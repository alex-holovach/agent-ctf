import { runBattleWorkflow } from '@/lib/battle-workflow'
import { DEFAULT_AGENTS, type AgentConfig, type BattleEvent } from '@/lib/types'

// Store active battles for abort functionality
const activeBattles = new Map<string, AbortController>()

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { action, battleId, agents } = body

    if (action === 'stop' && battleId) {
      const controller = activeBattles.get(battleId)
      if (controller) {
        controller.abort()
        activeBattles.delete(battleId)
        return Response.json({ success: true, message: 'Battle stopped' })
      }
      return Response.json({ success: false, message: 'Battle not found' }, { status: 404 })
    }

    // Start a new battle with streaming
    const battleAgents: AgentConfig[] = agents || DEFAULT_AGENTS
    const newBattleId = `battle-${Date.now()}`
    const abortController = new AbortController()
    activeBattles.set(newBattleId, abortController)

    // Create a ReadableStream for SSE
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder()
        
        const emit = (event: BattleEvent) => {
          const data = `data: ${JSON.stringify(event)}\n\n`
          controller.enqueue(encoder.encode(data))
        }

        // Send battle ID first
        emit({
          type: 'battle:start',
          timestamp: Date.now(),
          message: 'Battle initialized',
          data: { battleId: newBattleId },
        })

        try {
          await runBattleWorkflow(battleAgents, emit, abortController.signal)
        } catch (error) {
          emit({
            type: 'error',
            timestamp: Date.now(),
            message: error instanceof Error ? error.message : 'Unknown error',
          })
        } finally {
          activeBattles.delete(newBattleId)
          controller.close()
        }
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    })
  } catch (error) {
    console.error('Battle API error:', error)
    return Response.json(
      { error: 'Failed to process battle request' },
      { status: 500 }
    )
  }
}

export async function GET() {
  // Return list of active battles
  const battles = Array.from(activeBattles.keys())
  return Response.json({ activeBattles: battles })
}

