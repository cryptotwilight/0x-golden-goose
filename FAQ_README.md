# FAQ / Tips & Tricks (0x Golden Goose) — [GPT-5.2]

This FAQ collects the most common “it’s not working” issues when running the core service, Web UI, Firebase-hosted UI, ngrok, AXL, KeeperHub, and 0G persistence.

---

## [GPT-5.2] The UI says OFFLINE / blank page

**What it means**

- The Web UI is loading, but it can’t fetch JSON from `GET <API_BASE>/api/stats`.

**Quick checks**

- Open `http://127.0.0.1:3001/api/stats` locally (should return JSON).
- If using ngrok, open `https://xxxx.ngrok-free.app/api/stats` (should return JSON).

**Common causes**

- **Core service not running**: start it with `npm run dev` (repo root).
- **Wrong API base URL**: in the UI, paste only the origin (e.g. `https://xxxx.ngrok-free.app`), not `/api/stats`.
- **Typo**: `stats` is spelled `/api/stats` (not `ststs`, etc.).
- **Port mismatch**: the core HTTP API is on **3001**.

---

## [GPT-5.2] ngrok shows an interstitial / warning page

The UI sends the `ngrok-skip-browser-warning: true` header on requests. If you still see HTML:

- Open `https://xxxx.ngrok-free.app/api/stats` once in a browser and click through.
- Ensure you used **`ngrok http 3001`** (not 5173).

---

## [GPT-5.2] Why does the dashboard show “● local-bus” even though KeeperHub works?

“● local-bus” is **AXL status**, not KeeperHub status.

- If the AXL node at `AXL_API_URL` (default `http://127.0.0.1:9002`) isn’t reachable, agents fall back to a local in-process message bus.
- KeeperHub can still trigger `/api/trigger` over HTTP even when AXL is down.

To switch to “● AXL”, run an AXL node and set:

```bash
AXL_API_URL=http://127.0.0.1:9002
```

---

## [GPT-5.2] I can’t reach `http://127.0.0.1:3001/api/stats`

Possible reasons:

- The core process isn’t listening on 3001 (it should log a “listening” line).
- A firewall is blocking local connections (rare for loopback).

Try:

```powershell
Invoke-WebRequest -Uri "http://127.0.0.1:3001/api/stats" -UseBasicParsing -TimeoutSec 5
```

---

## [GPT-5.2] MetaMask / wallet errors like “Cannot redefine property: ethereum”

This is almost always a **browser extension conflict** (e.g. TronLink + MetaMask/Rabby both injecting `window.ethereum`).

Fix:

- Disable conflicting wallet extensions, or
- Use a clean Chrome profile with only one Ethereum provider enabled.

---

## [GPT-5.2] 0G persistence isn’t writing anything

Expected behavior:

- If `PRIVATE_KEY` is **not** set, 0G uploads are disabled (simulate-friendly).
- If `@0glabs/0g-ts-sdk` isn’t installed or init fails, the agents continue without persistence.

To enable uploads:

- Set `PRIVATE_KEY` and ensure dependencies are installed.

---

## [GPT-5.2] KeeperHub triggers don’t fire

Checklist:

- Your callback URL must be publicly reachable (use ngrok on port 3001).
- The callback must be the full endpoint: `https://xxxx.ngrok-free.app/api/trigger`
- Your core service must be running while workflows fire.

Manual verification:

- `POST` to `/api/trigger` yourself and confirm the core logs show a keeper trigger / tick.

---

## [GPT-5.2] Tips for demos

- Start the core service first, then UI.
- Keep one tab open at `.../api/stats` so you immediately see whether the API is reachable.
- If using hosted UI (`https://x-golden-goose.web.app/`), paste your ngrok base URL into the header field right away.

