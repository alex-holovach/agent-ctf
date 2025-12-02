import { db } from '@/lib/db'
import { games } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { runBattleWorkflow } from '@/lib/battle-workflow'
import { DEFAULT_AGENTS, type AgentConfig, type BattleEvent } from '@/lib/types'

// POST - Start a new battle or stop an existing one
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { action, gameId, agents } = body

    // Stop an existing battle by updating DB status
    if (action === 'stop' && gameId) {
      const [updatedGame] = await db.update(games)
        .set({
          status: 'cancelled',
          finishedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(games.id, gameId))
        .returning()

      if (!updatedGame) {
        return Response.json({ success: false, message: 'Battle not found' }, { status: 404 })
      }

      return Response.json({
        success: true,
        message: 'Battle stop signal sent',
        gameId: updatedGame.id,
      })
    }

    // Start a new battle
    if (action === 'start') {
      const battleAgents: AgentConfig[] = agents || DEFAULT_AGENTS

      // Create game record in DB
      const [game] = await db.insert(games)
        .values({
          status: 'running',
          startedAt: new Date(),
        })
        .returning()

      // Create a ReadableStream for SSE
      const stream = new ReadableStream({
        async start(controller) {
          const encoder = new TextEncoder()

          const emit = (event: BattleEvent) => {
            // Add gameId to all events
            const eventWithGameId = { ...event, data: { ...event.data, gameId: game.id } }
            const data = `data: ${JSON.stringify(eventWithGameId)}\n\n`
            try {
              controller.enqueue(encoder.encode(data))
            } catch {
              // Stream closed, ignore
            }
          }

          try {
            await runBattleWorkflow(game.id, battleAgents, emit)
          } catch (error) {
            emit({
              type: 'error',
              timestamp: Date.now(),
              message: error instanceof Error ? error.message : 'Unknown error',
            })

            // Mark as finished with error
            await db.update(games)
              .set({
                status: 'finished',
                finishedAt: new Date(),
                updatedAt: new Date(),
              })
              .where(eq(games.id, game.id))
          } finally {
            try {
              controller.close()
            } catch {
              // Already closed
            }
          }
        },
      })

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'X-Game-Id': game.id.toString(),
        },
      })
    }

    return Response.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    console.error('Battle API error:', error)
    return Response.json(
      { error: 'Failed to process battle request' },
      { status: 500 }
    )
  }
}

// GET - Get battle status by gameId
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const gameId = searchParams.get('gameId')

  if (!gameId) {
    return Response.json({ error: 'gameId required' }, { status: 400 })
  }

  const [game] = await db.select()
    .from(games)
    .where(eq(games.id, parseInt(gameId)))

  if (!game) {
    return Response.json({ error: 'Battle not found' }, { status: 404 })
  }

  return Response.json({ game })
}
