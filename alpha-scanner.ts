import { config } from "dotenv";
import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { registerExactSvmScheme } from "@x402/svm/exact/client";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { base58 } from "@scure/base";
import { writeFileSync } from "fs";

config();

const svmPrivateKey = process.env.SVM_PRIVATE_KEY as string;
const baseURL = "https://api.nansen.ai";

// ─── Types ───────────────────────────────────────────────────────────────────

interface SmartMoneyFlow {
  token_address: string;
  token_symbol: string;
  net_flow_1h_usd: number;
  net_flow_24h_usd: number;
  net_flow_7d_usd: number;
  net_flow_30d_usd: number;
  chain: string;
  token_sectors: string[];
  trader_count: number;
  token_age_days: number;
  market_cap_usd: number;
}

interface SmartMoneyTrade {
  chain: string;
  block_timestamp: string;
  trader_address: string;
  trader_address_label: string;
  token_bought_address: string;
  token_sold_address: string;
  token_bought_amount: number;
  token_sold_amount: number;
  token_bought_symbol: string;
  token_sold_symbol: string;
  token_bought_age_days: number;
  token_sold_age_days: number;
  token_bought_market_cap: number;
  token_sold_market_cap: number;
  trade_value_usd: number;
}

interface FlowIntel {
  public_figure_net_flow_usd: number;
  top_pnl_net_flow_usd: number;
  whale_net_flow_usd: number;
  smart_trader_net_flow_usd: number;
  exchange_net_flow_usd: number;
  fresh_wallets_net_flow_usd: number;
  whale_wallet_count: number;
  smart_trader_wallet_count: number;
  fresh_wallets_wallet_count: number;
}

interface TokenScreenerEntry {
  chain: string;
  token_address: string;
  token_symbol: string;
  token_age_days: number;
  market_cap_usd: number;
  liquidity: number;
  price_usd: number;
  price_change: number;
  buy_volume: number;
  sell_volume: number;
  volume: number;
  netflow: number;
}

interface ScoredToken {
  token_address: string;
  token_symbol: string;
  market_cap_usd: number;
  token_age_days: number;
  // Smart Money signals
  sm_net_flow_1h: number;
  sm_net_flow_24h: number;
  sm_trader_count: number;
  sm_flow_trend: "accelerating" | "steady" | "decelerating" | "new";
  sm_recent_buys: number;
  sm_recent_buy_usd: number;
  sm_sources: string[];
  // Flow Intel signals
  whale_flow: number;
  exchange_flow: number;
  fresh_wallet_flow: number;
  smart_trader_flow: number;
  // Market signals
  buy_sell_ratio: number;
  price_change: number;
  netflow: number;
  liquidity: number;
  // Scoring
  alpha_score: number;
  risk_score: number;
  signals: string[];
  warnings: string[];
}

// ─── API Client ──────────────────────────────────────────────────────────────

let fetchWithPayment: typeof fetch;

async function initClient() {
  const svmSigner = await createKeyPairSignerFromBytes(base58.decode(svmPrivateKey));
  const client = new x402Client();
  registerExactSvmScheme(client, { signer: svmSigner });
  fetchWithPayment = wrapFetchWithPayment(fetch, client);
}

async function callEndpoint<T>(path: string, body: Record<string, any>): Promise<T> {
  const response = await fetchWithPayment(`${baseURL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${path} returned ${response.status}: ${text.slice(0, 200)}`);
  }
  return response.json();
}

// ─── Phase 1: Smart Money Net Flow ──────────────────────────────────────────

