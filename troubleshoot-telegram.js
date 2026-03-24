#!/usr/bin/env node
// Troubleshooting script untuk Telegram polling conflict

import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

console.log('🔍 Troubleshooting Telegram Bot Polling Conflict\n')

// Check for Node processes
console.log('1️⃣  Checking for running Node processes...\n')

try {
  const { stdout } = await execAsync(
    'ps aux | grep -E "node.*index-m6|node.*validate" | grep -v grep',
  )

  if (stdout.trim()) {
    console.log('🚨 Found running Node processes:\n')
    console.log(stdout)
    console.log('\n⚠️  Multiple bot instances detected!')
    console.log('\n📋 To fix this:')
    console.log('   Run: killall node')
    console.log('   Then: npm run start:m6\n')
  } else {
    console.log('✅ No conflicting Node processes found\n')
    console.log('💡 If you still see polling error:')
    console.log('   1. Kill all node processes: killall node')
    console.log('   2. Wait 5 seconds')
    console.log('   3. Start bot again: npm run start:m6')
    console.log('   4. Check logs for errors\n')
  }
} catch (e) {
  console.log('⚠️  Could not check processes (might be normal on macOS)\n')
  console.log('Manual fix:')
  console.log('   1. killall node')
  console.log('   2. npm run start:m6\n')
}

console.log('📚 Understanding the Error:')
console.log(`
The error "terminated by other getUpdates request" means:
- Telegram API only allows ONE active polling connection per bot token
- If you have 2+ instances polling with same token → CONFLICT

Common causes:
1. Multiple npm scripts running (e.g., npm run dev AND npm start)
2. Previous process didn't fully kill (zombie process)
3. Using same bot token in multiple projects/terminals
4. Rapid restart before previous connection closes (~20-30 sec)

Prevention:
- Always: killall node BEFORE starting new instance
- Wait 3-5 seconds between restarts
- Check: ps aux | grep node`)
