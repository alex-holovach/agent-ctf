import { Sandbox } from '@vercel/sandbox'

// Tower sandbox configuration
const SANDBOX_TIMEOUT_MS = 10 * 60 * 1000 // 10 minutes

// Tailscale binary paths
const TAILSCALE = '/tmp/tailscale_1.76.6_amd64/tailscale'
const TAILSCALED = '/tmp/tailscale_1.76.6_amd64/tailscaled'

export interface SandboxInfo {
  id: string
  url: string
  tailscaleIp: string
  sandbox: Sandbox
}

export interface AgentSandboxInfo {
  id: string
  agentId: string
  sandbox: Sandbox
}

// Store active sandboxes in memory for cleanup
const activeTowerSandboxes = new Map<number, Sandbox>()
const activeAgentSandboxes = new Map<string, Sandbox>() // key: `${gameId}-${agentId}`

// Inline Hono server code to run on the tower sandbox
const TOWER_SERVER_CODE = `
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { writeFileSync } from 'fs'

const app = new Hono()
const requestCounts = new Map()
const PERSIST_PATH = '/tmp/request-counts.json'

setInterval(() => {
  try {
    writeFileSync(PERSIST_PATH, JSON.stringify(Object.fromEntries(requestCounts)))
  } catch {}
}, 100)

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

app.get('/health', (c) => c.json({ status: 'ok', uptime: process.uptime() }))

app.get('/stats', (c) => c.json({
  agents: Object.fromEntries(requestCounts),
  totalRequests: Array.from(requestCounts.values()).reduce((a, b) => a + b, 0),
}))

serve({ fetch: app.fetch, port: 3000 }, (info) => {
  console.log('Tower server listening on port ' + info.port)
})
`

/**
 * Install Tailscale on a sandbox and authenticate
 */
