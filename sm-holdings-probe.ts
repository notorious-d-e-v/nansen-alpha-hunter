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
    throw new Error(`${path} returned ${response.status}: ${text.slice(0, 500)}`);
  }
  return response.json();
}

// ─── SM Holdings Accumulation Probe ─────────────────────────────────────────
// Hypothesis: `balance_24h_percent_change DESC` shows tokens where SM is
// actively increasing positions — a different signal than net flow.
//
// We'll pull 3 views:
// 1. By 24h balance change (who's accumulating fastest)
// 2. By value (biggest SM positions — what are they convicted on)
// 3. By holders_count (broadest SM interest)
//
// Then cross-reference with Net Flow to find tokens where BOTH balance is
// growing AND flow is positive — double confirmation.
//
// Cost: $0.15 (3 holdings calls) + $0.05 (1 net flow call) = $0.20

async function main() {
  await initClient();

  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║          SM HOLDINGS ACCUMULATION PROBE                     ║");
  console.log("║   balance_24h_percent_change + cross-ref with Net Flow      ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");

  // ── View 1: Fastest accumulation (24h balance change) ──
  console.log("\n[1/4] SM Holdings — by 24h balance change ($0.05)...");
  const byChange = await callEndpoint<{ data: any[] }>("/api/v1/smart-money/holdings", {
    chains: ["solana"],
    order_by: [{ field: "balance_24h_percent_change", direction: "DESC" }],
  });
  console.log(`  ${byChange.data.length} tokens`);

  // ── View 2: Biggest SM positions (by value) ──
  console.log("\n[2/4] SM Holdings — by value ($0.05)...");
  const byValue = await callEndpoint<{ data: any[] }>("/api/v1/smart-money/holdings", {
    chains: ["solana"],
    order_by: [{ field: "value_usd", direction: "DESC" }],
  });
  console.log(`  ${byValue.data.length} tokens`);

  // ── View 3: Broadest SM interest (by holders count) ──
  console.log("\n[3/4] SM Holdings — by holders count ($0.05)...");
  const byHolders = await callEndpoint<{ data: any[] }>("/api/v1/smart-money/holdings", {
    chains: ["solana"],
    order_by: [{ field: "holders_count", direction: "DESC" }],
  });
  console.log(`  ${byHolders.data.length} tokens`);

  // ── View 4: Net Flow for cross-reference ──
  console.log("\n[4/4] SM Net Flow — by 24h flow for cross-ref ($0.05)...");
  const netFlow = await callEndpoint<{ data: any[] }>("/api/v1/smart-money/netflow", {
    chains: ["solana"],
    order_by: [{ field: "net_flow_24h_usd", direction: "DESC" }],
  });
  console.log(`  ${netFlow.data.length} tokens`);

  // ── Display each view ──
  const header = "  " + "Token".padEnd(14) + "24h Chg%".padStart(10) + "Value".padStart(12) + "Holders".padStart(9) + "Share%".padStart(9) + "MCap".padStart(12) + "Age".padStart(7);
  const divider = "  " + "-".repeat(73);

  console.log("\n\n  ═══ VIEW 1: FASTEST ACCUMULATION (24h balance change) ═══");
  console.log(header);
  console.log(divider);
  for (const t of byChange.data) {
    const chg = t.balance_24h_percent_change != null ? `${(t.balance_24h_percent_change * 100).toFixed(1)}%` : "N/A";
    const val = t.value_usd > 1e6 ? `$${(t.value_usd / 1e6).toFixed(1)}M` : `$${(t.value_usd / 1000).toFixed(1)}k`;
    const mcap = t.market_cap_usd > 1e6 ? `$${(t.market_cap_usd / 1e6).toFixed(1)}M` : `$${(t.market_cap_usd / 1000).toFixed(0)}k`;
    const share = `${(t.share_of_holdings_percent * 100).toFixed(2)}%`;
    console.log(`  ${(t.token_symbol || "???").padEnd(14)} ${chg.padStart(10)} ${val.padStart(12)} ${String(t.holders_count).padStart(9)} ${share.padStart(9)} ${mcap.padStart(12)} ${(t.token_age_days + "d").padStart(7)}`);
  }

  console.log("\n\n  ═══ VIEW 2: BIGGEST SM POSITIONS (by value) ═══");
  console.log(header);
  console.log(divider);
  for (const t of byValue.data) {
    const chg = t.balance_24h_percent_change != null ? `${(t.balance_24h_percent_change * 100).toFixed(1)}%` : "N/A";
    const val = t.value_usd > 1e6 ? `$${(t.value_usd / 1e6).toFixed(1)}M` : `$${(t.value_usd / 1000).toFixed(1)}k`;
    const mcap = t.market_cap_usd > 1e6 ? `$${(t.market_cap_usd / 1e6).toFixed(1)}M` : `$${(t.market_cap_usd / 1000).toFixed(0)}k`;
    const share = `${(t.share_of_holdings_percent * 100).toFixed(2)}%`;
    console.log(`  ${(t.token_symbol || "???").padEnd(14)} ${chg.padStart(10)} ${val.padStart(12)} ${String(t.holders_count).padStart(9)} ${share.padStart(9)} ${mcap.padStart(12)} ${(t.token_age_days + "d").padStart(7)}`);
  }

  console.log("\n\n  ═══ VIEW 3: BROADEST SM INTEREST (by holders count) ═══");
  console.log(header);
  console.log(divider);
  for (const t of byHolders.data) {
    const chg = t.balance_24h_percent_change != null ? `${(t.balance_24h_percent_change * 100).toFixed(1)}%` : "N/A";
    const val = t.value_usd > 1e6 ? `$${(t.value_usd / 1e6).toFixed(1)}M` : `$${(t.value_usd / 1000).toFixed(1)}k`;
    const mcap = t.market_cap_usd > 1e6 ? `$${(t.market_cap_usd / 1e6).toFixed(1)}M` : `$${(t.market_cap_usd / 1000).toFixed(0)}k`;
    const share = `${(t.share_of_holdings_percent * 100).toFixed(2)}%`;
    console.log(`  ${(t.token_symbol || "???").padEnd(14)} ${chg.padStart(10)} ${val.padStart(12)} ${String(t.holders_count).padStart(9)} ${share.padStart(9)} ${mcap.padStart(12)} ${(t.token_age_days + "d").padStart(7)}`);
  }

  // ── Cross-reference: Holdings accumulation + Net Flow positive ──
  console.log("\n\n  ═══ CROSS-REFERENCE: Accumulating Holdings + Positive Net Flow ═══");

  // Build lookup maps
  const holdingsMap = new Map<string, any>();
  for (const t of [...byChange.data, ...byValue.data, ...byHolders.data]) {
    if (!holdingsMap.has(t.token_address)) holdingsMap.set(t.token_address, t);
  }

  const flowMap = new Map<string, any>();
  for (const t of netFlow.data) {
    flowMap.set(t.token_address, t);
  }

  // Find tokens in BOTH datasets
  const crossRef: any[] = [];
  for (const [addr, holding] of holdingsMap) {
    const flow = flowMap.get(addr);
    if (flow && holding.balance_24h_percent_change > 0 && flow.net_flow_24h_usd > 0) {
      crossRef.push({
        token_symbol: holding.token_symbol,
        token_address: addr,
        balance_24h_pct: holding.balance_24h_percent_change,
        holdings_value: holding.value_usd,
        holders_count: holding.holders_count,
        share_pct: holding.share_of_holdings_percent,
        net_flow_1h: flow.net_flow_1h_usd,
        net_flow_24h: flow.net_flow_24h_usd,
        trader_count: flow.trader_count,
        market_cap: holding.market_cap_usd,
        token_age_days: holding.token_age_days,
      });
    }
  }

  crossRef.sort((a, b) => b.balance_24h_pct - a.balance_24h_pct);

  if (crossRef.length === 0) {
    console.log("  No tokens found with BOTH accumulating holdings AND positive net flow.");
    console.log("  This might mean SM is holding but not actively buying more right now.");
  } else {
    console.log(`  Found ${crossRef.length} tokens with accumulating holdings + positive net flow:\n`);
    console.log("  " + "Token".padEnd(14) + "24h Bal%".padStart(10) + "Holdings".padStart(12) + "SM Holders".padStart(11) + "24h Flow".padStart(11) + "1h Flow".padStart(10) + "Traders".padStart(9) + "MCap".padStart(12));
    console.log("  " + "-".repeat(89));
    for (const t of crossRef) {
      const chg = `+${(t.balance_24h_pct * 100).toFixed(1)}%`;
      const val = t.holdings_value > 1e6 ? `$${(t.holdings_value / 1e6).toFixed(1)}M` : `$${(t.holdings_value / 1000).toFixed(1)}k`;
      const flow24 = `$${(t.net_flow_24h / 1000).toFixed(1)}k`;
      const flow1h = `$${(t.net_flow_1h / 1000).toFixed(1)}k`;
      const mcap = t.market_cap > 1e6 ? `$${(t.market_cap / 1e6).toFixed(1)}M` : `$${(t.market_cap / 1000).toFixed(0)}k`;
      console.log(`  ${(t.token_symbol || "???").padEnd(14)} ${chg.padStart(10)} ${val.padStart(12)} ${String(t.holders_count).padStart(11)} ${flow24.padStart(11)} ${flow1h.padStart(10)} ${String(t.trader_count).padStart(9)} ${mcap.padStart(12)}`);
      console.log(`  ${"".padEnd(14)} ${t.token_address}`);
    }
  }

  // ── Also check: tokens with large SM positions but NEGATIVE balance change ──
  console.log("\n\n  ═══ WARNING: Big SM Positions with DECLINING Balance ═══");
  const declining = byValue.data
    .filter(t => t.balance_24h_percent_change < -0.01)
    .sort((a: any, b: any) => a.balance_24h_percent_change - b.balance_24h_percent_change);

  if (declining.length > 0) {
    console.log("  " + "Token".padEnd(14) + "24h Chg%".padStart(10) + "Value".padStart(12) + "Holders".padStart(9) + "MCap".padStart(12));
    console.log("  " + "-".repeat(57));
    for (const t of declining) {
      const chg = `${(t.balance_24h_percent_change * 100).toFixed(1)}%`;
      const val = t.value_usd > 1e6 ? `$${(t.value_usd / 1e6).toFixed(1)}M` : `$${(t.value_usd / 1000).toFixed(1)}k`;
      const mcap = t.market_cap_usd > 1e6 ? `$${(t.market_cap_usd / 1e6).toFixed(1)}M` : `$${(t.market_cap_usd / 1000).toFixed(0)}k`;
      console.log(`  ${(t.token_symbol || "???").padEnd(14)} ${chg.padStart(10)} ${val.padStart(12)} ${String(t.holders_count).padStart(9)} ${mcap.padStart(12)}`);
    }
  } else {
    console.log("  None — all big SM positions are stable or growing.");
  }

  // ── Save ──
  const output = {
    timestamp: new Date().toISOString(),
    views: {
      by_24h_change: byChange.data,
      by_value: byValue.data,
      by_holders: byHolders.data,
    },
    net_flow_crossref: netFlow.data,
    cross_referenced: crossRef,
    declining_positions: declining,
  };
  writeFileSync("sm-holdings-results.json", JSON.stringify(output, null, 2));
  console.log(`\nResults saved to sm-holdings-results.json`);
  console.log(`Cost: ~$0.20`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
