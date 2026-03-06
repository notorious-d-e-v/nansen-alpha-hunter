# Nansen x402 Alpha Hunting Playbook

A living document of strategies, learnings, and pitfalls discovered through on-chain analysis using Nansen's x402 API on Solana.

---

## Lesson 1: High SM Trader Count Does NOT Mean "Buy Now"

**What we assumed:** Tokens with the most smart money wallets (trader_count) are the best opportunities.

**What we found:** All three top-scoring tokens (PUNCH, LOBSTAR, GOYIM) from sorting by `trader_count DESC` were in the **exit phase**. Smart money had already entered, profited, and was actively distributing.

**Evidence:**
- PUNCH: 6/10 top PnL traders fully exited. $404k flowing to exchanges vs $174k in.
- LOBSTAR: 8/10 top PnL traders fully exited. 1 buy vs 9 sells on DEX. $93k to exchanges, $0 back.
- GOYIM: Top holders had 0-20% win rates and were underwater. Recent DEX sells 8x buys.

**Takeaway:** High `trader_count` means smart money *was* interested. It does NOT mean they still are. This metric is **lagging**, not leading.

---

## Lesson 2: The PnL Leaderboard "Conviction" Trap

**What we assumed:** If top PnL traders are "still holding >50% of max position," that signals conviction.

**What we found:** The PnL Leaderboard shows the *most profitable* traders, not the *largest* holders. Even when top PnL traders still hold, the actual top holders can be completely different people - often losing traders holding bags.

**Evidence (GOYIM):**
- PnL Leaderboard: 4/10 still holding >50% -> looked like "HIGH conviction"
- Actual top holders: 20% win rate (-$27k PnL), 0% win rate (-$9k PnL), zero trades
- The profitable traders held small positions. The big holders were losers.

**Takeaway:** Always cross-reference PnL Leaderboard with Holders endpoint. "Top profitable traders still holding" and "top holders are profitable traders" are completely different statements.

---

## Lesson 3: The X-Ray Invalidation Framework

The initial alpha scan is a **screening tool**, not a buy signal. Every candidate MUST pass the X-ray before conviction. Here's what invalidates a trade:

### Red Flags (any one is enough to skip)

| Signal | Endpoint | What It Looks Like |
|--------|----------|--------------------|
| Transfers one-way to exchanges | Transfers | $X to exchanges, $0 from exchanges |
| DEX sells dominate buys | DEX Trades | Sell volume >> buy volume in recent 2d |
| Top holders are losers | Holders + PnL Summary per wallet | Win rate <30%, negative realized PnL |
| SM routing to exit | Transfers | "Former Smart Trader -> Titan bot -> OKX" chains |
| Top PnL traders fully exited | PnL Leaderboard | still_holding_balance_ratio < 0.1 for majority |

### Green Flags (need multiple to build conviction)

| Signal | Endpoint | What It Looks Like |
|--------|----------|--------------------|
| Top holders are profitable | Holders + PnL Summary | Win rate >50%, positive PnL |
| Exchange withdrawals > deposits | Transfers | More tokens leaving exchanges than entering |
| DEX buys dominate sells | DEX Trades | Buy volume > sell volume in recent 2d |
| Top PnL traders still in | PnL Leaderboard | still_holding_balance_ratio > 0.5 for majority |
| SM flow accelerating (1h > 24h avg) | SM Net Flow | net_flow_1h_usd > net_flow_24h_usd / 24 (UNTESTED) |
| Holder accumulating (7d balance up) | Holders | balance_change_7d > 0 for majority of top 10 |
| Low holder concentration | Holders | top 5 < 15% of supply |

---

## Lesson 4: Sorting Strategy - What's Validated vs Hypotheses

### Validated
- `trader_count DESC` shows where SM *was* (lagging, often means exit phase) - **CONFIRMED**

### Hypotheses to Test
- `net_flow_1h_usd DESC` may catch tokens where SM is buying RIGHT NOW (leading signal) - **UNTESTED**
- `balance_24h_percent_change DESC` on SM Holdings may show active accumulation - **UNTESTED**
- `net_flow_7d_usd DESC` with `net_flow_1h_usd` near zero may signal fading interest - **UNTESTED**

### Working theory
1-hour flow may be a leading indicator while 7-day trader count is a lagging indicator. If true, the alpha is in the gap between them. **Needs validation.**

---

## Pipeline: Scan -> Deep Dive -> X-Ray

### Phase 1: Alpha Scanner ($0.22)
**Goal:** Generate candidate list
- SM Net Flow (by 1h momentum + by conviction) -> tokens SM is moving into
- SM DEX Trades (by value) -> real-time SM buys
- Token Screener (by volume + by mcap) -> market context
- Flow Intelligence (top 10) -> whale/exchange/fresh wallet validation

**Filter for:** Positive net_flow_1h_usd, trader_count >= 3, market_cap > $50k

### Phase 2: Deep Dive ($0.12/token)
**Goal:** Check conviction vs distribution
- Holders -> concentration risk, accumulation patterns
- PnL Leaderboard -> are winners still in or have they exited?
- Who Bought/Sold -> buyer/seller breakdown with labels
- Jupiter DCAs -> systematic accumulation or selling

**Kill the idea if:** Majority of top PnL traders exited, net sellers > net buyers

### Phase 3: Token X-Ray ($0.14/token)
**Goal:** Final validation before any position
- Flow timeline -> accumulation/distribution trend
- DEX Trades (2d) -> real buy/sell ratio
- Transfers -> exchange flow direction
- Top holder profiles -> are the biggest bags held by winners or losers?
- Related wallets -> check for connected wallet clusters (sybil risk)

**Kill the idea if:** One-way exchange transfers, DEX sells >> buys, top holders underwater

---

## Cost per Full Analysis

| Phase | Cost | Purpose |
|-------|------|---------|
| Alpha Scanner | $0.22 | Screen ~20 candidates |
| Deep Dive (x3) | $0.36 | Narrow to top 3 |
| X-Ray (x3) | $0.42 | Final validation |
| **Total** | **$1.00** | Full pipeline, 20 screened -> 3 deep dived -> final picks |

---

## What We Haven't Tested Yet

- [ ] Filtering by `net_flow_1h_usd DESC` to find fresh SM entries (not lagging interest)
- [ ] Using `balance_24h_percent_change DESC` on SM Holdings for active accumulation
- [ ] Cross-referencing SM DEX Trades with Flow Intel to confirm whale alignment
- [ ] Tracking a token through time (run X-ray daily to detect phase transitions)
- [ ] Using Counterparties to map wallet networks around a token's top holders
- [ ] Perp data correlation: do perp traders front-run spot SM entries?
