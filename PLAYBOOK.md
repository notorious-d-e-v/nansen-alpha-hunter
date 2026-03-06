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

## Lesson 4: Small 1h Flow on High-Count Tokens is Noise

**What we assumed:** `net_flow_1h_usd DESC` would catch tokens where SM is buying RIGHT NOW, acting as a leading indicator vs the lagging `trader_count`.

**What we tested:** Ran alpha scanner v2 with 3 SM Net Flow views (1h, 24h, trader_count). NEET ($2.1k 1h flow, 6 traders, "accelerating") and FOMO ($321 1h flow, 2 traders, "accelerating") were top 1h-flow candidates.

**What we found:** Both tokens failed X-ray validation — same exit-phase pattern as before:
- NEET: 8 sells vs 2 buys on DEX. $208k to exchanges vs $63k from. "Former Smart Trader" routing through "NEET Distributor." Top holders had 0 trades.
- FOMO: 7/10 top PnL traders fully exited (0% still held). ROIs of 550-2314% — they already made their money. $263k mcap with thin liquidity.

**Why small 1h flows fail:** $321-$2.1k inflows on tokens that already have 2-25 SM wallets represent noise: last stragglers, bots, or arbitrage. Not genuine fresh accumulation.

**Takeaway:** Small `net_flow_1h_usd` ($0-5k) on tokens with existing SM presence is NOT a leading indicator. It's the tail end of the same lagging signal. **PARTIALLY INVALIDATED.**

**Remaining hypothesis:** Large 1h inflows (>$10k+) on tokens with LOW existing trader count (1-3 wallets) might still be a valid leading signal — this represents genuinely *new* SM interest, not stragglers on an old trade. **UNTESTED.**

---

## Lesson 5: Sorting Strategy - What's Validated vs Hypotheses

### Validated
- `trader_count DESC` shows where SM *was* (lagging, often means exit phase) - **CONFIRMED**
- Small `net_flow_1h_usd` on high-count tokens is noise, not a leading signal - **CONFIRMED**

### Hypotheses to Test
- Large `net_flow_1h_usd` (>$10k) + low `trader_count` (1-3) = fresh SM entry - **UNTESTED**
- `balance_24h_percent_change DESC` on SM Holdings may show active accumulation - **UNTESTED**
- `net_flow_7d_usd DESC` with `net_flow_1h_usd` near zero may signal fading interest - **UNTESTED**

### Working theory
The alpha signal may not be in any single sort — it's in the **combination**: high recent flow + low historical trader count = new discovery. Tokens where SM is arriving (not where they've been). **Needs validation.**

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
| Alpha Scanner | $0.27 | Screen ~20 candidates |
| Deep Dive (x3) | $0.36 | Narrow to top 3 |
| X-Ray (x3) | $0.42 | Final validation |
| **Total** | **$1.05** | Full pipeline, 20 screened -> 3 deep dived -> final picks |

---

## Lesson 6: Alpha is Time-Dependent — Single Snapshots Aren't Enough

**What we observed:** Two full pipeline runs (scanner -> deep dive -> X-ray) produced zero actionable entries. Every candidate was in exit phase.

**Why this is expected:** A single scan is a snapshot. SM accumulation happens in windows — a token might only show the "high 1h flow + low trader count" pattern for a few hours before either price runs or interest fades. Checking once and finding nothing doesn't invalidate the pipeline; it means the market wasn't offering opportunities at that moment.

**Takeaway:** The pipeline's value comes from **repeated scans over time** — hourly or every few hours across days. The goal is to be ready when the signal appears, not to expect every scan to produce alpha. Consider automating scans on a schedule (cron/interval) and only alerting when a candidate passes Phase 1 filters with strong 1h-flow + low-count characteristics.

---

## What We Haven't Tested Yet

- [x] Filtering by `net_flow_1h_usd DESC` to find fresh SM entries — **small flows are noise** (Lesson 4)
- [ ] Filtering by `net_flow_1h_usd DESC` + `trader_count` 1-3 (large flow, low count = true fresh entry)
- [ ] Using `balance_24h_percent_change DESC` on SM Holdings for active accumulation
- [ ] Cross-referencing SM DEX Trades with Flow Intel to confirm whale alignment
- [ ] Tracking a token through time (run X-ray daily to detect phase transitions)
- [ ] Using Counterparties to map wallet networks around a token's top holders
- [ ] Perp data correlation: do perp traders front-run spot SM entries?
- [ ] Scheduled scanning: run alpha scanner every 1-4 hours, log results over days, look for patterns
- [ ] Alert system: auto-flag tokens matching "high 1h flow + low trader count" for immediate deep dive
