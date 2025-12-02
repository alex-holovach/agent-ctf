import { db } from './db'
import { games } from './db/schema'
import { eq } from 'drizzle-orm'
import type { AgentConfig, BattleEvent } from './types'

// Event emitter callback type
type EventCallback = (event: BattleEvent) => void

// Sleep utility
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

// Check if battle is still running (not cancelled)
async function isBattleActive(gameId: number): Promise<boolean> {
  const [game] = await db.select({ status: games.status }).from(games).where(eq(games.id, gameId))
  return game?.status === 'running'
}

// Tower setup step - empty for now, will implement sandbox later
async function setupTowerSandbox(gameId: number, emit: EventCallback): Promise<boolean> {
  emit({
    type: 'tower:setup',
    timestamp: Date.now(),
    message: 'Initializing tower sandbox environment...',
  })
  
  await sleep(500)
  
  // Check if cancelled
  if (!(await isBattleActive(gameId))) {
    emit({
      type: 'tower:setup',
      timestamp: Date.now(),
      message: 'Tower setup cancelled.',
    })
    return false
  }
  
  emit({
    type: 'tower:setup',
    timestamp: Date.now(),
    message: 'Tower sandbox ready. Port 3000 exposed.',
  })
  
  emit({
    type: 'tower:status',
    timestamp: Date.now(),
    data: { health: 100, status: 'ready' },
  })
  
  return true
}

// Agent step - runs for 10 seconds, emitting logs every second
async function runAgentStep(
  gameId: number,
  agent: AgentConfig,
  emit: EventCallback
): Promise<void> {
  emit({
    type: 'agent:status',
    timestamp: Date.now(),
    agentId: agent.id,
    data: { status: 'starting' },
  })

  for (let i = 1; i <= 10; i++) {
    // Check if battle was cancelled in DB
    if (!(await isBattleActive(gameId))) {
      emit({
        type: 'agent:log',
        timestamp: Date.now(),
        agentId: agent.id,
        message: `[${agent.name}] Battle cancelled. Disconnecting...`,
      })
      emit({
        type: 'agent:status',
        timestamp: Date.now(),
        agentId: agent.id,
        data: { status: 'finished' },
      })
      return
    }

    const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false })
    
    emit({
      type: 'agent:log',
      timestamp: Date.now(),
      agentId: agent.id,
      message: `[${timestamp}] Hello World from ${agent.name}! (${i}/10)`,
    })

    await sleep(1000)
  }

  emit({
    type: 'agent:status',
    timestamp: Date.now(),
    agentId: agent.id,
    data: { status: 'finished' },
  })
}

// Main battle workflow
export async function runBattleWorkflow(
  gameId: number,
  agents: AgentConfig[],
  emit: EventCallback
): Promise<void> {
  // Emit battle start
  emit({
    type: 'battle:start',
    timestamp: Date.now(),
    message: `Battle starting with ${agents.length} agents`,
    data: { gameId, agents: agents.map(a => ({ id: a.id, name: a.name })) },
  })

  // Step 1: Setup tower sandbox
  const setupSuccess = await setupTowerSandbox(gameId, emit)
  if (!setupSuccess) {
    emit({
      type: 'battle:end',
      timestamp: Date.now(),
      message: 'Battle cancelled during setup',
      data: { gameId, cancelled: true },
    })
    return
  }

  // Step 2: Run all agent steps in parallel
  emit({
    type: 'agent:status',
    timestamp: Date.now(),
    message: 'Starting all agents in parallel...',
  })

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
  emit({
    type: 'battle:end',
    timestamp: Date.now(),
    message: isStillActive ? 'Battle finished!' : 'Battle was cancelled',
    data: { 
      gameId,
      duration: 10,
      cancelled: !isStillActive,
      agents: agents.map(a => a.id),
    },
  })
}
