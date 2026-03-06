import { config } from "dotenv";
import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { registerExactSvmScheme } from "@x402/svm/exact/client";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { base58 } from "@scure/base";

config();

const svmPrivateKey = process.env.SVM_PRIVATE_KEY as string;
const baseURL = "https://api.nansen.ai";

async function main() {
  const svmSigner = await createKeyPairSignerFromBytes(base58.decode(svmPrivateKey));
  const client = new x402Client();
  registerExactSvmScheme(client, { signer: svmSigner });
  const fetchWithPayment = wrapFetchWithPayment(fetch, client);

  const testCases = [
    {
      name: "Token Screener - sort by buy_volume desc",
      path: "/api/v1/token-screener",
      body: { chains: ["solana"], timeframe: "24h", sort: [{ field: "buy_volume", direction: "desc" }] },
    },
    {
      name: "Token Screener - sort by price_change desc",
      path: "/api/v1/token-screener",
      body: { chains: ["solana"], timeframe: "24h", sort: [{ field: "price_change", direction: "desc" }] },
    },
    {
      name: "Token Screener - sort by liquidity desc",
      path: "/api/v1/token-screener",
      body: { chains: ["solana"], timeframe: "24h", sort: [{ field: "liquidity", direction: "desc" }] },
    },
    {
      name: "SM Net Flow - page param only",
      path: "/api/v1/smart-money/netflow",
      body: { chains: ["solana"], page: 2 },
    },
    {
      name: "SM Net Flow - limit param",
      path: "/api/v1/smart-money/netflow",
      body: { chains: ["solana"], limit: 20 },
    },
    {
      name: "Token Screener - sort by inflow_fdv_ratio desc",
      path: "/api/v1/token-screener",
      body: { chains: ["solana"], timeframe: "24h", sort: [{ field: "inflow_fdv_ratio", direction: "desc" }] },
    },
    {
      name: "Token Screener - sort by token_age_days asc",
      path: "/api/v1/token-screener",
      body: { chains: ["solana"], timeframe: "24h", sort: [{ field: "token_age_days", direction: "asc" }] },
    },
  ];

  const idx = process.argv[2] ? parseInt(process.argv[2]) : 0;
  const test = testCases[idx];
  console.log(`\n=== ${test.name} ===`);
  console.log(`Body: ${JSON.stringify(test.body)}`);

  try {
    const resp = await fetchWithPayment(`${baseURL}${test.path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(test.body),
    });
    const body = await resp.json();
    console.log(`Status: ${resp.status}`);

    if (body.error || body.message) {
      console.log("Error:", JSON.stringify(body, null, 2));
    } else {
      const data = body.data || [];
      console.log(`Pagination:`, body.pagination);
      console.log(`Results: ${data.length}`);
      for (const item of data.slice(0, 5)) {
        const symbol = item.token_symbol || item.token_address?.slice(0, 8);
        const relevant = {
          symbol,
          mcap: item.market_cap_usd,
          netflow: item.netflow,
          volume: item.volume,
          net_flow_24h: item.net_flow_24h_usd,
          trader_count: item.trader_count,
        };
        console.log(" ", JSON.stringify(relevant));
      }
      if (data.length > 5) console.log(`  ... and ${data.length - 5} more`);
    }
  } catch (e: any) {
    console.error("Error:", e.message);
  }
}

main().catch(console.error);
