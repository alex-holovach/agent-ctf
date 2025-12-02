"use client"

import { Card } from "./ui/card"
import { Trophy, Target } from "lucide-react"

interface Agent {
  id: string
  name: string
  score: number
  color: string
}

interface ScoreboardProps {
  agents: Agent[]
  gameActive: boolean
}

export function Scoreboard({ agents, gameActive }: ScoreboardProps) {
  const sortedAgents = [...agents].sort((a, b) => b.score - a.score)
  const winner = sortedAgents[0]

  return (
    <Card className="absolute bottom-8 right-8 p-6 min-w-[300px] border-2 border-primary/50 bg-card/95 backdrop-blur">
      <div className="flex items-center gap-3 mb-4">
        <Trophy className="w-6 h-6 text-accent" />
        <h2 className="text-xl font-bold font-mono">Leaderboard</h2>
      </div>

      <div className="space-y-3">
        {sortedAgents.map((agent, index) => (
          <div
            key={agent.id}
            className={`flex items-center justify-between p-3 rounded-lg transition-all ${
              index === 0 && agent.score > 0 ? "bg-accent/20 border border-accent/50" : "bg-secondary/50"
            }`}
          >
            <div className="flex items-center gap-3">
              <div
                className={`w-8 h-8 rounded-full bg-gradient-to-br ${agent.color} flex items-center justify-center text-xs font-bold text-primary-foreground`}
              >
                #{index + 1}
              </div>
              <div>
                <div className="font-bold text-sm font-mono">{agent.name}</div>
                <div className="text-xs text-muted-foreground font-mono">
                  {index === 0 && agent.score > 0 && !gameActive ? "👑 WINNER" : "AI Agent"}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Target className="w-4 h-4 text-muted-foreground" />
              <span
                className={`text-lg font-bold font-mono bg-gradient-to-r ${agent.color} bg-clip-text text-transparent`}
              >
                {agent.score}
              </span>
            </div>
          </div>
        ))}
      </div>

      {!gameActive && winner.score > 0 && (
        <div className="mt-4 p-3 rounded-lg bg-accent/10 border border-accent/50 text-center">
          <p className="text-sm font-mono text-accent font-bold">🎉 {winner.name} dominated the battlefield!</p>
        </div>
      )}
    </Card>
  )
}
