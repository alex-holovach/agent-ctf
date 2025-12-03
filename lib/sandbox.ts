import { Sandbox } from '@vercel/sandbox'

// Tower sandbox configuration
const TOWER_REPO_URL = 'https://github.com/alex-holovach/agent-ctf.git'
const SANDBOX_TIMEOUT_MS = 10 * 60 * 1000 // 10 minutes

export interface SandboxInfo {
  id: string
  url: string
  sandbox: Sandbox
}

// Store active sandboxes in memory for cleanup
const activeSandboxes = new Map<number, Sandbox>()

/**
 * Create a new Vercel sandbox for the tower
 */
export async function createTowerSandbox(gameId: number): Promise<SandboxInfo> {
  console.log(`[Sandbox] Creating sandbox for game ${gameId}...`)
  const createStart = Date.now()

  const sandbox = await Sandbox.create({
    source: {
      url: TOWER_REPO_URL,
      type: 'git',
    },
    resources: { vcpus: 2 },
    timeout: SANDBOX_TIMEOUT_MS,
    ports: [3000],
    runtime: 'node22',
  })

  console.log(`[Sandbox] Created in ${Date.now() - createStart}ms`)

  // Store reference for cleanup
  activeSandboxes.set(gameId, sandbox)

  // Install Tailscale via static binary (faster than install script)
  console.log(`[Sandbox] Installing Tailscale (static binary)...`)
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
  }

  // Paths to binaries in extracted location
  const TAILSCALE = '/tmp/tailscale_1.76.6_amd64/tailscale'
  const TAILSCALED = '/tmp/tailscale_1.76.6_amd64/tailscaled'

  // Start tailscaled in userspace networking mode (no TUN device needed)
  console.log(`[Sandbox] Starting tailscaled...`)
  const daemonStart = Date.now()
  await sandbox.runCommand({
    cmd: TAILSCALED,
    args: ['--tun=userspace-networking', '--statedir=/tmp/tailscale-state'],
    detached: true,
    sudo: true,
  })
  console.log(`[Sandbox] tailscaled started in ${Date.now() - daemonStart}ms`)

  // Wait for daemon to initialize
  console.log(`[Sandbox] Waiting for tailscaled to initialize...`)
  await new Promise(resolve => setTimeout(resolve, 2000))

  // Check tailscaled status
  const statusCheck = await sandbox.runCommand({ cmd: TAILSCALE, args: ['status'], sudo: true })
  console.log(`[Sandbox] tailscale status exit: ${statusCheck.exitCode}`)

  // Authenticate with Tailscale
  const authKey = process.env.TAILSCALE_KEY
  if (authKey) {
    console.log(`[Sandbox] Authenticating with Tailscale...`)
    console.log(`[Sandbox] Auth key prefix: ${authKey.substring(0, 10)}...`)
    const authStart = Date.now()

    // Create writable streams to capture output
    let stdout = ''
    let stderr = ''
    const stdoutStream = new (require('stream').Writable)({
      write(chunk: Buffer, encoding: string, callback: () => void) {
        stdout += chunk.toString()
        callback()
      }
    })
    const stderrStream = new (require('stream').Writable)({
      write(chunk: Buffer, encoding: string, callback: () => void) {
        stderr += chunk.toString()
        callback()
      }
    })

    const authResult = await sandbox.runCommand({
      cmd: TAILSCALE,
      args: ['up', '--authkey', authKey, '--hostname', `tower-${gameId}`],
      sudo: true,
      stdout: stdoutStream,
      stderr: stderrStream,
    })
    console.log(`[Sandbox] Tailscale auth completed in ${Date.now() - authStart}ms (exit: ${authResult.exitCode})`)
    if (stdout) console.log(`[Sandbox] stdout: ${stdout}`)
    if (stderr) console.log(`[Sandbox] stderr: ${stderr}`)

    if (authResult.exitCode === 0) {
      // Get Tailscale IP
      const ipResult = await sandbox.runCommand({ cmd: TAILSCALE, args: ['ip', '-4'], sudo: true })
      console.log(`[Sandbox] Tailscale IP: (exit: ${ipResult.exitCode})`)
    } else {
      console.error(`[Sandbox] Tailscale authentication failed`)
    }
  } else {
    console.warn(`[Sandbox] TAILSCALE_KEY not set, skipping authentication`)
  }

  console.log(`[Sandbox] Total setup time: ${Date.now() - createStart}ms`)

  return {
    id: sandbox.sandboxId,
    url: sandbox.domain(3000),
    sandbox,
  }
}

/**
 * Stop a sandbox by game ID
 */
export async function killTowerSandbox(gameId: number): Promise<void> {
  const sandbox = activeSandboxes.get(gameId)
  if (sandbox) {
    try {
      await sandbox.stop()
    } catch (error) {
      console.error(`Failed to stop sandbox for game ${gameId}:`, error)
    }
    activeSandboxes.delete(gameId)
  }
}

/**
 * Get sandbox info by game ID
 */
export function getSandbox(gameId: number): Sandbox | undefined {
  return activeSandboxes.get(gameId)
}
