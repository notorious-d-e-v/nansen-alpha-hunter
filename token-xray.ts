import { config } from "dotenv";
import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { registerExactSvmScheme } from "@x402/svm/exact/client";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { base58 } from "@scure/base";
import { writeFileSync, existsSync, readFileSync } from "fs";

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

// ─── Resolve target from CLI args or previous results ───────────────────────

function resolveTarget(): { symbol: string; address: string } {
  const arg = process.argv[2];
  if (!arg) {
    console.error("Usage: npx tsx token-xray.ts <TOKEN_SYMBOL or TOKEN_ADDRESS>");
    console.error("  e.g. npx tsx token-xray.ts GOYIM");
    console.error("  e.g. npx tsx token-xray.ts 9S8edqWxoWz5LYLnxWUmWBJnePg35WfdYQp7HQkUpump");
    process.exit(1);
  }

  // If it looks like an address (long string), use it directly
  if (arg.length > 20) {
    return { symbol: "???", address: arg };
  }

  // Otherwise, look up by symbol in previous results
  for (const file of ["alpha-results.json", "deep-dive-results.json"]) {
    if (!existsSync(file)) continue;
    const data = JSON.parse(readFileSync(file, "utf-8"));

    // alpha-results.json has top_alpha array
    if (data.top_alpha) {
      const match = data.top_alpha.find((t: any) => t.token_symbol?.toUpperCase() === arg.toUpperCase());
      if (match) return { symbol: match.token_symbol, address: match.token_address };
    }

    // deep-dive-results.json is keyed by symbol
    if (data[arg.toUpperCase()]) {
      // Need the address from alpha-results
      continue;
    }
  }

  console.error(`Could not find token "${arg}" in previous results. Pass a full address instead.`);
  process.exit(1);
}

const TODAY = "2026-03-06";
const WEEK_AGO = "2026-02-27";
const MONTH_AGO = "2026-02-06";

// ─── Analysis modules ───────────────────────────────────────────────────────

async function flowTimeline(symbol: string, address: string) {
  console.log(`\n[Hourly Flows - 7d] $0.01`);
  const result = await callEndpoint<{ data: any[] }>("/api/v1/tgm/flows", {
    token_address: address,
    chain: "solana",
    date: { from: WEEK_AGO, to: TODAY },
  });
  const flows = result.data;
  if (flows.length === 0) {
    console.log("  No flow data available");
    return null;
  }

  // Aggregate by day
  const byDay = new Map<string, { inflow: number; outflow: number; price: number; count: number }>();
  for (const f of flows) {
    const day = f.date.split("T")[0];
    const existing = byDay.get(day) || { inflow: 0, outflow: 0, price: 0, count: 0 };
    existing.inflow += f.total_inflows_count || 0;
    existing.outflow += Math.abs(f.total_outflows_count || 0);
    existing.price = f.price_usd; // last price of the day
    existing.count++;
    byDay.set(day, existing);
  }

  console.log("  Date       | Price         | Inflow (tokens)    | Outflow (tokens)   | Net");
  console.log("  " + "-".repeat(90));
  for (const [day, data] of [...byDay.entries()].sort()) {
    const net = data.inflow - data.outflow;
    const netStr = net >= 0 ? `+${(net / 1e6).toFixed(1)}M` : `${(net / 1e6).toFixed(1)}M`;
    console.log(`  ${day} | $${data.price.toFixed(8).padEnd(12)} | ${(data.inflow / 1e6).toFixed(1).padStart(8)}M       | ${(data.outflow / 1e6).toFixed(1).padStart(8)}M       | ${netStr}`);
  }

  // Trend detection
  const days = [...byDay.entries()].sort();
  const recentNet = days.slice(-3).reduce((s, [, d]) => s + d.inflow - d.outflow, 0);
  const earlierNet = days.slice(0, 3).reduce((s, [, d]) => s + d.inflow - d.outflow, 0);
  const trend = recentNet > earlierNet ? "INCREASING ACCUMULATION" : recentNet < earlierNet ? "INCREASING DISTRIBUTION" : "FLAT";
  console.log(`\n  Flow trend: ${trend}`);

  return { daily_flows: Object.fromEntries(byDay), trend, total_hours: flows.length };
}

