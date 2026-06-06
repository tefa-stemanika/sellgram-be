# Telegram AI Bot — Agent Guide

## Stack

Node.js 18+ ESM (`"type": "module"`), Express 5, Prisma + PostgreSQL, `node-telegram-bot-api`, native `fetch` for Gemini AI & Midtrans (no SDK). No linter/formatter configured.

## Entrypoint & Startup

- `src/index.js` — boots the system: init Redis client → init tenant map → spawn bot instances per active user → init admin bots → start Express API on `PORT` (default 3000, dev uses 5505). Graceful shutdown on SIGTERM/SIGINT: drain requests → close server → stop bots → quit Redis → disconnect Prisma.
- `src/app.js` — creates Express app; `GET /health` endpoint (pings Redis + DB, returns 200/503) mounted **before** webhook routes; webhook routes mounted before API routes.

## Environment

`.env` must always contain `DATABASE_URL`, `ENCRYPTION_KEY` (64 hex chars, 32 bytes), `JWT_SECRET`, `REDIS_URL`, `PORT`. Credentials (bot tokens, API keys) are encrypted (AES-256-GCM) and stored in `bot_credentials` table — run `npm run db:seed-config` to migrate them from `.env`. After seed, credential env vars can be removed.

`ENCRYPTION_KEY` must never change after credentials are stored.

## Key Commands

| Command | Purpose |
|---|---|
| `npm run dev` | `node --watch src/index.js` |
| `npm start` | `node src/index.js` |
| `npm run build` / `postinstall` | `prisma generate` |
| `npm run db:push` | Push Prisma schema to DB (no migration history — dev use) |
| `npm run db:migrate` | `prisma migrate dev` |
| `npm run db:seed` | Seed default products |
| `npm run db:seed-config` | Migrate .env credentials → encrypted DB |
| `npm run db:studio` | Prisma Studio on port 5555 |
| `npm run test:integration` | Multi-user isolation + order flow tests |
| `npm run test:webhook` | Payment webhook notification tests |
| `npm run test:load` | Concurrent order/payment load tests |
| `npm run test:phase5` | Runs all three test suites sequentially |

## Architecture

Multi-tenant SaaS: each `User` (tenant) has isolated bot config, credentials, products, orders. Bot instances are spawned per active user by `botManager.js`. `tenantResolver.js` maintains an in-memory map of `botToken → userId` built at startup.

Two bot runtime modes: **polling** (local dev, `bot_mode='polling'`) and **webhook** (production, uses `PUBLIC_BASE_URL`). Webhook mode calls `setWebhook` on Telegram API with retries + background reconciliation.

## Testing

No test framework — plain ESM scripts. Tests create real DB records via `test-helpers.js` and clean up via `TestContext.cleanup()`. Requires running PostgreSQL with schema pushed.

Important patterns from tests:
- `telegramId` is Prisma `BigInt` — convert with `Number()` or `String()` for JSON/Telegram API
- Order updates in webhook flow: `findFirst({ where: { orderId } })` → update by `id` (primary key, not composite key)
- `midtransOrderId` uses same value as `orderId` (already unique per user) to avoid concurrent constraint violations
- Delete order: `orderItem` → `order` → `product` → `user` (cascade order)

## Database

PostgreSQL via Prisma. Schema in `prisma/schema.prisma`. Composite unique constraints on `[userId, orderId]` and `[userId, key]` for credentials.

## Docker

`docker compose up -d` starts postgres:16-alpine on port 5284 + redis:7-alpine + app container. App command: `npm run db:push && npm start`. Uses `.env.docker` for env vars.

## API

Express routes under `/api`. Two notable patterns:
- `webhookRouter` mounted before `apiRouter` in `app.js` to avoid auth middleware on webhook endpoints
- JWT auth on dashboard endpoints via `auth.middleware.js`, tenant isolation via `req.user.id` in all queries
