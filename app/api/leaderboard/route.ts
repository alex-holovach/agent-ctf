import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { gameResults } from '@/lib/db/schema'
import { sql, eq } from 'drizzle-orm'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const gameId = searchParams.get('gameId')

  // If gameId is provided, return results for that specific game
  if (gameId) {
    try {
      const results = await db
        .select()
        .from(gameResults)
        .where(eq(gameResults.gameId, parseInt(gameId)))
        .orderBy(gameResults.place)

      const gameResultsData = results.map(r => ({
        model: r.model,
        modelColor: r.modelColor || '#888888',
        damage: r.damage,
        place: r.place,
      }))

      return NextResponse.json({ results: gameResultsData })
    } catch (error) {
      console.error('Failed to fetch game results:', error)
      return NextResponse.json(
        { error: 'Failed to fetch game results' },
        { status: 500 }
      )
    }
  }

  // Otherwise return aggregated leaderboard
  try {
    // Aggregate results by model
    const results = await db
      .select({
        model: gameResults.model,
        modelColor: gameResults.modelColor,
        totalDamage: sql<number>`SUM(${gameResults.damage})`.as('total_damage'),
        gamesPlayed: sql<number>`COUNT(*)`.as('games_played'),
        wins: sql<number>`SUM(CASE WHEN ${gameResults.place} = 1 THEN 1 ELSE 0 END)`.as('wins'),
      })
      .from(gameResults)
      .groupBy(gameResults.model, gameResults.modelColor)
      .orderBy(sql`total_damage DESC`)

    // Calculate win rate and format response
    const leaderboardData = results.map(entry => ({
      model: entry.model,
      modelColor: entry.modelColor || '#888888',
      totalDamage: Number(entry.totalDamage) || 0,
      gamesPlayed: Number(entry.gamesPlayed) || 0,
      wins: Number(entry.wins) || 0,
      winRate: entry.gamesPlayed > 0
        ? (Number(entry.wins) / Number(entry.gamesPlayed)) * 100
        : 0,
    })).sort((a, b) => b.winRate - a.winRate)

    // Calculate summary stats
    const summary = {
      totalGames: leaderboardData.length > 0
        ? Math.max(...leaderboardData.map(d => d.gamesPlayed))
        : 0,
      totalDamage: leaderboardData.reduce((sum, d) => sum + d.totalDamage, 0),
    }

    return NextResponse.json({
      leaderboard: leaderboardData,
      summary,
    })
  } catch (error) {
    console.error('Failed to fetch leaderboard:', error)
    return NextResponse.json(
      { error: 'Failed to fetch leaderboard data' },
      { status: 500 }
    )
  }
}