async function dexTradeActivity(symbol: string, address: string) {
  const YESTERDAY = "2026-03-05";
  console.log(`\n[Recent DEX Trades - 2d] $0.01`);
  const result = await callEndpoint<{ data: any[] }>("/api/v1/tgm/dex-trades", {
    token_address: address,
    chain: "solana",
    date: { from: YESTERDAY, to: TODAY },
  });
  const trades = result.data;
  const buys = trades.filter((t: any) => t.action === "BUY");
  const sells = trades.filter((t: any) => t.action === "SELL");
  const buyVol = buys.reduce((s: number, t: any) => s + (t.estimated_value_usd || 0), 0);
  const sellVol = sells.reduce((s: number, t: any) => s + (t.estimated_value_usd || 0), 0);

  console.log(`  Trades shown: ${trades.length} (${buys.length} buys, ${sells.length} sells)`);
  console.log(`  Buy volume: $${(buyVol / 1000).toFixed(1)}k | Sell volume: $${(sellVol / 1000).toFixed(1)}k`);

  // Identify notable traders (labeled)
  const labeledTrades = trades.filter((t: any) => t.trader_address_label && !t.trader_address_label.match(/^\[/));
  if (labeledTrades.length > 0) {
    console.log(`\n  Notable trades:`);
    for (const t of labeledTrades.slice(0, 10)) {
      const val = t.estimated_value_usd?.toFixed(0) || "?";
      const time = t.block_timestamp?.split("T")[1]?.slice(0, 5) || "";
      console.log(`    ${t.action.padEnd(4)} $${val.padStart(8)} | ${t.block_timestamp?.split("T")[0]} ${time} | ${t.trader_address_label}`);
    }
  }

  // Check for whale-sized trades
  const bigTrades = trades.filter((t: any) => (t.estimated_value_usd || 0) > 5000);
  if (bigTrades.length > 0) {
    console.log(`\n  Whale trades (>$5k):`);
    for (const t of bigTrades.slice(0, 10)) {
      const label = t.trader_address_label || t.trader_address.slice(0, 8);
      console.log(`    ${t.action.padEnd(4)} $${t.estimated_value_usd.toFixed(0).padStart(8)} | ${t.block_timestamp} | ${label}`);
    }
  }

  return { total_trades: trades.length, buys: buys.length, sells: sells.length, buy_vol: buyVol, sell_vol: sellVol };
}

async function topHolderWalletProfiles(symbol: string, address: string) {
  // First get holders to find top non-LP wallets
  console.log(`\n[Top Holder Profiles] $0.05 (holders) + $0.01-0.03/wallet`);
  const holdersResult = await callEndpoint<{ data: any[] }>("/api/v1/tgm/holders", {
    token_address: address,
    chain: "solana",
  });

  // Filter out LPs and exchanges, get top holder wallets
  const wallets = holdersResult.data
    .filter((h: any) => {
      const label = (h.address_label || "").toLowerCase();
      return !label.includes("liquidity pool") && !label.includes("🏦");
    })
    .slice(0, 3);

  console.log(`  Profiling top ${wallets.length} non-LP holders...\n`);

  for (const wallet of wallets) {
    const label = wallet.address_label || wallet.address.slice(0, 10);
    const pct = ((wallet.ownership_percentage || 0) * 100).toFixed(2);
    console.log(`  ── ${label} (${pct}% holder) ──`);

    // Get their PnL summary
    try {
      console.log(`    [PnL Summary] $0.01`);
      const pnl = await callEndpoint<any>("/api/v1/profiler/address/pnl-summary", {
        address: wallet.address,
        chain: "solana",
        date: { from: MONTH_AGO, to: TODAY },
      });
      console.log(`      Win rate: ${((pnl.win_rate || 0) * 100).toFixed(0)}% | Trades: ${pnl.traded_times || 0} | Tokens: ${pnl.traded_token_count || 0}`);
      console.log(`      Realized PnL: $${((pnl.realized_pnl_usd || 0) / 1000).toFixed(1)}k (${((pnl.realized_pnl_percent || 0) * 100).toFixed(1)}%)`);
      if (pnl.top5_tokens?.length > 0) {
        console.log(`      Top tokens: ${pnl.top5_tokens.map((t: any) => t.token_symbol || t.token_address?.slice(0, 6)).join(", ")}`);
      }
    } catch (e: any) {
      console.log(`      PnL Summary: ${e.message.slice(0, 100)}`);
    }

    // Get related wallets
    try {
      console.log(`    [Related Wallets] $0.01`);
      const related = await callEndpoint<{ data: any[] }>("/api/v1/profiler/address/related-wallets", {
        address: wallet.address,
        chain: "solana",
      });
      if (related.data.length > 0) {
        console.log(`      ${related.data.length} related wallets found:`);
        for (const r of related.data.slice(0, 5)) {
          const rlabel = r.address_label || r.address.slice(0, 10);
          console.log(`        ${r.relation} | ${rlabel}`);
        }
      } else {
        console.log("      No related wallets found (isolated wallet)");
      }
    } catch (e: any) {
      console.log(`      Related wallets: ${e.message.slice(0, 100)}`);
    }

    await new Promise(r => setTimeout(r, 500));
    console.log();
  }

  return { profiled_wallets: wallets.length };
}

async function transferActivity(symbol: string, address: string) {
  console.log(`\n[Large Transfers - 7d] $0.01`);
  const result = await callEndpoint<{ data: any[] }>("/api/v1/tgm/transfers", {
    token_address: address,
    chain: "solana",
    date: { from: WEEK_AGO, to: TODAY },
  });
  const transfers = result.data;
  if (transfers.length === 0) {
    console.log("  No large transfers in the last 7 days");
    return null;
  }

  const toExchange = transfers.filter((t: any) => (t.to_address_label || "").includes("🏦"));
  const fromExchange = transfers.filter((t: any) => (t.from_address_label || "").includes("🏦"));
  const totalToExchange = toExchange.reduce((s: number, t: any) => s + (t.transfer_value_usd || 0), 0);
  const totalFromExchange = fromExchange.reduce((s: number, t: any) => s + (t.transfer_value_usd || 0), 0);

  console.log(`  Total transfers: ${transfers.length}`);
  console.log(`  To exchanges: ${toExchange.length} ($${(totalToExchange / 1000).toFixed(1)}k) - potential sell pressure`);
  console.log(`  From exchanges: ${fromExchange.length} ($${(totalFromExchange / 1000).toFixed(1)}k) - potential accumulation`);

  console.log(`\n  All transfers:`);
  for (const t of transfers.slice(0, 10)) {
    const from = t.from_address_label || t.from_address.slice(0, 10);
    const to = t.to_address_label || t.to_address.slice(0, 10);
    const val = (t.transfer_value_usd / 1000).toFixed(1);
    console.log(`    $${val.padStart(6)}k | ${from} -> ${to}`);
  }

  return {
    total: transfers.length,
    to_exchange: toExchange.length,
    from_exchange: fromExchange.length,
    to_exchange_usd: totalToExchange,
    from_exchange_usd: totalFromExchange,
    exchange_pressure: totalToExchange > totalFromExchange ? "SELL" : "ACCUMULATE",
  };
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  await initClient();
  const target = resolveTarget();

  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║                    TOKEN X-RAY                              ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");
  console.log(`  Target: ${target.symbol}`);
  console.log(`  Address: ${target.address}`);

  let totalCost = 0;

  // 1. Flow timeline ($0.01)
  const flows = await flowTimeline(target.symbol, target.address);
  totalCost += 0.01;
  await new Promise(r => setTimeout(r, 500));

  // 2. DEX trade activity ($0.01)
  let trades = null;
  try {
    trades = await dexTradeActivity(target.symbol, target.address);
    totalCost += 0.01;
  } catch (e: any) {
    console.log(`  DEX trades failed (likely timeout): ${e.message.slice(0, 100)}`);
  }
  await new Promise(r => setTimeout(r, 500));

  // 3. Large transfers ($0.01)
  let transfers = null;
  try {
    transfers = await transferActivity(target.symbol, target.address);
    totalCost += 0.01;
  } catch (e: any) {
    console.log(`  Transfers failed: ${e.message.slice(0, 100)}`);
  }
  await new Promise(r => setTimeout(r, 500));

  // 4. Top holder wallet profiles ($0.05 holders + ~$0.06 for 3 wallets)
  const profiles = await topHolderWalletProfiles(target.symbol, target.address);
  totalCost += 0.05 + profiles.profiled_wallets * 0.02;

  // Save
  const output = {
    target,
    timestamp: new Date().toISOString(),
    flows,
    trades,
    transfers,
    profiles,
    estimated_cost: `$${totalCost.toFixed(2)}`,
  };
  const outFile = `xray-${target.symbol.toLowerCase()}.json`;
  writeFileSync(outFile, JSON.stringify(output, null, 2));
  console.log(`\nResults saved to ${outFile}`);
  console.log(`Estimated cost: $${totalCost.toFixed(2)}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