async function getSmartMoneyNetFlow(): Promise<SmartMoneyFlow[]> {
  console.log("\n[1/4] Fetching Smart Money Net Flow - 3 views ($0.15)...");

  // View A: Sort by 1h flow (LEADING signal - what's being bought RIGHT NOW)
  const by1h = await callEndpoint<{ data: SmartMoneyFlow[] }>("/api/v1/smart-money/netflow", {
    chains: ["solana"],
    order_by: [{ field: "net_flow_1h_usd", direction: "DESC" }],
  });
  console.log(`  By 1h momentum: ${by1h.data.length} tokens`);

  // View B: Sort by 24h flow (ongoing accumulation)
  const by24h = await callEndpoint<{ data: SmartMoneyFlow[] }>("/api/v1/smart-money/netflow", {
    chains: ["solana"],
    order_by: [{ field: "net_flow_24h_usd", direction: "DESC" }],
  });
  console.log(`  By 24h accumulation: ${by24h.data.length} tokens`);

  // View C: Sort by trader_count (broad interest - LAGGING, used for context only)
  const byCount = await callEndpoint<{ data: SmartMoneyFlow[] }>("/api/v1/smart-money/netflow", {
    chains: ["solana"],
    order_by: [{ field: "trader_count", direction: "DESC" }],
  });
  console.log(`  By trader count (context): ${byCount.data.length} tokens`);

  // Merge and dedupe, but tag the source
  const seen = new Map<string, SmartMoneyFlow & { _sources: string[] }>();
  for (const item of by1h.data) {
    seen.set(item.token_address, { ...item, _sources: ["1h"] });
  }
  for (const item of by24h.data) {
    const existing = seen.get(item.token_address);
    if (existing) {
      existing._sources.push("24h");
    } else {
      seen.set(item.token_address, { ...item, _sources: ["24h"] });
    }
  }
  for (const item of byCount.data) {
    const existing = seen.get(item.token_address);
    if (existing) {
      existing._sources.push("count");
    } else {
      seen.set(item.token_address, { ...item, _sources: ["count"] });
    }
  }

  const merged = [...seen.values()];
  const multiSource = merged.filter(t => t._sources.length > 1);
  console.log(`  Merged: ${merged.length} unique tokens (${multiSource.length} appear in multiple views)`);
  return merged;
}

// ─── Phase 2: Smart Money DEX Trades ────────────────────────────────────────

async function getSmartMoneyTrades(): Promise<SmartMoneyTrade[]> {
  console.log("\n[2/4] Fetching Smart Money DEX Trades - by value ($0.05)...");
  const result = await callEndpoint<{ data: SmartMoneyTrade[] }>("/api/v1/smart-money/dex-trades", {
    chains: ["solana"],
    order_by: [{ field: "trade_value_usd", direction: "DESC" }],
  });
  console.log(`  Found ${result.data.length} recent smart money trades (sorted by value)`);
  return result.data;
}

// ─── Phase 3: Flow Intelligence (per token) ─────────────────────────────────

async function getFlowIntel(tokenAddress: string): Promise<FlowIntel | null> {
  try {
    const result = await callEndpoint<{ data: FlowIntel[] }>("/api/v1/tgm/flow-intelligence", {
      token_address: tokenAddress,
      chain: "solana",
    });
    return result.data[0] || null;
  } catch {
    return null;
  }
}

// ─── Phase 4: Token Screener ────────────────────────────────────────────────

async function getTokenScreener(): Promise<TokenScreenerEntry[]> {
  console.log("\n[4/4] Fetching Token Screener - 2 views ($0.02)...");

  // View A: Highest volume (where the action is)
  const byVolume = await callEndpoint<{ data: TokenScreenerEntry[] }>("/api/v1/token-screener", {
    chains: ["solana"],
    timeframe: "24h",
    hide_spam_tokens: true,
    order_by: [{ field: "volume", direction: "DESC" }],
  });
  console.log(`  By volume: ${byVolume.data.length} tokens`);

  // View B: By market cap (catch the big movers)
  const byMcap = await callEndpoint<{ data: TokenScreenerEntry[] }>("/api/v1/token-screener", {
    chains: ["solana"],
    timeframe: "24h",
    hide_spam_tokens: true,
    order_by: [{ field: "market_cap_usd", direction: "DESC" }],
  });
  console.log(`  By mcap: ${byMcap.data.length} tokens`);

  // Merge and dedupe
  const seen = new Set<string>();
  const merged: TokenScreenerEntry[] = [];
  for (const item of [...byVolume.data, ...byMcap.data]) {
    if (!seen.has(item.token_address)) {
      seen.add(item.token_address);
      merged.push(item);
    }
  }
  console.log(`  Merged: ${merged.length} unique tokens`);
  return merged;
}

// ─── Scoring Engine ─────────────────────────────────────────────────────────

