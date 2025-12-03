import { db } from './db'
import { games, gameEvents } from './db/schema'
import { eq } from 'drizzle-orm'
import type { AgentConfig, BattleEvent } from './types'
import {
  createTowerSandbox,
  killTowerSandbox,
  createAgentSandbox,
  killAllAgentSandboxes,
  getAgentSandbox,
  readTowerStats,
  type SandboxInfo,
  type AgentSandboxInfo,
} from './sandbox'
import type { Sandbox } from '@vercel/sandbox'

// Game constants
const INITIAL_TOWER_HEALTH = 100
const DAMAGE_PER_REQUEST = 1

// Sleep utility
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

// Check if battle is still running (not cancelled)
async function isBattleActive(gameId: number): Promise<boolean> {
  const [game] = await db.select({ status: games.status }).from(games).where(eq(games.id, gameId))
  return game?.status === 'running'
}

// Store event in database and call emit callback
async function emitEvent(
  gameId: number,
  event: BattleEvent,
  emit?: (event: BattleEvent) => void
): Promise<void> {
  // Store in database for resumable streams
  await db.insert(gameEvents).values({
    gameId,
    type: event.type,
    agentId: event.agentId,
    message: event.message,
    data: event.data,
  })

  // Also emit to live stream if callback provided
  emit?.(event)
}

// Tower setup step - creates Vercel sandbox, returns sandbox info or null on failure
async function setupTowerSandbox(
  gameId: number,
  emit?: (event: BattleEvent) => void
): Promise<SandboxInfo | null> {
  await emitEvent(gameId, {
    type: 'tower:setup',
    timestamp: Date.now(),
    message: 'Initializing tower sandbox environment...',
  }, emit)

  // Check if cancelled before starting
  if (!(await isBattleActive(gameId))) {
    await emitEvent(gameId, {
      type: 'tower:setup',
      timestamp: Date.now(),
      message: 'Tower setup cancelled.',
    }, emit)
    return null
  }

  try {
    await emitEvent(gameId, {
      type: 'tower:setup',
      timestamp: Date.now(),
      message: 'Creating Vercel sandbox...',
    }, emit)

    const sandboxInfo = await createTowerSandbox(gameId)

    // Store sandbox info in database
    await db.update(games)
      .set({
        sandboxId: sandboxInfo.id,
        sandboxUrl: sandboxInfo.url,
        updatedAt: new Date(),
      })
      .where(eq(games.id, gameId))

    await emitEvent(gameId, {
      type: 'tower:setup',
      timestamp: Date.now(),
      message: `Tower sandbox ready at ${sandboxInfo.url}`,
    }, emit)

    if (sandboxInfo.tailscaleIp) {
      await emitEvent(gameId, {
        type: 'tower:setup',
        timestamp: Date.now(),
        message: `Tower Tailscale IP: ${sandboxInfo.tailscaleIp}`,
      }, emit)
    }

    await emitEvent(gameId, {
      type: 'tower:status',
      timestamp: Date.now(),
      data: { health: 100, status: 'ready', url: sandboxInfo.url, tailscaleIp: sandboxInfo.tailscaleIp },
    }, emit)

    return sandboxInfo
  } catch (error) {
    console.error('Sandbox creation failed:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    await emitEvent(gameId, {
      type: 'tower:setup',
      timestamp: Date.now(),
      message: `Failed to create sandbox: ${errorMessage}`,
    }, emit)
    await emitEvent(gameId, {
      type: 'error',
      timestamp: Date.now(),
      message: `Tower setup failed: ${errorMessage}`,
    }, emit)
    return null
  }
}

// Setup agent sandboxes - creates sandboxes in parallel
async function setupAgentSandboxes(
  gameId: number,
  agents: AgentConfig[],
  emit?: (event: BattleEvent) => void
): Promise<Map<string, AgentSandboxInfo>> {
  const agentSandboxes = new Map<string, AgentSandboxInfo>()

  await emitEvent(gameId, {
    type: 'tower:setup',
    timestamp: Date.now(),
    message: `Creating ${agents.length} agent sandboxes in parallel...`,
  }, emit)

  // Emit starting message for all agents
  await Promise.all(
    agents.map(agent =>
      emitEvent(gameId, {
        type: 'agent:log',
        timestamp: Date.now(),
        agentId: agent.id,
        message: 'Creating sandbox environment...',
      }, emit)
    )
  )

  // Create all sandboxes in parallel
  const results = await Promise.allSettled(
    agents.map(agent => createAgentSandbox(gameId, agent.id))
  )

  // Process results
  for (let i = 0; i < results.length; i++) {
    const result = results[i]
    const agent = agents[i]

    if (result.status === 'fulfilled') {
      agentSandboxes.set(agent.id, result.value)
      await emitEvent(gameId, {
        type: 'agent:log',
        timestamp: Date.now(),
        agentId: agent.id,
        message: 'Sandbox ready with Tailscale connected.',
      }, emit)
    } else {
      console.error(`[Battle] Agent sandbox creation failed for ${agent.id}:`, result.reason)
      await emitEvent(gameId, {
        type: 'agent:log',
        timestamp: Date.now(),
        agentId: agent.id,
        message: `Sandbox creation failed: ${result.reason instanceof Error ? result.reason.message : 'Unknown error'}`,
      }, emit)
    }
  }

  await emitEvent(gameId, {
    type: 'tower:setup',
    timestamp: Date.now(),
    message: `${agentSandboxes.size}/${agents.length} agent sandboxes ready.`,
  }, emit)

  return agentSandboxes
}

