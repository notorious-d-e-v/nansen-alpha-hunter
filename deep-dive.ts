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

// ─── Tokens to investigate ──────────────────────────────────────────────────

const TARGETS = [
  { symbol: "PUNCH", address: "NV2RYH954cTJ3ckFUpvfqaQXU4ARqqDH3562nFSpump" },
  { symbol: "LOBSTAR", address: "AVF9F4C4j8b1Kh4BmNHqybDaHgnZpJ7W7yLvL7hUpump" },
  { symbol: "GOYIM", address: "9S8edqWxoWz5LYLnxWUmWBJnePg35WfdYQp7HQkUpump" },
];

const TODAY = "2026-03-06";
const WEEK_AGO = "2026-02-27";

// ─── Analysis functions ─────────────────────────────────────────────────────

async function analyzeHolders(symbol: string, address: string) {
  console.log(`\n  [Holders] $0.05...`);
  const result = await callEndpoint<{ data: any[] }>("/api/v1/tgm/holders", {
    token_address: address,
    chain: "solana",
  });
  const holders = result.data;
  const top5Pct = holders.slice(0, 5).reduce((sum: number, h: any) => sum + (h.ownership_percentage || 0), 0);
  const top10Pct = holders.slice(0, 10).reduce((sum: number, h: any) => sum + (h.ownership_percentage || 0), 0);
  const accumulating = holders.filter((h: any) => h.balance_change_7d > 0).length;
  const dumping = holders.filter((h: any) => h.balance_change_7d < 0).length;
  const exchangeHolders = holders.filter((h: any) => (h.address_label || "").includes("Exchange") || (h.address_label || "").includes("🏦"));

  console.log(`    Top 5 holders: ${(top5Pct * 100).toFixed(1)}% of supply`);
  console.log(`    Top 10 holders: ${(top10Pct * 100).toFixed(1)}% of supply`);
  console.log(`    7d balance changes: ${accumulating} accumulating, ${dumping} dumping`);
  if (exchangeHolders.length > 0) {
    console.log(`    Exchange holders: ${exchangeHolders.map((h: any) => h.address_label).join(", ")}`);
  }

  // Print top 5 with details
  for (const h of holders.slice(0, 5)) {
    const label = h.address_label || h.address.slice(0, 8);
    const pct = ((h.ownership_percentage || 0) * 100).toFixed(2);
    const val = (h.value_usd / 1000).toFixed(1);
    const change7d = h.balance_change_7d > 0 ? `+${h.balance_change_7d.toFixed(2)}` : h.balance_change_7d?.toFixed(2) || "0";
    console.log(`    ${pct}% | $${val}k | 7d: ${change7d} | ${label}`);
  }

  return {
    top5_concentration: top5Pct,
    top10_concentration: top10Pct,
    accumulating_count: accumulating,
    dumping_count: dumping,
    exchange_holders: exchangeHolders.length,
    rug_risk: top5Pct > 0.5 ? "HIGH" : top5Pct > 0.3 ? "MEDIUM" : "LOW",
  };
}

