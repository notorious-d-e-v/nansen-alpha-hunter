import { config } from "dotenv";
import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { registerExactSvmScheme } from "@x402/svm/exact/client";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { base58 } from "@scure/base";
import { writeFileSync, existsSync, readFileSync } from "fs";

config();

const svmPrivateKey = process.env.SVM_PRIVATE_KEY as string;
const baseURL = process.env.RESOURCE_SERVER_URL || "https://api.nansen.ai";

// Well-known Solana addresses for testing
const TEST_WALLET = "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1"; // Raydium Authority
const TEST_TOKEN = "So11111111111111111111111111111111111111112"; // Wrapped SOL
const BONK_TOKEN = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"; // BONK

// All endpoints to explore
const ENDPOINTS = [
  // === BASIC TIER ($0.01/call) ===
  {
    name: "Current Balances",
    path: "/api/v1/profiler/address/current-balance",
    body: { address: TEST_WALLET, chain: "solana" },
  },
  {
    name: "Historical Balances",
    path: "/api/v1/profiler/address/historical-balances",
    body: { address: TEST_WALLET, chain: "solana", date: { from: "2025-03-01", to: "2025-03-06" } },
  },
  {
    name: "Transactions",
    path: "/api/v1/profiler/address/transactions",
    body: { address: TEST_WALLET, chain: "solana", date: { from: "2026-03-01", to: "2026-03-06" } },
  },
  {
    name: "Related Wallets",
    path: "/api/v1/profiler/address/related-wallets",
    body: { address: TEST_WALLET, chain: "solana" },
  },
  {
    name: "PnL Summary",
    path: "/api/v1/profiler/address/pnl-summary",
    body: { address: TEST_WALLET, chain: "solana", date: { from: "2026-02-01", to: "2026-03-06" } },
  },
  {
    name: "PnL",
    path: "/api/v1/profiler/address/pnl",
    body: { address: TEST_WALLET, chain: "solana", date: { from: "2026-02-01", to: "2026-03-06" } },
  },
  {
    name: "Perp Positions",
    path: "/api/v1/profiler/perp-positions",
    // Perp endpoints use EVM-style addresses (Hyperliquid)
    body: { address: "0x023a3d058020fb76cca98f01b3c48c8938a22355" },
  },
  {
    name: "Perp Trades",
    path: "/api/v1/profiler/perp-trades",
    body: { address: TEST_WALLET, chain: "solana" },
  },
  {
    name: "Token Screener",
    path: "/api/v1/token-screener",
    body: { chains: ["solana"], timeframe: "24h" },
  },
  {
    name: "Perp Screener",
    path: "/api/v1/perp-screener",
    body: { date: { from: "2026-03-01", to: "2026-03-06" } },
  },
  {
    name: "Transfers",
    path: "/api/v1/tgm/transfers",
    body: { token_address: BONK_TOKEN, chain: "solana", date: { from: "2026-03-05", to: "2026-03-06" } },
  },
  {
    name: "DCAs (Jupiter DCA)",
    path: "/api/v1/tgm/jup-dca",
    body: { token_address: BONK_TOKEN },
  },
  {
    name: "Flow Intel",
    path: "/api/v1/tgm/flow-intelligence",
    body: { token_address: TEST_TOKEN, chain: "solana" },
  },
  {
    name: "Who Bought/Sold",
    path: "/api/v1/tgm/who-bought-sold",
    body: { token_address: BONK_TOKEN, chain: "solana", date: { from: "2026-03-05", to: "2026-03-06" } },
  },
  {
    name: "DEX Trades",
    path: "/api/v1/tgm/dex-trades",
    body: { token_address: BONK_TOKEN, chain: "solana", date: { from: "2026-03-05", to: "2026-03-06" } },
  },
  {
    name: "DeFi Holdings (NOT x402)",
    path: "/api/v1/portfolio/defi-holdings",
    body: { address: TEST_WALLET, chain: "solana" },
  },
  {
    name: "Flows",
    path: "/api/v1/tgm/flows",
    body: { token_address: BONK_TOKEN, chain: "solana", date: { from: "2026-03-05", to: "2026-03-06" } },
  },

  // === PREMIUM TIER ($0.05/call) ===
  {
    name: "Counterparties",
    path: "/api/v1/profiler/address/counterparties",
    // Use a less active wallet since Raydium has too much activity
    body: { address: "rektbdF5r7HnWrPDRvD76pC1V9rVfaGmbSY3Dsrj8Kx", chain: "solana", date: { from: "2026-02-01", to: "2026-03-06" } },
  },
  {
    name: "Holders",
    path: "/api/v1/tgm/holders",
    body: { token_address: BONK_TOKEN, chain: "solana" },
  },
  {
    name: "PnL Leaderboard",
    path: "/api/v1/tgm/pnl-leaderboard",
    body: { token_address: BONK_TOKEN, chain: "solana", date: { from: "2026-02-01", to: "2026-03-06" } },
  },
  {
    name: "Perp PnL Leaderboard",
    path: "/api/v1/tgm/perp-pnl-leaderboard",
    body: { token_symbol: "SOL", date: { from: "2026-03-01", to: "2026-03-06" } },
  },
  {
    name: "Perp Leaderboard",
    path: "/api/v1/perp-leaderboard",
    body: { date: { from: "2026-03-01", to: "2026-03-06" } },
  },

  // === SMART MONEY TIER ($0.05/call) ===
  {
    name: "Smart Money Net Flow",
    path: "/api/v1/smart-money/netflow",
    body: { chains: ["solana"] },
  },
  {
    name: "Smart Money Holdings",
    path: "/api/v1/smart-money/holdings",
    body: { chains: ["solana"] },
  },
  {
    name: "Smart Money DEX Trades",
    path: "/api/v1/smart-money/dex-trades",
    body: { chains: ["solana"] },
  },
];