// Monitor tower health by reading request counts from the tower sandbox
async function monitorTowerHealth(
  gameId: number,
  towerSandbox: Sandbox,
  emit?: (event: BattleEvent) => void
): Promise<void> {
  let lastTotal = 0

  while (await isBattleActive(gameId)) {
    try {
      // Read request counts from tower sandbox
      const stats = await readTowerStats(towerSandbox)

      // Skip if we failed to read stats (file might not exist yet or read error)
      if (!stats) {
        await sleep(200)
        continue
      }

      const totalRequests = stats.totalRequests

      // Only update if requests increased (health should never go back up)
      if (totalRequests > lastTotal) {
        const health = Math.max(0, INITIAL_TOWER_HEALTH - totalRequests * DAMAGE_PER_REQUEST)
        lastTotal = totalRequests

        // Emit tower:status with updated health
        await emitEvent(gameId, {
          type: 'tower:status',
          timestamp: Date.now(),
          data: {
            health,
            status: health > 0 ? 'under_attack' : 'defeated',
            totalRequests,
            agentStats: stats.agents,
          },
        }, emit)

        // Log health update to tower terminal
        await emitEvent(gameId, {
          type: 'tower:setup',
          timestamp: Date.now(),
          message: `Received ${totalRequests} requests. Health: ${health}%`,
        }, emit)

        // If health is 0, mark game as finished
        if (health <= 0) {
          await emitEvent(gameId, {
            type: 'tower:setup',
            timestamp: Date.now(),
            message: 'TOWER DEFEATED! Health depleted.',
          }, emit)
          await db.update(games).set({ status: 'finished' }).where(eq(games.id, gameId))
          break
        }
      }
    } catch (error) {
      console.error('[Health Monitor] Error reading stats:', error)
    }

    await sleep(200) // Check every 200ms
  }
}

// Agent step - sends requests to tower via Tailscale until battle ends
async function runAgentStep(
  gameId: number,
  agent: AgentConfig,
  towerTailscaleIp: string,
  emit?: (event: BattleEvent) => void
): Promise<void> {
  const sandbox = getAgentSandbox(gameId, agent.id)
  if (!sandbox) {
    await emitEvent(gameId, {
      type: 'agent:log',
      timestamp: Date.now(),
      agentId: agent.id,
      message: 'Error: Agent sandbox not found.',
    }, emit)
    return
  }

  await emitEvent(gameId, {
    type: 'agent:status',
    timestamp: Date.now(),
    agentId: agent.id,
    data: { status: 'starting' },
  }, emit)

  await emitEvent(gameId, {
    type: 'agent:log',
    timestamp: Date.now(),
    agentId: agent.id,
    message: `Targeting tower at ${towerTailscaleIp}:3000`,
  }, emit)

  await sleep(500)

  await emitEvent(gameId, {
    type: 'agent:status',
    timestamp: Date.now(),
    agentId: agent.id,
    data: { status: 'running' },
  }, emit)

  // Send requests continuously until battle ends (tower defeated or cancelled)
  let requestCount = 0
  while (await isBattleActive(gameId)) {
    requestCount++

    await emitEvent(gameId, {
      type: 'agent:log',
      timestamp: Date.now(),
      agentId: agent.id,
      message: `Sending request #${requestCount}...`,
    }, emit)

    // Capture response
    let responseText = ''
    const { Writable } = require('stream')
    const stdoutStream = new Writable({
      write(chunk: Buffer, _encoding: string, callback: () => void) {
        responseText += chunk.toString()
        callback()
      }
    })

    try {
      // Use Tailscale's SOCKS proxy for userspace networking (no TUN device)
      const result = await sandbox.runCommand({
        cmd: 'curl',
        args: [
          '-s',
          '--max-time', '10',
          '--socks5', 'localhost:1055',
          '-H', `X-Agent-ID: ${agent.id}`,
          `http://${towerTailscaleIp}:3000/hello`,
        ],
        stdout: stdoutStream,
      })

      if (result.exitCode === 0 && responseText) {
        try {
          const response = JSON.parse(responseText)
          await emitEvent(gameId, {
            type: 'agent:log',
            timestamp: Date.now(),
            agentId: agent.id,
            message: `Response: ${response.message} (request #${response.requestNumber})`,
          }, emit)
        } catch {
          await emitEvent(gameId, {
            type: 'agent:log',
            timestamp: Date.now(),
            agentId: agent.id,
            message: `Response: ${responseText.substring(0, 100)}`,
          }, emit)
        }
      } else {
        await emitEvent(gameId, {
          type: 'agent:log',
          timestamp: Date.now(),
          agentId: agent.id,
          message: `Request failed (exit: ${result.exitCode})`,
        }, emit)
      }
    } catch (error) {
      await emitEvent(gameId, {
        type: 'agent:log',
        timestamp: Date.now(),
        agentId: agent.id,
        message: `Request error: ${error instanceof Error ? error.message : 'Unknown'}`,
      }, emit)
    }

    await sleep(500)
  }

  await emitEvent(gameId, {
    type: 'agent:status',
    timestamp: Date.now(),
    agentId: agent.id,
    data: { status: 'finished' },
  }, emit)

  await emitEvent(gameId, {
    type: 'agent:log',
    timestamp: Date.now(),
    agentId: agent.id,
    message: `Battle ended. Sent ${requestCount} requests total.`,
  }, emit)
}