async function installAndAuthTailscale(
  sandbox: Sandbox,
  hostname: string
): Promise<string | null> {
  console.log(`[Sandbox] Installing Tailscale for ${hostname}...`)
  const tailscaleStart = Date.now()

  // Download static tarball
  const downloadResult = await sandbox.runCommand('curl', [
    '-fsSL',
    'https://pkgs.tailscale.com/stable/tailscale_1.76.6_amd64.tgz',
    '-o',
    '/tmp/tailscale.tgz',
  ])
  console.log(`[Sandbox] Downloaded tarball in ${Date.now() - tailscaleStart}ms (exit: ${downloadResult.exitCode})`)

  // Extract tarball
  const extractStart = Date.now()
  const extractResult = await sandbox.runCommand('tar', ['-xzf', '/tmp/tailscale.tgz', '-C', '/tmp'])
  console.log(`[Sandbox] Extracted in ${Date.now() - extractStart}ms (exit: ${extractResult.exitCode})`)

  if (downloadResult.exitCode !== 0 || extractResult.exitCode !== 0) {
    console.error(`[Sandbox] Tailscale installation failed`)
    return null
  }

  // Start tailscaled in userspace networking mode with SOCKS5 proxy
  console.log(`[Sandbox] Starting tailscaled...`)
  const daemonStart = Date.now()
  await sandbox.runCommand({
    cmd: TAILSCALED,
    args: [
      '--tun=userspace-networking',
      '--statedir=/tmp/tailscale-state',
      '--socks5-server=localhost:1055',
    ],
    detached: true,
    sudo: true,
  })
  console.log(`[Sandbox] tailscaled started in ${Date.now() - daemonStart}ms`)

  // Wait for daemon to initialize
  await new Promise(resolve => setTimeout(resolve, 2000))

  // Authenticate with Tailscale
  const authKey = process.env.TAILSCALE_KEY
  if (!authKey) {
    console.warn(`[Sandbox] TAILSCALE_KEY not set, skipping authentication`)
    return null
  }

  console.log(`[Sandbox] Authenticating with Tailscale as ${hostname}...`)
  const authStart = Date.now()

  // Capture output
  let stdout = ''
  let stderr = ''
  const { Writable } = require('stream')
  const stdoutStream = new Writable({
    write(chunk: Buffer, _encoding: string, callback: () => void) {
      stdout += chunk.toString()
      callback()
    }
  })
  const stderrStream = new Writable({
    write(chunk: Buffer, _encoding: string, callback: () => void) {
      stderr += chunk.toString()
      callback()
    }
  })

  const authResult = await sandbox.runCommand({
    cmd: TAILSCALE,
    args: ['up', '--authkey', authKey, '--hostname', hostname],
    sudo: true,
    stdout: stdoutStream,
    stderr: stderrStream,
  })
  console.log(`[Sandbox] Tailscale auth completed in ${Date.now() - authStart}ms (exit: ${authResult.exitCode})`)
  if (stdout) console.log(`[Sandbox] stdout: ${stdout}`)
  if (stderr) console.log(`[Sandbox] stderr: ${stderr}`)

  if (authResult.exitCode !== 0) {
    console.error(`[Sandbox] Tailscale authentication failed`)
    return null
  }

  // Wait a moment for Tailscale to fully connect
  await new Promise(resolve => setTimeout(resolve, 1000))

  // Get Tailscale IP (try a few times as it may take a moment)
  let tailscaleIp = ''
  for (let attempt = 0; attempt < 3; attempt++) {
    let ipOutput = ''
    const ipStdout = new Writable({
      write(chunk: Buffer, _encoding: string, callback: () => void) {
        ipOutput += chunk.toString()
        callback()
      }
    })
    const ipResult = await sandbox.runCommand({
      cmd: TAILSCALE,
      args: ['ip', '-4'],
      sudo: true,
      stdout: ipStdout,
    })
    tailscaleIp = ipOutput.trim()
    console.log(`[Sandbox] Tailscale IP attempt ${attempt + 1}: "${tailscaleIp}" (exit: ${ipResult.exitCode})`)

    if (tailscaleIp && ipResult.exitCode === 0) {
      break
    }
    await new Promise(resolve => setTimeout(resolve, 500))
  }

  console.log(`[Sandbox] Final Tailscale IP: ${tailscaleIp}`)
  return tailscaleIp || null
}

/**
 * Create a new Vercel sandbox for the tower
 */
