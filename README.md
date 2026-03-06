# Nansen Alpha Hunter

On-chain alpha hunting pipeline for Solana using [Nansen's x402 API](https://docs.nansen.ai/getting-started/x402-payments). No API key needed — pays per call with USDC via the [x402 protocol](https://www.x402.org/).

Built to find smart money entries before they become obvious, and to avoid traps that look bullish on the surface.

## What's Inside

### 3-Phase Pipeline (~$1.05 for a full 20-token scan)

| Phase | Script | Cost | What It Does |
|-------|--------|------|-------------|
| 1. Scan | `alpha-scanner.ts` | $0.27 | Screens ~20 candidates via 3 SM flow views, DEX trades, screener, flow intel |
| 2. Deep Dive | `deep-dive.ts` | $0.12/token | Checks holders, PnL leaderboard, who bought/sold, Jupiter DCAs |
| 3. X-Ray | `token-xray.ts` | $0.14/token | Flow timeline, DEX trades, transfers, top holder wallet profiles |

### Specialized Probes

| Script | Cost | Purpose |
|--------|------|---------|
| `counterparty-probe.ts` | ~$0.30/token | Maps wallet networks around top holders — detects sybil rings and linked wallets |
| `whale-alignment-probe.ts` | ~$0.15 | Cross-references SM DEX trades with Flow Intel to check whale/exchange alignment |
| `sm-holdings-probe.ts` | $0.20 | SM Holdings 3 views (accumulation, value, breadth) + net flow cross-reference |
| `leading-signal-probe.ts` | $0.15 | Tests high 1h flow + low trader count as a leading indicator |
| `wallet-profile.ts` | ~$0.09 | Deep profiles any wallet: balances, PnL, related wallets, counterparties |

### Reference Docs

- **[PLAYBOOK.md](PLAYBOOK.md)** — 11 validated lessons on what works, what doesn't, and what to watch for
- **[NANSEN_x402_ENDPOINTS_SKILL.md](NANSEN_x402_ENDPOINTS_SKILL.md)** — Complete reference for all 22 x402 endpoints with exact params, response schemas, and alpha strategies

## Quick Start

### Prerequisites

- Node.js v20+
- A Solana wallet with USDC (for x402 payments — each call costs $0.01-$0.05)

### Setup

```bash
git clone git@github.com:notorious-d-e-v/nansen-alpha-hunter.git
cd nansen-alpha-hunter
npm install --legacy-peer-deps
```

Create a `.env` file:

```
SVM_PRIVATE_KEY=<your_solana_private_key_base58>
```

### Run the Pipeline

```bash
# Phase 1: Scan for candidates
npx tsx alpha-scanner.ts

# Phase 2: Deep dive top picks (edit TARGETS array in the file)
npx tsx deep-dive.ts

# Phase 3: X-ray a specific token
npx tsx token-xray.ts <TOKEN_ADDRESS>

# Or by symbol (if it appeared in previous scan results)
npx tsx token-xray.ts PUNCH
```

### Run Individual Probes

```bash
# Map wallet networks around a token's top holders
# (edit TARGETS array in the file first)
npx tsx counterparty-probe.ts

# Check SM + whale alignment on recent SM trades
npx tsx whale-alignment-probe.ts

# SM Holdings accumulation analysis
npx tsx sm-holdings-probe.ts

# Profile any wallet
# (edit the address constants in the file first)
npx tsx wallet-profile.ts
```

## Key Learnings (from PLAYBOOK.md)

Things we validated through real analysis:

1. **High SM trader count is lagging** — means SM *was* interested, often signals exit phase
2. **PnL leaderboard "conviction" is misleading** — top profitable traders and top holders are different people
3. **Small 1h flows ($0-5k) are noise** — not a leading indicator on tokens with existing SM presence
4. **Single-wallet flows on young tokens are ambiguous** — could be deployer distribution or genuine early entry
5. **Flow Intel divergence is a reliable kill signal** — SM buys but whales sell = skip
6. **Convergence alone isn't enough** — SM + whales buying still needs X-ray validation
7. **Counterparties reveal hidden sybil risk** — "5 independent holders" can actually be 2 linked entities
8. **SM Holdings has 3 tiers** — conviction holds (no alpha), active accumulation (best signal), micro-bets (noise)
9. **Pump.fun PDAs look like insider bots** — always check Related Wallets before flagging
10. **Alpha is time-dependent** — a single scan may find nothing; the value is in repeated scans over time

## Red Flags (any one = skip)

| Signal | How to Check |
|--------|-------------|
| Transfers one-way to exchanges | `token-xray.ts` — $X to exchanges, $0 back |
| DEX sells dominate buys | `token-xray.ts` — sell count/volume >> buy |
| Top holders are losers | `token-xray.ts` — win rate <30%, negative PnL |
| Top PnL traders fully exited | `deep-dive.ts` — still_holding < 10% for majority |
| Linked holders (same funder) | `counterparty-probe.ts` or `token-xray.ts` — shared First Funder |

## Cost Breakdown

| What | Cost |
|------|------|
| Full pipeline (20 scanned, 3 deep dived, 3 x-rayed) | ~$1.05 |
| Single token deep dive + x-ray | ~$0.26 |
| Counterparty network map (1 token, 5 holders) | ~$0.30 |
| All probes combined | ~$0.50 |

## Project Structure

```
alpha-scanner.ts          # Phase 1: candidate screening
deep-dive.ts              # Phase 2: conviction check
token-xray.ts             # Phase 3: final validation
counterparty-probe.ts     # Sybil/network detection
whale-alignment-probe.ts  # SM + whale convergence check
sm-holdings-probe.ts      # SM portfolio analysis
leading-signal-probe.ts   # 1h flow hypothesis test
wallet-profile.ts         # Individual wallet deep profile
addr-lookup.ts            # Utility: get full addresses from transfers
explore.ts                # Utility: test all 22 endpoints
probe-params.ts           # Utility: discover valid sort/filter params
watchlist.json            # Tokens to track over time
PLAYBOOK.md               # Strategy playbook (11 lessons)
NANSEN_x402_ENDPOINTS_SKILL.md  # Full API reference
```

## License

MIT
