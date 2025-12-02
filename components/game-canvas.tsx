"use client"

import { useEffect, useState, useRef, useCallback } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { AutoScrollTerminal } from "@/components/auto-scroll-terminal"
import Link from "next/link"
import { DEFAULT_AGENTS, type AgentConfig, type BattleEvent } from "@/lib/types"

interface AgentState extends AgentConfig {
  terminalLogs: string[]
  status: 'idle' | 'starting' | 'running' | 'finished'
  score: number
}

interface TowerState {
  health: number
  status: 'idle' | 'ready' | 'under_attack' | 'defeated'
  terminalLogs: string[]
}

const BATTLE_STORAGE_KEY = 'llm-battle-gameId'

export function GameCanvas() {
  const [gameId, setGameId] = useState<number | null>(null)
  const [battleStarted, setBattleStarted] = useState(false)
  const [agents, setAgents] = useState<AgentState[]>(() => 
    DEFAULT_AGENTS.map(agent => ({
      ...agent,
      terminalLogs: [],
      status: 'idle',
      score: 0,
    }))
  )
  const [tower, setTower] = useState<TowerState>({
    health: 100,
    status: 'idle',
    terminalLogs: [],
  })
  
  const eventSourceRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  // Check for existing battle on mount
  useEffect(() => {
    const checkExistingBattle = async () => {
      const storedGameId = localStorage.getItem(BATTLE_STORAGE_KEY)
      if (!storedGameId) return

      try {
        const response = await fetch(`/api/battle?gameId=${storedGameId}`)
        if (response.ok) {
          const { game } = await response.json()
          if (game?.status === 'running') {
            // Battle is still running - show as active but we can't reconnect to stream
            setGameId(game.id)
            setBattleStarted(true)
            setTower(prev => ({
              ...prev,
              terminalLogs: ['Reconnected to existing battle...', 'Note: Live stream unavailable after page reload'],
              status: 'ready',
            }))
          } else {
            // Battle finished or cancelled, clear storage
            localStorage.removeItem(BATTLE_STORAGE_KEY)
          }
        } else {
          localStorage.removeItem(BATTLE_STORAGE_KEY)
        }
      } catch {
        localStorage.removeItem(BATTLE_STORAGE_KEY)
      }
    }

    checkExistingBattle()
  }, [])

  // Handle battle events from stream
  const handleBattleEvent = useCallback((event: BattleEvent) => {
    switch (event.type) {
      case 'battle:start':
        if (event.data?.gameId) {
          const id = event.data.gameId as number
          setGameId(id)
          // Store in localStorage for persistence
          localStorage.setItem(BATTLE_STORAGE_KEY, id.toString())
        }
        break

      case 'tower:setup':
        setTower(prev => ({
          ...prev,
          terminalLogs: [...prev.terminalLogs.slice(-20), event.message || ''],
        }))
        break

      case 'tower:status':
        if (event.data) {
          setTower(prev => ({
            ...prev,
            health: (event.data?.health as number) ?? prev.health,
            status: (event.data?.status as TowerState['status']) ?? prev.status,
          }))
        }
        break

      case 'agent:log':
        if (event.agentId && event.message) {
          setAgents(prev => prev.map(agent => 
            agent.id === event.agentId
              ? { ...agent, terminalLogs: [...agent.terminalLogs.slice(-20), event.message!] }
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

      case 'battle:end':
        setBattleStarted(false)
        setGameId(null)
        // Clear localStorage
        localStorage.removeItem(BATTLE_STORAGE_KEY)
        setTower(prev => ({
          ...prev,
          terminalLogs: [...prev.terminalLogs.slice(-20), event.message || 'Battle ended'],
        }))
        break

      case 'error':
        console.error('Battle error:', event.message)
        setTower(prev => ({
          ...prev,
          terminalLogs: [...prev.terminalLogs.slice(-20), `ERROR: ${event.message}`],
        }))
        break
    }
  }, [])

  // Start battle with streaming
  const handleStartBattle = async () => {
    // Reset state
    setAgents(prev => prev.map(agent => ({
      ...agent,
      terminalLogs: [],
      status: 'idle',
      score: 0,
    })))
    setTower({
      health: 100,
      status: 'idle',
      terminalLogs: [],
    })

    setBattleStarted(true)

    try {
      abortControllerRef.current = new AbortController()
      
      const response = await fetch('/api/battle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          action: 'start',
          agents: DEFAULT_AGENTS,
        }),
        signal: abortControllerRef.current.signal,
      })

      if (!response.body) {
        throw new Error('No response body')
      }

      const reader = response.body.getReader()
      eventSourceRef.current = reader
      const decoder = new TextDecoder()

      let buffer = ''
      
      while (true) {
        const { done, value } = await reader.read()
        
        if (done) {
          break
        }

        buffer += decoder.decode(value, { stream: true })
        
        // Process complete SSE messages
        const lines = buffer.split('\n\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const event = JSON.parse(line.slice(6)) as BattleEvent
              handleBattleEvent(event)
            } catch (e) {
              console.error('Failed to parse event:', e)
            }
          }
        }
      }
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        console.error('Battle stream error:', error)
      }
    } finally {
      setBattleStarted(false)
      eventSourceRef.current = null
      abortControllerRef.current = null
    }
  }

  // Stop battle
  const handleStopBattle = async () => {
    // Abort the fetch stream
    abortControllerRef.current?.abort()
    
    // Notify server to cancel via DB update
    if (gameId) {
      try {
        await fetch('/api/battle', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'stop', gameId }),
        })
      } catch {
        // Ignore errors on stop
      }
    }

    // Clear localStorage
    localStorage.removeItem(BATTLE_STORAGE_KEY)
    setBattleStarted(false)
    setGameId(null)
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort()
    }
  }, [])

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
      <div className="flex-1 flex min-h-0">
        {/* Left Sidebar - LLM Terminals */}
        <div className="w-[320px] border-r border-neutral-800 bg-black overflow-hidden">
          <ScrollArea className="h-full">
            <div className="p-4 space-y-4">
              <h2 className="text-xs font-mono text-neutral-400 uppercase tracking-wide mb-4">LLM Agents</h2>
              {agents.map((agent) => (
                <div key={agent.id} className="border border-neutral-800 rounded-lg bg-neutral-950 p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-sm font-mono font-bold uppercase" style={{ color: agent.color }}>
                      {agent.name}
                    </div>
                    <div className={`text-[10px] font-mono px-2 py-0.5 rounded ${
                      agent.status === 'running' || agent.status === 'starting'
                        ? 'bg-green-500/20 text-green-400'
                        : agent.status === 'finished'
                        ? 'bg-blue-500/20 text-blue-400'
                        : 'bg-neutral-800 text-neutral-500'
                    }`}>
                      {agent.status.toUpperCase()}
                    </div>
                  </div>

                  {/* Terminal logs */}
                  <div className="bg-black border border-neutral-900 rounded p-3 h-40">
                    <div className="text-[10px] font-mono text-neutral-600 uppercase mb-2 flex items-center gap-2">
                      <span>Terminal</span>
                      {(agent.status === 'running' || agent.status === 'starting') && (
                        <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
                      )}
                    </div>
                    <AutoScrollTerminal
                      logs={agent.terminalLogs}
                      emptyMessage={battleStarted ? 'Connecting...' : 'Waiting for battle...'}
                      isActive={agent.status === 'running' || agent.status === 'starting'}
                      className="h-28"
                    />
                  </div>

                  {/* Model info */}
                  <div className="mt-3 text-[10px] font-mono text-neutral-600">
                    Model: <span className="text-neutral-400">{agent.model}</span>
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

            {/* Tower */}
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
                      fill={tower.health <= 30 ? "#ef4444" : tower.health <= 60 ? "#f97316" : "#71717a"}
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
                fill={tower.health <= 30 ? "#ef4444" : tower.health <= 60 ? "#f97316" : "#71717a"}
                style={{ fontSize: "10px" }}
              >
                HP: {Math.round(tower.health)}%
              </text>
              <text
                x="0"
                y="78"
                textAnchor="middle"
                className="text-[9px] font-mono uppercase"
                fill={tower.status === 'ready' ? "#22c55e" : "#71717a"}
                style={{ fontSize: "9px" }}
              >
                {tower.status.toUpperCase().replace('_', ' ')}
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
                    {/* Agent dot matrix triangle */}
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
                              ? {
                                  opacity: [0.7, 1, 0.7],
                                  scale: [1, 1.2, 1],
                                }
                              : {}
                          }
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
                    className="text-[9px] font-mono"
                    fill={agent.status === 'running' ? "#22c55e" : "#71717a"}
                    style={{ fontSize: "9px" }}
                  >
                    {agent.status.toUpperCase()}
                  </text>
                </g>
              )
            })}

            {/* Connection lines during battle */}
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
                    x1={fromX}
                    y1={fromY}
                    x2={toX}
                    y2={toY}
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
          </svg>
        </div>

        {/* Right Sidebar - Tower Dashboard */}
        <div className="w-[320px] border-l border-neutral-800 bg-black">
          <ScrollArea className="h-full">
            <div className="p-4 space-y-4">
              <h2 className="text-xs font-mono text-neutral-400 uppercase tracking-wide mb-4">Tower Dashboard</h2>

              {/* Status Section */}
              <div className="border border-neutral-800 rounded-lg bg-neutral-950 p-4">
                <h3 className="text-[10px] font-mono text-neutral-600 uppercase mb-3">Status</h3>

                <div className="space-y-3">
                  <div>
                    <p className="text-[10px] font-mono text-neutral-500 uppercase mb-1">Health</p>
                    <div className="text-2xl font-bold font-mono text-white">{Math.round(tower.health)}%</div>
                    <div className="w-full h-2 bg-neutral-900 rounded-full overflow-hidden mt-2">
                      <div
                        className="h-full transition-all duration-300"
                        style={{
                          width: `${tower.health}%`,
                          backgroundColor: tower.health > 60 ? "#71717a" : tower.health > 30 ? "#f97316" : "#ef4444",
                        }}
                      />
                    </div>
                  </div>

                  <div>
                    <p className="text-[10px] font-mono text-neutral-500 uppercase mb-1">Status</p>
                    <div className={`text-sm font-bold font-mono ${
                      tower.status === 'ready' ? 'text-green-400' : 
                      tower.status === 'under_attack' ? 'text-red-400' : 
                      'text-neutral-400'
                    }`}>
                      {tower.status.toUpperCase().replace('_', ' ')}
                    </div>
                  </div>
                </div>
              </div>

              {/* Terminal Section */}
              <div className="border border-neutral-800 rounded-lg bg-neutral-950 p-4">
                <h3 className="text-[10px] font-mono text-neutral-600 uppercase mb-3 flex items-center gap-2">
                  Tower Terminal
                  {tower.status === 'ready' && (
                    <span className="w-1.5 h-1.5 bg-green-500 rounded-full" />
                  )}
                </h3>

                <div className="bg-black border border-neutral-900 rounded p-3">
                  <AutoScrollTerminal
                    logs={tower.terminalLogs}
                    emptyMessage="System idle..."
                    isActive={tower.status === 'ready'}
                    className="h-48"
                  />
                </div>
              </div>

              {/* Battle Info */}
              {gameId && (
                <div className="border border-neutral-800 rounded-lg bg-neutral-950 p-4">
                  <h3 className="text-[10px] font-mono text-neutral-600 uppercase mb-3">Battle Info</h3>
                  <div className="text-[10px] font-mono text-neutral-400">
                    Game ID: <span className="text-neutral-500">{gameId}</span>
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>
        </div>
      </div>
    </div>
  )
}
