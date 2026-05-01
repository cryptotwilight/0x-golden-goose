# 🪿 0x Golden Goose

> AI-powered multi-agent DEX trading swarm built for ETHGlobal OpenAgents

0x Golden Goose is an autonomous trading system made of three specialized AI agents that coordinate with each other to monitor, evaluate, and execute trades on Uniswap v3 — without any central server or single point of failure.

---

## Architecture

```
                    ┌─────────────────────────────────────────────────────┐
                    │              KeeperHub (Automation Layer)            │
                    │   Scheduled polls + price-condition triggers         │
                    │   POST /api/trigger → PriceScout                    │
                    └──────────────────────┬──────────────────────────────┘
                                           │ HTTP callback
                    ┌──────────────────────▼──────────────────────────────┐
                    │                  GENSYN AXL                          │
                    │     P2P encrypted inter-agent message bus            │
                    │     Endpoints: /send, /recv, /topology               │
                    └──────┬───────────────────────────────┬──────────────┘
                           │ SIGNAL                        │ DECISION
              ┌────────────▼──────────┐     ┌─────────────▼────────────┐
              │      PriceScout       │     │      RiskManager          │
              │  scout.0xgoldengoose.eth  │────▶│  risk.0xgoldengoose.eth       │
              │                       │     │                           │
              │  • Polls Uniswap v3   │     │  • Confidence gate (≥40%) │
              │  • Rolling avg price  │     │  • Circuit breaker (10%)  │
              │  • Emits BUY/SELL     │     │  • 60s trade cooldown     │
              │  • Stores ticks → 0G  │     │  • Adjusts position size  │
              └───────────────────────┘     └─────────────┬─────────────┘
                           ▲                              │ DECISION (approved)
                           │ RESULT                       ▼
                           │                ┌─────────────────────────────┐
                           └────────────────│        Executor              │
                                            │  executor.0xgoldengoose.eth      │
                                            │                              │
                                            │  • Approves token spend      │
                                            │  • Submits swap (Sepolia)    │
                                            │  • Waits for confirmation    │
                                            │  • Logs result → 0G          │
                                            └──────────────┬───────────────┘
                                                           │
                              ┌────────────────────────────▼───────────────┐
                              │            Uniswap v3 (Sepolia)             │
                              │   SwapRouter02 · QuoterV2 · WETH/USDC pool  │
                              └────────────────────────────────────────────┘

  ┌──────────────────────────────────────────────────────────────────────────┐
  │                     0G Labs Decentralized Storage                        │
  │  Every agent persists state snapshots + event logs to 0G testnet         │
  │  Creates an immutable, auditable history of all trading decisions        │
  └──────────────────────────────────────────────────────────────────────────┘

  ┌──────────────────────────────────────────────────────────────────────────┐
  │                          ENS Identity Layer                              │
  │  scout.0xgoldengoose.eth · risk.0xgoldengoose.eth · executor.0xgoldengoose.eth       │
  │  Agents are identified by human-readable ENS names, not raw addresses   │
  └──────────────────────────────────────────────────────────────────────────┘
```

---

## Prize Tracks

| Sponsor | Prize | How 0x Golden Goose qualifies |
|---|---|---|
| **0G Labs** | Best Agent Framework ($7,500) | Multi-agent framework built on 0G — state, coordination, swarm architecture |
| **0G Labs** | Best Autonomous Agents/Swarms ($7,500) | Three autonomous agents in a swarm — PriceScout → RiskManager → Executor |
| **Uniswap Foundation** | Best Uniswap API Integration ($5,000) | Live Uniswap v3 QuoterV2 + SwapRouter02 integration for quotes and execution |
| **ENS** | Best ENS Integration for AI Agents ($2,500) | Each agent has an ENS identity; tokens and protocols resolved by ENS name |
| **ENS** | Most Creative Use of ENS ($2,500) | AI agents as ENS-identified autonomous actors — a new paradigm for onchain AI |
| **KeeperHub** | Best Use of KeeperHub ($4,500) | KeeperHub schedules PriceScout + triggers on price condition deviation |
| **Gensyn** | Best Application of AXL ($5,000) | All three agents communicate exclusively over Gensyn AXL P2P messaging |

---

## Quick Start

### 1. Install

```bash
git clone https://github.com/yourname/0x-golden-goose
cd 0x-golden-goose
npm install
cp .env.example .env
```

### 2. Configure

Edit `.env`:

```bash
# At minimum, set your RPC URL (no wallet needed for simulate mode)
MAINNET_RPC_URL=https://eth.llamarpc.com

# Optional: set for live trading on Sepolia
PRIVATE_KEY=0x...
KEEPERHUB_API_KEY=kh_...
```

### 3. Run

```bash
npm run dev
```

The live dashboard boots immediately and shows all three agents. In simulate mode, no real transactions are sent.

### 4. Set up KeeperHub automation (optional)

```bash
# Expose your callback URL publicly first
npx ngrok http 3001

# Then register the keeper jobs
CALLBACK_URL=https://your-ngrok-url.ngrok.io/api/trigger npm run setup-keeper
```

---

## Agent Roles

**PriceScout** (`scout.0xgoldengoose.eth`)
Fetches live WETH/USDC prices from Uniswap v3 on Ethereum mainnet using the QuoterV2 contract. Computes a 5-tick rolling average and emits `BUY` signals when the price drops more than `BUY_THRESHOLD_PCT` below the average, and `SELL` signals when it rises above `SELL_THRESHOLD_PCT`. All signals are forwarded to the RiskManager via Gensyn AXL and logged to 0G storage.

**RiskManager** (`risk.0xgoldengoose.eth`)
Receives signals from PriceScout and applies three risk rules before approving:
- **Confidence gate**: rejects signals with confidence < 40%
- **Circuit breaker**: rejects moves > 10% (possible flash crash)
- **Cooldown**: enforces 60s between approved trades

Approved decisions include an adjusted trade size scaled by confidence and a computed risk score (0–10).

**Executor** (`executor.0xgoldengoose.eth`)
Receives approved decisions from RiskManager and either simulates (no key) or executes a real Uniswap v3 swap on Sepolia testnet. Handles ERC20 approval, swap submission, and confirmation. Results are broadcast back and stored on 0G.

---

## How Gensyn AXL Works

AXL is a P2P encrypted node that gives each agent its own network identity. Agents send messages to each other using their peer IDs via:

- `POST /send` with `X-Destination-Peer-Id` header — fire-and-forget
- `GET /recv` — poll for inbound messages
- Messages are encrypted end-to-end using Yggdrasil

0x Golden Goose includes a graceful fallback: when AXL isn't running locally, agents communicate via a local EventEmitter (no functionality lost for demos).

**To run AXL locally:**
```bash
git clone https://github.com/gensyn-ai/axl
cd axl && make build
openssl genpkey -algorithm ed25519 -out private.pem
./node -config node-config.json
```

---

## How 0G Storage Works

Each agent writes JSON state snapshots and event logs to the 0G decentralized storage network via the `@0glabs/0g-ts-sdk`. Files are content-addressed by their merkle root hash, creating an immutable audit trail.

- PriceScout stores: price ticks, emitted signals
- RiskManager stores: decision history with reasons and risk scores
- Executor stores: trade results with tx hashes and gas costs

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PRIVATE_KEY` | — | Executor wallet key (Sepolia only) |
| `MAINNET_RPC_URL` | llamarpc | For price quotes |
| `SEPOLIA_RPC_URL` | ankr | For trade execution |
| `OG_INDEXER_URL` | 0G testnet | 0G storage indexer |
| `AXL_API_URL` | localhost:9002 | Gensyn AXL node |
| `KEEPERHUB_API_KEY` | — | KeeperHub automation |
| `TOKEN_IN` | WETH | Input token symbol |
| `TOKEN_OUT` | USDC | Output token symbol |
| `BUY_THRESHOLD_PCT` | 1.5 | % drop to trigger BUY |
| `SELL_THRESHOLD_PCT` | 1.5 | % rise to trigger SELL |
| `MAX_SLIPPAGE_PCT` | 0.5 | Max swap slippage |
| `SCOUT_POLL_MS` | 15000 | Price poll interval |

---

## Tech Stack

- **TypeScript** — full type safety across all agents
- **viem** — Ethereum/ENS interaction
- **@0glabs/0g-ts-sdk** — decentralized agent state storage
- **Gensyn AXL** — P2P encrypted inter-agent messaging
- **KeeperHub** — automation and scheduling layer
- **Uniswap v3** — QuoterV2 (prices) + SwapRouter02 (execution)
- **ENS** — agent identity and address resolution

---

Built for [ETHGlobal OpenAgents](https://ethglobal.com/events/openagents) — May 2026