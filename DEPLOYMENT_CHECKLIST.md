# DEPLOYMENT CHECKLIST & PRODUCTION GUIDE

**Status:** ✅ READY FOR DEPLOYMENT  
**Target:** Production  
**Date:** March 24, 2026

---

## 📋 Pre-Deployment Requirements

### Environment Setup

- [ ] Production MySQL/MariaDB database created
- [ ] Database URL configured: `DATABASE_URL`
- [ ] Encryption key generated: `ENCRYPTION_KEY`
- [ ] Telegram bot token (production): `TELEGRAM_BOT_TOKEN`
- [ ] Telegram admin bot token: `TELEGRAM_ADMIN_BOT_TOKEN`
- [ ] Midtrans credentials (production): `MIDTRANS_SERVER_KEY`, `MIDTRANS_CLIENT_KEY`
- [ ] webhook URL configured in Midtrans dashboard
- [ ] Node.js 18+ installed
- [ ] PM2 or similar process manager available

### Code Preparation

- [ ] All Phase 1-4 code merged to main branch
- [ ] Phase 5 test suite created
- [ ] All tests passing locally
- [ ] No console errors on startup
- [ ] Git commit history clean
- [ ] Database migrations up-to-date

### Credentials Security

- [ ] `.env` file NOT committed to git
- [ ] Credentials loaded from environment variables only
- [ ] Encryption key rotated (if new deployment)
- [ ] Database credentials use strong passwords
- [ ] Telegram tokens are production tokens (not sandbox)
- [ ] Midtrans configured for production (not sandbox)

---

## 🧪 Phase 5 Testing (Pre-Deployment)

### All Tests Must Pass

```bash
# Ensure clean test database
npm run db:push

# Run test suites
node tests/integration-tests.js     # ✅ 6 tests
node tests/webhook-tests.js         # ✅ 6 tests
node tests/load-tests.js            # ✅ 4 tests
```

**Target:** All 16 tests PASS ✅

### Manual Testing (Staging Environment)

```bash
# Start bot in staging
killall node
sleep 5
npm run start:m6

# Monitor startup
# Should see: ✅ Multi-tenant bot system ready!
```

**Test Scenarios:**

1. **User Registration Flow**
   - [ ] Create new bot user via admin panel
   - [ ] Bot token loaded correctly
   - [ ] credentials encrypted in database

2. **Order Creation**
   - [ ] `/menu` command shows products
   - [ ] Product selection works
   - [ ] Order generated with unique orderId
   - [ ] Order stored in database

3. **Payment Flow**
   - [ ] Midtrans Snap button appears
   - [ ] Payment notification received
   - [ ] Webhook processes successfully
   - [ ] Order status → COMPLETED
   - [ ] Admin receives notification
   - [ ] User receives payment confirmation

4. **Multi-User Isolation**
   - [ ] Create 2 test users
   - [ ] Each user creates order
   - [ ] User 1's order doesn't appear in User 2's list
   - [ ] Payment for User 1 doesn't affect User 2

5. **Admin Bot Notifications**
   - [ ] Admin chat receives order notifications
   - [ ] Notifications routed to correct admin
   - [ ] No notifications leak to other admins

---

## 🚀 Deployment Procedure

### Step 1: Database Migration

```bash
# Time: ~5 minutes
# Backup existing database FIRST!

# Migrate schema to production database
DATABASE_URL=mysql://prod_user:prod_pass@prod_host/prod_db npm run db:push

# Verify migration successful
npm run db:studio
# Check tables exist: users, products, orders, bot_credentials, bot_config
```

### Step 2: Migration Data (First-Time Only)

```bash
# If migrating from single-tenant to multi-tenant:
npm run db:seed-migration-m6

# This:
# 1. Creates default user (ID=1)
# 2. Migrates credentials from .env
# 3. Migrates existing products/orders to user 1
# 4. Creates bot config for user 1
```

### Step 3: Prepare Production Environment

```bash
# Create production .env file (NOT in git)
cat > .env.production << 'EOF'
NODE_ENV=production
DATABASE_URL=mysql://user:pass@host/dbname
ENCRYPTION_KEY=your-128-char-hex-key
WEBHOOK_PORT=3000
TELEGRAM_BOT_TOKEN=your-production-token
TELEGRAM_ADMIN_BOT_TOKEN=your-admin-token
MIDTRANS_SERVER_KEY=your-server-key
MIDTRANS_CLIENT_KEY=your-client-key
EOF

# Set permissions
chmod 600 .env.production
```

### Step 4: Process Manager Setup (PM2)

