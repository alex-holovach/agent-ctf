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
  { id: 'agent-1', name: 'GPT-4', model: 'gpt-4o', color: '#10a37f', provider: 'openai' },
  { id: 'agent-2', name: 'Claude', model: 'claude-sonnet-4.5', color: '#d97706', provider: 'anthropic' },
  { id: 'agent-3', name: 'Gemini', model: 'gemini-2.5-pro', color: '#4285f4', provider: 'google' },
  { id: 'agent-4', name: 'Grok', model: 'grok-4', color: '#ef4444', provider: 'xai' },
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

