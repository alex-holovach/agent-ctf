import { db } from './db'
import { games, gameEvents, gameResults } from './db/schema'
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
import { runLLMAgent } from './llm-client'
import type { Sandbox } from '@vercel/sandbox'

// Game constants
const INITIAL_TOWER_HEALTH = 1000
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
        const healthPercent = Math.round((health / INITIAL_TOWER_HEALTH) * 100)
        lastTotal = totalRequests

        // Emit tower:status with updated health (as percentage for UI)
        await emitEvent(gameId, {
          type: 'tower:status',
          timestamp: Date.now(),
          data: {
            health: healthPercent,
            status: health > 0 ? 'under_attack' : 'defeated',
            totalRequests,
            agentStats: stats.agents,
          },
        }, emit)

        // Log health update to tower terminal
        await emitEvent(gameId, {
          type: 'tower:setup',
          timestamp: Date.now(),
          message: `Received ${totalRequests} requests. Health: ${healthPercent}% (${health}/${INITIAL_TOWER_HEALTH})`,
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

// Agent step - runs LLM agent that discovers and attacks tower
async function runAgentStep(
  gameId: number,
  agent: AgentConfig,
  towerTailscaleIp: string,
  emit?: (event: BattleEvent) => void
): Promise<{ tokensUsed: number }> {
  const sandbox = getAgentSandbox(gameId, agent.id)
  if (!sandbox) {
    await emitEvent(gameId, {
      type: 'agent:log',
      timestamp: Date.now(),
      agentId: agent.id,
      message: 'Error: Agent sandbox not found.',
    }, emit)
    return { tokensUsed: 0 }
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
    message: `Initializing ${agent.name} agent...`,
  }, emit)

  await sleep(500)

  await emitEvent(gameId, {
    type: 'agent:status',
    timestamp: Date.now(),
    agentId: agent.id,
    data: { status: 'running' },
  }, emit)

  // Create emit wrapper that stores events in DB
  const emitWrapper = async (event: BattleEvent) => {
    await emitEvent(gameId, event, emit)
  }

  // Create battle active checker
  const checkBattleActive = () => isBattleActive(gameId)

  // Run the LLM agent
  let tokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
  try {
    tokenUsage = await runLLMAgent(
      agent,
      towerTailscaleIp,
      sandbox,
      emitWrapper,
      checkBattleActive
    )
  } catch (error) {
    await emitEvent(gameId, {
      type: 'agent:log',
      timestamp: Date.now(),
      agentId: agent.id,
      message: `Agent error: ${error instanceof Error ? error.message : 'Unknown'}`,
    }, emit)
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
    message: `Battle ended. Used ${tokenUsage.totalTokens.toLocaleString()} tokens.`,
  }, emit)

  return { tokensUsed: tokenUsage.totalTokens }
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
  // - Agents run LLM loops until battle ends
  const activeAgents = agents.filter(agent => agentSandboxes.has(agent.id))
  const agentPromises = activeAgents.map(agent => runAgentStep(gameId, agent, towerIp, emit))

  const [, ...agentResults] = await Promise.all([
    // Health monitor (will stop when health=0 or battle cancelled)
    monitorTowerHealth(gameId, towerInfo.sandbox, emit),
    // All agents attack (will stop when isBattleActive returns false)
    ...agentPromises,
  ])

  // Collect token usage from agents
  const tokenUsageByAgent = new Map<string, number>()
  activeAgents.forEach((agent, index) => {
    const result = agentResults[index] as { tokensUsed: number }
    tokenUsageByAgent.set(agent.id, result?.tokensUsed || 0)
  })

  // Check final status (game ends when tower defeated or manually cancelled)
  const isStillActive = await isBattleActive(gameId)

  // Get final stats from tower before cleanup
  let finalStats: { totalRequests: number; agents: Record<string, number> } | null = null
  try {
    finalStats = await readTowerStats(towerInfo.sandbox)
  } catch (error) {
    console.error('[Battle] Failed to read final stats:', error)
  }

  // Save game results to database
  if (finalStats && finalStats.agents) {
    try {
      // Create results array with damage per agent
      const results = agents.map(agent => ({
        agentId: agent.id,
        name: agent.name,
        color: agent.color,
        damage: finalStats!.agents[agent.id] || 0,
        tokensUsed: tokenUsageByAgent.get(agent.id) || 0,
      }))

      // Sort by damage (descending) to calculate places
      const sortedResults = [...results].sort((a, b) => b.damage - a.damage)

      // Insert results into database
      await Promise.all(
        sortedResults.map((result, index) =>
          db.insert(gameResults).values({
            gameId,
            model: result.name,
            modelColor: result.color,
            damage: result.damage,
            place: index + 1,
            tokensCount: result.tokensUsed,
          })
        )
      )

      // Emit results event for UI
      await emitEvent(gameId, {
        type: 'battle:end',
        timestamp: Date.now(),
        message: 'Game results saved',
        data: {
          gameId,
          results: sortedResults.map((r, i) => ({
            model: r.name,
            modelColor: r.color,
            damage: r.damage,
            place: i + 1,
            tokensCount: r.tokensUsed,
          })),
        },
      }, emit)
    } catch (error) {
      console.error('[Battle] Failed to save game results:', error)
    }
  }

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
