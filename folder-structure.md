
```
telegram-ai-bot
├─ .dockerignore
├─ 1README.md
├─ ARCHITECTURE.md
├─ DEPLOYMENT_CHECKLIST.md
├─ DockerFile
├─ FIX_SUMMARY.md
├─ M6_CHECKLIST.md
├─ M6_IMPLEMENTATION_GUIDE.md
├─ M6_IMPLEMENTATION_SUMMARY.md
├─ M6_NEXT_STEPS.md
├─ M6_PHASE3_WEBHOOK_ADMIN.md
├─ M6_PHASE4_STATE_MANAGEMENT.md
├─ PHASE5_INTEGRATION_TESTING.md
├─ PHASE5_SUMMARY.md
├─ PLAN.md
├─ README.md
├─ Telegram Order Bot API.postman_collection.json
├─ WEBHOOK_ERROR_FIX.md
├─ docker-compose.yml
├─ package.json
├─ prisma
│  ├─ DATABASE.md
│  ├─ schema.prisma
│  ├─ seed-config.js
│  ├─ seed-migration-m6.js
│  └─ seed.js
├─ src
│  ├─ api
│  │  ├─ controllers
│  │  │  ├─ auth.controller.js
│  │  │  ├─ botConfig.controller.js
│  │  │  ├─ botCredential.controller.js
│  │  │  ├─ botStatus.controller.js
│  │  │  ├─ health.controller.js
│  │  │  ├─ orders.controller.js
│  │  │  ├─ products.controller.js
│  │  │  └─ webhook.controller.js
│  │  ├─ middlewares
│  │  │  ├─ auth.middleware.js
│  │  │  ├─ error.middleware.js
│  │  │  ├─ notFound.middleware.js
│  │  │  └─ requestLogger.middleware.js
│  │  ├─ routes
│  │  │  ├─ auth.routes.js
│  │  │  ├─ botConfig.routes.js
│  │  │  ├─ botCredential.routes.js
│  │  │  ├─ bots.routes.js
│  │  │  ├─ health.routes.js
│  │  │  ├─ index.js
│  │  │  ├─ orders.routes.js
│  │  │  ├─ products.routes.js
│  │  │  └─ webhook.routes.js
│  │  └─ utils
│  │     └─ response.js
│  ├─ app.js
│  ├─ data
│  │  └─ products.js
│  ├─ handlers
│  │  ├─ HANDLERS.md
│  │  ├─ buttonHandler.js
│  │  ├─ index.js
│  │  ├─ messageHandler.js
│  │  └─ orderHandler.js
│  ├─ index.js
│  ├─ runtime
│  │  └─ botRuntime.js
│  ├─ services
│  │  ├─ SERVICES.md
│  │  ├─ adminBot.js
│  │  ├─ botManager.js
│  │  ├─ configService.js
│  │  ├─ db.js
│  │  ├─ gemini.js
│  │  ├─ midtrans.js
│  │  ├─ order.js
│  │  ├─ orderService.js
│  │  ├─ productService.js
│  │  ├─ session.js
│  │  ├─ tenantResolver.js
│  │  └─ userService.js
│  └─ utils
│     ├─ encryption.js
│     ├─ jwt.js
│     └─ password.js
├─ tests
│  ├─ integration-tests.js
│  ├─ load-tests.js
│  ├─ test-helpers.js
│  ├─ test-phase4.js
│  └─ webhook-tests.js
├─ troubleshoot-telegram.js
├─ validate-phase2.js
└─ validate-phase3.js

```