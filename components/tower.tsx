"use client"

import { Progress } from "./ui/progress"
import { Shield, AlertTriangle } from "lucide-react"

interface TowerProps {
  health: number
  active: boolean
}

export function Tower({ health, active }: TowerProps) {
  const isDanger = health < 30
  const isWarning = health < 60

  return (
    <div className="flex flex-col items-center gap-4">
      {/* Tower structure */}
      <div
        className={`relative flex flex-col items-center transition-all duration-300 ${active ? "animate-pulse" : ""}`}
      >
        {/* Top */}
        <div
          className={`w-24 h-8 bg-gradient-to-b from-destructive to-destructive/80 rounded-t-lg border-2 border-destructive ${
            health > 0 ? "glow-destructive" : "opacity-50"
          }`}
        />

        {/* Middle */}
        <div
          className={`w-32 h-32 bg-gradient-to-b from-destructive/80 to-destructive border-2 border-destructive relative ${
            health > 0 ? "glow-destructive" : "opacity-50"
          }`}
        >
          <div className="absolute inset-0 flex items-center justify-center">
            <Shield
              className={`w-16 h-16 ${
                isDanger ? "text-destructive-foreground animate-bounce" : "text-destructive-foreground"
              }`}
            />
          </div>

          {/* Windows */}
          <div className="absolute top-4 left-4 w-4 h-4 bg-orange-500/50 rounded-sm" />
          <div className="absolute top-4 right-4 w-4 h-4 bg-orange-500/50 rounded-sm" />
          <div className="absolute bottom-4 left-4 w-4 h-4 bg-orange-500/50 rounded-sm" />
          <div className="absolute bottom-4 right-4 w-4 h-4 bg-orange-500/50 rounded-sm" />
        </div>

        {/* Base */}
        <div
          className={`w-40 h-12 bg-gradient-to-b from-destructive to-destructive/60 rounded-b-lg border-2 border-destructive border-t-0 ${
            health > 0 ? "glow-destructive" : "opacity-50"
          }`}
        />

        {/* Warning indicator */}
        {isDanger && health > 0 && (
          <div className="absolute -top-12">
            <AlertTriangle className="w-8 h-8 text-destructive animate-bounce" />
          </div>
        )}
      </div>

      {/* Health bar */}
      <div className="flex flex-col items-center gap-2 min-w-[200px]">
        <div className="flex items-center justify-between w-full">
          <span className="text-xs font-mono text-muted-foreground">TOWER INTEGRITY</span>
          <span
            className={`text-sm font-bold font-mono ${
              isDanger ? "text-destructive" : isWarning ? "text-accent" : "text-primary"
            }`}
          >
            {health}%
          </span>
        </div>
        <Progress
          value={health}
          className="h-3"
          indicatorClassName={isDanger ? "bg-destructive" : isWarning ? "bg-accent" : "bg-primary"}
        />
      </div>

      {/* Status */}
      <div
        className={`px-4 py-2 rounded-full border text-xs font-mono font-bold ${
          health <= 0
            ? "border-destructive text-destructive bg-destructive/10"
            : active
              ? "border-primary text-primary bg-primary/10 glow-primary"
              : "border-muted-foreground text-muted-foreground bg-muted/10"
        }`}
      >
        {health <= 0 ? "DEFEATED" : active ? "UNDER ATTACK" : "IDLE"}
      </div>
    </div>
  )
}
