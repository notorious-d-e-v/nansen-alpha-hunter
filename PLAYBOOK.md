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

**Remaining hypothesis:** Large 1h inflows (>$10k+) on tokens with LOW existing trader count (1-3 wallets) might still be a valid leading signal — this represents genuinely *new* SM interest, not stragglers on an old trade. → See Lesson 5.

---

## Lesson 5: Single-Wallet Flow on Young Tokens = Deployer Activity

**What we assumed:** Large 24h flow ($13.8k) + single SM wallet + 4-day-old token (MACHI) = the ideal leading signal. Fresh SM discovery of a new token.

**What we found:** X-ray revealed MACHI's flows were deployer distribution, not organic accumulation:
- $136k minted from Solana Mint → Bot, then distributed to multiple wallets including "Ahmadinejad Token Deployer"
- $28.3k one-way to LP, $0 from exchanges
- Top holders: 15% win rate (-$41k PnL), spam token trader (-$1.1k PnL)
- Trade sizes tiny ($12-$224) — no real market

**Why single-wallet flows on young tokens fail:** On tokens < 7 days old, the "SM wallet" making the large flow is often the deployer or an insider moving supply. Nansen may label these wallets as smart money based on historical activity, but the current flow is supply distribution, not genuine accumulation.

**Takeaway:** When `trader_count = 1` and `token_age_days < 7`, check Transfers for mint/deployer chains before treating the flow as a buy signal. However, this pattern could also indicate a genuine early breakout — needs validation over multiple scans to distinguish deployer activity from real SM discovery. **CAUTION, NOT CONFIRMED TRAP.**

**Additional finding:** Server-side `trader_count` filter is not supported on SM Net Flow (returns 422). Must filter client-side.

---

## Lesson 6: Sorting Strategy - What's Validated vs Hypotheses

### Validated
- `trader_count DESC` shows where SM *was* (lagging, often means exit phase) - **CONFIRMED**
- Small `net_flow_1h_usd` ($0-5k) on high-count tokens is noise - **CONFIRMED**
- Single-wallet flow on young tokens (< 7d) is usually deployer activity - **CONFIRMED**
- Server-side `trader_count` filter not available; must filter client-side - **CONFIRMED**

### Hypotheses to Test
- Large `net_flow_1h_usd` (>$10k) + `trader_count` 2-5 + `token_age_days` > 14 = fresh SM entry - **UNTESTED** (refined: excludes deployer traps)
- `balance_24h_percent_change DESC` on SM Holdings may show active accumulation - **UNTESTED**
- `net_flow_7d_usd DESC` with `net_flow_1h_usd` near zero may signal fading interest - **UNTESTED**

### Working theory
The alpha signal may not be in any single sort — it's in the **combination**: high recent flow + low historical trader count + token old enough to exclude deployer activity. Tokens where SM is arriving (not where they've been), with enough market history to verify legitimacy. **Needs validation — but the right conditions may not exist at every point in time (Lesson 7).**

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

## Lesson 7: Alpha is Time-Dependent — Single Snapshots Aren't Enough

**What we observed:** Two full pipeline runs (scanner -> deep dive -> X-ray) produced zero actionable entries. Every candidate was in exit phase.

**Why this is expected:** A single scan is a snapshot. SM accumulation happens in windows — a token might only show the "high 1h flow + low trader count" pattern for a few hours before either price runs or interest fades. Checking once and finding nothing doesn't invalidate the pipeline; it means the market wasn't offering opportunities at that moment.

**Takeaway:** The pipeline's value comes from **repeated scans over time** — hourly or every few hours across days. The goal is to be ready when the signal appears, not to expect every scan to produce alpha. Consider automating scans on a schedule (cron/interval) and only alerting when a candidate passes Phase 1 filters with strong 1h-flow + low-count characteristics.

---

## Lesson 8: Flow Intel Alignment is Necessary but Not Sufficient

**What we tested:** Cross-referenced SM DEX Trades with Flow Intelligence to check whether whale/exchange/fresh wallet flows converge with SM buying.

**Setup:** Pulled 10 SM DEX trades, aggregated by token (3 had net SM buying), then ran Flow Intel on each to check whale, exchange, fresh wallet, top PnL, and public figure alignment.

