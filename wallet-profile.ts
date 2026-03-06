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
    throw new Error(`${path} returned ${response.status}: ${text.slice(0, 300)}`);
  }
  return response.json();
}

const TODAY = "2026-03-06";
const MONTH_AGO = "2026-02-06";

// Target: the deployer bot from WHITEHOUSE analysis
const BOT_ADDRESS = "7QYs4kR7zq7ChJVeHw25x4LgJs65wfP8UcmubwQfxPC9";

// Also check DanySlicer Token Deployer
const DEPLOYER_ADDRESS = "7feiky5tbp3BW1f5k49bibzNzRsZRGyhQcvpmkTkzpw7";

async function profileWallet(address: string, label: string) {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  ${label}`);
  console.log(`  ${address}`);
  console.log("═".repeat(60));

  // 1. Current balances
  console.log("\n  [Current Balances] $0.01");
  try {
    const balances = await callEndpoint<{ data: any[] }>("/api/v1/profiler/address/current-balance", {
      address,
      chain: "solana",
    });
    if (balances.data.length === 0) {
      console.log("    Empty wallet — no holdings");
    } else {
      console.log(`    ${balances.data.length} tokens held:`);
      for (const b of balances.data.slice(0, 10)) {
        const val = b.value_usd > 1000 ? `$${(b.value_usd / 1000).toFixed(1)}k` : `$${b.value_usd?.toFixed(0) || 0}`;
        console.log(`      ${(b.token_symbol || "???").padEnd(12)} ${val.padStart(10)} | ${b.token_amount?.toFixed(0) || 0} tokens`);
      }
    }
  } catch (e: any) {
    console.log(`    Failed: ${e.message.slice(0, 100)}`);
  }

  // 2. PnL Summary
  console.log("\n  [PnL Summary] $0.01");
  try {
    const pnl = await callEndpoint<any>("/api/v1/profiler/address/pnl-summary", {
      address,
      chain: "solana",
      date: { from: MONTH_AGO, to: TODAY },
    });
    console.log(`    Win rate: ${((pnl.win_rate || 0) * 100).toFixed(0)}% | Trades: ${pnl.traded_times || 0} | Tokens: ${pnl.traded_token_count || 0}`);
    console.log(`    Realized PnL: $${((pnl.realized_pnl_usd || 0) / 1000).toFixed(1)}k (${((pnl.realized_pnl_percent || 0) * 100).toFixed(1)}%)`);
    if (pnl.top5_tokens?.length > 0) {
      console.log(`    Top tokens: ${pnl.top5_tokens.map((t: any) => t.token_symbol || t.token_address?.slice(0, 8)).join(", ")}`);
    }
  } catch (e: any) {
    console.log(`    Failed: ${e.message.slice(0, 100)}`);
  }

  // 3. Related Wallets
  console.log("\n  [Related Wallets] $0.01");
  try {
    const related = await callEndpoint<{ data: any[] }>("/api/v1/profiler/address/related-wallets", {
      address,
      chain: "solana",
    });
    if (related.data.length === 0) {
      console.log("    No related wallets found");
    } else {
      console.log(`    ${related.data.length} related wallets:`);
      for (const r of related.data.slice(0, 10)) {
        const rlabel = r.address_label || r.address?.slice(0, 10);
        console.log(`      ${(r.relation || "???").padEnd(20)} | ${rlabel}`);
      }
    }
  } catch (e: any) {
    console.log(`    Failed: ${e.message.slice(0, 100)}`);
  }

  // 4. Recent transactions
  console.log("\n  [Recent Transactions] $0.01");
  try {
    const txs = await callEndpoint<{ data: any[] }>("/api/v1/profiler/address/transactions", {
      address,
      chain: "solana",
      date: { from: "2026-03-01", to: TODAY },
    });
    console.log(`    ${txs.data.length} transactions in last 6 days`);
    for (const tx of txs.data.slice(0, 10)) {
      const time = tx.block_timestamp?.split("T")[1]?.slice(0, 5) || "";
      const date = tx.block_timestamp?.split("T")[0] || "";
      const from = tx.from_address_label || tx.from_address?.slice(0, 10) || "?";
      const to = tx.to_address_label || tx.to_address?.slice(0, 10) || "?";
      const val = tx.value_usd ? `$${(tx.value_usd / 1000).toFixed(1)}k` : "$0";
      const token = tx.token_symbol || "???";
      console.log(`      ${date} ${time} | ${token.padEnd(15)} | ${val.padStart(8)} | ${from} -> ${to}`);
    }
  } catch (e: any) {
    console.log(`    Failed: ${e.message.slice(0, 100)}`);
  }

  // 5. Counterparties (if not too active)
  console.log("\n  [Counterparties] $0.05");
  try {
    const cps = await callEndpoint<{ data: any[] }>("/api/v1/profiler/address/counterparties", {
      address,
      chain: "solana",
      date: { from: MONTH_AGO, to: TODAY },
    });
    console.log(`    ${cps.data.length} counterparties:`);
    for (const cp of cps.data.slice(0, 10)) {
      const rawLabel = cp.counterparty_address_label;
      const cpLabel = typeof rawLabel === "string" ? rawLabel : (Array.isArray(rawLabel) ? rawLabel.join(", ") : String(rawLabel || cp.counterparty_address?.slice(0, 10) || "???"));
      const vol = cp.total_volume_usd > 1000 ? `$${(cp.total_volume_usd / 1000).toFixed(1)}k` : `$${cp.total_volume_usd?.toFixed(0) || 0}`;
      const volIn = cp.volume_in_usd > 1000 ? `$${(cp.volume_in_usd / 1000).toFixed(1)}k` : `$${cp.volume_in_usd?.toFixed(0) || 0}`;
      const volOut = cp.volume_out_usd > 1000 ? `$${(cp.volume_out_usd / 1000).toFixed(1)}k` : `$${cp.volume_out_usd?.toFixed(0) || 0}`;
      console.log(`      ${cpLabel.slice(0, 40).padEnd(41)} | ${cp.interaction_count || 0} txs | ${vol} vol | in: ${volIn} out: ${volOut}`);

      // Check if counterparty has tokens_info mentioning WHITEHOUSE
      if (cp.tokens_info?.length > 0) {
        const wh = cp.tokens_info.find((t: any) => t.token_symbol?.includes("WHITEHOUSE") || t.token_address === "7oXNE1dbpHUp6dn1JF8pRgCtzfCy4P2FuBneWjZHpump");
        if (wh) {
          console.log(`        ^^^ WHITEHOUSE interaction: $${((wh.volume_usd || 0) / 1000).toFixed(1)}k`);
        }
      }
    }
  } catch (e: any) {
    console.log(`    Failed: ${e.message.slice(0, 100)}`);
  }
}

async function main() {
  await initClient();

  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║          WALLET DEEP PROFILE                                ║");
  console.log("║   Who is Bot [7QYs4kR7]? Deployer app or insider?           ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");

  await profileWallet(BOT_ADDRESS, "Bot [7QYs4kR7] — WHITEHOUSE deployer bot");
  await new Promise(r => setTimeout(r, 1000));
  await profileWallet(DEPLOYER_ADDRESS, "DanySlicer Token Deployer [7feiky5t] — received $21.9k from bot");
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
