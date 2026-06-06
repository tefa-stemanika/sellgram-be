# Progress

## Goal

Delivered: v1 → v2 migration (Redis-backed state, webhook-only, rate limiter, graceful shutdown, duplicate webhook prevention).

All 11 phases complete. Only ARCHITECTURE.md rename (phase 11) is a trivial leftover.

## What's Running

- Redis-backed `order:{userId}:{telegramId}` (TTL 3600s) and `session:{userId}:{telegramId}` (TTL 1800s) via `src/services/redis.js`
- ConfigService: `tenant_config:{userId}` cache (TTL 600s) + in-memory Map for sync getters
- Webhook-only processing with queue+lock serde: `webhook_queue:{userId}:{telegramId}` / `webhook_lock:{userId}:{telegramId}` (TTL 30s)
- Welcome dedup: `welcome_sent:{userId}:{chatId}` (TTL 24h)
- Rate limiter: `ratelimit:{ip}` sliding window (30 req/min)
- Health check at `GET /health` (Redis + DB ping)
- Graceful shutdown: SIGTERM/SIGINT → close server → stop bots → redisQuit → prisma.$disconnect
- WEBHOOK_SECRET global validation via `x-telegram-bot-api-secret-token` header
- Idempotency in Midtrans webhook: skip if `order.status === 'COMPLETED'`
- Docker Compose: postgres:16-alpine + redis:7-alpine (AOF) + app

## Trivial Leftover

- `Phase 11`: rename `ARCHITECTURE_V2.md` → `ARCHITECTURE.md` (overwrite v1), update `AGENTS.md` to reflect current stack

## Next Improvements (candidate)

1. **ConfigService pure Redis** — remove in-memory `userConfigCache` Map, make getters async to eliminate sync/async dual cache. Breaks handler API but simplifies architecture.
2. **Order cleanup job** — periodic `setInterval` (or cron) that scans redis keys `order:*` with TTL near expiry and sends expiry warnings to users.
3. **Rate limiter per-user** — use `userId` (from JWT) or `telegramId` instead of IP for more accurate throttling on dashboard routes.
4. **Midtrans payment retry** — provide `/bayar` command that regenerates Snap transaction URL if previous one expired (order state PENDING).
5. **Caching dashboard queries** — Redis cache for product lists, order lists, bot stats to reduce DB load on dashboard API routes.
6. **ARCHITECTURE.md rename** — quick Phase 11 cleanup.
