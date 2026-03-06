import { config } from "dotenv";
import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { registerExactSvmScheme } from "@x402/svm/exact/client";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { base58 } from "@scure/base";

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

// ─── Leading Signal Probe ────────────────────────────────────────────────────
// Hypothesis: large net_flow_1h_usd + low trader_count = fresh SM discovery
//
// Strategy: Pull SM Net Flow sorted by 1h flow, then filter client-side for
// low trader count. Also try server-side trader_count filter if the API allows it.

async function main() {
  await initClient();

  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║          LEADING SIGNAL PROBE                               ║");
  console.log("║   High 1h flow + Low trader count = Fresh SM entry?         ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");

  // ── Attempt 1: Server-side filter on trader_count ──
  console.log("\n[1] Trying server-side trader_count filter (max: 5)...");
  try {
    const filtered = await callEndpoint<{ data: any[] }>("/api/v1/smart-money/netflow", {
      chains: ["solana"],
      order_by: [{ field: "net_flow_1h_usd", direction: "DESC" }],
      trader_count: { min: 1, max: 5 },
    });
    console.log(`  Server filter worked! Got ${filtered.data.length} tokens`);
    printResults("Server-filtered (trader_count 1-5, sorted by 1h flow)", filtered.data);
  } catch (e: any) {
    console.log(`  Server filter failed: ${e.message.slice(0, 200)}`);
    console.log("  Falling back to client-side filtering...\n");
  }

  // ── Attempt 2: Client-side filter ──
  // Get top 1h flow tokens (no filter), then filter locally
  console.log("\n[2] Client-side approach: fetch top 1h flow, filter for low trader count...");
  const raw = await callEndpoint<{ data: any[] }>("/api/v1/smart-money/netflow", {
    chains: ["solana"],
    order_by: [{ field: "net_flow_1h_usd", direction: "DESC" }],
  });
  console.log(`  Raw results: ${raw.data.length} tokens`);

  // Show all results with trader counts
  console.log("\n  All tokens sorted by 1h flow:");
  console.log("  " + "-".repeat(90));
  console.log("  Symbol".padEnd(14) + "1h Flow".padStart(12) + "24h Flow".padStart(12) + "Traders".padStart(10) + "MCap".padStart(14) + "Age".padStart(8));
  console.log("  " + "-".repeat(90));
  for (const t of raw.data) {
    const flow1h = `$${(t.net_flow_1h_usd / 1000).toFixed(1)}k`;
    const flow24h = `$${(t.net_flow_24h_usd / 1000).toFixed(1)}k`;
    const mcap = t.market_cap_usd > 1e6 ? `$${(t.market_cap_usd / 1e6).toFixed(1)}M` : `$${(t.market_cap_usd / 1000).toFixed(0)}k`;
    const marker = t.trader_count <= 3 ? " <-- LOW COUNT" : t.trader_count <= 5 ? " <-- medium" : "";
    console.log(`  ${(t.token_symbol || "???").padEnd(12)} ${flow1h.padStart(12)} ${flow24h.padStart(12)} ${String(t.trader_count).padStart(10)} ${mcap.padStart(14)} ${String(t.token_age_days + "d").padStart(8)}${marker}`);
  }

  // Filter for our target: high 1h flow + low trader count
  const leading = raw.data.filter(t => t.net_flow_1h_usd > 0 && t.trader_count <= 5);
  const strongLeading = raw.data.filter(t => t.net_flow_1h_usd > 5000 && t.trader_count <= 3);

  console.log(`\n  Tokens with positive 1h flow + trader_count <= 5: ${leading.length}`);
  console.log(`  Tokens with 1h flow > $5k + trader_count <= 3: ${strongLeading.length}`);

  if (leading.length > 0) {
    printResults("LEADING SIGNAL CANDIDATES (1h flow > 0, traders <= 5)", leading);
  }
  if (strongLeading.length > 0) {
    printResults("STRONG LEADING SIGNAL (1h flow > $5k, traders <= 3)", strongLeading);
  }

  // ── Also check: what does the 24h sort look like with low counts? ──
  console.log("\n[3] Cross-check: 24h flow sort, filter for low trader count...");
  const raw24h = await callEndpoint<{ data: any[] }>("/api/v1/smart-money/netflow", {
    chains: ["solana"],
    order_by: [{ field: "net_flow_24h_usd", direction: "DESC" }],
  });

  const leading24h = raw24h.data.filter(t => t.net_flow_24h_usd > 5000 && t.trader_count <= 5);
  console.log(`  24h flow > $5k + trader_count <= 5: ${leading24h.length}`);
  if (leading24h.length > 0) {
    printResults("24H ACCUMULATION + LOW COUNT", leading24h);
  }

  console.log(`\nTotal cost: ~$0.15 (3 SM Net Flow calls)`);
}

function printResults(label: string, data: any[]) {
  console.log(`\n  ── ${label} ──`);
  for (const t of data) {
    const flow1h = (t.net_flow_1h_usd / 1000).toFixed(1);
    const flow24h = (t.net_flow_24h_usd / 1000).toFixed(1);
    const mcap = t.market_cap_usd > 1e6 ? `$${(t.market_cap_usd / 1e6).toFixed(1)}M` : `$${(t.market_cap_usd / 1000).toFixed(0)}k`;
    const ratio = t.net_flow_24h_usd > 0 ? (t.net_flow_1h_usd / (t.net_flow_24h_usd / 24)).toFixed(1) : "new";
    console.log(`    ${t.token_symbol || "???"} | 1h: $${flow1h}k | 24h: $${flow24h}k | ${t.trader_count} traders | ${mcap} mcap | ${t.token_age_days}d | 1h/avg: ${ratio}x`);
    console.log(`      ${t.token_address}`);
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
