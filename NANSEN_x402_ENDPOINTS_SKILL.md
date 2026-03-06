# Skill: Nansen X402 Solana Alpha Hunter

> **Claude Skill** - Use this reference when querying the Nansen x402 API for on-chain Solana intelligence. This skill documents every available endpoint, its exact parameters, response schema, and alpha strategies.

## Overview

- **Base URL:** `https://api.nansen.ai`
- **Payment:** x402 protocol via USDC on Solana or Base (no API key needed)
- **Rate Limits:** 5 req/sec, 60 req/min per wallet
- **All endpoints:** `POST` with `Content-Type: application/json`
- **22 of 25 endpoints** are available via x402 payments

### When to use which endpoint

| Goal | Endpoint(s) |
|------|-------------|
| What is smart money buying right now? | Smart Money DEX Trades, Smart Money Net Flow |
| Is a token safe or a rug? | Holders, Flow Intelligence, Who Bought/Sold |
| Should I copy-trade a wallet? | PnL Summary, PnL Leaderboard, Transactions |
| Find new tokens early | Token Screener, Smart Money Net Flow, Smart Money Holdings |
| Track whale movements | Transfers, Flows, Current Balances |
| Perp trading intelligence | Perp Screener, Perp Leaderboard, Perp Positions |
| Map wallet networks | Related Wallets, Counterparties |

---

## Table of Contents

