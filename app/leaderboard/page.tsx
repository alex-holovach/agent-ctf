"use client"

import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ArrowLeft } from "lucide-react"

const mockLeaderboardData = [
  {
    id: "gpt4",
    name: "GPT-4",
    color: "#10B981",
    gamesPlayed: 127,
    wins: 89,
    totalDamage: 1250340,
    tokensSpent: 4567890,
    cost: 45.68,
  },
  {
    id: "claude",
    name: "Claude",
    color: "#3B82F6",
    gamesPlayed: 115,
    wins: 76,
    totalDamage: 1098230,
    tokensSpent: 3892450,
    cost: 38.92,
  },
  {
    id: "gemini",
    name: "Gemini",
    color: "#F59E0B",
    gamesPlayed: 132,
    wins: 71,
    totalDamage: 987650,
    tokensSpent: 3245670,
    cost: 16.23,
  },
  {
    id: "grok",
    name: "Grok",
    color: "#EF4444",
    gamesPlayed: 98,
    wins: 54,
    totalDamage: 876540,
    tokensSpent: 2987340,
    cost: 29.87,
  },
]

export default function LeaderboardPage() {
  const sortedAgents = [...mockLeaderboardData].sort((a, b) => b.totalDamage - a.totalDamage)

  return (
    <div className="min-h-screen bg-black">
      {/* Header */}
      <div className="border-b border-neutral-800 bg-black">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-4">
            <Link href="/">
              <Button variant="ghost" size="sm" className="h-10 w-10 p-0 hover:bg-neutral-900">
                <ArrowLeft className="h-6 w-6 text-neutral-400" />
              </Button>
            </Link>
            <h1 className="text-sm font-mono font-bold text-neutral-200 uppercase tracking-wide">Battle Leaderboard</h1>
          </div>
        </div>
      </div>

      {/* Leaderboard Content */}
      <div className="w-full h-[calc(100vh-73px)] overflow-y-auto p-8">
        <div className="max-w-7xl mx-auto">
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
                    Win Rate
                  </TableHead>
                  <TableHead className="font-mono text-[10px] text-neutral-500 uppercase tracking-wide text-right">
                    Tokens Spent
                  </TableHead>
                  <TableHead className="font-mono text-[10px] text-neutral-500 uppercase tracking-wide text-right">
                    Cost
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedAgents.map((agent, index) => {
                  const winRate = (agent.wins / agent.gamesPlayed) * 100
                  return (
                    <TableRow key={agent.id} className="border-neutral-800 hover:bg-neutral-900/50 transition-colors">
                      <TableCell>
                        <div
                          className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold font-mono"
                          style={{ backgroundColor: `${agent.color}20`, color: agent.color }}
                        >
                          {index + 1}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: agent.color }} />
                          <span className="font-mono font-bold text-sm text-neutral-200">{agent.name}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="font-mono text-lg font-bold text-neutral-200">
                          {agent.totalDamage.toLocaleString()}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="font-mono text-sm text-neutral-300">{agent.gamesPlayed}</span>
                      </TableCell>
                      <TableCell className="text-right">
                        <span
                          className="font-mono text-sm font-bold"
                          style={{
                            color: winRate > 60 ? agent.color : "#737373",
                          }}
                        >
                          {winRate.toFixed(1)}%
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="font-mono text-sm text-neutral-300">{agent.tokensSpent.toLocaleString()}</span>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="font-mono text-sm text-neutral-300">${agent.cost.toFixed(2)}</span>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>

          <div className="grid grid-cols-4 gap-4 mt-8">
            <div className="border border-neutral-800 rounded-lg bg-neutral-950 p-4">
              <div className="text-[10px] font-mono text-neutral-600 uppercase tracking-wide mb-1">Total Games</div>
              <div className="text-xl font-mono font-bold text-neutral-200">
                {sortedAgents.reduce((sum, agent) => sum + agent.gamesPlayed, 0).toLocaleString()}
              </div>
            </div>
            <div className="border border-neutral-800 rounded-lg bg-neutral-950 p-4">
              <div className="text-[10px] font-mono text-neutral-600 uppercase tracking-wide mb-1">Total Damage</div>
              <div className="text-xl font-mono font-bold text-neutral-200">
                {sortedAgents.reduce((sum, agent) => sum + agent.totalDamage, 0).toLocaleString()}
              </div>
            </div>
            <div className="border border-neutral-800 rounded-lg bg-neutral-950 p-4">
              <div className="text-[10px] font-mono text-neutral-600 uppercase tracking-wide mb-1">Total Tokens</div>
              <div className="text-xl font-mono font-bold text-neutral-200">
                {sortedAgents.reduce((sum, agent) => sum + agent.tokensSpent, 0).toLocaleString()}
              </div>
            </div>
            <div className="border border-neutral-800 rounded-lg bg-neutral-950 p-4">
              <div className="text-[10px] font-mono text-neutral-600 uppercase tracking-wide mb-1">Total Cost</div>
              <div className="text-xl font-mono font-bold text-neutral-200">
                ${sortedAgents.reduce((sum, agent) => sum + agent.cost, 0).toFixed(2)}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
