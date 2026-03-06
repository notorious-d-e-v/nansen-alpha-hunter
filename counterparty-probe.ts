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

const TODAY = "2026-03-06";
const MONTH_AGO = "2026-02-06";

const TARGETS = [
  { symbol: "WHITEHOUSE", address: "7oXNE1dbpHUp6dn1JF8pRgCtzfCy4P2FuBneWjZHpump" },
];

// ─── Counterparty Network Mapper ────────────────────────────────────────────
// For each token:
// 1. Get top holders (skip LPs/exchanges)
// 2. Run Counterparties on each holder
// 3. Check: do holders share counterparties? (coordinated wallets)
// 4. Check: are counterparties exchanges/bots? (exit routing)
// 5. Check: do any holders transact directly with each other? (linked wallets)

async function analyzeToken(symbol: string, tokenAddress: string) {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  ${symbol} — Counterparty Network Map`);
  console.log(`  ${tokenAddress}`);
  console.log("═".repeat(60));

  // Step 1: Get holders
  console.log(`\n  [Holders] $0.05`);
  const holdersResult = await callEndpoint<{ data: any[] }>("/api/v1/tgm/holders", {
    token_address: tokenAddress,
    chain: "solana",
  });

  // Filter to non-LP, non-exchange wallets
  const holders = holdersResult.data
    .filter((h: any) => {
      const label = (h.address_label || "").toLowerCase();
      return !label.includes("liquidity pool") && !label.includes("🏦") && !label.includes("🤖 🏦");
    })
    .slice(0, 5);

  console.log(`  Top ${holders.length} non-LP holders selected\n`);

  // Track all counterparties across holders to find overlaps
  const holderCounterparties = new Map<string, Map<string, any>>(); // holder -> Map<counterparty_addr, data>
  const allCounterparties = new Map<string, { label: string; seenBy: string[] }>(); // counterparty -> which holders interact with it

  // Step 2: Run counterparties for each holder
  for (const holder of holders) {
    const label = holder.address_label || holder.address.slice(0, 10);
    const pct = ((holder.ownership_percentage || 0) * 100).toFixed(2);
    console.log(`  ── ${label} (${pct}%) ──`);

    try {
      console.log(`    [Counterparties] $0.05`);
      const result = await callEndpoint<{ data: any[] }>("/api/v1/profiler/address/counterparties", {
        address: holder.address,
        chain: "solana",
        date: { from: MONTH_AGO, to: TODAY },
      });

      const cps = result.data;
      console.log(`    Found ${cps.length} counterparties`);

      const cpMap = new Map<string, any>();

      for (const cp of cps.slice(0, 10)) {
        const rawLabel = cp.counterparty_address_label;
        const cpLabel = typeof rawLabel === "string" ? rawLabel : (Array.isArray(rawLabel) ? rawLabel.join(", ") : String(rawLabel || cp.counterparty_address?.slice(0, 10) || "???"));
        const volIn = cp.volume_in_usd || 0;
        const volOut = cp.volume_out_usd || 0;
        const totalVol = cp.total_volume_usd || 0;
        const interactions = cp.interaction_count || 0;

        // Track for overlap detection
        const cpAddr = cp.counterparty_address;
        cpMap.set(cpAddr, cp);

        const existing = allCounterparties.get(cpAddr);
        if (existing) {
          existing.seenBy.push(label);
        } else {
          allCounterparties.set(cpAddr, { label: cpLabel, seenBy: [label] });
        }

        // Check if counterparty is another holder
        const isOtherHolder = holders.some(h => h.address === cpAddr && h.address !== holder.address);
        const holderTag = isOtherHolder ? " *** LINKED HOLDER ***" : "";

        // Categorize
        const cpLabelLower = cpLabel.toLowerCase();
        const isExchange = cpLabel.includes("🏦") || cpLabelLower.includes("exchange");
        const isBot = cpLabel.includes("🤖") || cpLabelLower.includes("bot");
        const isSM = cpLabel.includes("🤓") || cpLabelLower.includes("smart");

        const tag = isExchange ? "[EXCHANGE]" : isBot ? "[BOT]" : isSM ? "[SM]" : "";

        console.log(`      ${tag.padEnd(11)} ${cpLabel.slice(0, 35).padEnd(36)} | ${interactions} txs | $${(totalVol / 1000).toFixed(1)}k vol | in: $${(volIn / 1000).toFixed(1)}k out: $${(volOut / 1000).toFixed(1)}k${holderTag}`);
      }

      holderCounterparties.set(holder.address, cpMap);

      // Check for token-specific interactions
      const tokenTrades = cps.filter((cp: any) =>
        cp.tokens_info?.some((ti: any) => ti.token_address === tokenAddress)
      );
      if (tokenTrades.length > 0) {
        console.log(`\n      Token-specific interactions (${symbol}):`);
        for (const cp of tokenTrades.slice(0, 5)) {
          const cpLabel = cp.counterparty_address_label || cp.counterparty_address?.slice(0, 10);
          const tokenInfo = cp.tokens_info?.find((ti: any) => ti.token_address === tokenAddress);
          console.log(`        ${cpLabel}: ${tokenInfo?.token_symbol || symbol} — $${((tokenInfo?.volume_usd || 0) / 1000).toFixed(1)}k`);
        }
      }

    } catch (e: any) {
      console.log(`    Failed: ${e.message.slice(0, 150)}`);
    }

    await new Promise(r => setTimeout(r, 500));
    console.log();
  }

  // Step 3: Overlap analysis
  console.log(`  ── NETWORK ANALYSIS ──\n`);

  // Find counterparties shared by multiple holders
  const shared = [...allCounterparties.entries()]
    .filter(([, v]) => v.seenBy.length > 1)
    .sort((a, b) => b[1].seenBy.length - a[1].seenBy.length);

  if (shared.length > 0) {
    console.log(`  Shared counterparties (wallets interacting with multiple holders):`);
    for (const [addr, info] of shared) {
      console.log(`    ${info.label.slice(0, 40).padEnd(41)} | shared by: ${info.seenBy.join(", ")}`);
    }
  } else {
    console.log(`  No shared counterparties found — holders appear independent`);
  }

  // Check for direct holder-to-holder links
  console.log();
  const holderAddrs = new Set(holders.map(h => h.address));
  let directLinks = 0;
  for (const [holderAddr, cpMap] of holderCounterparties) {
    for (const [cpAddr] of cpMap) {
      if (holderAddrs.has(cpAddr) && cpAddr !== holderAddr) {
        const holderLabel = holders.find(h => h.address === holderAddr)?.address_label || holderAddr.slice(0, 10);
        const cpLabel = holders.find(h => h.address === cpAddr)?.address_label || cpAddr.slice(0, 10);
        console.log(`  DIRECT LINK: ${holderLabel} <-> ${cpLabel}`);
        directLinks++;
      }
    }
  }

  if (directLinks === 0) {
    console.log(`  No direct holder-to-holder transactions found`);
  } else {
    console.log(`\n  ${directLinks} direct links detected — possible sybil/coordinated holding`);
  }

  // Count exchange vs non-exchange counterparties
  let exchangeCount = 0;
  let smCount = 0;
  let botCount = 0;
  for (const [, info] of allCounterparties) {
    const lb = String(info.label || "").toLowerCase();
    if (info.label.includes("🏦") || lb.includes("exchange")) exchangeCount++;
    if (info.label.includes("🤓") || lb.includes("smart")) smCount++;
    if (info.label.includes("🤖") || lb.includes("bot")) botCount++;
  }

  console.log(`\n  Network composition:`);
  console.log(`    Exchange connections: ${exchangeCount}`);
  console.log(`    Smart Money connections: ${smCount}`);
  console.log(`    Bot connections: ${botCount}`);
  console.log(`    Total unique counterparties: ${allCounterparties.size}`);

  return {
    token: symbol,
    holders_analyzed: holders.length,
    total_counterparties: allCounterparties.size,
    shared_counterparties: shared.length,
    direct_holder_links: directLinks,
    exchange_connections: exchangeCount,
    sm_connections: smCount,
  };
}

async function main() {
  await initClient();

  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║          COUNTERPARTY NETWORK PROBE                         ║");
  console.log("║   Map wallet connections around top holders                  ║");
  console.log("║   Cost: $0.05 (holders) + $0.05/wallet (counterparties)     ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");

  const results: any[] = [];
  for (const target of TARGETS) {
    const result = await analyzeToken(target.symbol, target.address);
    results.push(result);
    await new Promise(r => setTimeout(r, 1000));
  }

  writeFileSync("counterparty-results.json", JSON.stringify(results, null, 2));
  const totalCost = TARGETS.length * (0.05 + 5 * 0.05); // holders + 5 counterparty calls each
  console.log(`\nResults saved to counterparty-results.json`);
  console.log(`Estimated cost: ~$${totalCost.toFixed(2)}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
