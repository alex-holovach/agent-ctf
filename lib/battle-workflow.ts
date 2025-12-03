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
  type SandboxInfo,
  type AgentSandboxInfo,
} from './sandbox'

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

// Setup agent sandboxes - creates sandboxes sequentially to avoid rate limits
async function setupAgentSandboxes(
  gameId: number,
  agents: AgentConfig[],
  emit?: (event: BattleEvent) => void
): Promise<Map<string, AgentSandboxInfo>> {
  const agentSandboxes = new Map<string, AgentSandboxInfo>()

  await emitEvent(gameId, {
    type: 'tower:setup',
    timestamp: Date.now(),
    message: `Creating ${agents.length} agent sandboxes...`,
  }, emit)

  // Create sandboxes sequentially to avoid rate limits
  for (const agent of agents) {
    await emitEvent(gameId, {
      type: 'agent:log',
      timestamp: Date.now(),
      agentId: agent.id,
      message: 'Creating sandbox environment...',
    }, emit)

    try {
      const sandboxInfo = await createAgentSandbox(gameId, agent.id)

      await emitEvent(gameId, {
        type: 'agent:log',
        timestamp: Date.now(),
        agentId: agent.id,
        message: 'Sandbox ready with Tailscale connected.',
      }, emit)

      agentSandboxes.set(agent.id, sandboxInfo)
    } catch (error) {
      console.error(`[Battle] Agent sandbox creation failed for ${agent.id}:`, error)
      await emitEvent(gameId, {
        type: 'agent:log',
        timestamp: Date.now(),
        agentId: agent.id,
        message: `Sandbox creation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
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

// Agent step - sends 10 requests to tower via Tailscale
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

  // Send 10 requests to the tower's hello endpoint
  for (let i = 0; i < 10; i++) {
    // Check if battle was cancelled
    if (!(await isBattleActive(gameId))) {
      await emitEvent(gameId, {
        type: 'agent:log',
        timestamp: Date.now(),
        agentId: agent.id,
        message: 'Battle cancelled. Disconnecting...',
      }, emit)
      break
    }

    await emitEvent(gameId, {
      type: 'agent:log',
      timestamp: Date.now(),
      agentId: agent.id,
      message: `Sending request ${i + 1}/10...`,
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
      const result = await sandbox.runCommand({
        cmd: 'curl',
        args: [
          '-s',
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
    message: 'Session complete.',
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

  await Promise.all(
    agents
      .filter(agent => agentSandboxes.has(agent.id))
      .map(agent => runAgentStep(gameId, agent, towerIp, emit))
  )

  // Check final status
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
    message: isStillActive ? 'Battle finished!' : 'Battle was cancelled',
    data: {
      gameId,
      cancelled: !isStillActive,
    },
  }, emit)
}
