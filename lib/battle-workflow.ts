import type { AgentConfig, BattleEvent } from './types'

// Event emitter callback type
type EventCallback = (event: BattleEvent) => void

// Sleep utility
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

// Tower setup step - empty for now, will implement sandbox later
async function setupTowerSandbox(emit: EventCallback): Promise<void> {
  emit({
    type: 'tower:setup',
    timestamp: Date.now(),
    message: 'Initializing tower sandbox environment...',
  })
  
  await sleep(500)
  
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
}

// Agent step - runs for 10 seconds, emitting logs every second
async function runAgentStep(
  agent: AgentConfig,
  emit: EventCallback,
  abortSignal?: AbortSignal
): Promise<void> {
  emit({
    type: 'agent:status',
    timestamp: Date.now(),
    agentId: agent.id,
    data: { status: 'starting' },
  })

  for (let i = 1; i <= 10; i++) {
    // Check if battle was aborted
    if (abortSignal?.aborted) {
      emit({
        type: 'agent:log',
        timestamp: Date.now(),
        agentId: agent.id,
        message: `[${agent.name}] Battle stopped. Disconnecting...`,
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
  agents: AgentConfig[],
  emit: EventCallback,
  abortSignal?: AbortSignal
): Promise<void> {
  // Emit battle start
  emit({
    type: 'battle:start',
    timestamp: Date.now(),
    message: `Battle starting with ${agents.length} agents`,
    data: { agents: agents.map(a => ({ id: a.id, name: a.name })) },
  })

  // Step 1: Setup tower sandbox
  await setupTowerSandbox(emit)

  // Check if aborted before starting agents
  if (abortSignal?.aborted) {
    emit({
      type: 'battle:end',
      timestamp: Date.now(),
      message: 'Battle aborted before agent execution',
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
    agents.map(agent => runAgentStep(agent, emit, abortSignal))
  )

  // Emit battle end
  emit({
    type: 'battle:end',
    timestamp: Date.now(),
    message: 'Battle finished!',
    data: { 
      duration: 10,
      agents: agents.map(a => a.id),
    },
  })
}

