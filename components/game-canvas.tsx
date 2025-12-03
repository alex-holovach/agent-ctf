"use client"

import { useEffect, useState, useRef, useCallback } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Maximize2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { AutoScrollTerminal } from "@/components/auto-scroll-terminal"
import { ResultsTable, type GameResultEntry } from "@/components/results-table"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import confetti from "canvas-confetti"
import Link from "next/link"
import useSWR from "swr"
import { DEFAULT_AGENTS, type AgentConfig, type BattleEvent } from "@/lib/types"

const fetcher = (url: string) => fetch(url).then(res => res.json())

const BATTLE_STORAGE_KEY = 'llm-battle-gameId'

interface AgentState extends AgentConfig {
  terminalLogs: string[]
  status: 'idle' | 'starting' | 'running' | 'finished'
  damage: number
}

interface TowerState {
  health: number
  status: 'idle' | 'ready' | 'under_attack' | 'defeated'
  terminalLogs: string[]
}

export function GameCanvas() {
  const [gameId, setGameId] = useState<number | null>(null)
  const [battleStarted, setBattleStarted] = useState(false)
  const [lastEventId, setLastEventId] = useState<number>(0)
  const [agents, setAgents] = useState<AgentState[]>(() =>
    DEFAULT_AGENTS.map(agent => ({
      ...agent,
      terminalLogs: [],
      status: 'idle',
      damage: 0,
    }))
  )
  const [tower, setTower] = useState<TowerState>({
    health: 100,
    status: 'idle',
    terminalLogs: [],
  })

  const abortControllerRef = useRef<AbortController | null>(null)
  const [hasShownConfetti, setHasShownConfetti] = useState(false)
  const [showResults, setShowResults] = useState(false)
  const [gameResults, setGameResults] = useState<GameResultEntry[]>([])
  const [maximizedTerminal, setMaximizedTerminal] = useState<{ title: string; logs: string[] } | null>(null)

  // Handle battle events
  const handleBattleEvent = useCallback((event: BattleEvent & { id?: number }) => {
    // Track last event ID for resumability
    if (event.id && event.id > lastEventId) {
      setLastEventId(event.id)
    }

    switch (event.type) {
      case 'battle:start':
        if (event.data?.gameId) {
          const id = event.data.gameId as number
          setGameId(id)
          localStorage.setItem(BATTLE_STORAGE_KEY, id.toString())
        }
        break

      case 'tower:setup':
        setTower(prev => ({
          ...prev,
          terminalLogs: [...prev.terminalLogs.slice(-50), event.message || ''],
        }))
        break

      case 'tower:status':
        if (event.data) {
          setTower(prev => ({
            ...prev,
            health: (event.data?.health as number) ?? prev.health,
            status: (event.data?.status as TowerState['status']) ?? prev.status,
          }))
          // Update agent damage from agentStats
          const agentStats = event.data?.agentStats as Record<string, number> | undefined
          if (agentStats) {
            setAgents(prev => prev.map(agent => ({
              ...agent,
              damage: agentStats[agent.id] ?? agent.damage,
            })))
          }
        }
        break

      case 'agent:log':
        if (event.agentId && event.message) {
          setAgents(prev => prev.map(agent =>
            agent.id === event.agentId
              ? { ...agent, terminalLogs: [...agent.terminalLogs.slice(-50), event.message!] }
              : agent
          ))
        }
        break

      case 'agent:status':
        if (event.agentId && event.data?.status) {
          setAgents(prev => prev.map(agent =>
            agent.id === event.agentId
              ? { ...agent, status: event.data!.status as AgentState['status'] }
              : agent
          ))
        }
        break

      case 'agent:thinking':
        // Stream LLM reasoning to terminal with special formatting
        if (event.agentId && event.message) {
          setAgents(prev => prev.map(agent =>
            agent.id === event.agentId
              ? { ...agent, terminalLogs: [...agent.terminalLogs.slice(-50), `💭 ${event.message}`] }
              : agent
          ))
        }
        break

      case 'battle:end':
        setBattleStarted(false)
        localStorage.removeItem(BATTLE_STORAGE_KEY)
        setTower(prev => ({
          ...prev,
          terminalLogs: [...prev.terminalLogs.slice(-50), event.message || 'Battle ended'],
        }))
        break

      case 'error':
        console.error('Battle error:', event.message)
        setTower(prev => ({
          ...prev,
          terminalLogs: [...prev.terminalLogs.slice(-50), `ERROR: ${event.message}`],
        }))
        break
    }
  }, [lastEventId])

  // Connect to event stream
  const connectToStream = useCallback(async (gId: number, fromEventId: number = 0) => {
    abortControllerRef.current?.abort()
    abortControllerRef.current = new AbortController()

    try {
      const response = await fetch(
        `/api/battle?gameId=${gId}&stream=true&lastEventId=${fromEventId}`,
        { signal: abortControllerRef.current.signal }
      )

      if (!response.body) return

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const event = JSON.parse(line.slice(6))
              handleBattleEvent(event)
            } catch {
              // Ignore parse errors
            }
          }
        }
      }
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        console.error('Stream error:', error)
      }
    }
  }, [handleBattleEvent])

  // Check for existing battle on mount
  useEffect(() => {
    const checkExistingBattle = async () => {
      const storedGameId = localStorage.getItem(BATTLE_STORAGE_KEY)
      if (!storedGameId) return

      try {
        const response = await fetch(`/api/battle?gameId=${storedGameId}`)
        if (!response.ok) {
          localStorage.removeItem(BATTLE_STORAGE_KEY)
          return
        }

        const { game, events } = await response.json()

        if (game?.status === 'running') {
          // Restore state from events
          setGameId(game.id)
          setBattleStarted(true)

          // Replay events to restore UI state
          let maxEventId = 0
          for (const event of events) {
            handleBattleEvent(event)
            if (event.id > maxEventId) maxEventId = event.id
          }
          setLastEventId(maxEventId)

          // Connect to stream for new events
          connectToStream(game.id, maxEventId)
        } else {
          // Battle finished, clear storage
          localStorage.removeItem(BATTLE_STORAGE_KEY)
        }
      } catch {
        localStorage.removeItem(BATTLE_STORAGE_KEY)
      }
    }

    checkExistingBattle()

    return () => {
      abortControllerRef.current?.abort()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Poll game status every second to detect when battle ends
  const { data: gameStatus } = useSWR(
    battleStarted && gameId ? `/api/battle?gameId=${gameId}` : null,
    fetcher,
    { refreshInterval: 1000 }
  )

  // Handle game status changes from polling
  useEffect(() => {
    if (!gameStatus?.game || !battleStarted) return

    const { game } = gameStatus

    // If game is no longer running, update UI
    if (game.status !== 'running') {
      setBattleStarted(false)
      localStorage.removeItem(BATTLE_STORAGE_KEY)

      // Update tower status if defeated
      if (game.status === 'finished') {
        setTower(prev => ({
          ...prev,
          status: 'defeated',
          terminalLogs: [...prev.terminalLogs.slice(-50), 'Battle ended - Tower defeated!'],
        }))

        // Generate game results from agent data
        const sortedAgents = [...agents].sort((a, b) => b.damage - a.damage)
        const results: GameResultEntry[] = sortedAgents.map((agent, index) => ({
          model: agent.name,
          modelColor: agent.color,
          damage: agent.damage,
          place: index + 1,
        }))
        setGameResults(results)
        setShowResults(true)

        // Fire fireworks celebration
        if (!hasShownConfetti) {
          setHasShownConfetti(true)

          const duration = 5 * 1000
          const animationEnd = Date.now() + duration
          const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 9999 }

          const randomInRange = (min: number, max: number) =>
            Math.random() * (max - min) + min

          const interval = window.setInterval(() => {
            const timeLeft = animationEnd - Date.now()

            if (timeLeft <= 0) {
              return clearInterval(interval)
            }

            const particleCount = 50 * (timeLeft / duration)
            confetti({
              ...defaults,
              particleCount,
              origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 },
            })
            confetti({
              ...defaults,
              particleCount,
              origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 },
            })
          }, 250)
        }
      }
    }
  }, [gameStatus, battleStarted, hasShownConfetti, agents])

  // Start battle
  const handleStartBattle = async () => {
    // Reset state - set gameId to null FIRST to prevent SWR from fetching old game status
    setGameId(null)
    setAgents(prev => prev.map(agent => ({
      ...agent,
      terminalLogs: [],
      status: 'idle',
      damage: 0,
      tokens: 0,
    })))
    setTower({
      health: 100,
      status: 'idle',
      terminalLogs: [],
    })
    setLastEventId(0)
    setHasShownConfetti(false)
    setShowResults(false)
    setGameResults([])
    setBattleStarted(true)

    try {
      const response = await fetch('/api/battle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agents: DEFAULT_AGENTS }),
      })

      const { gameId: newGameId } = await response.json()

      if (newGameId) {
        setGameId(newGameId)
        localStorage.setItem(BATTLE_STORAGE_KEY, newGameId.toString())
        // Connect to stream
        connectToStream(newGameId, 0)
      }
    } catch (error) {
      console.error('Failed to start battle:', error)
      setBattleStarted(false)
    }
  }

  // Stop battle
  const handleStopBattle = async () => {
    abortControllerRef.current?.abort()

    if (gameId) {
      try {
        await fetch('/api/battle', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'stop', gameId }),
        })
      } catch {
        // Ignore errors
      }
    }

    localStorage.removeItem(BATTLE_STORAGE_KEY)
    setBattleStarted(false)
    setGameId(null)
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
            <h1 className="text-sm font-mono text-neutral-400 uppercase tracking-wide">Agent CTF</h1>
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
      <div className="flex-1 flex min-h-0">
        {/* Left Sidebar - LLM Terminals */}
        <div className="w-[400px] border-r border-neutral-800 bg-black overflow-hidden">
          <ScrollArea className="h-full">
            <div className="px-4">
              {(() => {
                // Sort agents by damage (descending) when battle is finished
                const isFinished = !battleStarted && agents.some(a => a.damage > 0)
                const sortedAgents = isFinished
                  ? [...agents].sort((a, b) => b.damage - a.damage)
                  : agents
                const prizes = ['🥇', '🥈', '🥉']

                return sortedAgents.map((agent, index) => (
                  <div key={agent.id} className="border-b border-neutral-800 py-4">
                    <div className="mb-3 flex items-center gap-2">
                      <div className="text-sm font-mono font-bold uppercase" style={{ color: agent.color }}>
                        {agent.name}
                      </div>
                      {isFinished && index < 3 && (
                        <span className="text-3xl -mt-2">{prizes[index]}</span>
                      )}
                    </div>

                    {/* Damage */}
                    <div className="mb-3">
                      <div className="flex justify-between text-[10px] font-mono text-neutral-500 uppercase mb-1">
                        <span>Damage</span>
                        <span style={{ color: agent.color }}>{agent.damage}</span>
                      </div>
                      <div className="w-full h-1 bg-neutral-900 overflow-hidden">
                        <div
                          className="h-full transition-all duration-300"
                          style={{
                            width: `${Math.min(100, (agent.damage / 3000) * 100)}%`,
                            backgroundColor: agent.color,
                          }}
                        />
                      </div>
                    </div>

                    {/* Terminal logs */}
                    <div className="bg-neutral-950 border border-neutral-800 p-3">
                      <div className="text-[10px] font-mono text-neutral-600 uppercase mb-2 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span>Terminal</span>
                          {(agent.status === 'running' || agent.status === 'starting') && (
                            <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
                          )}
                        </div>
                        <button
                          onClick={() => setMaximizedTerminal({ title: `${agent.name} Terminal`, logs: agent.terminalLogs })}
                          className="p-0.5 text-neutral-600 hover:text-neutral-400 transition-colors"
                          title="Maximize"
                        >
                          <Maximize2 className="w-3 h-3" />
                        </button>
                      </div>
                      <AutoScrollTerminal
                        logs={agent.terminalLogs}
                        emptyMessage={battleStarted ? 'Connecting...' : 'Waiting for battle...'}
                        isActive={agent.status === 'running' || agent.status === 'starting'}
                        className="h-28"
                      />
                    </div>

                  </div>
                ))
              })()}
            </div>
          </ScrollArea>
        </div>

        {/* Center - Battle Arena or Results */}
        <div className="flex-1 relative overflow-hidden bg-black flex items-start justify-center pt-8">
          {showResults ? (
            <div className="w-full max-w-2xl px-8">
              <h2 className="text-lg font-mono font-bold text-neutral-200 uppercase tracking-wide mb-6 text-center">
                Battle Results
              </h2>
              <ResultsTable mode="game" gameResults={gameResults} />
            </div>
          ) : (
            <svg viewBox="0 0 1000 600" className="w-full h-auto max-w-full" style={{ maxHeight: "calc(100vh - 120px)" }}>
              {/* Background grid */}
              <defs>
                <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
                  <circle cx="10" cy="10" r="0.5" fill="#262626" opacity="0.4" />
                </pattern>
                <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
                  <feGaussianBlur stdDeviation="3" result="coloredBlur" />
                  <feMerge>
                    <feMergeNode in="coloredBlur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>
              <rect width="1000" height="600" fill="url(#grid)" />

              {/* Tower */}
              <g transform="translate(500, 150)">
                <motion.g
                  initial={{ opacity: 0, scale: 0 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.5 }}
                >
                  {Array.from({ length: 14 }).map((_, row) =>
                    Array.from({ length: 14 }).map((_, col) => (
                      <motion.circle
                        key={`tower-${row}-${col}`}
                        cx={col * 5 - 35}
                        cy={row * 5 - 35}
                        r="2"
                        fill={tower.health <= 30 ? "#ef4444" : tower.health <= 60 ? "#f97316" : "#22c55e"}
                        animate={{ opacity: [0.6, 1, 0.6] }}
                        transition={{ duration: 2, repeat: Infinity, delay: (row + col) * 0.05 }}
                      />
                    )),
                  )}
                </motion.g>
                <text x="0" y="50" textAnchor="middle" fill="#a3a3a3" style={{ fontSize: "12px" }} className="font-mono uppercase">
                  TOWER
                </text>
                <text x="0" y="64" textAnchor="middle" fill={tower.health <= 30 ? "#ef4444" : tower.health <= 60 ? "#f97316" : "#22c55e"} style={{ fontSize: "10px" }} className="font-mono uppercase">
                  HP: {Math.round(tower.health)}%
                </text>
              </g>

              {/* Agents */}
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
                      {Array.from({ length: 10 }).map((_, row) =>
                        Array.from({ length: 10 - row }).map((_, col) => (
                          <motion.circle
                            key={`${agent.id}-${row}-${col}`}
                            cx={col * 5 + (row * 5) / 2 - 25}
                            cy={row * 5 - 25}
                            r="2"
                            fill={agent.color}
                            animate={
                              agent.status === 'running' || agent.status === 'starting'
                                ? { opacity: [0.7, 1, 0.7], scale: [1, 1.2, 1] }
                                : {}
                            }
                            transition={{ duration: 1.5, repeat: Infinity, delay: (row + col) * 0.03 }}
                          />
                        )),
                      )}
                    </motion.g>
                    <text x="0" y="35" textAnchor="middle" fill={agent.color} style={{ fontSize: "11px" }} className="font-mono font-bold uppercase">
                      {agent.name}
                    </text>
                  </g>
                )
              })}

              {/* Connection lines */}
              <AnimatePresence>
                {battleStarted && agents.map((agent, index) => {
                  const spacing = 180
                  const startX = 500 - ((agents.length - 1) * spacing) / 2
                  const fromX = startX + index * spacing
                  const fromY = 420
                  const toX = 500
                  const toY = 180

                  if (agent.status !== 'running' && agent.status !== 'starting') return null

                  return (
                    <motion.line
                      key={`line-${agent.id}`}
                      x1={fromX} y1={fromY} x2={toX} y2={toY}
                      stroke={agent.color}
                      strokeWidth="1"
                      strokeDasharray="4 4"
                      strokeOpacity="0.3"
                      initial={{ pathLength: 0, opacity: 0 }}
                      animate={{ pathLength: 1, opacity: 0.3 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.5 }}
                    />
                  )
                })}
              </AnimatePresence>

              {/* Attack projectiles */}
              {battleStarted && agents.flatMap((agent, index) => {
                const spacing = 180
                const startX = 500 - ((agents.length - 1) * spacing) / 2
                const fromX = startX + index * spacing
                const fromY = 420
                const toX = 500
                const toY = 180

                // Show projectiles when agent is actively attacking (running/starting) and has done damage
                if ((agent.status !== 'running' && agent.status !== 'starting') || agent.damage === 0) return []

                // Create multiple projectiles with staggered animations
                return Array.from({ length: 3 }).map((_, projectileIndex) => (
                  <motion.circle
                    key={`projectile-${agent.id}-${projectileIndex}`}
                    r="5"
                    fill={agent.color}
                    filter="url(#glow)"
                    animate={{
                      cx: [fromX, toX],
                      cy: [fromY, toY],
                      opacity: [0.8, 1, 1, 0.2],
                      scale: [1, 1.2, 1, 0.8],
                    }}
                    transition={{
                      duration: 1,
                      repeat: Infinity,
                      delay: projectileIndex * 0.35,
                      ease: "easeInOut",
                    }}
                  />
                ))
              })}
            </svg>
          )}
        </div>

        {/* Right Sidebar - Tower Dashboard */}
        <div className="w-[320px] border-l border-neutral-800 bg-black flex flex-col">
          <div className="px-4">
            <h2 className="text-xs font-mono text-neutral-500 uppercase tracking-wide py-4 border-b border-neutral-800">Tower Dashboard</h2>

            {/* Health Section */}
            <div className="py-4">
              <div className="space-y-3">
                <div>
                  <p className="text-[10px] font-mono text-neutral-500 uppercase mb-1">Health</p>
                  <div className="text-2xl font-bold font-mono text-white">{Math.round(tower.health)}%</div>
                  <div className="w-full h-1 bg-neutral-900 overflow-hidden mt-2">
                    <div
                      className="h-full transition-all duration-300"
                      style={{
                        width: `${tower.health}%`,
                        backgroundColor: tower.health > 60 ? "#22c55e" : tower.health > 30 ? "#f97316" : "#ef4444",
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Terminal Section */}
            <h3 className="text-[10px] font-mono text-neutral-600 uppercase mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                Tower Terminal
                {tower.status === 'ready' && (
                  <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
                )}
              </div>
              <button
                onClick={() => setMaximizedTerminal({ title: "Tower Terminal", logs: tower.terminalLogs })}
                className="p-0.5 text-neutral-600 hover:text-neutral-400 transition-colors"
                title="Maximize"
              >
                <Maximize2 className="w-3 h-3" />
              </button>
            </h3>
          </div>
          <div className="flex-1 px-4 pb-4 min-h-0">
            <div className="bg-neutral-950 border border-neutral-800 p-3 h-full">
              <AutoScrollTerminal
                logs={tower.terminalLogs}
                emptyMessage="System idle..."
                isActive={tower.status === 'ready'}
                className="h-full"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Terminal Maximize Modal */}
      <Dialog open={!!maximizedTerminal} onOpenChange={(open) => !open && setMaximizedTerminal(null)}>
        <DialogContent className="!max-w-[80vw] !w-[80vw] h-[85vh] bg-neutral-950 border-neutral-800 flex flex-col">
          <DialogHeader className="flex-shrink-0">
            <DialogTitle className="text-neutral-200 font-mono text-sm">{maximizedTerminal?.title}</DialogTitle>
          </DialogHeader>
          <div
            className="flex-1 overflow-y-auto overflow-x-hidden p-4 bg-neutral-900/50 rounded-md"
            style={{
              scrollbarWidth: 'thin',
              scrollbarColor: '#404040 transparent',
            }}
          >
            <div className="space-y-1 min-w-0">
              {maximizedTerminal?.logs.map((log, i) => (
                <div key={i} className="text-xs font-mono text-neutral-400 leading-relaxed break-all">
                  {log}
                </div>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>

    </div>
  )
}