export async function createTowerSandbox(gameId: number): Promise<SandboxInfo> {
  console.log(`[Sandbox] Creating tower sandbox for game ${gameId}...`)
  const createStart = Date.now()

  const sandbox = await Sandbox.create({
    resources: { vcpus: 2 },
    timeout: SANDBOX_TIMEOUT_MS,
    ports: [3000],
    runtime: 'node22',
  })

  console.log(`[Sandbox] Created in ${Date.now() - createStart}ms`)

  // Store reference for cleanup
  activeTowerSandboxes.set(gameId, sandbox)

  // Write the Hono server code to the sandbox (use /tmp since it's writable)
  console.log(`[Sandbox] Setting up Hono server...`)
  await sandbox.runCommand('mkdir', ['-p', '/tmp/app'])

  // Write package.json
  const packageJson = JSON.stringify({
    name: 'tower-server',
    type: 'module',
    dependencies: {
      hono: '^4.6.0',
      '@hono/node-server': '^1.13.0',
    },
  })
  await sandbox.runCommand('bash', ['-c', `echo '${packageJson}' > /tmp/app/package.json`])

  // Write server code
  const escapedCode = TOWER_SERVER_CODE.replace(/'/g, "'\\''")
  await sandbox.runCommand('bash', ['-c', `echo '${escapedCode}' > /tmp/app/server.mjs`])

  // Install dependencies
  console.log(`[Sandbox] Installing Hono dependencies...`)
  const installStart = Date.now()
  const installResult = await sandbox.runCommand({
    cmd: 'npm',
    args: ['install'],
    cwd: '/tmp/app',
  })
  console.log(`[Sandbox] npm install completed in ${Date.now() - installStart}ms (exit: ${installResult.exitCode})`)

  // Start the server in background
  console.log(`[Sandbox] Starting Hono server...`)
  await sandbox.runCommand({
    cmd: 'node',
    args: ['/tmp/app/server.mjs'],
    detached: true,
    cwd: '/tmp/app',
  })

  // Wait for server to start
  await new Promise(resolve => setTimeout(resolve, 1000))

  // Install and authenticate Tailscale
  const tailscaleIp = await installAndAuthTailscale(sandbox, `tower-${gameId}`)

  console.log(`[Sandbox] Total tower setup time: ${Date.now() - createStart}ms`)

  return {
    id: sandbox.sandboxId,
    url: sandbox.domain(3000),
    tailscaleIp: tailscaleIp ?? '',
    sandbox,
  }
}

/**
 * Create a new Vercel sandbox for an agent
 */
export async function createAgentSandbox(gameId: number, agentId: string): Promise<AgentSandboxInfo> {
  console.log(`[Sandbox] Creating agent sandbox for ${agentId} in game ${gameId}...`)
  const createStart = Date.now()

  try {
    const sandbox = await Sandbox.create({
      resources: { vcpus: 2 },
      timeout: SANDBOX_TIMEOUT_MS,
      runtime: 'node22',
    })

    console.log(`[Sandbox] Agent ${agentId} sandbox created in ${Date.now() - createStart}ms`)

    // Store reference for cleanup
    const key = `${gameId}-${agentId}`
    activeAgentSandboxes.set(key, sandbox)

    // Install and authenticate Tailscale
    console.log(`[Sandbox] Installing Tailscale for agent ${agentId}...`)
    await installAndAuthTailscale(sandbox, `agent-${agentId}-${gameId}`)

    console.log(`[Sandbox] Agent ${agentId} total setup time: ${Date.now() - createStart}ms`)

    return {
      id: sandbox.sandboxId,
      agentId,
      sandbox,
    }
  } catch (error) {
    console.error(`[Sandbox] Failed to create agent sandbox for ${agentId}:`, error)
    throw error
  }
}

/**
 * Stop a tower sandbox by game ID
 */
export async function killTowerSandbox(gameId: number): Promise<void> {
  const sandbox = activeTowerSandboxes.get(gameId)
  if (sandbox) {
    try {
      await sandbox.stop()
    } catch (error) {
      console.error(`Failed to stop tower sandbox for game ${gameId}:`, error)
    }
    activeTowerSandboxes.delete(gameId)
  }
}

/**
 * Stop an agent sandbox
 */
export async function killAgentSandbox(gameId: number, agentId: string): Promise<void> {
  const key = `${gameId}-${agentId}`
  const sandbox = activeAgentSandboxes.get(key)
  if (sandbox) {
    try {
      await sandbox.stop()
    } catch (error) {
      console.error(`Failed to stop agent sandbox ${agentId} for game ${gameId}:`, error)
    }
    activeAgentSandboxes.delete(key)
  }
}

/**
 * Stop all agent sandboxes for a game
 */
export async function killAllAgentSandboxes(gameId: number): Promise<void> {
  const prefix = `${gameId}-`
  const keysToDelete: string[] = []

  for (const [key, sandbox] of activeAgentSandboxes) {
    if (key.startsWith(prefix)) {
      try {
        await sandbox.stop()
      } catch (error) {
        console.error(`Failed to stop agent sandbox ${key}:`, error)
      }
      keysToDelete.push(key)
    }
  }

  for (const key of keysToDelete) {
    activeAgentSandboxes.delete(key)
  }
}

/**
 * Get tower sandbox by game ID
 */
export function getTowerSandbox(gameId: number): Sandbox | undefined {
  return activeTowerSandboxes.get(gameId)
}

/**
 * Get agent sandbox
 */
export function getAgentSandbox(gameId: number, agentId: string): Sandbox | undefined {
  return activeAgentSandboxes.get(`${gameId}-${agentId}`)
}
