import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { games, agents } from "@/lib/db/schema"
import { eq, desc } from "drizzle-orm"

const INITIAL_AGENTS = [
  { name: "GPT-4", color: "#10b981" },
  { name: "Claude", color: "#f59e0b" },
  { name: "Gemini", color: "#3b82f6" },
  { name: "Grok", color: "#ef4444" },
]

export async function GET() {
  try {
    const [latestGame] = await db.select().from(games).orderBy(desc(games.id)).limit(1)

    if (!latestGame) {
      return NextResponse.json({ game: null })
    }

    // Get agents for this game
    const gameAgents = await db.select().from(agents).where(eq(agents.gameId, latestGame.id))

    return NextResponse.json({ game: latestGame, agents: gameAgents })
  } catch (error) {
    console.error("[v0] Error fetching game:", error)
    return NextResponse.json(
      {
        error: "Failed to fetch game",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    )
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { action } = body

    if (action === "start") {
      // Create a new game
      const [game] = await db
        .insert(games)
        .values({
          status: "running",
          startedAt: new Date(),
        })
        .returning()

      // Create agents for this game
      const agentRecords = await Promise.all(
        INITIAL_AGENTS.map((agent) =>
          db
            .insert(agents)
            .values({
              gameId: game.id,
              name: agent.name,
              color: agent.color,
            })
            .returning(),
        ),
      )

      return NextResponse.json({ game, agents: agentRecords.flat() })
    }

    if (action === "stop") {
      const { gameId } = body

      // Update game status
      const [updatedGame] = await db
        .update(games)
        .set({
          status: "finished",
          finishedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(games.id, gameId))
        .returning()

      return NextResponse.json({ game: updatedGame })
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 })
  } catch (error) {
    console.error("Error managing game:", error)
    return NextResponse.json(
      { error: "Failed to manage game", details: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    )
  }
}

export async function PATCH(request: Request) {
  try {
    const { gameId, towerHealth, towerCpu, towerMemory, towerRequests } = await request.json()

    const [updatedGame] = await db
      .update(games)
      .set({
        towerHealth,
        towerCpu,
        towerMemory,
        towerRequests,
        updatedAt: new Date(),
      })
      .where(eq(games.id, gameId))
      .returning()

    return NextResponse.json({ game: updatedGame })
  } catch (error) {
    console.error("Error updating game:", error)
    return NextResponse.json({ error: "Failed to update game" }, { status: 500 })
  }
}
