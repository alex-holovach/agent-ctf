import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { writeFileSync } from 'fs'

const app = new Hono()

// In-memory map to store request counts per agent
const requestCounts = new Map<string, number>()

// Persist counts to file every 100ms
const PERSIST_PATH = '/tmp/request-counts.json'
setInterval(() => {
  try {
    writeFileSync(PERSIST_PATH, JSON.stringify(Object.fromEntries(requestCounts)))
  } catch {
    // Ignore write errors
  }
}, 100)

// Root endpoint - hint for AI agents
app.get('/', (c) => {
  return c.text('Call /hello endpoint with X-Agent-ID header to defeat the tower')
})

// Hello endpoint - extracts agent ID from header and tracks request count
app.get('/hello', (c) => {
  const agentId = c.req.header('X-Agent-ID') ?? 'unknown'
  const currentCount = requestCounts.get(agentId) ?? 0
  requestCounts.set(agentId, currentCount + 1)

  return c.json({
    message: 'Hello from Tower!',
    agentId,
    requestNumber: currentCount + 1,
    totalRequests: Array.from(requestCounts.values()).reduce((a, b) => a + b, 0),
  })
})

// Health check endpoint
app.get('/health', (c) => {
  return c.json({ status: 'ok', uptime: process.uptime() })
})

// Stats endpoint - returns all agent request counts
app.get('/stats', (c) => {
  return c.json({
    agents: Object.fromEntries(requestCounts),
    totalRequests: Array.from(requestCounts.values()).reduce((a, b) => a + b, 0),
  })
})

const PORT = 3000

console.log(`Tower server starting on port ${PORT}...`)

serve({
  fetch: app.fetch,
  port: PORT,
}, (info) => {
  console.log(`Tower server listening on http://localhost:${info.port}`)
})

