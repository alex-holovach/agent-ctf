import { db } from '@/lib/db'
import { games, gameEvents } from '@/lib/db/schema'
import { eq, gt, asc } from 'drizzle-orm'
import { runBattleWorkflow } from '@/lib/battle-workflow'
import { killTowerSandbox } from '@/lib/sandbox'
import { DEFAULT_AGENTS, type AgentConfig, type BattleEvent } from '@/lib/types'

// POST - Start a new battle or stop an existing one
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { action, gameId, agents } = body

    // Stop an existing battle
    if (action === 'stop' && gameId) {
      // Kill the sandbox first
      try {
        await killTowerSandbox(gameId)
      } catch (error) {
        console.error('Failed to kill sandbox:', error)
      }

      const [updatedGame] = await db.update(games)
        .set({
          status: 'cancelled',
          sandboxId: null,
          sandboxUrl: null,
          finishedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(games.id, gameId))
        .returning()

      if (!updatedGame) {
        return Response.json({ error: 'Battle not found' }, { status: 404 })
      }

      return Response.json({
        success: true,
        gameId: updatedGame.id,
        status: 'cancelled',
      })
    }

    // Start a new battle
    const battleAgents: AgentConfig[] = agents || DEFAULT_AGENTS

    // Create game record in DB
    const [game] = await db.insert(games)
      .values({
        status: 'running',
        startedAt: new Date(),
      })
      .returning()

    // Run workflow in background (fire and forget)
    // The workflow stores events in DB, so client can reconnect anytime
    runBattleWorkflow(game.id, battleAgents).catch(async (error) => {
      console.error('Battle workflow error:', error)
      await db.update(games)
        .set({
          status: 'finished',
          finishedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(games.id, game.id))
    })

    // Return game ID immediately - client will connect to stream separately
    return Response.json({
      success: true,
      gameId: game.id,
      status: 'running',
    })
  } catch (error) {
    console.error('Battle API error:', error)
    return Response.json(
      { error: 'Failed to process battle request' },
      { status: 500 }
    )
  }
}

// GET - Get battle status or stream events
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const gameId = searchParams.get('gameId')
  const stream = searchParams.get('stream') === 'true'
  const lastEventId = searchParams.get('lastEventId')

  if (!gameId) {
    return Response.json({ error: 'gameId required' }, { status: 400 })
  }

  const gameIdNum = parseInt(gameId)

  // Get game status
  const [game] = await db.select()
    .from(games)
    .where(eq(games.id, gameIdNum))

  if (!game) {
    return Response.json({ error: 'Battle not found' }, { status: 404 })
  }

  // If not streaming, just return status and all events
  if (!stream) {
    const events = await db.select()
      .from(gameEvents)
      .where(eq(gameEvents.gameId, gameIdNum))
      .orderBy(asc(gameEvents.id))

    return Response.json({
      game,
      events: events.map(e => ({
        id: e.id,
        type: e.type,
        agentId: e.agentId,
        message: e.message,
        data: e.data,
        timestamp: e.createdAt?.getTime(),
      })),
    })
  }

  // Streaming mode - SSE for real-time updates
  const encoder = new TextEncoder()
  let lastSeenId = lastEventId ? parseInt(lastEventId) : 0

  const stream2 = new ReadableStream({
    async start(controller) {
      const sendEvent = (event: BattleEvent & { id?: number }) => {
        const data = `data: ${JSON.stringify(event)}\n\n`
        try {
          controller.enqueue(encoder.encode(data))
        } catch {
          // Stream closed
        }
      }

      // First, send any events we missed (for resumability)
      const missedEvents = await db.select()
        .from(gameEvents)
        .where(eq(gameEvents.gameId, gameIdNum))
        .orderBy(asc(gameEvents.id))

      for (const event of missedEvents) {
        if (event.id > lastSeenId) {
          sendEvent({
            id: event.id,
            type: event.type as BattleEvent['type'],
            agentId: event.agentId ?? undefined,
            message: event.message ?? undefined,
            data: event.data as Record<string, unknown> | undefined,
            timestamp: event.createdAt?.getTime() ?? Date.now(),
          })
          lastSeenId = event.id
        }
      }

      // Poll for new events until game is done
      const pollInterval = setInterval(async () => {
        try {
          // Check game status
          const [currentGame] = await db.select({ status: games.status })
            .from(games)
            .where(eq(games.id, gameIdNum))

          // Fetch new events
          const newEvents = await db.select()
            .from(gameEvents)
            .where(eq(gameEvents.gameId, gameIdNum))
            .orderBy(asc(gameEvents.id))

          for (const event of newEvents) {
            if (event.id > lastSeenId) {
              sendEvent({
                id: event.id,
                type: event.type as BattleEvent['type'],
                agentId: event.agentId ?? undefined,
                message: event.message ?? undefined,
                data: event.data as Record<string, unknown> | undefined,
                timestamp: event.createdAt?.getTime() ?? Date.now(),
              })
              lastSeenId = event.id
            }
          }

          // If game is done, close the stream
          if (currentGame?.status !== 'running') {
            clearInterval(pollInterval)
            controller.close()
          }
        } catch {
          clearInterval(pollInterval)
          controller.close()
        }
      }, 500) // Poll every 500ms

      // Cleanup on abort
      request.signal.addEventListener('abort', () => {
        clearInterval(pollInterval)
        try {
          controller.close()
        } catch {
          // Already closed
        }
      })
    },
  })

  return new Response(stream2, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}