**What we found:**
- Only 1/3 tokens showed alignment (我的刀盾): whales +$14.4k, public figures +$34.4k alongside SM buying
- BUT X-ray invalidated it: top holders were 25-43% win rate losing traders. Transfer activity thin and circular. The "aligned" flow was real but the underlying token quality was poor.
- MAXXING showed clear divergence: SM buying but whales selling — correct skip signal.
- MACHI (deployer trap from Lesson 5) confirmed as mixed — no whale interest.

**Why alignment alone fails:** Flow Intel tells you *who* is buying, but not *why* or *how much conviction*. A whale putting $14k into a token could be 0.001% of their portfolio — a throwaway bet. The X-ray (holder quality, PnL profiles, transfer patterns) is still the final gate.

**What works:** Divergence is a reliable **kill signal**. When SM buys but whales sell (MAXXING), skip it. But convergence (SM + whales + public figures all buying) is only a **qualifying signal**, not a buy signal. It narrows the field but doesn't replace the X-ray.

**Takeaway:** Add whale alignment as a Phase 1 filter to prioritize which tokens get deep-dived, but never skip the X-ray based on Flow Intel alone. Divergence = skip. Convergence = investigate further.

---

## Lesson 9: Counterparties Reveal Hidden Concentration and Sybil Risk

**What we tested:** Ran Counterparties ($0.05/wallet) on top 5 non-LP holders of PUNCH and LOBSTAR to map their wallet networks and check for coordinated activity.

**PUNCH findings — sybil risk MODERATE-HIGH:**
- **Direct holder link:** punchkun.sol (#1, 3.81%) ↔ hyperwynn.sol (#2, 2.49%) — 5 direct transactions, $11k volume. Combined 6.3% of supply from what's likely a single entity.
- **Multi-wallet operator:** 👤 Ily (#3, 1.85%) — top 3 counterparties are all other "Ily" wallets. One person spread across multiple addresses.
- **Insider distribution:** Distributor (#4, 1.59%) sent $57.3k one-way to an unlabeled address. Connected to "Punchzi Token Deployer."
- **Real concentration is ~2x reported.** Holders page shows 5 independent wallets at 11.1% combined; in reality, linked entities control a larger share.

**LOBSTAR findings — sybil risk LOW-MODERATE:**
- No direct holder-to-holder transactions.
- Holders #4 and #5 share the same top counterparty (Trading Bot [AgmLJBMD]) with massive volume — possibly same operator.
- Holder #1 is isolated, exchange-funded (Binance). Clean.
- OKX DEX is the universal routing hub (4/5 holders use it) — shared infrastructure, not collusion.

**Key insight:** The Holders endpoint shows "5 independent wallets" but Counterparties reveals the *actual* ownership graph. Linked wallets, multi-wallet operators, and insider distributors make reported concentration deceptively low.

**Takeaway:** Run Counterparties on top 3-5 holders as part of the X-ray phase. Red flags: direct holder-to-holder transactions, same entity labels across counterparty lists, one-way high-volume transfers to unlabeled wallets. Cost: $0.25-0.30 per token (holders + 5 counterparty calls).

**API note:** Highly active wallets may timeout on Counterparties (hyperwynn.sol returned 500). Use shorter date ranges or skip those wallets.

---

## What We Haven't Tested Yet

- [x] Filtering by `net_flow_1h_usd DESC` to find fresh SM entries — **small flows are noise** (Lesson 4)
- [ ] Filtering by `net_flow_1h_usd DESC` + `trader_count` 1-3 — needs validation over time (could be deployer trap OR early breakout)
- [x] Cross-referencing SM DEX Trades with Flow Intel to confirm whale alignment — **convergence is necessary but not sufficient; divergence is a reliable kill signal** (Lesson 8)
- [x] Using Counterparties to map wallet networks around top holders — **reveals hidden concentration, linked wallets, and sybil risk** (Lesson 9)
- [ ] Refined: large flow + trader_count 2-5 + token_age > 14d (excludes deployer traps)
- [ ] Using `balance_24h_percent_change DESC` on SM Holdings for active accumulation
- [ ] Tracking a token through time (run X-ray daily to detect phase transitions)
- [ ] Perp data correlation: do perp traders front-run spot SM entries?
- [ ] Scheduled scanning: run alpha scanner every 1-4 hours, log results over days, look for patterns
- [ ] Alert system: auto-flag tokens matching "high 1h flow + low trader count" for immediate deep dive