function scoreToken(token: Partial<ScoredToken>): { alpha: number; risk: number; signals: string[]; warnings: string[] } {
  let alpha = 0;
  let risk = 0;
  const signals: string[] = [];
  const warnings: string[] = [];

  // === ALPHA SIGNALS ===

  // 1H FLOW: The hypothesized leading indicator
  const flow1h = token.sm_net_flow_1h ?? 0;
  if (flow1h > 5000) {
    alpha += 20;
    signals.push(`1H SM inflow: $${(flow1h / 1000).toFixed(1)}k (ACTIVE NOW)`);
  } else if (flow1h > 1000) {
    alpha += 12;
    signals.push(`1H SM inflow: $${(flow1h / 1000).toFixed(1)}k`);
  } else if (flow1h > 0) {
    alpha += 5;
    signals.push(`1H SM inflow: $${flow1h.toFixed(0)}`);
  }

  // 24h accumulation (supporting signal)
  if ((token.sm_net_flow_24h ?? 0) > 10000) {
    alpha += 10;
    signals.push(`24h SM: $${((token.sm_net_flow_24h ?? 0) / 1000).toFixed(1)}k`);
  } else if ((token.sm_net_flow_24h ?? 0) > 5000) {
    alpha += 5;
  }

  // Appears in multiple sort views (1h + 24h + count) = convergent signal
  const sources = token.sm_sources ?? [];
  if (sources.length >= 3) {
    alpha += 15;
    signals.push("In ALL 3 SM views (1h + 24h + count)");
  } else if (sources.length >= 2) {
    alpha += 8;
    signals.push(`In ${sources.join(" + ")} SM views`);
  }

  // Multiple SM wallets (context, not primary)
  if ((token.sm_trader_count ?? 0) >= 5) {
    alpha += 8;
    signals.push(`${token.sm_trader_count} SM wallets`);
  } else if ((token.sm_trader_count ?? 0) >= 3) {
    alpha += 4;
  }

  // Flow acceleration: 1h rate exceeds 24h average hourly rate
  if (token.sm_flow_trend === "accelerating") {
    alpha += 10;
    signals.push("Flow ACCELERATING (1h > 24h avg/hr)");
  }

  // Recent buy activity from SM DEX Trades
  if ((token.sm_recent_buys ?? 0) >= 3) {
    alpha += 10;
    signals.push(`${token.sm_recent_buys} recent SM buys`);
  } else if ((token.sm_recent_buys ?? 0) >= 1) {
    alpha += 5;
    signals.push(`${token.sm_recent_buys} recent SM buy`);
  }

  // Whale buying
  if ((token.whale_flow ?? 0) > 0) {
    alpha += 10;
    signals.push(`Whales net buying $${((token.whale_flow ?? 0) / 1000).toFixed(1)}k`);
  }

  // Smart traders buying
  if ((token.smart_trader_flow ?? 0) > 0) {
    alpha += 8;
    signals.push("Smart traders net buying");
  }

  // Top PnL traders buying (from flow intel)
  // (already captured in smart_trader_flow)

  // Positive market netflow (more buying than selling)
  if ((token.netflow ?? 0) > 0 && (token.buy_sell_ratio ?? 1) > 1.1) {
    alpha += 5;
    signals.push(`Buy/sell ratio: ${(token.buy_sell_ratio ?? 0).toFixed(2)}`);
  }

  // Price momentum aligning with flow
  if ((token.price_change ?? 0) > 0 && (token.sm_net_flow_24h ?? 0) > 0) {
    alpha += 5;
    signals.push(`Price up ${((token.price_change ?? 0) * 100).toFixed(1)}% with SM buying`);
  }

  // Early token (higher potential)
  if ((token.token_age_days ?? 999) < 30 && (token.sm_trader_count ?? 0) >= 2) {
    alpha += 10;
    signals.push(`Young token (${token.token_age_days}d) with SM interest`);
  }

  // Low mcap with SM interest (asymmetric upside)
  if ((token.market_cap_usd ?? 0) < 10_000_000 && (token.sm_trader_count ?? 0) >= 2) {
    alpha += 10;
    signals.push(`Low mcap ($${((token.market_cap_usd ?? 0) / 1_000_000).toFixed(1)}M) + SM`);
  }

  // === RISK SIGNALS ===

  // Fresh wallet inflow (potential rug/manipulation)
  if ((token.fresh_wallet_flow ?? 0) > 100000) {
    risk += 20;
    warnings.push(`High fresh wallet inflow: $${((token.fresh_wallet_flow ?? 0) / 1000).toFixed(0)}k`);
  }

  // Exchange outflow (dumping)
  if ((token.exchange_flow ?? 0) < -50000) {
    risk += 10;
    warnings.push("Exchanges net selling");
  }

  // Whale selling while SM buying (divergence)
  if ((token.whale_flow ?? 0) < 0 && (token.sm_net_flow_24h ?? 0) > 0) {
    risk += 10;
    warnings.push("Whale/SM divergence (whales selling)");
  }

  // Very young token
  if ((token.token_age_days ?? 999) < 7) {
    risk += 15;
    warnings.push(`Very new token (${token.token_age_days}d old)`);
  }

  // Extremely low liquidity
  if ((token.liquidity ?? 0) < 50000 && (token.liquidity ?? 0) > 0) {
    risk += 15;
    warnings.push(`Low liquidity ($${((token.liquidity ?? 0) / 1000).toFixed(0)}k)`);
  }

  // Tiny mcap (could be illiquid)
  if ((token.market_cap_usd ?? 0) < 100000 && (token.market_cap_usd ?? 0) > 0) {
    risk += 15;
    warnings.push("Micro-cap (<$100k)");
  }

  // SM selling (negative flow)
  if ((token.sm_net_flow_24h ?? 0) < -5000) {
    risk += 10;
    warnings.push(`SM net selling $${(Math.abs(token.sm_net_flow_24h ?? 0) / 1000).toFixed(1)}k/24h`);
  }

  return { alpha, risk, signals, warnings };
}

