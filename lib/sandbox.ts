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

  // Store reference for cleanup
  activeSandboxes.set(gameId, sandbox)

  // Install dependencies
  const install = await sandbox.runCommand('npm', ['install'])

  if (install.exitCode !== 0) {
    await sandbox.stop()
    activeSandboxes.delete(gameId)
    throw new Error('Failed to install tower dependencies')
  }

  // Start the tower server in detached mode
  await sandbox.runCommand({
    cmd: 'npm',
    args: ['run', 'start'],
    detached: true,
  })

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