// Cleanup function to kill all sandboxes
async function cleanupBattle(
  gameId: number,
  emit?: (event: BattleEvent) => void
): Promise<void> {
  await emitEvent(gameId, {
    type: 'tower:setup',
    timestamp: Date.now(),
    message: 'Shutting down all sandboxes...',
  }, emit)

  // Kill all agent sandboxes
  try {
    await killAllAgentSandboxes(gameId)
  } catch (error) {
    console.error(`Failed to cleanup agent sandboxes for game ${gameId}:`, error)
  }

  // Kill tower sandbox
  try {
    await killTowerSandbox(gameId)
  } catch (error) {
    console.error(`Failed to cleanup tower sandbox for game ${gameId}:`, error)
  }

  // Clear sandbox info from database
  await db.update(games)
    .set({
      sandboxId: null,
      sandboxUrl: null,
      updatedAt: new Date(),
    })
    .where(eq(games.id, gameId))

  await emitEvent(gameId, {
    type: 'tower:setup',
    timestamp: Date.now(),
    message: 'All sandboxes terminated.',
  }, emit)
}

// Main battle workflow
export async function runBattleWorkflow(
  gameId: number,
  agents: AgentConfig[],
  emit?: (event: BattleEvent) => void
): Promise<void> {
  // Emit battle start
  await emitEvent(gameId, {
    type: 'battle:start',
    timestamp: Date.now(),
    message: `Battle starting with ${agents.length} agents`,
    data: { gameId, agents: agents.map(a => ({ id: a.id, name: a.name })) },
  }, emit)

  // Step 1: Setup tower sandbox
  const towerInfo = await setupTowerSandbox(gameId, emit)
  if (!towerInfo) {
    await cleanupBattle(gameId, emit)
    await emitEvent(gameId, {
      type: 'battle:end',
      timestamp: Date.now(),
      message: 'Battle cancelled during tower setup',
      data: { gameId, cancelled: true },
    }, emit)
    return
  }

  // Step 2: Setup agent sandboxes in parallel
  const agentSandboxes = await setupAgentSandboxes(gameId, agents, emit)
  if (agentSandboxes.size === 0) {
    await cleanupBattle(gameId, emit)
    await emitEvent(gameId, {
      type: 'battle:end',
      timestamp: Date.now(),
      message: 'Battle cancelled - no agent sandboxes created',
      data: { gameId, cancelled: true },
    }, emit)
    return
  }

  // Step 3: Run all agent steps in parallel (sending requests to tower)
  const towerIp = towerInfo.tailscaleIp
  if (!towerIp) {
    await emitEvent(gameId, {
      type: 'error',
      timestamp: Date.now(),
      message: 'Tower Tailscale IP not available. Agents cannot connect.',
    }, emit)
    await cleanupBattle(gameId, emit)
    await emitEvent(gameId, {
      type: 'battle:end',
      timestamp: Date.now(),
      message: 'Battle cancelled - tower not reachable via Tailscale',
      data: { gameId, cancelled: true },
    }, emit)
    return
  }

  // Step 3: Run health monitor and all agents in parallel
  // - Health monitor tracks damage and ends game when tower health reaches 0
  // - Agents send requests continuously until battle ends
  await Promise.all([
    // Health monitor (will stop when health=0 or battle cancelled)
    monitorTowerHealth(gameId, towerInfo.sandbox, emit),
    // All agents attack (will stop when isBattleActive returns false)
    ...agents
      .filter(agent => agentSandboxes.has(agent.id))
      .map(agent => runAgentStep(gameId, agent, towerIp, emit)),
  ])

  // Check final status (game ends when tower defeated or manually cancelled)
  const isStillActive = await isBattleActive(gameId)

  // Step 4: Cleanup - kill all sandboxes
  await cleanupBattle(gameId, emit)

  // Mark game as finished in DB
  await db.update(games)
    .set({
      status: isStillActive ? 'finished' : 'cancelled',
      finishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(games.id, gameId))

  // Emit battle end
  await emitEvent(gameId, {
    type: 'battle:end',
    timestamp: Date.now(),
    message: isStillActive ? 'Tower defeated! Battle finished!' : 'Battle was cancelled',
    data: {
      gameId,
      cancelled: !isStillActive,
    },
  }, emit)
}
