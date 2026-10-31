# Telegram AI Bot — Agent Guide

## Stack

Node.js 18+ ESM (`"type": "module"`), Express 5, Prisma + PostgreSQL, `node-telegram-bot-api` (webhook-only, `polling: false`), native `fetch` for Gemini AI & Midtrans (no SDK). No linter/formatter.

## Startup

- `src/index.js` — init Redis → init tenant map (Redis) → spawn bot instances → sync WhatsApp webhooks (Evolution API) → start Express on `PORT` (default 3000/5505 docker). Graceful shutdown: close server → stop bots → redisQuit → prisma.$disconnect.
- `src/app.js` — `GET /health` (pings Redis + DB) mounted first, then webhook routes, then API routes.

## Environment

`DATABASE_URL`, `ENCRYPTION_KEY` (64 hex chars), `JWT_SECRET`, `REDIS_URL`, `PORT` required. Credentials encrypted (AES-256-GCM) in `bot_credentials`; `ENCRYPTION_KEY` must never change after encrypting. Run `npm run db:seed-config` to migrate `.env` credentials → DB, then strip credential env vars.

WhatsApp (Evolution API): `EVOLUTION_API_URL` and `EVOLUTION_API_KEY` can be stored per tenant in `bot_credentials` (keys same name) with env fallback. The instance name is **always derived by the backend** from `userId` (`tenant-<userId without punctuation>`) and is never read from env or client input. Each tenant owns **at most one** instance created via `POST /instance/create`; create/connect/restart idempotently ensure the tenant webhook (`${PUBLIC_BASE_URL}/api/webhook/whatsapp/:userId`, `MESSAGES_UPSERT`), QR/pairing comes from `GET /instance/connect/{instance}`, state from `GET /instance/connectionState/{instance}`, and `POST /instance/restart/{instance}` (PUT fallback) recovers a broken instance. Optional `EVOLUTION_WEBHOOK_SECRET`; when unset, the webhook secret is derived from `ENCRYPTION_KEY`. Webhook requests must carry `x-evolution-webhook-secret`.

## Key Commands

| Command | Purpose |
|---|---|
| `npm run dev` | `node --watch src/index.js` |
| `npm start` | `node src/index.js` |
| `npm run build` / `postinstall` | `prisma generate` |
| `npm run db:push` | Push Prisma schema (no migration history — dev) |
| `npm run db:migrate` | `prisma migrate dev` |
| `npm run db:seed` | Seed default products |
| `npm run db:seed-config` | Migrate .env → encrypted DB |
| `npm run db:studio` | Prisma Studio on port 5555 |
| `npm run test:integration` | Multi-user isolation + order flow |
| `npm run test:webhook` | Payment webhook tests |
| `npm run test:load` | Concurrent order/payment load tests |
| `npm run test:whatsapp` | WhatsApp parser/helper unit tests (offline) |
| `npm run test:whatsapp:lifecycle` | Instance create/connect/restart against a mock Evolution server |
| `npm run test:phase5` | All three suites sequentially |

## Architecture

Multi-tenant: each `User` has isolated bot config, credentials, products, orders. Bot instances spawned per active user by `botManager.js`. **Tenant is resolved from the URL** (`/api/webhook/telegram/:userId`), not from Telegram bot token. `tenantResolver.js` uses `tenant_map:{sha256-token-hash}` keys in Redis (TTL 600s) for auxiliary reverse lookups only.

Redis key patterns:
- `order:{userId}:{telegramId}` — active order (TTL 3600s)
- `session:{userId}:{telegramId}` — conversation state (TTL 1800s)
- `webhook_queue:{userId}:{telegramId}` / `webhook_lock:{userId}:{telegramId}` — queue+lock serde (TTL 30s)
- `welcome_sent:{userId}:{chatId}` — dedup (TTL 24h)
- `ratelimit:{ip}` — sliding window (30 req/min)
- `tenant_map:{hash}` — token→userId lookup (TTL 600s)
- `tenant_config:{userId}` — config cache (TTL 600s)
- `whatsapp_msg:{userId}:{messageId}` — Evolution webhook dedup (TTL 600s)
- `whatsapp_queue:{userId}:{chatId}` / `whatsapp_lock:{userId}:{chatId}` — WhatsApp per-chat message queue+lock (lock TTL 60s)
- `whatsapp_lid:{userId}:{lid}` — LID→phone JID mapping cache (TTL 30d; miss marker 5m)

Webhook-only — bot instances use `polling: false`. Webhook is set on Telegram API via botManager at spawn time. WhatsApp uses Evolution API webhook (`messages.upsert` only) configured at startup or via credential update; messages are serialized per chat through the Redis queue. Incoming `@lid` JIDs are mapped to the phone JID via `key.remoteJidAlt` / `senderPn` / `participantAlt` (Evolution >= 2.3.x), with a cached contact-profile fallback for Evolution 2.2.x; replies always target the phone JID when a mapping exists.

## Testing

No framework — plain ESM scripts in `tests/`. Creates real DB records via `test-helpers.js`, cleans up via `TestContext.cleanup()`. Requires PostgreSQL with schema pushed.

Test patterns:
- `telegramId` is Prisma `BigInt` — always convert with `Number()` for JSON/Telegram API
- Order webhook flow: `findFirst({ where: { orderId } })` → update by primary `id`
- `midtransOrderId` = same value as `orderId` (unique per user)
- Delete cascade: `orderItem` → `order` → `product` → `user`

## Docker

`docker compose up -d` — postgres:16-alpine (port 5284) + redis:7-alpine (AOF) + app (port 5505). App command: `npm run db:push && npm start`. Uses `.env.docker`.

## API

Express routes under `/api`. `webhookRouter` mounted before `apiRouter` to skip JWT auth on webhooks. Dashboard endpoints use `auth.middleware.js` (JWT), tenant isolation via `req.user.id`.

WhatsApp endpoints:
- `POST /api/webhook/whatsapp/:userId` — Evolution webhook (header `x-evolution-webhook-secret`).
- `GET /api/bots/whatsapp/status` — connection state + webhook config.
- `POST /api/bots/whatsapp/instance` — create/ensure tenant Evolution instance (idempotent).
- `GET /api/bots/whatsapp/connect` — QR/pairing code for scan-to-connect.
- `POST /api/bots/whatsapp/restart` — restart instance + re-set webhook; `/reconnect` is an alias.

Order source `WHATSAPP` stores the destination JID in `Order.whatsappId`; payment/fulfillment notifications are routed through Evolution `sendText`.
