"use client"

import { useState, useEffect } from "react"
import { Tower } from "./tower"
import { LLMAgent } from "./llm-agent"
import { AttackAnimation } from "./attack-animation"
import { Scoreboard } from "./scoreboard"
import { Button } from "./ui/button"

interface Agent {
  id: string
  name: string
  score: number
  color: string
  position: { x: number; y: number }
}

interface Attack {
  id: string
  from: string
  timestamp: number
  payload: string
}

export function BattleArena() {
  const [towerHealth, setTowerHealth] = useState(100)
  const [gameActive, setGameActive] = useState(false)
  const [attacks, setAttacks] = useState<Attack[]>([])
  const [agents, setAgents] = useState<Agent[]>([
    { id: "llm-1", name: "GPT-Hunter", score: 0, color: "from-cyan-500 to-blue-500", position: { x: 15, y: 30 } },
    { id: "llm-2", name: "Claude-Striker", score: 0, color: "from-pink-500 to-purple-500", position: { x: 15, y: 70 } },
    {
      id: "llm-3",
      name: "Gemini-Breaker",
      score: 0,
      color: "from-green-500 to-emerald-500",
      position: { x: 85, y: 50 },
    },
  ])

  const startGame = () => {
    setGameActive(true)
    setTowerHealth(100)
    setAgents((prev) => prev.map((agent) => ({ ...agent, score: 0 })))
    setAttacks([])
  }

  const stopGame = () => {
    setGameActive(false)
  }

  useEffect(() => {
    if (!gameActive || towerHealth <= 0) return

    const interval = setInterval(() => {
      // Random agent attacks
      const randomAgent = agents[Math.floor(Math.random() * agents.length)]
      const attackPayloads = [
        "POST /api/tower",
        "GET /vulnerable",
        "DELETE /defense",
        "PUT /exploit",
        "PATCH /backdoor",
      ]

      const newAttack: Attack = {
        id: `${randomAgent.id}-${Date.now()}`,
        from: randomAgent.id,
        timestamp: Date.now(),
        payload: attackPayloads[Math.floor(Math.random() * attackPayloads.length)],
      }

      setAttacks((prev) => [...prev, newAttack])

      // Damage tower
      const damage = Math.floor(Math.random() * 8) + 3
      setTowerHealth((prev) => Math.max(0, prev - damage))

      // Update agent score
      setAgents((prev) =>
        prev.map((agent) => (agent.id === randomAgent.id ? { ...agent, score: agent.score + damage } : agent)),
      )

      // Clean old attacks
      setTimeout(() => {
        setAttacks((prev) => prev.filter((a) => a.id !== newAttack.id))
      }, 2000)
    }, 800)

    return () => clearInterval(interval)
  }, [gameActive, towerHealth, agents])

  useEffect(() => {
    if (towerHealth <= 0 && gameActive) {
      setGameActive(false)
    }
  }, [towerHealth, gameActive])

  return (
    <div className="relative w-full h-screen overflow-hidden">
      {/* Grid background */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,oklch(0.25_0.04_240_/_0.1)_1px,transparent_1px),linear-gradient(to_bottom,oklch(0.25_0.04_240_/_0.1)_1px,transparent_1px)] bg-[size:4rem_4rem]" />

      {/* Header */}
      <div className="relative z-10 flex items-center justify-between px-8 py-6 border-b border-border bg-card/50 backdrop-blur">
        <div>
          <h1 className="text-3xl font-bold text-balance bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
            LLM vs Tower
          </h1>
          <p className="text-sm text-muted-foreground font-mono">Autonomous AI Battle Arena</p>
        </div>
        <div className="flex gap-4">
          {!gameActive ? (
            <Button onClick={startGame} className="glow-primary">
              Start Battle
            </Button>
          ) : (
            <Button onClick={stopGame} variant="destructive" className="glow-destructive">
              Stop Battle
            </Button>
          )}
        </div>
      </div>

      {/* Battle Arena */}
      <div className="relative h-[calc(100vh-120px)]">
        {/* Tower in center */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <Tower health={towerHealth} active={gameActive} />
        </div>

        {/* LLM Agents */}
        {agents.map((agent) => (
          <div
            key={agent.id}
            className="absolute"
            style={{
              left: `${agent.position.x}%`,
              top: `${agent.position.y}%`,
              transform: "translate(-50%, -50%)",
            }}
          >
            <LLMAgent name={agent.name} score={agent.score} color={agent.color} active={gameActive} />
          </div>
        ))}

        {/* Attack animations */}
        {attacks.map((attack) => {
          const agent = agents.find((a) => a.id === attack.from)
          if (!agent) return null

          return (
            <AttackAnimation
              key={attack.id}
              from={agent.position}
              to={{ x: 50, y: 50 }}
              color={agent.color}
              payload={attack.payload}
            />
          )
        })}
      </div>

      {/* Scoreboard */}
      <Scoreboard agents={agents} gameActive={gameActive} />
    </div>
  )
}