```bash
# Install PM2 globally
npm install -g pm2

# Create PM2 ecosystem config
cat > ecosystem.config.js << 'EOF'
module.exports = {
  apps: [
    {
      name: 'telegram-bot',
      script: 'src/index-m6.js',
      instances: 1,
      exec_mode: 'fork',
      error_file: 'logs/bot-error.log',
      out_file: 'logs/bot-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
      },
      // Restart on error
      max_restarts: 10,
      min_uptime: '10s',
      // Graceful shutdown
      kill_timeout: 5000,
      listen_timeout: 3000,
      shutdown_with_message: true,
    },
  ],
}
EOF

# Start bot with PM2
pm2 start ecosystem.config.js

# Save PM2 config for autostart on reboot
pm2 save
pm2 startup
```

### Step 5: Verify Startup

```bash
# Check bot is running
pm2 status

# Monitor logs
pm2 logs telegram-bot --lines 100

# Should see:
# ✅ Tenant map diinisialisasi (X bot active)
# ✅ Multi-tenant bot system ready!
# 🌐 Webhook server berjalan di http://localhost:3000
```

### Step 6: Test Production Webhook

```bash
# Verify webhook is accessible from Midtrans servers
curl http://your-server:3000/health

# Should respond:
# {"status":"ok","timestamp":"2026-03-24T..."}

# Configure Midtrans dashboard:
# Notification URL: https://your-domain.com/webhook/midtrans
# Ensure HTTPS certificate is valid
```

### Step 7: Monitoring Setup

```bash
# Setup log rotation (logrotate)
cat > /etc/logrotate.d/telegram-bot << 'EOF'
/path/to/project/logs/*.log {
  daily
  missingok
  rotate 7
  compress
  delaycompress
  notifempty
  create 0640 node node
}
EOF

# Setup alerts for errors
# Monitor: pm2 logs for ERROR, FAIL, ECONNREFUSED
# Alert when: bot stops, high memory usage, database connection fails
```

---

## 🔍 Post-Deployment Verification

### Immediate Checks (First Hour)

- [ ] Bot is online and responding to commands
- [ ] `/start` command works for test user
- [ ] `/menu` displays products correctly
- [ ] No connection errors in logs
- [ ] Database queries execute successfully
- [ ] Webhook endpoint is accessible

### Payment Flow Test (First Day)

- [ ] Create test order
- [ ] Initiate payment in Midtrans
- [ ] Complete payment successfully
- [ ] Webhook triggered and processed
- [ ] Order marked as COMPLETED
- [ ] Admin notified of payment
- [ ] No Prisma errors in logs

### Multi-User Test (First Week)

- [ ] 2+ bots running simultaneously
- [ ] Each bot processes orders independently
- [ ] No data leakage between users
- [ ] Payments isolated per user
- [ ] Admin notifications go to correct user

### Performance Baseline (First Week)

```bash
# Record baseline metrics
# Command latency: < 1s
# Payment processing: < 2s
# Database query: < 50ms
# Memory usage: < 300MB
# CPU usage: < 20%

# Setup Grafana/Prometheus for continuous monitoring
```

---

## 🛠️ Troubleshooting Production

### Bot Not Starting

```bash
# 1. Check logs
pm2 logs telegram-bot

# 2. Verify environment
echo $DATABASE_URL
echo $ENCRYPTION_KEY
echo $TELEGRAM_BOT_TOKEN

# 3. Test database connection
node -e "import('./src/services/db.js').then(() => console.log('DB OK'))"

# 4. Restart bot
pm2 restart telegram-bot

# 5. Check system resources
free -h
df -h
top -n 1
```

### Webhook Not Processing

```bash
# 1. Verify webhook server is running
curl http://localhost:3000/health

# 2. Check Midtrans dashboard configuration
# Ensure: Notification URL is correct and accessible

# 3. Check logs for errors
pm2 logs telegram-bot | grep -i webhook

# 4. Test webhook manually
curl -X POST http://localhost:3000/webhook/midtrans \
  -H "Content-Type: application/json" \
  -d '{...webhook payload...}'

# 5. Check database connectivity during webhook
node -e "import('./src/services/db.js').then(() => console.log('DB OK'))"
```

### Database Connection Issues

```bash
# 1. Verify DATABASE_URL is correct
echo $DATABASE_URL

# 2. Test MySQL connection
mysql -h $DB_HOST -u $DB_USER -p$DB_PASS $DB_NAME -e "SELECT 1;"

# 3. Check connection pool
# Monitor: Too many connections error
# Solution: Increase max_connections in MySQL

# 4. Restart database if needed
# Backup first!
systemctl restart mysql
```

### Memory Leak Suspected

```bash
# Monitor memory over time
pm2 monit telegram-bot

# If memory grows unbounded:
# 1. Check for event listener leaks
# 2. Verify database connection pool size
# 3. Check for memory leaks in handlers

# Restart bot if necessary
killall node && sleep 5 && pm2 start ecosystem.config.js
```

---

## 📊 Monitoring & Alerting

### Key Metrics to Monitor

