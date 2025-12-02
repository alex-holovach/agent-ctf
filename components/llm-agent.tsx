"use client"

import { Card } from "./ui/card"
import { Cpu, Zap } from "lucide-react"

interface LLMAgentProps {
  name: string
  score: number
  color: string
  active: boolean
}

export function LLMAgent({ name, score, color, active }: LLMAgentProps) {
  return (
    <Card className={`p-4 min-w-[180px] border-2 relative overflow-hidden ${active ? "animate-pulse" : ""}`}>
      {/* Gradient overlay */}
      <div className={`absolute inset-0 bg-gradient-to-br ${color} opacity-10`} />

      <div className="relative flex flex-col items-center gap-3">
        {/* Agent icon */}
        <div
          className={`relative w-16 h-16 rounded-full bg-gradient-to-br ${color} flex items-center justify-center ${
            active ? "glow-primary" : ""
          }`}
        >
          <Cpu className="w-8 h-8 text-primary-foreground" />
          {active && (
            <div className="absolute -top-1 -right-1">
              <Zap className="w-5 h-5 text-accent animate-bounce" />
            </div>
          )}
        </div>

        {/* Name */}
        <div className="text-center">
          <h3 className="font-bold text-sm font-mono text-balance">{name}</h3>
          <p className="text-xs text-muted-foreground font-mono">AI Agent</p>
        </div>

        {/* Score */}
        <div className="flex flex-col items-center gap-1 w-full">
          <span className="text-xs text-muted-foreground font-mono">DAMAGE DEALT</span>
          <span className={`text-2xl font-bold font-mono bg-gradient-to-r ${color} bg-clip-text text-transparent`}>
            {score}
          </span>
        </div>

        {/* Status indicator */}
        <div className={`w-full h-1 rounded-full ${active ? `bg-gradient-to-r ${color}` : "bg-muted"}`} />
      </div>
    </Card>
  )
}
