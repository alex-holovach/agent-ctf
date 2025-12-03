import { db } from './db'
import { games, gameEvents } from './db/schema'
import { eq } from 'drizzle-orm'
import type { AgentConfig, BattleEvent } from './types'
import { createTowerSandbox, killTowerSandbox } from './sandbox'

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

// Tower setup step - creates Vercel sandbox, returns URL or null on failure
async function setupTowerSandbox(
  gameId: number,
  emit?: (event: BattleEvent) => void
): Promise<string | null> {
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

    await emitEvent(gameId, {
      type: 'tower:status',
      timestamp: Date.now(),
      data: { health: 100, status: 'ready', url: sandboxInfo.url },
    }, emit)

    return sandboxInfo.url
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

// Mock agent actions for simulation
const MOCK_ACTIONS = [
  'Scanning target endpoint...',
  'Analyzing response headers...',
  'Testing authentication flow...',
  'Enumerating API endpoints...',
  'Checking for common vulnerabilities...',
  'Attempting directory traversal...',
  'Testing input validation...',
  'Reviewing error messages...',
  'Probing for SQL injection...',
  'Finalizing analysis...',
]

// Agent step - mock simulation for 10 seconds
async function runAgentStep(
  gameId: number,
  agent: AgentConfig,
  towerUrl: string,
  emit?: (event: BattleEvent) => void
): Promise<void> {
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
    message: `Connecting to target: ${towerUrl}`,
  }, emit)

  await sleep(500)

  await emitEvent(gameId, {
    type: 'agent:status',
    timestamp: Date.now(),
    agentId: agent.id,
    data: { status: 'running' },
  }, emit)

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
      message: MOCK_ACTIONS[i],
    }, emit)

    await sleep(1000)
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

// Cleanup function to kill sandbox
async function cleanupBattle(
  gameId: number,
  emit?: (event: BattleEvent) => void
): Promise<void> {
  await emitEvent(gameId, {
    type: 'tower:setup',
    timestamp: Date.now(),
    message: 'Shutting down tower...',
  }, emit)

  try {
    await killTowerSandbox(gameId)
  } catch (error) {
    console.error(`Failed to cleanup sandbox for game ${gameId}:`, error)
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
    message: 'Tower terminated.',
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
  const sandboxUrl = await setupTowerSandbox(gameId, emit)
  if (!sandboxUrl) {
    await cleanupBattle(gameId, emit)
    await emitEvent(gameId, {
      type: 'battle:end',
      timestamp: Date.now(),
      message: 'Battle cancelled during setup',
      data: { gameId, cancelled: true },
    }, emit)
    return
  }

  // Step 2: Run all agent steps in parallel
  await Promise.all(
    agents.map(agent => runAgentStep(gameId, agent, sandboxUrl, emit))
  )

  // Check final status
  const isStillActive = await isBattleActive(gameId)

  // Step 3: Cleanup - kill the sandbox
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