// ─── Main Scanner ───────────────────────────────────────────────────────────

async function scan() {
  await initClient();

  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║           NANSEN x402 SOLANA ALPHA SCANNER v2               ║");
  console.log("║   1h-flow hypothesis | $0.27 base + $0.01/flow-intel        ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");

  // Phase 1 & 2: Parallel fetch of SM Net Flow + SM DEX Trades + Token Screener
  const [smFlows, smTrades, screener] = await Promise.all([
    getSmartMoneyNetFlow(),
    getSmartMoneyTrades(),
    getTokenScreener(),
  ]);

  // Build lookup maps
  const screenerMap = new Map<string, TokenScreenerEntry>();
  for (const t of screener) {
    screenerMap.set(t.token_address, t);
  }

  // Aggregate SM trades by token bought
  const smBuysByToken = new Map<string, { count: number; totalUsd: number; traders: Set<string> }>();
  for (const trade of smTrades) {
    const addr = trade.token_bought_address;
    if (addr === "So11111111111111111111111111111111111111112") continue; // skip SOL buys (just exits)
    const existing = smBuysByToken.get(addr) || { count: 0, totalUsd: 0, traders: new Set<string>() };
    existing.count++;
    existing.totalUsd += trade.trade_value_usd;
    existing.traders.add(trade.trader_address);
    smBuysByToken.set(addr, existing);
  }

  // Build candidate list from SM Net Flow (tokens being accumulated)
  const candidates = new Map<string, Partial<ScoredToken>>();

  for (const flow of smFlows as (SmartMoneyFlow & { _sources?: string[] })[]) {
    candidates.set(flow.token_address, {
      token_address: flow.token_address,
      token_symbol: flow.token_symbol,
      market_cap_usd: flow.market_cap_usd,
      token_age_days: flow.token_age_days,
      sm_net_flow_1h: flow.net_flow_1h_usd,
      sm_net_flow_24h: flow.net_flow_24h_usd,
      sm_trader_count: flow.trader_count,
      sm_sources: flow._sources ?? [],
      sm_flow_trend:
        flow.net_flow_1h_usd > 0 && flow.net_flow_24h_usd > 0 && flow.net_flow_1h_usd > flow.net_flow_24h_usd / 24
          ? "accelerating"
          : flow.net_flow_24h_usd > 0 && flow.net_flow_7d_usd > 0
            ? "steady"
            : flow.net_flow_24h_usd > 0 && flow.net_flow_7d_usd < 0
              ? "new"
              : "decelerating",
    });
  }

  // Also add tokens from SM trades that aren't already in the flow data
  for (const [addr, buys] of smBuysByToken) {
    if (!candidates.has(addr)) {
      const screenerData = screenerMap.get(addr);
      candidates.set(addr, {
        token_address: addr,
        token_symbol: screenerData?.token_symbol ?? "???",
        market_cap_usd: screenerData?.market_cap_usd ?? 0,
        token_age_days: screenerData?.token_age_days ?? 0,
        sm_net_flow_1h: 0,
        sm_net_flow_24h: 0,
        sm_trader_count: buys.traders.size,
        sm_sources: ["trades"],
        sm_flow_trend: "new",
      });
    }
  }

  // Enrich with SM trade data
  for (const [addr, buys] of smBuysByToken) {
    const candidate = candidates.get(addr);
    if (candidate) {
      candidate.sm_recent_buys = buys.count;
      candidate.sm_recent_buy_usd = buys.totalUsd;
    }
  }

  // Enrich with screener data
  for (const [addr, candidate] of candidates) {
    const s = screenerMap.get(addr);
    if (s) {
      candidate.buy_sell_ratio = s.sell_volume > 0 ? s.buy_volume / s.sell_volume : 0;
      candidate.price_change = s.price_change;
      candidate.netflow = s.netflow;
      candidate.liquidity = s.liquidity;
      if (!candidate.market_cap_usd) candidate.market_cap_usd = s.market_cap_usd;
    }
  }

  // Phase 3: Flow Intelligence for top candidates (the ones with strongest initial signals)
  // Pre-score to decide which ones are worth the $0.01 flow intel call
  const preScoredCandidates = [...candidates.values()]
    .map(c => ({ ...c, _preScore: (c.sm_net_flow_24h ?? 0) + (c.sm_recent_buy_usd ?? 0) * 2 }))
    .sort((a, b) => b._preScore - a._preScore);

  const topCandidates = preScoredCandidates.slice(0, 10); // Flow intel for top 10 only
  console.log(`\n[3/4] Fetching Flow Intelligence for top ${topCandidates.length} candidates ($0.01 each)...`);

  for (const candidate of topCandidates) {
    if (!candidate.token_address) continue;
    await new Promise(r => setTimeout(r, 300)); // rate limit
    const intel = await getFlowIntel(candidate.token_address);
    if (intel) {
      candidate.whale_flow = intel.whale_net_flow_usd;
      candidate.exchange_flow = intel.exchange_net_flow_usd;
      candidate.fresh_wallet_flow = intel.fresh_wallets_net_flow_usd;
      candidate.smart_trader_flow = intel.smart_trader_net_flow_usd;
      console.log(`  ${candidate.token_symbol}: whale=${(intel.whale_net_flow_usd / 1000).toFixed(1)}k, exchange=${(intel.exchange_net_flow_usd / 1000).toFixed(1)}k, fresh=${(intel.fresh_wallets_net_flow_usd / 1000).toFixed(1)}k`);
    }
  }

  // Final scoring
  const scoredTokens: ScoredToken[] = [];
  for (const candidate of candidates.values()) {
    const { alpha, risk, signals, warnings } = scoreToken(candidate);
    scoredTokens.push({
      token_address: candidate.token_address ?? "",
      token_symbol: candidate.token_symbol ?? "???",
      market_cap_usd: candidate.market_cap_usd ?? 0,
      token_age_days: candidate.token_age_days ?? 0,
      sm_net_flow_1h: candidate.sm_net_flow_1h ?? 0,
      sm_net_flow_24h: candidate.sm_net_flow_24h ?? 0,
      sm_trader_count: candidate.sm_trader_count ?? 0,
      sm_flow_trend: candidate.sm_flow_trend ?? "new",
      sm_recent_buys: candidate.sm_recent_buys ?? 0,
      sm_recent_buy_usd: candidate.sm_recent_buy_usd ?? 0,
      sm_sources: candidate.sm_sources ?? [],
      whale_flow: candidate.whale_flow ?? 0,
      exchange_flow: candidate.exchange_flow ?? 0,
      fresh_wallet_flow: candidate.fresh_wallet_flow ?? 0,
      smart_trader_flow: candidate.smart_trader_flow ?? 0,
      buy_sell_ratio: candidate.buy_sell_ratio ?? 0,
      price_change: candidate.price_change ?? 0,
      netflow: candidate.netflow ?? 0,
      liquidity: candidate.liquidity ?? 0,
      alpha_score: alpha,
      risk_score: risk,
      signals,
      warnings,
    });
  }

  // Sort by alpha_score descending, then by risk ascending
  scoredTokens.sort((a, b) => {
    const netA = a.alpha_score - a.risk_score;
    const netB = b.alpha_score - b.risk_score;
    return netB - netA;
  });

  // ─── Output ─────────────────────────────────────────────────────────────

  console.log("\n");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("                    ALPHA OPPORTUNITIES                        ");
  console.log("═══════════════════════════════════════════════════════════════");

  const topAlpha = scoredTokens.filter(t => t.alpha_score > 0).slice(0, 15);

  for (let i = 0; i < topAlpha.length; i++) {
    const t = topAlpha[i];
    const net = t.alpha_score - t.risk_score;
    const mcapStr = t.market_cap_usd >= 1_000_000
      ? `$${(t.market_cap_usd / 1_000_000).toFixed(1)}M`
      : `$${(t.market_cap_usd / 1000).toFixed(0)}k`;

    console.log(`\n#${i + 1} ${t.token_symbol} (${mcapStr} mcap, ${t.token_age_days}d old) [${t.sm_sources.join("+")}]`);
    console.log(`   Alpha: ${t.alpha_score} | Risk: ${t.risk_score} | Net: ${net}`);
    console.log(`   SM Flow 1h: $${(t.sm_net_flow_1h / 1000).toFixed(1)}k | 24h: $${(t.sm_net_flow_24h / 1000).toFixed(1)}k | Traders: ${t.sm_trader_count} | Trend: ${t.sm_flow_trend}`);
    if (t.sm_recent_buys > 0) {
      console.log(`   Recent SM buys: ${t.sm_recent_buys} ($${(t.sm_recent_buy_usd / 1000).toFixed(1)}k)`);
    }
    if (t.whale_flow !== 0 || t.exchange_flow !== 0) {
      console.log(`   Whale: $${(t.whale_flow / 1000).toFixed(1)}k | Exchange: $${(t.exchange_flow / 1000).toFixed(1)}k | Fresh: $${(t.fresh_wallet_flow / 1000).toFixed(1)}k`);
    }
    if (t.price_change !== 0) {
      console.log(`   Price: ${(t.price_change * 100).toFixed(2)}% | Buy/Sell: ${t.buy_sell_ratio.toFixed(2)} | Liq: $${(t.liquidity / 1000).toFixed(0)}k`);
    }
    if (t.signals.length > 0) {
      console.log(`   ✓ ${t.signals.join(" | ")}`);
    }
    if (t.warnings.length > 0) {
      console.log(`   ⚠ ${t.warnings.join(" | ")}`);
    }
    console.log(`   ${t.token_address}`);
  }

  // ─── Risk Alerts ────────────────────────────────────────────────────────

  const riskyTokens = scoredTokens.filter(t => t.risk_score >= 20 && t.sm_net_flow_24h < 0);
  if (riskyTokens.length > 0) {
    console.log("\n");
    console.log("═══════════════════════════════════════════════════════════════");
    console.log("                      RISK ALERTS                             ");
    console.log("═══════════════════════════════════════════════════════════════");

    for (const t of riskyTokens.slice(0, 5)) {
      console.log(`\n⚠ ${t.token_symbol} - SM selling $${(Math.abs(t.sm_net_flow_24h) / 1000).toFixed(1)}k/24h`);
      if (t.warnings.length > 0) {
        console.log(`  ${t.warnings.join(" | ")}`);
      }
    }
  }

  // Save full results
  const output = {
    timestamp: new Date().toISOString(),
    cost_estimate: `$${(0.10 + 0.05 + 0.02 + topCandidates.length * 0.01).toFixed(2)}`,
    total_candidates: candidates.size,
    top_alpha: topAlpha,
    risk_alerts: riskyTokens.slice(0, 5),
    raw: {
      sm_flows_count: smFlows.length,
      sm_trades_count: smTrades.length,
      screener_count: screener.length,
    },
  };
  writeFileSync("alpha-results.json", JSON.stringify(output, null, 2));
  console.log(`\n\nFull results saved to alpha-results.json`);
  console.log(`Scan cost: ${output.cost_estimate}`);
}

scan().catch(error => {
  console.error(error);
  process.exit(1);
});
