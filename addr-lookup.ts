import { config } from "dotenv";
import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { registerExactSvmScheme } from "@x402/svm/exact/client";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { base58 } from "@scure/base";
config();

async function main() {
  const signer = await createKeyPairSignerFromBytes(base58.decode(process.env.SVM_PRIVATE_KEY as string));
  const client = new x402Client();
  registerExactSvmScheme(client, { signer });
  const f = wrapFetchWithPayment(fetch, client);

  const r = await f("https://api.nansen.ai/api/v1/tgm/transfers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      token_address: "7oXNE1dbpHUp6dn1JF8pRgCtzfCy4P2FuBneWjZHpump",
      chain: "solana",
      date: { from: "2026-02-27", to: "2026-03-06" },
    }),
  });
  const data = (await r.json()) as any;
  const addresses = new Set<string>();
  for (const t of data.data) {
    console.log(`${(t.from_address_label || t.from_address.slice(0,10)).padEnd(45)} -> ${(t.to_address_label || t.to_address.slice(0,10)).padEnd(45)} | $${(t.transfer_value_usd/1000).toFixed(1)}k`);
    console.log(`  FROM: ${t.from_address}`);
    console.log(`  TO:   ${t.to_address}`);
    console.log();
  }
}
main();