async function analyzePnlLeaderboard(symbol: string, address: string) {
  console.log(`\n  [PnL Leaderboard] $0.05...`);
  const result = await callEndpoint<{ data: any[] }>("/api/v1/tgm/pnl-leaderboard", {
    token_address: address,
    chain: "solana",
    date: { from: WEEK_AGO, to: TODAY },
  });
  const traders = result.data;
  const stillHolding = traders.filter((t: any) => t.still_holding_balance_ratio > 0.5);
  const exited = traders.filter((t: any) => t.still_holding_balance_ratio < 0.1);
  const totalRealized = traders.reduce((sum: number, t: any) => sum + (t.pnl_usd_realised || 0), 0);
  const totalUnrealized = traders.reduce((sum: number, t: any) => sum + (t.pnl_usd_unrealised || 0), 0);

  console.log(`    Top traders: ${traders.length}`);
  console.log(`    Still holding (>50% of max): ${stillHolding.length}/${traders.length}`);
  console.log(`    Exited (<10% of max): ${exited.length}/${traders.length}`);
  console.log(`    Total realized PnL: $${(totalRealized / 1000).toFixed(1)}k`);
  console.log(`    Total unrealized PnL: $${(totalUnrealized / 1000).toFixed(1)}k`);

  // Print top 5
  for (const t of traders.slice(0, 5)) {
    const label = t.trader_address_label || t.trader_address.slice(0, 8);
    const pnl = (t.pnl_usd_total / 1000).toFixed(1);
    const roi = (t.roi_percent_total * 100).toFixed(0);
    const holding = (t.still_holding_balance_ratio * 100).toFixed(0);
    console.log(`    $${pnl}k PnL | ${roi}% ROI | ${holding}% still held | ${label}`);
  }

  return {
    top_trader_count: traders.length,
    still_holding_ratio: stillHolding.length / Math.max(traders.length, 1),
    exited_ratio: exited.length / Math.max(traders.length, 1),
    total_realized_pnl: totalRealized,
    total_unrealized_pnl: totalUnrealized,
    conviction: stillHolding.length > exited.length ? "HIGH" : "LOW",
  };
}

async function analyzeWhoBoughtSold(symbol: string, address: string) {
  console.log(`\n  [Who Bought/Sold] $0.01...`);
  const result = await callEndpoint<{ data: any[] }>("/api/v1/tgm/who-bought-sold", {
    token_address: address,
    chain: "solana",
    date: { from: WEEK_AGO, to: TODAY },
  });
  const actors = result.data;
  const totalBought = actors.reduce((sum: number, a: any) => sum + (a.bought_volume_usd || 0), 0);
  const totalSold = actors.reduce((sum: number, a: any) => sum + (a.sold_volume_usd || 0), 0);
  const netBuyers = actors.filter((a: any) => a.bought_volume_usd > a.sold_volume_usd);
  const netSellers = actors.filter((a: any) => a.sold_volume_usd > a.bought_volume_usd);
  const labeledBuyers = netBuyers.filter((a: any) => a.address_label && !a.address_label.startsWith("["));

  console.log(`    Total bought: $${(totalBought / 1000).toFixed(1)}k | Total sold: $${(totalSold / 1000).toFixed(1)}k`);
  console.log(`    Net buyers: ${netBuyers.length} | Net sellers: ${netSellers.length}`);
  if (labeledBuyers.length > 0) {
    console.log(`    Notable buyers:`);
    for (const b of labeledBuyers.slice(0, 5)) {
      const net = ((b.bought_volume_usd - b.sold_volume_usd) / 1000).toFixed(1);
      console.log(`      +$${net}k | ${b.address_label}`);
    }
  }

  return {
    total_bought_usd: totalBought,
    total_sold_usd: totalSold,
    buy_sell_ratio: totalSold > 0 ? totalBought / totalSold : Infinity,
    net_buyers: netBuyers.length,
    net_sellers: netSellers.length,
    pressure: totalBought > totalSold ? "BUYING" : "SELLING",
  };
}

