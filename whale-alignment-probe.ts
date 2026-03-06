import { config } from "dotenv";
import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { registerExactSvmScheme } from "@x402/svm/exact/client";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { base58 } from "@scure/base";
import { writeFileSync } from "fs";

config();

const svmPrivateKey = process.env.SVM_PRIVATE_KEY as string;
const baseURL = "https://api.nansen.ai";

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
    throw new Error(`${path} returned ${response.status}: ${text.slice(0, 300)}`);
  }
  return response.json();
}

// ─── Whale Alignment Probe ──────────────────────────────────────────────────
// Cross-reference SM DEX Trades with Flow Intelligence to check:
// 1. Are whales aligned with SM? (both buying = strong, diverging = warning)
// 2. Are exchanges accumulating or distributing?
// 3. Are fresh wallets entering? (potential insider/early signal)
//
// Cost: $0.05 (SM DEX Trades) + $0.01/token (Flow Intel) = ~$0.15-0.25

interface TradeAggregation {
  token_address: string;
  token_symbol: string;
  market_cap: number;
  token_age_days: number;
  buy_count: number;
  sell_count: number;
  buy_volume_usd: number;
  sell_volume_usd: number;
  net_usd: number;
  traders: Set<string>;
  trader_labels: string[];
}

async function main() {
  await initClient();

  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║          WHALE ALIGNMENT PROBE                              ║");
  console.log("║   SM DEX Trades x Flow Intelligence = Convergence Check     ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");

  // ── Step 1: Get SM DEX Trades ──
  console.log("\n[1/3] Smart Money DEX Trades ($0.05)...");
  const trades = await callEndpoint<{ data: any[] }>("/api/v1/smart-money/dex-trades", {
    chains: ["solana"],
    order_by: [{ field: "trade_value_usd", direction: "DESC" }],
  });
  console.log(`  ${trades.data.length} trades`);

  // Aggregate by token bought (we care about what SM is buying, not selling)
  const byToken = new Map<string, TradeAggregation>();

  for (const t of trades.data) {
    // Token being bought
    if (t.token_bought_address && t.token_bought_symbol !== "SOL" && t.token_bought_symbol !== "USDC" && t.token_bought_symbol !== "USDT") {
      const addr = t.token_bought_address;
      const existing = byToken.get(addr) || {
        token_address: addr,
        token_symbol: t.token_bought_symbol || "???",
        market_cap: t.token_bought_market_cap || 0,
        token_age_days: t.token_bought_age_days || 0,
        buy_count: 0,
        sell_count: 0,
        buy_volume_usd: 0,
        sell_volume_usd: 0,
        net_usd: 0,
        traders: new Set<string>(),
        trader_labels: [],
      };
      existing.buy_count++;
      existing.buy_volume_usd += t.trade_value_usd || 0;
      existing.net_usd += t.trade_value_usd || 0;
      existing.traders.add(t.trader_address);
      if (t.trader_address_label && !existing.trader_labels.includes(t.trader_address_label)) {
        existing.trader_labels.push(t.trader_address_label);
      }
      byToken.set(addr, existing);
    }

    // Token being sold (negative signal)
    if (t.token_sold_address && t.token_sold_symbol !== "SOL" && t.token_sold_symbol !== "USDC" && t.token_sold_symbol !== "USDT") {
      const addr = t.token_sold_address;
      const existing = byToken.get(addr) || {
        token_address: addr,
        token_symbol: t.token_sold_symbol || "???",
        market_cap: t.token_sold_market_cap || 0,
        token_age_days: t.token_sold_age_days || 0,
        buy_count: 0,
        sell_count: 0,
        buy_volume_usd: 0,
        sell_volume_usd: 0,
        net_usd: 0,
        traders: new Set<string>(),
        trader_labels: [],
      };
      existing.sell_count++;
      existing.sell_volume_usd += t.trade_value_usd || 0;
      existing.net_usd -= t.trade_value_usd || 0;
      existing.traders.add(t.trader_address);
      byToken.set(addr, existing);
    }
  }

  // Sort by net buying volume
  const sorted = [...byToken.values()]
    .filter(t => t.net_usd > 0) // only net buyers
    .sort((a, b) => b.net_usd - a.net_usd);

  console.log(`\n  ${byToken.size} unique tokens in SM trades`);
  console.log(`  ${sorted.length} tokens with net SM buying`);

  console.log("\n  SM DEX Trade Summary (net buyers only):");
  console.log("  " + "-".repeat(95));
  console.log("  " + "Token".padEnd(12) + "Net Buy".padStart(10) + "Buys".padStart(6) + "Sells".padStart(6) + "Traders".padStart(9) + "MCap".padStart(12) + "Age".padStart(8) + "  Notable");
  console.log("  " + "-".repeat(95));
  for (const t of sorted.slice(0, 15)) {
    const mcap = t.market_cap > 1e6 ? `$${(t.market_cap / 1e6).toFixed(1)}M` : `$${(t.market_cap / 1000).toFixed(0)}k`;
    const labels = t.trader_labels.slice(0, 2).join(", ") || "-";
    console.log(`  ${t.token_symbol.padEnd(12)} ${("$" + (t.net_usd / 1000).toFixed(1) + "k").padStart(10)} ${String(t.buy_count).padStart(6)} ${String(t.sell_count).padStart(6)} ${String(t.traders.size).padStart(9)} ${mcap.padStart(12)} ${(t.token_age_days + "d").padStart(8)}  ${labels}`);
  }

  // ── Step 2: Flow Intelligence for top SM-bought tokens ──
  const topTokens = sorted.slice(0, 10);
  console.log(`\n[2/3] Flow Intelligence for top ${topTokens.length} SM-bought tokens ($0.01 each)...`);

  const alignmentResults: any[] = [];

  for (const token of topTokens) {
    await new Promise(r => setTimeout(r, 300));
    try {
      const flow = await callEndpoint<{ data: any[] }>("/api/v1/tgm/flow-intelligence", {
        token_address: token.token_address,
        chain: "solana",
      });
      const f = flow.data[0];
      if (!f) {
        console.log(`  ${token.token_symbol}: no flow data`);
        continue;
      }

      const whaleFlow = f.whale_net_flow_usd || 0;
      const smFlow = f.smart_trader_net_flow_usd || 0;
      const exchangeFlow = f.exchange_net_flow_usd || 0;
      const freshFlow = f.fresh_wallets_net_flow_usd || 0;
      const publicFlow = f.public_figure_net_flow_usd || 0;
      const topPnlFlow = f.top_pnl_net_flow_usd || 0;

      // Alignment scoring
      let alignment = 0;
      const signals: string[] = [];

      // SM buying (confirmed from DEX trades)
      alignment += 1;
      signals.push(`SM DEX: +$${(token.net_usd / 1000).toFixed(1)}k`);

      // Whale alignment
      if (whaleFlow > 1000) {
        alignment += 2;
        signals.push(`Whales: +$${(whaleFlow / 1000).toFixed(1)}k ALIGNED`);
      } else if (whaleFlow < -1000) {
        alignment -= 2;
        signals.push(`Whales: $${(whaleFlow / 1000).toFixed(1)}k DIVERGING`);
      } else {
        signals.push(`Whales: $${(whaleFlow / 1000).toFixed(1)}k neutral`);
      }

      // Exchange flow (negative = tokens leaving exchanges = bullish)
      if (exchangeFlow < -5000) {
        alignment += 2;
        signals.push(`Exchanges: $${(exchangeFlow / 1000).toFixed(1)}k WITHDRAWING`);
      } else if (exchangeFlow > 5000) {
        alignment -= 1;
        signals.push(`Exchanges: +$${(exchangeFlow / 1000).toFixed(1)}k depositing`);
      } else {
        signals.push(`Exchanges: $${(exchangeFlow / 1000).toFixed(1)}k flat`);
      }

      // Fresh wallets (could be insiders or genuine new interest)
      if (freshFlow > 5000) {
        alignment += 1;
        signals.push(`Fresh wallets: +$${(freshFlow / 1000).toFixed(1)}k entering`);
      } else if (freshFlow > 50000) {
        // Suspiciously large fresh wallet flow could be sybil
        alignment -= 1;
        signals.push(`Fresh wallets: +$${(freshFlow / 1000).toFixed(1)}k SUSPICIOUS`);
      }

      // Top PnL traders
      if (topPnlFlow > 1000) {
        alignment += 1;
        signals.push(`Top PnL traders: +$${(topPnlFlow / 1000).toFixed(1)}k buying`);
      } else if (topPnlFlow < -1000) {
        alignment -= 1;
        signals.push(`Top PnL traders: $${(topPnlFlow / 1000).toFixed(1)}k selling`);
      }

      // Public figures
      if (publicFlow > 1000) {
        alignment += 1;
        signals.push(`Public figures: +$${(publicFlow / 1000).toFixed(1)}k`);
      }

      const verdict = alignment >= 4 ? "STRONG CONVERGENCE" :
                      alignment >= 2 ? "ALIGNED" :
                      alignment >= 0 ? "MIXED" :
                      "DIVERGING";

      const result = {
        token_symbol: token.token_symbol,
        token_address: token.token_address,
        market_cap: token.market_cap,
        token_age_days: token.token_age_days,
        sm_dex_net: token.net_usd,
        sm_traders: token.traders.size,
        whale_flow: whaleFlow,
        exchange_flow: exchangeFlow,
        fresh_wallet_flow: freshFlow,
        top_pnl_flow: topPnlFlow,
        public_figure_flow: publicFlow,
        alignment_score: alignment,
        verdict,
        signals,
      };
      alignmentResults.push(result);

      const icon = verdict === "STRONG CONVERGENCE" ? "***" : verdict === "ALIGNED" ? " **" : verdict === "MIXED" ? "  *" : "  !";
      console.log(`  ${icon} ${token.token_symbol.padEnd(10)} alignment: ${alignment} (${verdict})`);

    } catch (e: any) {
      console.log(`  ${token.token_symbol}: flow intel failed - ${e.message.slice(0, 80)}`);
    }
  }

  // ── Step 3: Results ──
  console.log("\n[3/3] Alignment Analysis\n");

  const byVerdict = {
    strong: alignmentResults.filter(r => r.verdict === "STRONG CONVERGENCE"),
    aligned: alignmentResults.filter(r => r.verdict === "ALIGNED"),
    mixed: alignmentResults.filter(r => r.verdict === "MIXED"),
    diverging: alignmentResults.filter(r => r.verdict === "DIVERGING"),
  };

  console.log(`  Strong convergence: ${byVerdict.strong.length}`);
  console.log(`  Aligned:            ${byVerdict.aligned.length}`);
  console.log(`  Mixed:              ${byVerdict.mixed.length}`);
  console.log(`  Diverging:          ${byVerdict.diverging.length}`);

  // Print detailed results sorted by alignment
  const allSorted = alignmentResults.sort((a, b) => b.alignment_score - a.alignment_score);

  for (const r of allSorted) {
    const mcap = r.market_cap > 1e6 ? `$${(r.market_cap / 1e6).toFixed(1)}M` : `$${(r.market_cap / 1000).toFixed(0)}k`;
    console.log(`\n  ── ${r.token_symbol} (${mcap}, ${r.token_age_days}d) ── ${r.verdict} (score: ${r.alignment_score})`);
    console.log(`     ${r.token_address}`);
    for (const s of r.signals) {
      console.log(`     ${s}`);
    }
  }

  // ── Save results ──
  const output = {
    timestamp: new Date().toISOString(),
    sm_trades_analyzed: trades.data.length,
    unique_tokens: byToken.size,
    net_buying_tokens: sorted.length,
    flow_intel_checked: alignmentResults.length,
    summary: byVerdict,
    results: allSorted.map(r => ({ ...r })),
    cost: `~$${(0.05 + topTokens.length * 0.01).toFixed(2)}`,
  };
  writeFileSync("whale-alignment-results.json", JSON.stringify(output, null, 2));
  console.log(`\nResults saved to whale-alignment-results.json`);
  console.log(`Cost: ~$${(0.05 + topTokens.length * 0.01).toFixed(2)}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
