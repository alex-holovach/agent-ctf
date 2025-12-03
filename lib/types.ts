// Agent configuration - will be used for dynamic model selection later
export interface AgentConfig {
  id: string
  name: string
  model: string
  color: string
  provider: 'openai' | 'anthropic' | 'google' | 'xai'
}

// Default agent configurations
export const DEFAULT_AGENTS: AgentConfig[] = [
  { id: 'agent-1', name: 'gpt-5-mini', model: 'gpt-5-mini', color: '#10a37f', provider: 'openai' },
  { id: 'agent-2', name: 'claude-haiku-4.5', model: 'claude-haiku-4.5', color: '#d97706', provider: 'anthropic' },
  { id: 'agent-3', name: 'gemini-2.5-flash', model: 'gemini-2.5-flash', color: '#4285f4', provider: 'google' },
  { id: 'agent-4', name: 'grok-code-fast-1', model: 'grok-code-fast-1', color: '#ef4444', provider: 'xai' },
]

// Battle event types for streaming
export type BattleEventType =
  | 'battle:start'
  | 'battle:end'
  | 'tower:setup'
  | 'tower:status'
  | 'agent:log'
  | 'agent:status'
  | 'agent:thinking'  // LLM reasoning stream
  | 'agent:tokens'    // Token usage updates
  | 'error'

export interface BattleEvent {
  type: BattleEventType
  timestamp: number
  agentId?: string
  message?: string
  data?: Record<string, unknown>
}

// Battle state
export interface BattleState {
  id: string
  status: 'idle' | 'running' | 'finished'
  agents: AgentConfig[]
  towerHealth: number
  startedAt?: number
  finishedAt?: number
}

