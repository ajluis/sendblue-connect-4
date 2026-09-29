# Sendblue Connect 4

A low-latency webhook bot that plays GamePigeon Four in a Row over iMessage
using [Sendblue App Cards](https://docs.sendblue.com/api-v2/app-cards/).

The Connect Four engine is local and deterministic. No LLM or model API is
used for moves, so response time is limited to webhook, compute, and iMessage
delivery latency.

> This is an independent interoperability demo. It is not affiliated with
> GamePigeon, Apple, or Sendblue.

## What it does

- Starts a new Connect Four App Card when a direct message reaches the
  configured Sendblue testing line.
- Opens as red with a center-column move already played.
- Validates inbound GamePigeon identity, session, game, and board state.
- Chooses a red response locally with iterative-deepening minimax.
- Continues the same Sendblue App Card session with idempotent updates.
- Ignores other Sendblue lines, group conversations, opted-out contacts, and
  unsupported App Cards.
- Persists active sessions to disk so games survive restarts.

## Requirements

- Node.js 22 or newer
- A Sendblue account with API credentials
- A compatible Sendblue V2 line with App Cards enabled
- An iMessage-capable recipient with GamePigeon installed
- A public HTTPS URL for the receive webhook

App Cards do not fall back to SMS. See the
[Sendblue App Cards documentation](https://docs.sendblue.com/api-v2/app-cards/)
for current account and line requirements.

## Local setup

```bash
npm install
cp .env.example .env
```

Fill in `.env`:

| Variable | Purpose |
| --- | --- |
| `SENDBLUE_API_KEY` | Sendblue API key ID |
| `SENDBLUE_API_SECRET` | Sendblue API secret |
| `SENDBLUE_FROM_NUMBER` | Dedicated testing line in E.164 format |
| `WEBHOOK_TOKEN` | Long random value embedded in the receive URL |
| `ADMIN_TOKEN` | Separate bearer token for private API routes |
| `DATA_DIR` | Writable directory for `sessions.json` |
| `MOVE_TIME_LIMIT_MS` | Maximum search time per bot move |
| `MOVE_MAX_DEPTH` | Maximum minimax search depth |
| `BOOTSTRAP_SESSIONS_JSON` | Optional JSON array of sessions to restore |

Generate independent tokens, for example:

```bash
openssl rand -hex 32
openssl rand -hex 32
```

Run the checks and start locally with Node's environment-file loader:

```bash
npm test
npm run dev
```

The service listens on `PORT` (default `3000`).

## Configure the Sendblue webhook

Create a `receive` webhook that points to:

```text
https://YOUR_PUBLIC_HOST/webhooks/sendblue/YOUR_WEBHOOK_TOKEN
```

Example:

```bash
curl -X POST https://api.sendblue.com/api/account/webhooks \
  -H "sb-api-key-id: $SENDBLUE_API_KEY" \
  -H "sb-api-secret-key: $SENDBLUE_API_SECRET" \
  -H "content-type: application/json" \
  -d "{\"type\":\"receive\",\"webhooks\":[\"https://YOUR_PUBLIC_HOST/webhooks/sendblue/$WEBHOOK_TOKEN\"]}"
```

Keep `WEBHOOK_TOKEN` secret. Anyone who knows the complete URL can submit
events to the endpoint.

## Start a game explicitly

Ordinary direct inbound messages to `SENDBLUE_FROM_NUMBER` automatically start
a game. You can also start one through the private endpoint:

```bash
curl -X POST https://YOUR_PUBLIC_HOST/api/games/connect4/start \
  -H "authorization: Bearer $ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{"number":"+12025550101"}'
```

## API

- `GET /healthz` — health and stored-session count
- `POST /webhooks/sendblue/:WEBHOOK_TOKEN` — receive webhook; acknowledges
  immediately and processes asynchronously
- `POST /api/games/connect4/start` — starts a game; requires `ADMIN_TOKEN`
- `GET /api/status` — lists public session metadata; requires `ADMIN_TOKEN`

## Deploy

Deploy the app to any Node.js 22 host with a public HTTPS URL. Configure every
variable from `.env.example`, mount a persistent writable directory, and point
`DATA_DIR` at that mount before sending traffic. The production process starts
with `npm start` and listens on the platform-provided `PORT`.

## Important App Card limitation

Sendblue continuations preserve the App Card session, but each continuation is
a new iMessage rather than an in-place edit. A recipient who leaves GamePigeon
open may need to close it and tap the newest card after each remote move. This
behavior is documented in
[How App Card sessions work](https://docs.sendblue.com/api-v2/app-cards/#how-app-card-sessions-work)
and cannot be changed by this server.

## Security notes

- Never commit Sendblue credentials, `.env`, webhook tokens, admin tokens, or
  persisted `data/*.json` files.
- Use a dedicated testing line. Every ordinary direct inbound message to the
  configured line starts a new game.
- Rotate any credential that has ever appeared in source control or logs.
- Validate and rate-limit public traffic at the hosting edge when exposing this
  beyond a controlled demo.

## Attribution and license

Original project code is available under the MIT License. The GamePigeon URL
codec contains Apache-2.0-licensed work adapted from `@imsg-sdk/sdk`; see
[`NOTICE.md`](NOTICE.md) for attribution.
