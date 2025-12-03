"use client"

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

// Medal component for top 3 places
function Medal({ place }: { place: number }) {
  if (place > 3) {
    return null
  }

  const medals = ['🥇', '🥈', '🥉']

  return (
    <span className="text-4xl">
      {medals[place - 1]}
    </span>
  )
}

// Types for game results (single game)
export interface GameResultEntry {
  model: string
  modelColor: string
  damage: number
  place: number
}

// Types for leaderboard (aggregated)
export interface LeaderboardEntry {
  model: string
  modelColor: string
  totalDamage: number
  gamesPlayed: number
  wins: number
  winRate: number
}

interface ResultsTableProps {
  mode: "game" | "leaderboard"
  gameResults?: GameResultEntry[]
  leaderboardData?: LeaderboardEntry[]
}

export function ResultsTable({ mode, gameResults, leaderboardData }: ResultsTableProps) {
  if (mode === "game" && gameResults) {
    return (
      <div className="border border-neutral-800 rounded-lg overflow-hidden bg-neutral-950">
        <Table>
          <TableHeader>
            <TableRow className="border-neutral-800 hover:bg-transparent">
              <TableHead className="font-mono text-[10px] text-neutral-500 uppercase tracking-wide w-16">
                Place
              </TableHead>
              <TableHead className="font-mono text-[10px] text-neutral-500 uppercase tracking-wide">
                Model
              </TableHead>
              <TableHead className="font-mono text-[10px] text-neutral-500 uppercase tracking-wide text-right">
                Damage
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {gameResults.map((result) => (
              <TableRow key={result.model} className="border-neutral-800 hover:bg-neutral-900/50 transition-colors">
                <TableCell>
                  <Medal place={result.place} />
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: result.modelColor }} />
                    <span className="font-mono font-bold text-sm text-neutral-200">{result.model}</span>
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <span className="font-mono text-sm text-neutral-200">
                    {result.damage.toLocaleString()}
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    )
  }

  if (mode === "leaderboard" && leaderboardData) {
    return (
      <div className="border border-neutral-800 rounded-lg overflow-hidden bg-neutral-950">
        <Table>
          <TableHeader>
            <TableRow className="border-neutral-800 hover:bg-transparent">
              <TableHead className="font-mono text-[10px] text-neutral-500 uppercase tracking-wide w-16">
                Rank
              </TableHead>
              <TableHead className="font-mono text-[10px] text-neutral-500 uppercase tracking-wide">
                Model
              </TableHead>
              <TableHead className="font-mono text-[10px] text-neutral-500 uppercase tracking-wide text-right">
                Total Damage
              </TableHead>
              <TableHead className="font-mono text-[10px] text-neutral-500 uppercase tracking-wide text-right">
                Games Played
              </TableHead>
              <TableHead className="font-mono text-[10px] text-neutral-500 uppercase tracking-wide text-right">
                Wins
              </TableHead>
              <TableHead className="font-mono text-[10px] text-neutral-500 uppercase tracking-wide text-right">
                Win Rate
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {leaderboardData.map((entry, index) => {
              // Win rate color: purple > 60%, green > 50%, orange > 40%, red otherwise
              const winRateColor = entry.winRate > 60
                ? "#a855f7" // purple
                : entry.winRate > 50
                  ? "#22c55e" // green
                  : entry.winRate > 40
                    ? "#f97316" // orange
                    : "#ef4444" // red

              return (
                <TableRow key={entry.model} className="border-neutral-800 hover:bg-neutral-900/50 transition-colors">
                  <TableCell>
                    <Medal place={index + 1} />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.modelColor }} />
                      <span className="font-mono font-bold text-sm text-neutral-200">{entry.model}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="font-mono text-sm text-neutral-200">
                      {entry.totalDamage.toLocaleString()}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="font-mono text-sm text-neutral-200">{entry.gamesPlayed}</span>
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="font-mono text-sm font-bold text-neutral-200">{entry.wins}</span>
                  </TableCell>
                  <TableCell className="text-right">
                    <span
                      className="font-mono text-sm font-bold"
                      style={{ color: winRateColor }}
                    >
                      {entry.winRate.toFixed(1)}%
                    </span>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    )
  }

  return null
}