1. [Profiler Endpoints (Wallet Analysis)](#1-profiler-endpoints-wallet-analysis)
2. [Token God Mode (TGM) Endpoints](#2-token-god-mode-tgm-endpoints)
3. [Screener Endpoints](#3-screener-endpoints)
4. [Perpetual Futures Endpoints](#4-perpetual-futures-endpoints)
5. [Smart Money Endpoints](#5-smart-money-endpoints)
6. [Endpoints NOT Available via x402](#6-endpoints-not-available-via-x402)

---

## 1. Profiler Endpoints (Wallet Analysis)

### 1.1 Current Balances - $0.01/call
**POST** `/api/v1/profiler/address/current-balance`

Shows all token holdings for a wallet right now, sorted by USD value.

**Request:**
```json
{
  "address": "<solana_address>",
  "chain": "solana"
}
```

**Response Fields:**
| Field | Description |
|-------|-------------|
| `token_address` | Token mint address |
| `token_symbol` | Token ticker (e.g., SOL, USDC) |
| `token_name` | Full token name |
| `token_amount` | Number of tokens held |
| `price_usd` | Current token price |
| `value_usd` | Total position value |

**Alpha Use:** Instantly see what a wallet is holding. Check whale portfolios, see if smart money is concentrated in certain tokens.

---

### 1.2 Historical Balances - $0.01/call
**POST** `/api/v1/profiler/address/historical-balances`

Snapshots of wallet holdings at past points in time.

**Request:**
```json
{
  "address": "<solana_address>",
  "chain": "solana",
  "date": { "from": "YYYY-MM-DD", "to": "YYYY-MM-DD" }
}
```

**Response Fields:**
| Field | Description |
|-------|-------------|
| `block_timestamp` | Snapshot timestamp |
| `token_address` | Token mint |
| `token_amount` | Balance at that time |
| `value_usd` | USD value at that time |
| `token_symbol` | Token ticker |

**Alpha Use:** Track how a wallet's portfolio evolved over time. Detect accumulation/distribution patterns.

---

### 1.3 Transactions - $0.01/call
**POST** `/api/v1/profiler/address/transactions`

Full transaction history for a wallet.

**Request:**
```json
{
  "address": "<solana_address>",
  "chain": "solana",
  "date": { "from": "YYYY-MM-DD", "to": "YYYY-MM-DD" }
}
```

**Response Fields:**
| Field | Description |
|-------|-------------|
| `method` | Transaction type (swap, transfer, etc.) |
| `tokens_sent` | Array of tokens sent (address, symbol, amount) |
| `tokens_received` | Array of tokens received |
| `volume_usd` | Total transaction value |
| `block_timestamp` | When it happened |
| `transaction_hash` | On-chain tx signature |
| `source_type` | Protocol used (e.g., DEX, transfer) |

**Alpha Use:** Full audit trail. See exactly what a wallet has been doing - swapping, transferring, providing liquidity.

---

### 1.4 Related Wallets - $0.01/call
**POST** `/api/v1/profiler/address/related-wallets`

Finds wallets that are connected to the target wallet (funded by, sent to, etc.).

**Request:**
```json
{
  "address": "<solana_address>",
  "chain": "solana"
}
```

**Response Fields:**
| Field | Description |
|-------|-------------|
| `address` | Related wallet address |
| `address_label` | Nansen label (exchange, whale, etc.) |
| `relation` | How they're connected |
| `transaction_hash` | Connecting transaction |
| `block_timestamp` | When the connection happened |

**Alpha Use:** Uncover wallet clusters. If a whale has 10 wallets, you can find them all. Detect insider networks.

---

### 1.5 PnL Summary - $0.01/call
**POST** `/api/v1/profiler/address/pnl-summary`

High-level profit/loss overview for a wallet over a time period.

**Request:**
```json
{
  "address": "<solana_address>",
  "chain": "solana",
  "date": { "from": "YYYY-MM-DD", "to": "YYYY-MM-DD" }
}
```

**Response Fields:**
| Field | Description |
|-------|-------------|
| `top5_tokens` | Best performing tokens |
| `traded_token_count` | Number of unique tokens traded |
| `traded_times` | Total number of trades |
| `realized_pnl_usd` | Realized profit/loss in USD |
| `realized_pnl_percent` | PnL as percentage |
| `win_rate` | Percentage of profitable trades |

**Alpha Use:** Quickly assess if a wallet is actually profitable or just lucky. Check win rates before copy-trading.

---

### 1.6 PnL (Detailed) - $0.01/call
**POST** `/api/v1/profiler/address/pnl`

Token-by-token breakdown of profit/loss.

**Request:**
```json
{
  "address": "<solana_address>",
  "chain": "solana",
  "date": { "from": "YYYY-MM-DD", "to": "YYYY-MM-DD" }
}
```

**Alpha Use:** See exactly which tokens made or lost money for a wallet. Understand their strategy.

---

### 1.7 Counterparties - $0.05/call (Premium)
**POST** `/api/v1/profiler/address/counterparties`

Shows which wallets the target has interacted with most, including volume and token details.

**Request:**
```json
{
  "address": "<solana_address>",
  "chain": "solana",
  "date": { "from": "YYYY-MM-DD", "to": "YYYY-MM-DD" }
}
```
> Note: Extremely active wallets (like Raydium) may be rejected.

**Response Fields:**
| Field | Description |
|-------|-------------|
| `counterparty_address` | The other wallet |
| `counterparty_address_label` | Nansen label |
| `interaction_count` | Number of interactions |
| `total_volume_usd` | Total value exchanged |
| `volume_in_usd` | Value received from counterparty |
| `volume_out_usd` | Value sent to counterparty |
| `tokens_info` | Array of tokens traded between them |

**Alpha Use:** Map the social graph of money. Find who a whale is trading with. Detect coordinated activity, OTC deals, or insider flows.

---

## 2. Token God Mode (TGM) Endpoints

### 2.1 Transfers - $0.01/call
**POST** `/api/v1/tgm/transfers`

Large token transfers (not swaps) - typically exchange deposits/withdrawals and whale movements.

**Request:**
```json
{
  "token_address": "<token_mint>",
  "chain": "solana",
  "date": { "from": "YYYY-MM-DD", "to": "YYYY-MM-DD" }
}
```
> Note: Native SOL (`So111...`) is NOT supported. Use specific token addresses.

**Response Fields:**
| Field | Description |
|-------|-------------|
| `from_address` / `to_address` | Sender and receiver |
| `from_address_label` / `to_address_label` | Nansen labels (exchange names, whale tags) |
| `transaction_type` | "transfer" |
| `transfer_amount` | Token amount moved |
| `transfer_value_usd` | USD value |

**Alpha Use:** Track large movements to/from exchanges. Coinbase deposit = potential sell. Exchange withdrawal = likely hold. Wintermute to Robinhood = market making activity.

---

### 2.2 DCAs (Jupiter DCA) - $0.01/call
**POST** `/api/v1/tgm/jup-dca`

Active and recent Jupiter DCA (Dollar Cost Averaging) orders for a token.

**Request:**
```json
{
  "token_address": "<token_mint>"
}
```
> Note: No `chain` field needed (Solana-only endpoint).

**Response Fields:**
| Field | Description |
|-------|-------------|
| `trader_address` | Who set up the DCA |
| `dca_vault_address` | Jupiter DCA vault |
| `input_mint_address` / `output_mint_address` | What's being swapped |
| `deposit_amount` | Total tokens deposited |
| `deposit_spent` | How much has been spent so far |
| `other_token_redeemed` | Tokens received |
| `status` | "Open" or "Closed" |
| `token_input` / `token_output` | Human-readable symbols |
| `deposit_usd_value` | USD value of deposit |

**Alpha Use:** See who is systematically accumulating or selling a token. Large open DCA buys = bullish conviction. Large DCA sells = someone exiting.

---

### 2.3 Flow Intelligence - $0.01/call
**POST** `/api/v1/tgm/flow-intelligence`

Aggregated net flows by wallet type (whales, smart traders, exchanges, fresh wallets, etc.).

**Request:**
```json
{
  "token_address": "<token_mint>",
  "chain": "solana"
}
```

**Response Fields:**
| Field | Description |
|-------|-------------|
| `public_figure_net_flow_usd` | Net buying/selling by known figures |
| `top_pnl_net_flow_usd` | Net flow from top PnL traders |
| `whale_net_flow_usd` | Net flow from whale wallets |
| `smart_trader_net_flow_usd` | Net flow from smart money |
| `exchange_net_flow_usd` | Net flow to/from exchanges |
| `fresh_wallets_net_flow_usd` | Net flow from newly created wallets |
| `*_avg_flow_usd` | Average flow size per category |
| `*_wallet_count` | Number of wallets in each category |

**Alpha Use:** THIS IS THE MOST POWERFUL SINGLE ENDPOINT FOR ALPHA. At a glance: Are whales buying or selling? Are exchanges accumulating or distributing? Are fresh wallets (potential insiders) piling in? Negative whale flow + positive fresh wallet flow = potential rug setup.

---

### 2.4 Who Bought/Sold - $0.01/call
**POST** `/api/v1/tgm/who-bought-sold`

Top buyers and sellers of a token in a time period, with labels.

**Request:**
```json
{
  "token_address": "<token_mint>",
  "chain": "solana",
  "date": { "from": "YYYY-MM-DD", "to": "YYYY-MM-DD" }
}
```

**Response Fields:**
| Field | Description |
|-------|-------------|
| `address` | Wallet address |
| `address_label` | Nansen label (exchange, whale, bot, etc.) |
| `bought_token_volume` | Tokens bought |
| `sold_token_volume` | Tokens sold |
| `token_trade_volume` | Net position change |
| `bought_volume_usd` / `sold_volume_usd` | USD values |

**Alpha Use:** See exactly who the biggest buyers/sellers are. Is Wintermute market making? Is a specific whale accumulating? Are bots dominating the flow?

---

### 2.5 DEX Trades - $0.01/call
**POST** `/api/v1/tgm/dex-trades`

Individual DEX swap transactions for a token.

**Request:**
```json
{
  "token_address": "<token_mint>",
  "chain": "solana",
  "date": { "from": "YYYY-MM-DD", "to": "YYYY-MM-DD" }
}
```

**Response Fields:**
| Field | Description |
|-------|-------------|
| `block_timestamp` | Exact time of trade |
| `transaction_hash` | On-chain tx |
| `trader_address` | Who traded |
| `trader_address_label` | Nansen label |
| `action` | "BUY" or "SELL" |
| `token_amount` | Amount of target token |
| `traded_token_address/name/amount` | The other side of the swap |
| `estimated_swap_price_usd` | Price at time of swap |
| `estimated_value_usd` | Trade value in USD |

**Alpha Use:** Real-time trade feed. See every swap with the trader's identity. Detect front-running, sandwich attacks, or smart money entries.

---

### 2.6 Flows - $0.01/call
**POST** `/api/v1/tgm/flows`

Hourly aggregated inflow/outflow data for a token across top holders.

**Request:**
```json
{
  "token_address": "<token_mint>",
  "chain": "solana",
  "date": { "from": "YYYY-MM-DD", "to": "YYYY-MM-DD" }
}
```

**Response Fields:**
| Field | Description |
|-------|-------------|
| `date` | Hourly timestamp |
| `price_usd` | Token price at that hour |
| `token_amount` | Total token supply tracked |
| `value_usd` | Total value tracked |
| `holders_count` | Number of holders tracked |
| `total_inflows_count` | Tokens flowing in |
| `total_outflows_count` | Tokens flowing out (negative) |

**Alpha Use:** Track accumulation/distribution patterns over time. Correlate flow changes with price movements. Large outflows before price drops = smart money exiting.

---

### 2.7 Holders - $0.05/call (Premium)
**POST** `/api/v1/tgm/holders`

Top holders of a token with detailed balance change info.

**Request:**
```json
{
  "token_address": "<token_mint>",
  "chain": "solana"
}
```

**Response Fields:**
| Field | Description |
|-------|-------------|
| `address` | Holder wallet |
| `address_label` | Nansen label (exchange, whale, DAO, etc.) |
| `token_amount` | Current balance |
| `total_outflow` / `total_inflow` | Lifetime flows |
| `balance_change_24h/7d/30d` | Recent balance changes |
| `ownership_percentage` | % of total supply |
| `value_usd` | Current USD value |

**Alpha Use:** See the holder distribution. Is it concentrated (rug risk) or distributed (healthy)? Are top holders accumulating (24h/7d change) or dumping? Binance/Robinhood holdings = retail interest.

---

### 2.8 PnL Leaderboard - $0.05/call (Premium)
**POST** `/api/v1/tgm/pnl-leaderboard`

Top traders of a specific token ranked by profit/loss.

**Request:**
```json
{
  "token_address": "<token_mint>",
  "chain": "solana",
  "date": { "from": "YYYY-MM-DD", "to": "YYYY-MM-DD" }
}
```

**Response Fields:**
| Field | Description |
|-------|-------------|
| `trader_address` | Wallet address |
| `trader_address_label` | Nansen label |
| `pnl_usd_realised` | Locked-in profit/loss |
| `pnl_usd_unrealised` | Paper profit/loss |
| `pnl_usd_total` | Combined PnL |
| `holding_amount/usd` | Current position |
| `max_balance_held` | Largest position ever |
| `still_holding_balance_ratio` | % of max still held |
| `roi_percent_total` | Return on investment |
| `nof_trades` | Number of trades |

**Alpha Use:** Find the best traders on any token. Copy their next moves. Check if top PnL wallets are still holding or have exited. Low `still_holding_balance_ratio` = they've taken profits.

---

## 3. Screener Endpoints

### 3.1 Token Screener - $0.01/call
**POST** `/api/v1/token-screener`

Screen all tokens by metrics - essentially Nansen's token discovery tool.

**Request:**
```json
{
  "chains": ["solana"],
  "timeframe": "24h"
}
```
> Valid timeframes: "1h", "4h", "12h", "24h", "7d", "30d"

**Response Fields:**
| Field | Description |
|-------|-------------|
| `token_address` | Token mint |
| `token_symbol` | Ticker |
| `token_age_days` | How old the token is |
| `market_cap_usd` | Market capitalization |
| `liquidity` | Available liquidity |
| `price_usd` | Current price |
| `price_change` | Price change in timeframe |
| `fdv` | Fully diluted valuation |
| `buy_volume` / `sell_volume` | Directional volume |
| `volume` | Total volume |
| `netflow` | Buy volume minus sell volume |
| `inflow_fdv_ratio` / `outflow_fdv_ratio` | Volume relative to FDV |

**Alpha Use:** Discovery engine. Sort by netflow to find tokens with the most buying pressure. High inflow_fdv_ratio = big money relative to size. Compare buy/sell volume for sentiment.

---

## 4. Perpetual Futures Endpoints

> Note: Perp endpoints track Hyperliquid and use EVM-style addresses (0x...), not Solana addresses.

### 4.1 Perp Positions - $0.01/call
**POST** `/api/v1/profiler/perp-positions`

Current open perpetual futures positions for a trader.

**Request:**
```json
{
  "address": "<evm_address>"
}
```

**Response Fields:**
| Field | Description |
|-------|-------------|
| `token_symbol` | Asset being traded |
| `size` | Position size |
| `position_value_usd` | Total position value |
| `entry_price_usd` | Entry price |
| `liquidation_price_usd` | Liquidation level |
| `leverage_value` | Current leverage |
| `unrealized_pnl_usd` | Paper PnL |
| `cumulative_funding_all_time_usd` | Total funding paid/received |
| `margin_summary_account_value_usd` | Total account value |
| `withdrawable_usd` | Available to withdraw |

**Alpha Use:** See exactly what top perp traders are positioned in. Large long positions at high leverage = conviction (or recklessness). Track funding payments to understand carry trade viability.

---

### 4.2 Perp Screener - $0.01/call
**POST** `/api/v1/perp-screener`

Screen perpetual futures markets by metrics.

**Request:**
```json
{
  "date": { "from": "YYYY-MM-DD", "to": "YYYY-MM-DD" }
}
```

**Response Fields:**
| Field | Description |
|-------|-------------|
| `token_symbol` | Asset |
| `volume` | Total trading volume |
| `buy_volume` / `sell_volume` | Directional volume |
| `buy_sell_pressure` | Net buying pressure |
| `trader_count` | Active traders |
| `mark_price` | Current mark price |
| `funding` | Funding rate |
| `open_interest` | Total open positions |

**Alpha Use:** Find which perp markets have the most activity. High positive funding = crowded long. Increasing OI + price rise = genuine trend. Decreasing OI + price rise = short squeeze.

---

### 4.3 Perp PnL Leaderboard - $0.05/call (Premium)
**POST** `/api/v1/tgm/perp-pnl-leaderboard`

Top perp traders ranked by PnL for a specific asset.

**Request:**
```json
{
  "token_symbol": "SOL",
  "date": { "from": "YYYY-MM-DD", "to": "YYYY-MM-DD" }
}
```

**Response Fields:**
Same as PnL Leaderboard but with `position_value_usd` instead of `holding_usd`.

**Alpha Use:** Find who's making money on SOL perps. These traders often have early information on price moves.

---

### 4.4 Perp Leaderboard - $0.05/call (Premium)
**POST** `/api/v1/perp-leaderboard`

Overall top perpetual futures traders across all assets.

**Request:**
```json
{
  "date": { "from": "YYYY-MM-DD", "to": "YYYY-MM-DD" }
}
```

**Response Fields:**
| Field | Description |
|-------|-------------|
| `trader_address` | Wallet address |
| `trader_address_label` | Nansen label (Abraxas Capital, Galaxy Digital, etc.) |
| `total_pnl` | Total profit/loss |
| `roi` | Return on investment |
| `account_value` | Current account size |

**Alpha Use:** The global leaderboard of perp traders. These are the ones to watch. Galaxy Digital, Abraxas Capital, and smart HL traders consistently appear.

---

## 5. Smart Money Endpoints

### 5.1 Smart Money Net Flow - $0.05/call
**POST** `/api/v1/smart-money/netflow`

Aggregated net flows from Nansen-labeled "Smart Money" wallets across all tokens.

**Request:**
```json
{
  "chains": ["solana"]
}
```

**Response Fields:**
| Field | Description |
|-------|-------------|
| `token_address` | Token mint |
| `token_symbol` | Ticker |
| `net_flow_1h_usd` | Smart money net flow last 1 hour |
| `net_flow_24h_usd` | Last 24 hours |
| `net_flow_7d_usd` | Last 7 days |
| `net_flow_30d_usd` | Last 30 days |
| `token_sectors` | Token categories (Memecoins, DeFi, etc.) |
| `trader_count` | Number of smart money wallets involved |
| `token_age_days` | Token age |
| `market_cap_usd` | Market cap |

**Alpha Use:** THE SMART MONEY SIGNAL. See what institutional/smart wallets are accumulating RIGHT NOW. Positive net_flow_24h + low market_cap = early smart money entry. Compare 1h vs 24h vs 7d trends to gauge conviction.

---

### 5.2 Smart Money Holdings - $0.05/call
**POST** `/api/v1/smart-money/holdings`

What smart money wallets are collectively holding.

**Request:**
```json
{
  "chains": ["solana"]
}
```

**Response Fields:**
| Field | Description |
|-------|-------------|
| `token_address` | Token mint |
| `token_symbol` | Ticker |
| `token_sectors` | Categories |
| `value_usd` | Total smart money value held |
| `balance_24h_percent_change` | 24h change in holdings |
| `holders_count` | Number of smart money holders |
| `share_of_holdings_percent` | % of smart money portfolio |
| `token_age_days` | Token age |
| `market_cap_usd` | Market cap |

**Alpha Use:** Smart money portfolio snapshot. High `holders_count` = broad conviction. Positive `balance_24h_percent_change` = active accumulation. JUP, META, FARTCOIN were all in smart money holdings.

---

### 5.3 Smart Money DEX Trades - $0.05/call
**POST** `/api/v1/smart-money/dex-trades`

Real-time DEX trades from smart money wallets.

**Request:**
```json
{
  "chains": ["solana"]
}
```

**Response Fields:**
| Field | Description |
|-------|-------------|
| `block_timestamp` | Exact trade time |
| `trader_address` | Smart money wallet |
| `trader_address_label` | Label (e.g., "30D Smart Trader", "180D Smart Trader") |
| `token_bought_address/symbol` | What they bought |
| `token_sold_address/symbol` | What they sold |
| `token_bought/sold_amount` | Amounts |
| `token_bought/sold_age_days` | Token ages |
| `token_bought/sold_market_cap` | Market caps |
| `trade_value_usd` | Trade size |

**Alpha Use:** REAL-TIME SMART MONEY TRADE FEED. See exactly what smart traders are buying RIGHT NOW. New low-cap buys (`token_bought_age_days` < 30, low `market_cap`) are the highest alpha signals. Smart traders buying PUNCH ($7.5M mcap) and POKOPIA ($45K mcap) = potential early entries.

---

## 6. Endpoints NOT Available via x402

| Endpoint | Path | Reason |
|----------|------|--------|
| Perp Trades | `/api/v1/profiler/perp-trades` | Returns 401, requires API key |
| DeFi Holdings | `/api/v1/portfolio/defi-holdings` | Explicitly not x402-enabled |
| Labels | Various | Pro subscription only |

---

## Quick Reference: Parameter Patterns

| Parameter | Format | Used By |
|-----------|--------|---------|
| `address` | Solana pubkey or 0x EVM | Profiler endpoints |
| `chain` | `"solana"` | Most token-specific endpoints |
| `chains` | `["solana"]` | Screeners, Smart Money |
| `token_address` | Token mint address | TGM endpoints |
| `token_symbol` | `"SOL"`, `"BTC"` | Perp PnL Leaderboard |
| `date` | `{"from": "YYYY-MM-DD", "to": "YYYY-MM-DD"}` | Most endpoints |
| `timeframe` | `"1h"`, `"4h"`, `"12h"`, `"24h"`, `"7d"`, `"30d"` | Token Screener |

## Cost Summary

| Tier | Cost | Endpoints |
|------|------|-----------|
| Basic | $0.01 | Current/Historical Balances, Transactions, Related Wallets, PnL, Perp Positions, Token/Perp Screener, Transfers, DCAs, Flow Intel, Who Bought/Sold, DEX Trades, Flows |
| Premium | $0.05 | Counterparties, Holders, PnL Leaderboard, Perp PnL/Perp Leaderboard |
| Smart Money | $0.05 | Net Flow, Holdings, DEX Trades |

**Full scan of one token** (all applicable endpoints): ~$0.15
**Full scan of one wallet** (all applicable endpoints): ~$0.12

---

## Skill Usage Instructions

When using this skill as a Claude agent or AI assistant:

1. **Always use snake_case** for request body fields (`token_address`, not `tokenAddress`)
2. **Smart Money endpoints use `chains` (array)**, not `chain` (string): `{"chains": ["solana"]}`
3. **Most TGM/profiler endpoints require `date`**: `{"from": "YYYY-MM-DD", "to": "YYYY-MM-DD"}`
4. **Perp endpoints use EVM addresses** (0x...) from Hyperliquid, not Solana pubkeys
5. **Jupiter DCA endpoint needs no `chain` field** - it's Solana-only
6. **Native SOL is not supported** on the Transfers endpoint - use SPL token addresses
7. **Highly active wallets** (like protocol addresses) may be rejected by the Counterparties endpoint
8. **All responses are paginated** with `{page, per_page, is_last_page}` - request additional pages as needed

### Recommended Alpha Hunting Workflow

```
1. Smart Money Net Flow     -> Find what SM is accumulating
2. Smart Money DEX Trades   -> See real-time SM buys
3. Flow Intelligence        -> Check if whales/exchanges agree
4. Token Screener           -> Validate with market metrics
5. Holders                  -> Check concentration risk
6. PnL Leaderboard          -> Find top traders on the token
7. Who Bought/Sold          -> Confirm buying pressure
```

### Risk Assessment Workflow

```
1. Holders                  -> Check top holder concentration
2. Flow Intelligence        -> Fresh wallet inflow = red flag
3. Transfers                -> Large exchange deposits = sell pressure
4. Related Wallets          -> Check if top holders are connected
5. Counterparties           -> Map the money graph
```
