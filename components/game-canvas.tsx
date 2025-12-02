"use client"

import { useEffect, useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import Link from "next/link"
import useSWR from "swr"

interface Agent {
  id: string
  name: string
  score: number
  color: string
  terminalLogs: string[]
  thinking: string
  totalRequests: number
  successfulExploits: number
  portDiscovered: boolean
  vulnerabilitiesFound: string[]
  x: number
  y: number
}

interface TowerMetrics {
  cpu: number
  memory: number
  requests: number
  terminalLogs: string[]
  attackHistory: { timestamp: string; agent: string; damage: number; payload: string }[]
}

interface Attack {
  id: string
  fromAgent: string
  progress: number
  payload: string
}

const fetcher = (url: string) => fetch(url).then((res) => res.json())

export function GameCanvas() {
  const { data: gameData, mutate } = useSWR("/api/game", fetcher, {
    refreshInterval: 1000,
    revalidateOnFocus: true,
  })

  const [currentGameId, setCurrentGameId] = useState<number | null>(null)
  const [battleStarted, setBattleStarted] = useState(false)
  const [towerHealth, setTowerHealth] = useState(100)
  const [agents, setAgents] = useState<Agent[]>([
    {
      id: "llm-1",
      name: "GPT-4",
      score: 0,
      color: "#10a37f",
      terminalLogs: [],
      thinking: "",
      totalRequests: 0,
      successfulExploits: 0,
      portDiscovered: false,
      vulnerabilitiesFound: [],
      x: 0.3,
      y: 0.25,
    },
    {
      id: "llm-2",
      name: "Claude",
      score: 0,
      color: "#d97706",
      terminalLogs: [],
      thinking: "",
      totalRequests: 0,
      successfulExploits: 0,
      portDiscovered: false,
      vulnerabilitiesFound: [],
      x: 0.7,
      y: 0.25,
    },
    {
      id: "llm-3",
      name: "Gemini",
      score: 0,
      color: "#4285f4",
      terminalLogs: [],
      thinking: "",
      totalRequests: 0,
      successfulExploits: 0,
      portDiscovered: false,
      vulnerabilitiesFound: [],
      x: 0.3,
      y: 0.75,
    },
    {
      id: "llm-4",
      name: "Grok",
      score: 0,
      color: "#ef4444",
      terminalLogs: [],
      thinking: "",
      totalRequests: 0,
      successfulExploits: 0,
      portDiscovered: false,
      vulnerabilitiesFound: [],
      x: 0.7,
      y: 0.75,
    },
  ])
  const [towerMetrics, setTowerMetrics] = useState<TowerMetrics>({
    cpu: 0,
    memory: 0,
    requests: 0,
    terminalLogs: [],
    attackHistory: [],
  })
  const [attacks, setAttacks] = useState<Attack[]>([])

  useEffect(() => {
    if (gameData?.game) {
      const game = gameData.game
      setCurrentGameId(game.id)
      setBattleStarted(game.status === "running")
      setTowerHealth(game.towerHealth)

      if (game.agents && game.agents.length > 0) {
        setAgents((prev) =>
          prev.map((agent, index) => {
            const dbAgent = game.agents[index]
            if (dbAgent) {
              return {
                ...agent,
                id: dbAgent.id.toString(),
                score: dbAgent.score,
                totalRequests: dbAgent.totalRequests,
                successfulExploits: dbAgent.successfulExploits,
                portDiscovered: dbAgent.portDiscovered,
                vulnerabilitiesFound: dbAgent.vulnerabilitiesFound || [],
              }
            }
            return agent
          }),
        )
      }

      setTowerMetrics((prev) => ({
        ...prev,
        cpu: game.towerCpu,
        memory: game.towerMemory,
        requests: game.towerRequests,
      }))
    }
  }, [gameData])

  useEffect(() => {
    if (!battleStarted) return

    const thinkingMessages = [
      "Analyzing tower response patterns...",
      "Scanning for open ports...",
      "Testing payload variants...",
      "Calculating optimal attack vector...",
      "Detecting vulnerabilities...",
      "Adjusting strategy...",
      "Probing defense mechanisms...",
      "Optimizing request timing...",
    ]

    const interval = setInterval(() => {
      setAgents((prev) =>
        prev.map((agent) => ({
          ...agent,
          thinking: thinkingMessages[Math.floor(Math.random() * thinkingMessages.length)],
        })),
      )
    }, 2000)

    return () => clearInterval(interval)
  }, [battleStarted])

  useEffect(() => {
    if (!battleStarted || towerHealth <= 0) return

    const interval = setInterval(() => {
      const randomAgent = agents[Math.floor(Math.random() * agents.length)]
      const attackPayloads = [
        "POST /api/tower",
        "GET /vulnerable",
        "DELETE /defense",
        "PUT /exploit",
        "PATCH /backdoor",
      ]

      const vulnerabilities = [
        "SQL Injection",
        "XSS Attack",
        "CSRF Token Bypass",
        "API Rate Limit Bypass",
        "Auth Header Exploit",
      ]

      const damage = Math.floor(Math.random() * 8) + 3
      const payload = attackPayloads[Math.floor(Math.random() * attackPayloads.length)]
      const timestamp = new Date().toLocaleTimeString("en-US", { hour12: false })

      const attack: Attack = {
        id: `${randomAgent.id}-${Date.now()}`,
        fromAgent: randomAgent.id,
        progress: 0,
        payload,
      }

      setAttacks((prev) => [...prev, attack])

      setAgents((prev) =>
        prev.map((agent) => {
          if (agent.id === randomAgent.id) {
            const newLog = `[${timestamp}] Executing ${payload} -> DMG: ${damage}`
            const isExploit = Math.random() > 0.7
            const foundVulnerability = isExploit
              ? vulnerabilities[Math.floor(Math.random() * vulnerabilities.length)]
              : null
            const discoveredPort = !agent.portDiscovered && Math.random() > 0.85

            return {
              ...agent,
              score: agent.score + damage,
              terminalLogs: [...agent.terminalLogs.slice(-5), newLog],
              totalRequests: agent.totalRequests + 1,
              successfulExploits: agent.successfulExploits + (isExploit ? 1 : 0),
              portDiscovered: agent.portDiscovered || discoveredPort,
              vulnerabilitiesFound:
                foundVulnerability && !agent.vulnerabilitiesFound.includes(foundVulnerability)
                  ? [...agent.vulnerabilitiesFound, foundVulnerability]
                  : agent.vulnerabilitiesFound,
            }
          }
          return agent
        }),
      )

      setTowerMetrics((prev) => {
        const newLog = `[${timestamp}] Incoming ${payload} from ${randomAgent.name} - DMG: ${damage}`
        const newCpu = Math.min(95, prev.cpu + Math.random() * 5)
        const newMemory = Math.min(90, prev.memory + Math.random() * 3)

        const newAttack = {
          timestamp,
          agent: randomAgent.name,
          damage,
          payload,
        }

        return {
          cpu: newCpu,
          memory: newMemory,
          requests: prev.requests + 1,
          terminalLogs: [...prev.terminalLogs.slice(-8), newLog],
          attackHistory: [...prev.attackHistory.slice(-10), newAttack],
        }
      })

      setTowerHealth((prev) => Math.max(0, prev - damage))
    }, 800)

    return () => clearInterval(interval)
  }, [battleStarted, towerHealth, agents])

  useEffect(() => {
    if (towerHealth <= 0 && battleStarted) {
      setBattleStarted(false)
    }
  }, [towerHealth, battleStarted])

  useEffect(() => {
    if (!battleStarted || !currentGameId) return

    const syncInterval = setInterval(async () => {
      try {
        await fetch("/api/game", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            gameId: currentGameId,
            towerHealth,
            towerCpu: towerMetrics.cpu,
            towerMemory: towerMetrics.memory,
            towerRequests: towerMetrics.requests,
          }),
        })
      } catch (error) {
        console.error("Failed to sync tower metrics:", error)
      }
    }, 2000)

    return () => clearInterval(syncInterval)
  }, [battleStarted, currentGameId, towerHealth, towerMetrics])

  useEffect(() => {
    if (!battleStarted || !currentGameId) return

    const syncInterval = setInterval(async () => {
      try {
        await Promise.all(
          agents.map((agent) =>
            fetch("/api/agents", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                agentId: agent.id,
                score: agent.score,
                totalRequests: agent.totalRequests,
                successfulExploits: agent.successfulExploits,
                portDiscovered: agent.portDiscovered,
                vulnerabilitiesFound: agent.vulnerabilitiesFound,
              }),
            }),
          ),
        )
      } catch (error) {
        console.error("Failed to sync agent data:", error)
      }
    }, 2000)

    return () => clearInterval(syncInterval)
  }, [battleStarted, currentGameId, agents])

  const handleStartBattle = async () => {
    try {
      const response = await fetch("/api/game", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start" }),
      })
      const data = await response.json()
      setCurrentGameId(data.game.id)
      setBattleStarted(true)
      mutate()
    } catch (error) {
      console.error("Failed to start battle:", error)
    }
  }

  const handleStopBattle = async () => {
    if (!currentGameId) return
    try {
      await fetch("/api/game", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "stop", gameId: currentGameId }),
      })
      setBattleStarted(false)
      mutate()
    } catch (error) {
      console.error("Failed to stop battle:", error)
    }
  }

  return (
    <div className="relative w-full h-screen bg-black flex flex-col overflow-hidden">
      {/* Header */}
      <div className="relative z-10 flex items-center justify-between px-6 py-4 border-b border-neutral-800 bg-black">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${battleStarted ? "bg-red-500 animate-pulse" : "bg-neutral-600"}`} />
            <span className="text-xs font-mono text-neutral-400 uppercase tracking-wide">
              {battleStarted ? "LIVE" : "OFFLINE"}
            </span>
          </div>
          <div className="h-4 w-px bg-neutral-800" />
          <div>
            <h1 className="text-sm font-mono text-neutral-400 uppercase tracking-wide">LLM vs Tower</h1>
            <p className="text-xs text-neutral-600 font-mono">Battle Simulation</p>
          </div>
        </div>
        <div className="flex gap-2">
          {!battleStarted ? (
            <Button onClick={handleStartBattle} size="sm" className="font-mono text-xs h-8 px-4">
              Start Battle
            </Button>
          ) : (
            <Button onClick={handleStopBattle} variant="destructive" size="sm" className="font-mono text-xs h-8 px-4">
              Stop Battle
            </Button>
          )}
          <Button asChild variant="outline" size="sm" className="font-mono text-xs h-8 px-4 bg-transparent">
            <Link href="/leaderboard">View Leaderboard</Link>
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex">
        {/* Left Sidebar - LLM Terminals */}
        <div className="w-[320px] border-r border-neutral-800 bg-black">
          <ScrollArea className="h-full">
            <div className="p-4 space-y-4">
              <h2 className="text-xs font-mono text-neutral-400 uppercase tracking-wide mb-4">LLM Agents</h2>
              {agents.map((agent) => (
                <div key={agent.id} className="border border-neutral-800 rounded-lg bg-neutral-950 p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-sm font-mono font-bold uppercase" style={{ color: agent.color }}>
                      {agent.name}
                    </div>
                    <div className="text-xs font-mono text-neutral-500">DMG: {agent.score}</div>
                  </div>

                  {/* Thinking status */}
                  <div className="text-[10px] font-mono text-neutral-600 italic mb-2 min-h-[16px]">
                    {agent.thinking || "Idle..."}
                  </div>

                  {/* Terminal logs */}
                  <div className="bg-black border border-neutral-900 rounded p-3 h-32">
                    <div className="text-[10px] font-mono text-neutral-600 uppercase mb-2">Terminal</div>
                    <ScrollArea className="h-24">
                      <div className="space-y-1">
                        {agent.terminalLogs.length === 0 ? (
                          <div className="text-[10px] font-mono text-neutral-700">Waiting for connection...</div>
                        ) : (
                          agent.terminalLogs.slice(-6).map((log, i) => (
                            <div key={i} className="text-[10px] font-mono text-neutral-400 leading-relaxed">
                              {log}
                            </div>
                          ))
                        )}
                      </div>
                    </ScrollArea>
                  </div>

                  {/* Stats */}
                  <div className="mt-3 space-y-2 text-[10px] font-mono">
                    <div className="flex justify-between">
                      <span className="text-neutral-600">Requests:</span>
                      <span className="text-neutral-400">{agent.totalRequests}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-neutral-600">Exploits:</span>
                      <span className="text-green-500">{agent.successfulExploits}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-neutral-600">Port Discovered:</span>
                      <span className={agent.portDiscovered ? "text-green-500" : "text-neutral-600"}>
                        {agent.portDiscovered ? "YES" : "NO"}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-neutral-600">Success Rate:</span>
                      <span className="text-neutral-400">
                        {agent.totalRequests > 0
                          ? Math.round((agent.successfulExploits / agent.totalRequests) * 100)
                          : 0}
                        %
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>

        {/* Center - Battle Arena */}
        <div className="flex-1 relative overflow-hidden bg-black flex items-start justify-center pt-8">
          <svg viewBox="0 0 1000 600" className="w-full h-auto max-w-full" style={{ maxHeight: "calc(100vh - 120px)" }}>
            {/* Background grid */}
            <defs>
              <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
                <circle cx="10" cy="10" r="0.5" fill="#262626" opacity="0.4" />
              </pattern>
            </defs>
            <rect width="1000" height="600" fill="url(#grid)" />

            <g transform="translate(500, 150)">
              <motion.g
                initial={{ opacity: 0, scale: 0 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.5 }}
              >
                {/* Tower dot matrix square */}
                {Array.from({ length: 14 }).map((_, row) =>
                  Array.from({ length: 14 }).map((_, col) => (
                    <motion.circle
                      key={`tower-${row}-${col}`}
                      cx={col * 5 - 35}
                      cy={row * 5 - 35}
                      r="2"
                      fill={towerHealth <= 30 ? "#ef4444" : towerHealth <= 60 ? "#f97316" : "#71717a"}
                      animate={{
                        opacity: [0.6, 1, 0.6],
                      }}
                      transition={{
                        duration: 2,
                        repeat: Number.POSITIVE_INFINITY,
                        delay: (row + col) * 0.05,
                      }}
                    />
                  )),
                )}
              </motion.g>
              <text
                x="0"
                y="50"
                textAnchor="middle"
                className="text-xs font-mono fill-neutral-400 uppercase"
                style={{ fontSize: "12px" }}
              >
                TOWER
              </text>
              <text
                x="0"
                y="64"
                textAnchor="middle"
                className="text-[10px] font-mono uppercase"
                fill={towerHealth <= 30 ? "#ef4444" : towerHealth <= 60 ? "#f97316" : "#71717a"}
                style={{ fontSize: "10px" }}
              >
                HP: {Math.round(towerHealth)}%
              </text>
            </g>

            {agents.map((agent, index) => {
              const spacing = 180
              const startX = 500 - ((agents.length - 1) * spacing) / 2
              const cx = startX + index * spacing
              const cy = 450

              return (
                <g key={agent.id} transform={`translate(${cx}, ${cy})`}>
                  <motion.g
                    initial={{ opacity: 0, scale: 0 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.5, delay: index * 0.1 }}
                  >
                    {/* Agent dot matrix triangle */}
                    {Array.from({ length: 10 }).map((_, row) =>
                      Array.from({ length: 10 - row }).map((_, col) => (
                        <motion.circle
                          key={`${agent.id}-${row}-${col}`}
                          cx={col * 5 + (row * 5) / 2 - 25}
                          cy={row * 5 - 25}
                          r="2"
                          fill={agent.color}
                          animate={{
                            opacity: [0.7, 1, 0.7],
                            scale: [1, 1.2, 1],
                          }}
                          transition={{
                            duration: 1.5,
                            repeat: Number.POSITIVE_INFINITY,
                            delay: (row + col) * 0.03,
                          }}
                        />
                      )),
                    )}
                  </motion.g>
                  <text
                    x="0"
                    y="35"
                    textAnchor="middle"
                    fill={agent.color}
                    className="text-[11px] font-mono font-bold uppercase"
                    style={{ fontSize: "11px" }}
                  >
                    {agent.name}
                  </text>
                  <text
                    x="0"
                    y="47"
                    textAnchor="middle"
                    className="text-[9px] font-mono fill-neutral-600"
                    style={{ fontSize: "9px" }}
                  >
                    DMG: {agent.score}
                  </text>
                </g>
              )
            })}

            <AnimatePresence>
              {attacks.map((attack) => {
                const agent = agents.find((a) => a.id === attack.fromAgent)
                if (!agent) return null

                const agentIndex = agents.findIndex((a) => a.id === attack.fromAgent)
                const spacing = 180
                const startX = 500 - ((agents.length - 1) * spacing) / 2
                const fromX = startX + agentIndex * spacing
                const fromY = 450
                const toX = 500
                const toY = 150

                return (
                  <g key={attack.id}>
                    {/* Attack line */}
                    <motion.line
                      x1={fromX}
                      y1={fromY}
                      x2={toX}
                      y2={toY}
                      stroke={agent.color}
                      strokeWidth="1.5"
                      strokeOpacity="0.4"
                      initial={{ pathLength: 0, opacity: 0 }}
                      animate={{ pathLength: 1, opacity: [0, 0.6, 0] }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.8, ease: "easeOut" }}
                    />
                    {/* Attack projectile */}
                    <motion.circle
                      r="3"
                      fill={agent.color}
                      initial={{ cx: fromX, cy: fromY }}
                      animate={{ cx: toX, cy: toY }}
                      exit={{ opacity: 0, scale: 0 }}
                      transition={{ duration: 0.8, ease: "easeOut" }}
                    >
                      <motion.animate attributeName="r" values="3;5;3" dur="0.5s" repeatCount="indefinite" />
                    </motion.circle>
                    {/* Projectile glow */}
                    <motion.circle
                      r="8"
                      fill={agent.color}
                      fillOpacity="0.2"
                      initial={{ cx: fromX, cy: fromY }}
                      animate={{ cx: toX, cy: toY }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.8, ease: "easeOut" }}
                    />
                  </g>
                )
              })}
            </AnimatePresence>
          </svg>
        </div>

        {/* Right Sidebar - Tower Dashboard */}
        <div className="w-[320px] border-l border-neutral-800 bg-black">
          <ScrollArea className="h-full">
            <div className="p-4 space-y-4">
              <h2 className="text-xs font-mono text-neutral-400 uppercase tracking-wide mb-4">Tower Dashboard</h2>

              {/* Resources Section */}
              <div className="border border-neutral-800 rounded-lg bg-neutral-950 p-4">
                <h3 className="text-[10px] font-mono text-neutral-600 uppercase mb-3">Resources</h3>

                <div className="space-y-3">
                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <p className="text-[10px] font-mono text-neutral-500 uppercase">CPU Usage</p>
                      <p className="text-xs font-mono text-neutral-400">{Math.round(towerMetrics.cpu)}%</p>
                    </div>
                    <div className="w-full h-2 bg-neutral-900 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-500 transition-all duration-300"
                        style={{ width: `${towerMetrics.cpu}%` }}
                      />
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <p className="text-[10px] font-mono text-neutral-500 uppercase">Memory Usage</p>
                      <p className="text-xs font-mono text-neutral-400">{Math.round(towerMetrics.memory)}%</p>
                    </div>
                    <div className="w-full h-2 bg-neutral-900 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-yellow-500 transition-all duration-300"
                        style={{ width: `${towerMetrics.memory}%` }}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Status Section */}
              <div className="border border-neutral-800 rounded-lg bg-neutral-950 p-4">
                <h3 className="text-[10px] font-mono text-neutral-600 uppercase mb-3">Status</h3>

                <div className="space-y-3">
                  <div>
                    <p className="text-[10px] font-mono text-neutral-500 uppercase mb-1">Health</p>
                    <div className="text-2xl font-bold font-mono text-white">{Math.round(towerHealth)}%</div>
                    <div className="w-full h-2 bg-neutral-900 rounded-full overflow-hidden mt-2">
                      <div
                        className="h-full transition-all duration-300"
                        style={{
                          width: `${towerHealth}%`,
                          backgroundColor: towerHealth > 60 ? "#71717a" : towerHealth > 30 ? "#f97316" : "#ef4444",
                        }}
                      />
                    </div>
                  </div>

                  <div>
                    <p className="text-[10px] font-mono text-neutral-500 uppercase mb-1">Total Requests</p>
                    <div className="text-xl font-bold font-mono text-white">{towerMetrics.requests}</div>
                  </div>
                </div>
              </div>

              {/* Attacks Section */}
              <div className="border border-neutral-800 rounded-lg bg-neutral-950 p-4">
                <h3 className="text-[10px] font-mono text-neutral-600 uppercase mb-3">Attack History</h3>

                <ScrollArea className="h-48">
                  <div className="space-y-2">
                    {towerMetrics.attackHistory.length === 0 ? (
                      <div className="text-[10px] font-mono text-neutral-700">No attacks yet...</div>
                    ) : (
                      towerMetrics.attackHistory
                        .slice()
                        .reverse()
                        .map((attack, i) => (
                          <div key={i} className="border-l-2 pl-2 py-1" style={{ borderColor: "#525252" }}>
                            <div className="flex justify-between items-start mb-1">
                              <span className="text-[10px] font-mono text-neutral-500">{attack.timestamp}</span>
                              <span className="text-[10px] font-mono font-bold text-red-400">-{attack.damage}</span>
                            </div>
                            <div className="text-[10px] font-mono text-neutral-400">{attack.agent}</div>
                            <div className="text-[10px] font-mono text-neutral-600">{attack.payload}</div>
                          </div>
                        ))
                    )}
                  </div>
                </ScrollArea>
              </div>

              {/* Terminal Section */}
              <div className="border border-neutral-800 rounded-lg bg-neutral-950 p-4">
                <h3 className="text-[10px] font-mono text-neutral-600 uppercase mb-3">Terminal</h3>

                <div className="bg-black border border-neutral-900 rounded p-3">
                  <ScrollArea className="h-32">
                    <div className="space-y-1">
                      {towerMetrics.terminalLogs.length === 0 ? (
                        <div className="text-[10px] font-mono text-neutral-700">System idle...</div>
                      ) : (
                        towerMetrics.terminalLogs.slice(-8).map((log, i) => (
                          <div key={i} className="text-[10px] font-mono text-neutral-400 leading-relaxed">
                            {log}
                          </div>
                        ))
                      )}
                    </div>
                  </ScrollArea>
                </div>
              </div>
            </div>
          </ScrollArea>
        </div>
      </div>
    </div>
  )
}
