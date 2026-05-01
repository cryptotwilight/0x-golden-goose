# Sponsor Feedback — 0x Golden Goose / ETHGlobal OpenAgents

Honest developer experience feedback from building a multi-agent DEX trading swarm in under 24 hours. Blunt where it needs to be — meant constructively.

---

## Gensyn AXL

**TL;DR:** The concept is solid but the onboarding friction is too high for a hackathon.

**What worked:**
- The HTTP API design is genuinely good. `/send`, `/recv`, `/topology` — simple, language-agnostic, no native SDK required. Any stack can integrate in minutes once the node is running.
- No port forwarding, no root required. That's a real win.
- The fallback-to-EventEmitter pattern (what we had to build ourselves) validated that the API surface is the right abstraction.

**What didn't:**
- **You have to build from source.** There are no pre-built binaries anywhere. For a hackathon where participants are on Windows, Mac, and Linux with varying Go setups, this is a significant barrier. Go 1.25.5 is the pinned requirement — most machines don't have that out of the box.
- **Peer ID exchange is entirely manual.** In a multi-agent setup, each agent needs to know the peer IDs of the others. There's no discovery, no registry, no handshake. We had to wire this up ourselves with a local exchange on startup. A `/peers/register` endpoint or a simple peer registry would make a huge difference.
- **The node just crashes silently** if the key file is missing or malformed. Better error messages would save a lot of time.
- **No local dev mode.** There's no lightweight stub or mock server for testing without running the full binary. We ended up building our own EventEmitter fallback just to develop without the binary running.

**Ask of the Gensyn team:**
Publish pre-built binaries for the major platforms on every release. Add a `/peers/announce` endpoint so agents can register themselves. A one-line install (`curl | sh`) would make AXL genuinely accessible at hackathons.

---

## 0G Labs Storage

**TL;DR:** The idea of immutable, content-addressed agent state is compelling. The SDK needs polish.

**What worked:**
- Content-addressed storage via merkle root hashes is exactly right for agent audit trails. Every decision, every trade — permanently verifiable. That's a strong story.
- The testnet is live and functional.

**What didn't:**
- **The SDK pins `ethers@6.13.1` as a hard peer dependency.** Any project already using a different version of ethers — which is most DeFi projects — hits an immediate conflict. This should either be a flexible peer dep range or the SDK should bundle its own ethers internally.
- **`HDNodeWallet` vs `Wallet` type mismatch.** `ethers.Wallet.createRandom()` returns an `HDNodeWallet` which isn't directly assignable to `Wallet` in TypeScript. The workaround (`new ethers.Wallet(randomWallet.privateKey, provider)`) is non-obvious and not in the docs.
- **You need a funded testnet wallet just to upload.** For a read-heavy use case like logging agent state, requiring gas on a testnet wallet adds setup friction. A faucet link in the docs would help. We found one eventually but it wasn't obvious.
- **No error when the wallet has no funds** — the upload just hangs until timeout. A clear "insufficient balance" error would save significant debugging time.

**Ask of the 0G Labs team:**
Fix the ethers peer dep. Fix the TypeScript types. Add a faucet link to the quickstart. And please surface balance errors immediately rather than timing out silently.

---

## Uniswap v3

**TL;DR:** The protocol is excellent. One documentation gap cost us hours.

**What worked:**
- QuoterV2 + SwapRouter02 is a clean, well-designed interface. Getting a live price quote in a few lines of viem is genuinely impressive.
- The Sepolia deployment is fully functional for testing live swaps.
- Contract addresses are consistent and well-documented.

**What didn't:**
- **QuoterV2 is not a view function, and the docs don't say so clearly.** `simulateContract` — the obvious viem approach — fails silently or throws "Internal error" on public RPCs because QuoterV2 uses `eth_call` with state overrides under the hood. The fix is to use raw `client.call()` + `encodeFunctionData` + `decodeFunctionResult`, which is not documented anywhere in the Uniswap v3 integration guide. We lost several hours to this.
- **Public RPC variability.** Some public mainnet RPCs (llamarpc, cloudflare-eth) return inconsistent results or fail entirely for QuoterV2 calls. This is partly an RPC provider issue but worth a note in the docs.

**Ask of the Uniswap team:**
Add a clear callout in the QuoterV2 docs that it is NOT a view function and that `simulateContract` will fail on public RPCs. Show the `eth_call` pattern explicitly. This single doc fix would save every developer integrating QuoterV2 a significant amount of time.

---

## ENS

**TL;DR:** ENS as an agent identity layer is a genuinely exciting idea. The cost and testnet story holds it back.

**What worked:**
- viem's ENS support is excellent. `getEnsAddress` and `getEnsName` just work, with minimal setup.
- Using human-readable names like `scout.0xgoldengoose.eth` instead of raw addresses makes logs and dashboards dramatically more readable. It also gives agents a persistent, portable identity that isn't tied to a single wallet.
- The concept of AI agents with ENS identities is new and interesting — it deserves to be pushed further.

**What didn't:**
- **Subdomains cost real money.** To give each agent a subdomain (`scout.0xgoldengoose.eth`), you first need to register the parent domain and then set subdomain records. That's registration fees plus gas, which is a real barrier for hackathon projects. We ended up using the names for display and logging only rather than on-chain resolution.
- **No hackathon-friendly testnet path.** There's no straightforward way to register `.eth` names on a testnet for free during a hackathon. The ENS app doesn't fully support Sepolia for new registrations in a frictionless way.

**Ask of the ENS team:**
A free testnet ENS registrar on Sepolia — even with short TTLs — would make ENS integration genuinely testable at hackathons. Alternatively, a sponsored subdomain faucet (e.g. `yourproject.agents.eth`) would unlock the agent identity use case without requiring teams to pay for mainnet registrations.

---

## KeeperHub

**TL;DR:** Clean API, great trigger types, one practical friction point.

**What worked:**
- The REST API is well-designed. Workflow CRUD is intuitive, the response shapes are consistent, and Bearer token auth is trivial to set up.
- The `price_condition` trigger type is exactly what a trading bot needs. Having the infrastructure handle "fire when ETH/USDC moves 2%" is a strong primitive.
- Scheduled cron triggers work as expected.

**What didn't:**
- **The callback URL must be publicly reachable.** For local development this means setting up ngrok or a similar tunnel every time, which adds friction and breaks on machine restarts. During a hackathon where developers are iterating fast, this slows things down noticeably.
- **No dry-run or sandbox mode.** There's no way to verify a workflow registration is correct without having a live, publicly reachable endpoint. A test-trigger that fires against localhost (or a built-in echo endpoint) would make iteration much faster.
- **No feedback when the callback fails.** If the callback URL returns an error or is unreachable, there's no visibility into that in the dashboard or API. Better failure logging would help diagnose integration issues.

**Ask of the KeeperHub team:**
Add a sandbox mode or a local tunnel integration (even a recommended ngrok setup in the docs). Surface callback failure logs in the workflow dashboard. A `/test` endpoint that fires a workflow immediately against a given URL without requiring it to be publicly registered would be very useful during development.

---

*Feedback submitted by the 0x Golden Goose team — ETHGlobal OpenAgents, May 2026.*
