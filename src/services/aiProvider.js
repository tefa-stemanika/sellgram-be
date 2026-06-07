export function isAiEnabled() {
  return !!(process.env.GEMINI_API_KEY || process.env.OPENROUTER_API_KEY)
}

export async function isAiEnabledForUser(userId) {
  const { getBotModeForUser } = await import('./configService.js')
  const mode = await getBotModeForUser(userId)
  if (mode === 'BUTTON') return false
  return isAiEnabled()
}

function getActiveProvider() {
  if (process.env.OPENROUTER_API_KEY) return 'openrouter'
  if (process.env.GEMINI_API_KEY) return 'gemini'
  return null
}

export async function askAI(userMessage, userId, conversationHistory = []) {
  const provider = getActiveProvider()
  if (provider === 'openrouter') {
    const { askOpenRouter } = await import('./openrouter.js')
    return askOpenRouter(userMessage, userId, conversationHistory)
  }
  if (provider === 'gemini') {
    const { askGemini } = await import('./gemini.js')
    return askGemini(userMessage, userId, conversationHistory)
  }
  throw new Error('No AI provider configured. Set GEMINI_API_KEY or OPENROUTER_API_KEY in .env')
}