async function analyzeDCAs(symbol: string, address: string) {
  console.log(`\n  [Jupiter DCAs] $0.01...`);
  const result = await callEndpoint<{ data: any[] }>("/api/v1/tgm/jup-dca", {
    token_address: address,
  });
  const dcas = result.data;
  const openBuys = dcas.filter((d: any) => d.status === "Open" && d.output_mint_address === address);
  const openSells = dcas.filter((d: any) => d.status === "Open" && d.input_mint_address === address);
  const totalBuyValue = openBuys.reduce((sum: number, d: any) => sum + (d.deposit_usd_value || 0), 0);
  const totalSellValue = openSells.reduce((sum: number, d: any) => sum + (d.deposit_usd_value || 0), 0);

  console.log(`    Total DCAs found: ${dcas.length}`);
  console.log(`    Open DCA buys: ${openBuys.length} ($${(totalBuyValue / 1000).toFixed(1)}k)`);
  console.log(`    Open DCA sells: ${openSells.length} ($${(totalSellValue / 1000).toFixed(1)}k)`);

  if (openBuys.length > 0) {
    for (const d of openBuys.slice(0, 3)) {
      const label = d.trader_label || d.trader_address.slice(0, 8);
      const spent = ((d.deposit_spent / d.deposit_amount) * 100).toFixed(0);
      console.log(`      DCA buy: $${d.deposit_usd_value} | ${spent}% spent | ${d.token_input}->${d.token_output} | ${label}`);
    }
  }

  return {
    total_dcas: dcas.length,
    open_buys: openBuys.length,
    open_sells: openSells.length,
    open_buy_value: totalBuyValue,
    open_sell_value: totalSellValue,
    dca_signal: openBuys.length > openSells.length ? "ACCUMULATING" : openSells.length > openBuys.length ? "DISTRIBUTING" : "NEUTRAL",
  };
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  await initClient();

  const targetIdx = process.argv[2] ? parseInt(process.argv[2]) : undefined;
  const targets = targetIdx !== undefined ? [TARGETS[targetIdx]] : TARGETS;

  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║              DEEP DIVE - CONVICTION CHECK                   ║");
  console.log("║         $0.12/token (Holders + PnL LB + WBS + DCA)          ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");

  const allResults: Record<string, any> = {};

  for (const target of targets) {
    console.log(`\n${"═".repeat(60)}`);
    console.log(`  ${target.symbol}`);
    console.log(`  ${target.address}`);
    console.log("═".repeat(60));

    const holders = await analyzeHolders(target.symbol, target.address);
    await new Promise(r => setTimeout(r, 500));

    const pnl = await analyzePnlLeaderboard(target.symbol, target.address);
    await new Promise(r => setTimeout(r, 500));

    const wbs = await analyzeWhoBoughtSold(target.symbol, target.address);
    await new Promise(r => setTimeout(r, 500));

    const dcas = await analyzeDCAs(target.symbol, target.address);

    // Verdict
    console.log(`\n  ── VERDICT ──`);
    console.log(`    Holder concentration: ${holders.rug_risk} risk (top5: ${(holders.top5_concentration * 100).toFixed(1)}%)`);
    console.log(`    Top trader conviction: ${pnl.conviction} (${(pnl.still_holding_ratio * 100).toFixed(0)}% still holding)`);
    console.log(`    Market pressure: ${wbs.pressure} (buy/sell: ${wbs.buy_sell_ratio.toFixed(2)})`);
    console.log(`    DCA signal: ${dcas.dca_signal}`);

    const bullish = [
      holders.rug_risk === "LOW",
      pnl.conviction === "HIGH",
      wbs.pressure === "BUYING",
      dcas.dca_signal === "ACCUMULATING",
    ].filter(Boolean).length;

    const bearish = [
      holders.rug_risk === "HIGH",
      pnl.conviction === "LOW",
      wbs.pressure === "SELLING",
      dcas.dca_signal === "DISTRIBUTING",
    ].filter(Boolean).length;

    const overall = bullish >= 3 ? "STRONG BUY" : bullish >= 2 ? "LEAN BULLISH" : bearish >= 3 ? "AVOID" : bearish >= 2 ? "LEAN BEARISH" : "NEUTRAL";
    console.log(`    Overall: ${overall} (${bullish} bullish / ${bearish} bearish signals)`);

    allResults[target.symbol] = { holders, pnl, wbs, dcas, verdict: overall };

    await new Promise(r => setTimeout(r, 1000));
  }

  writeFileSync("deep-dive-results.json", JSON.stringify(allResults, null, 2));
  console.log(`\nResults saved to deep-dive-results.json`);
  console.log(`Total cost: ~$${(targets.length * 0.12).toFixed(2)}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