| Metric           | Target  | Alert If            |
| ---------------- | ------- | ------------------- |
| Bot Status       | Running | Stopped for > 5 min |
| Memory Usage     | < 300MB | > 500MB             |
| CPU Usage        | < 20%   | > 80%               |
| Database Latency | < 100ms | > 500ms             |
| Webhook Latency  | < 2s    | > 10s               |
| Error Rate       | 0%      | > 1%                |
| Uptime           | 99.9%   | < 99%               |

### Log Monitoring

```bash
# Monitor for critical errors
pm2 logs telegram-bot | grep -E "ERROR|FAIL|ECONNREFUSED"

# Monitor webhook processing
pm2 logs telegram-bot | grep -E "\[Webhook\]"

# Monitor database queries
pm2 logs telegram-bot | grep -E "\[Database\]"
```

### Prometheus Metrics (Optional)

```javascript
// Setup Prometheus metrics in src/index-m6.js
import prometheus from 'prom-client'

const httpRequestDuration = new prometheus.Histogram({
  name: 'http_request_duration_ms',
  help: 'Duration of HTTP requests in ms',
})

const dbQueryDuration = new prometheus.Histogram({
  name: 'db_query_duration_ms',
  help: 'Duration of DB queries in ms',
})

// Expose metrics endpoint: GET /metrics
```

---

## 🔄 Maintenance Schedule

### Daily

- [ ] Check bot is running: `pm2 status`
- [ ] Monitor error logs: `pm2 logs telegram-bot`
- [ ] Verify webhook is processing

### Weekly

- [ ] Performance baseline review
- [ ] Database backup verification
- [ ] Security key rotation check (if needed)
- [ ] Unused credentials cleanup

### Monthly

- [ ] Database optimization (ANALYZE, OPTIMIZE)
- [ ] Log rotation and archival
- [ ] Performance trend analysis
- [ ] Security audit

### Quarterly

- [ ] Dependency updates
- [ ] Database backup restoration test
- [ ] Disaster recovery drill
- [ ] Feature performance review

---

## 🔐 Security Checklist

- [ ] DATABASE_URL contains strong password (16+ chars)
- [ ] ENCRYPTION_KEY is 32 bytes (256 bits) = 64 hex chars
- [ ] .env file permissions are 600 (read-write owner only)
- [ ] .env NOT committed to version control
- [ ] HTTPS enabled for webhook endpoint
- [ ] SSL certificate valid and not expired
- [ ] Telegram bot token is production token
- [ ] Midtrans credentials are production keys (not sandbox)
- [ ] Database backups encrypted
- [ ] Database accessible only from application server
- [ ] No hardcoded credentials in code
- [ ] No sensitive data logged

---

## 📈 Scaling Guide

If experiencing performance issues under load:

### Horizontal Scaling (Multiple Bot Instances)

```javascript
// Setup load balancer to distribute webhook traffic
// Use Redis for cross-instance session sharing
// Implement database connection pool management
```

### Vertical Scaling (Larger Server)

```bash
# Increase available resources
# Database: Add indices on userId, orderId
# Application: Increase Node.js memory limit
# System: More CPU cores, more RAM
```

### Database Optimization

```sql
-- Add indices for common queries
CREATE INDEX idx_order_userid ON orders(user_id);
CREATE INDEX idx_order_orderid ON orders(order_id);
CREATE INDEX idx_order_userid_status ON orders(user_id, status);

-- Analyze table statistics
ANALYZE TABLE orders;

-- Archive old orders if needed
```

---

## ✅ Deployment Sign-Off

When ready to deploy:

1. **QA Sign-Off**
   - [ ] All Phase 5 tests pass
   - [ ] Manual testing complete
   - [ ] No critical bugs found

2. **DevOps Sign-Off**
   - [ ] Infrastructure ready
   - [ ] Database migrated
   - [ ] Monitoring configured
   - [ ] Backups verified

3. **Security Sign-Off**
   - [ ] All credentials seure
   - [ ] HTTPS configured
   - [ ] Database accessible only from app
   - [ ] No sensitive data exposed

4. **Management Sign-Off**
   - [ ] Budget approved for hosting
   - [ ] SLA requirements understood
   - [ ] Escalation procedures defined
   - [ ] Go-live date confirmed

**Deployment Date:** ****\_\_\_\_****  
**Deployed By:** ****\_\_\_\_****  
**Signed Off:** ****\_\_\_\_****

---

## 🎯 Success Criteria

Deployment is successful when:

✅ Bot responding to all commands  
✅ Products displaying correctly  
✅ Orders created and stored  
✅ Payments processing successfully  
✅ Admin notifications received  
✅ Multi-user isolation verified  
✅ No errors in logs  
✅ Performance acceptable  
✅ Monitoring alerts working  
✅ Backup procedure verified

---

**Status:** ✅ DEPLOYMENT READY

Contact DevOps team for final deployment window.
