import { db } from './db'
import { games, gameEvents } from './db/schema'
import { eq } from 'drizzle-orm'
import type { AgentConfig, BattleEvent } from './types'

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

// Tower setup step - empty for now, will implement sandbox later
async function setupTowerSandbox(
  gameId: number,
  emit?: (event: BattleEvent) => void
): Promise<boolean> {
  await emitEvent(gameId, {
    type: 'tower:setup',
    timestamp: Date.now(),
    message: 'Initializing tower sandbox environment...',
  }, emit)
  
  await sleep(500)
  
  // Check if cancelled
  if (!(await isBattleActive(gameId))) {
    await emitEvent(gameId, {
      type: 'tower:setup',
      timestamp: Date.now(),
      message: 'Tower setup cancelled.',
    }, emit)
    return false
  }
  
  await emitEvent(gameId, {
    type: 'tower:setup',
    timestamp: Date.now(),
    message: 'Tower sandbox ready. Port 3000 exposed.',
  }, emit)
  
  await emitEvent(gameId, {
    type: 'tower:status',
    timestamp: Date.now(),
    data: { health: 100, status: 'ready' },
  }, emit)
  
  return true
}

// Agent step - runs for 10 seconds, emitting logs every second
async function runAgentStep(
  gameId: number,
  agent: AgentConfig,
  emit?: (event: BattleEvent) => void
): Promise<void> {
  await emitEvent(gameId, {
    type: 'agent:status',
    timestamp: Date.now(),
    agentId: agent.id,
    data: { status: 'starting' },
  }, emit)

  for (let i = 1; i <= 10; i++) {
    // Check if battle was cancelled in DB
    if (!(await isBattleActive(gameId))) {
      await emitEvent(gameId, {
        type: 'agent:log',
        timestamp: Date.now(),
        agentId: agent.id,
        message: `[${agent.name}] Battle cancelled. Disconnecting...`,
      }, emit)
      await emitEvent(gameId, {
        type: 'agent:status',
        timestamp: Date.now(),
        agentId: agent.id,
        data: { status: 'finished' },
      }, emit)
      return
    }

    const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false })
    
    await emitEvent(gameId, {
      type: 'agent:log',
      timestamp: Date.now(),
      agentId: agent.id,
      message: `[${timestamp}] Hello World from ${agent.name}! (${i}/10)`,
    }, emit)

    await sleep(1000)
  }

  await emitEvent(gameId, {
    type: 'agent:status',
    timestamp: Date.now(),
    agentId: agent.id,
    data: { status: 'finished' },
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
  const setupSuccess = await setupTowerSandbox(gameId, emit)
  if (!setupSuccess) {
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
    agents.map(agent => runAgentStep(gameId, agent, emit))
  )

  // Check final status
  const isStillActive = await isBattleActive(gameId)
  
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
