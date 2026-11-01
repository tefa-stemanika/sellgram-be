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
- `webhook_queue:{userId}:{telegramId}` / `webhook_lock:{userId}:{telegramId}` — antrean + lock update Telegram (queue TTL 300s, lock TTL 30s dengan token fencing; `redisReleaseLock`/`redisRefreshLock` tidak pernah menyentuh lock milik drainer lain)
- `welcome_sent:{userId}:{chatId}` — dedup (TTL 24h)
- `telegram_update:{userId}:{update_id}` — dedup redeliveri Telegram (TTL 3600s), dipasang sebelum update masuk queue; kunci dilepas kalau push ke queue gagal, dan redeliveri tetap menguras antrean (update sebelumnya bisa saja tertahan karena bot belum siap)
- `ratelimit:{ip}` — sliding window (30 req/min)
- `tenant_map:{hash}` — token→userId lookup (TTL 600s)
- `tenant_config:{userId}` — config cache (TTL 600s)
- `whatsapp_msg:{userId}:{messageId}` — Evolution webhook dedup (TTL 600s)
- `whatsapp_queue:{userId}:{chatId}` / `whatsapp_lock:{userId}:{chatId}` — WhatsApp per-chat message queue (TTL 300s) + lock (TTL 60s, released by Lua compare-and-delete with a fencing token)
- `whatsapp_lid:{userId}:{lid}` — LID→phone JID mapping cache (TTL 30d; miss marker 5m)

Webhook-only — bot instances use `polling: false`. Webhook is set on Telegram API via botManager at spawn time. WhatsApp uses Evolution API webhook (`messages.upsert` only) configured at startup or via credential update; messages are serialized per chat through the Redis queue. Incoming `@lid` JIDs are mapped to the phone JID via `key.remoteJidAlt` / `senderPn` / `participantAlt` (Evolution >= 2.3.x), with a cached contact-profile fallback for Evolution 2.2.x; replies always target the phone JID when a mapping exists.

Shared helpers (do not duplicate locally):
- `src/services/whatsappJid.js` — `normalizeWhatsAppJid`, `extractPhoneFromJid`, `normalizePhoneJid`. Single source for JID/device-suffix/`@lid` rules.
- `src/services/paymentSettlement.js` — `settlePayment()`. Satu-satunya jalan untuk mengubah status pembayaran order (webhook Midtrans dan `POST /api/public/orders/:orderId/verify`). Klaim status dengan `updateMany` CAS yang **wajib** `paidAt: null` (penanda "belum pernah dibayar" — status bisa turun lagi ke `PROCESSING` oleh strategi fulfillment manual, jadi status saja tidak cukup), lalu antrekan job dengan `jobId` deterministik. Worker (`workers.js`) menjaga idempotensi efek samping: `deductStock` hanya kalau belum ada `StockLog type: 'SALE'` untuk order itu, `refundStock` hanya kalau **sudah ada** `'SALE'` dan belum ada `'REFUND'` (stok hanya dipotong pada payment-success, jadi order expired yang tidak pernah lunas tidak punya apa pun untuk dikembalikan), dan customer hanya di-upsert kalau `customerId` masih kosong.
- `src/services/safeText.js` — `safePlainText`, `safeEmoji`. Every tenant- or customer-controlled string injected into a chat or admin message goes through these first: Telegram sends `parse_mode: 'Markdown'` and WhatsApp always parses markup, so a stray `* _ ~ ` [ ]` in a product name breaks the whole message.

WhatsApp command parsing is **slash-only** for order actions (`/konfirmasi`, `/confirm`, `/reset`); `start`/`mulai`, `menu`, `help`/`bantuan`, `pesan`/`order`, `batal`/`cancel`, and `status` work with or without a slash. Bare `konfirmasi`/`reset`/`bayar` are NOT commands — unmatched text is first offered to session-state input (product/quantity selection), then to the AI seller (or the product menu when AI is off). `confirmOrder` re-fetches the product for current price/availability and marks the order `PAYMENT_FAILED` if transaction creation fails after the order row was saved.

Error codes from the WhatsApp lifecycle endpoints are stable strings: `not_configured`, `public_base_url_missing`, `webhook_secret_missing`, `invalid_number`, `server_unreachable`, `instance_missing`, `instance_limit_reached`, `create_failed`, `restart_failed`, `webhook_failed`. `success: true` from restart requires both the restart and the webhook re-set; transient upstream failures map to HTTP 503, others 502.

Broadcast channels: only `TELEGRAM` is implemented. `broadcastService.assertSupportedChannel` rejects `WHATSAPP`/`EMAIL` with HTTP 400 + `code: 'channel_not_supported'`; the error middleware forwards `code` whenever an error carries `statusCode`.

Bot health (`botHealthService.js`) checks WhatsApp for every tenant that has Evolution credentials — `getWhatsAppConfiguredUserIds()` — not only tenants with a live Telegram bot, emitting `WHATSAPP_NOT_CONNECTED` / `WHATSAPP_CHECK_FAILED` (warning) and `WHATSAPP_WEBHOOK_NOT_SYNCED` (critical).

## Testing

No framework — plain ESM scripts in `tests/`. Creates real DB records via `test-helpers.js`, cleans up via `TestContext.cleanup()`. Requires PostgreSQL with schema pushed.

Test patterns:
- `telegramId` is Prisma `BigInt` — always convert with `Number()` for JSON/Telegram API
- Order webhook flow: `findMany({ where: { orderId } })` → verifikasi signature per kandidat (kolisi lintas tenant mungkin karena `orderId` cuma unik dalam tenant), order terpilih yang `totalPrice`-nya sama dengan `parseGrossAmount(gross_amount)` → klaim status dengan `updateMany` CAS lewat `paymentSettlement.js` `settlePayment()` (status ditulis **sebelum** job diantre karena `fulfillmentWorker` membuang job order non-`COMPLETED`; kalau antrean gagal klaim dilepas lagi dan respons 500 agar Midtrans retry). `jobId` deterministik `payment-success-<rowId>` / `payment-failed-<rowId>` — BullMQ menolak `:`. `COMPLETED` tidak bisa diturunkan jadi `PAYMENT_FAILED`. `POST /api/public/orders/:orderId/verify` memakai helper yang sama
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

Buyer identity must be **source-aware** (`adminBot.buildBuyerIdentity` / `buildBuyerLabel`): Telegram orders show `Telegram ID`, WhatsApp orders show `Sumber: WhatsApp` + `No. HP` resolved from `customerPhone` then `extractPhoneFromJid(whatsappId)`. Never print a `null` Telegram ID for a WhatsApp order. `customerService.upsertCustomerFromOrder` and `ticketService.resolveCustomerContact` use the same JID→phone fallback, and a raw `@lid` must never be stored in `Ticket.customerContact`. Dashboard `ordersBySource` / `revenueBySource` include `TELEGRAM`, `WHATSAPP`, `WEBSITE`.