async function main() {
  const svmSigner = await createKeyPairSignerFromBytes(base58.decode(svmPrivateKey));
  const client = new x402Client();
  registerExactSvmScheme(client, { signer: svmSigner });
  const fetchWithPayment = wrapFetchWithPayment(fetch, client);

  // Allow specifying which endpoint to run via CLI arg
  const targetIndex = process.argv[2] ? parseInt(process.argv[2]) : undefined;
  const resultsFile = "/Users/node/Desktop/starters/nansen-client/results.json";

  // Load existing results
  let allResults: Record<string, any> = {};
  if (existsSync(resultsFile)) {
    allResults = JSON.parse(readFileSync(resultsFile, "utf-8"));
  }

  const endpoints = targetIndex !== undefined ? [ENDPOINTS[targetIndex]] : ENDPOINTS;
  const startIdx = targetIndex !== undefined ? targetIndex : 0;

  for (let i = 0; i < endpoints.length; i++) {
    const ep = endpoints[i];
    const idx = targetIndex !== undefined ? targetIndex : i;
    console.log(`\n${"=".repeat(80)}`);
    console.log(`[${idx}] ${ep.name} - POST ${ep.path}`);
    console.log(`Request body: ${JSON.stringify(ep.body)}`);
    console.log("=".repeat(80));

    try {
      const url = `${baseURL}${ep.path}`;
      const response = await fetchWithPayment(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ep.body),
      });

      const status = response.status;
      const body = await response.text();

      let parsed: any;
      try {
        parsed = JSON.parse(body);
      } catch {
        parsed = body;
      }

      console.log(`Status: ${status}`);
      console.log(`Response: ${JSON.stringify(parsed, null, 2).slice(0, 3000)}`);

      allResults[ep.name] = {
        index: idx,
        path: ep.path,
        requestBody: ep.body,
        status,
        response: parsed,
        timestamp: new Date().toISOString(),
      };

      // Save after each call
      writeFileSync(resultsFile, JSON.stringify(allResults, null, 2));

      // Small delay to respect rate limits
      await new Promise(r => setTimeout(r, 1500));
    } catch (error: any) {
      console.error(`ERROR: ${error.message}`);
      allResults[ep.name] = {
        index: idx,
        path: ep.path,
        requestBody: ep.body,
        error: error.message,
        timestamp: new Date().toISOString(),
      };
      writeFileSync(resultsFile, JSON.stringify(allResults, null, 2));
    }
  }

  console.log(`\nAll results saved to ${resultsFile}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
