"use client"

import { useEffect, useRef } from "react"

interface AutoScrollTerminalProps {
  logs: string[]
  emptyMessage?: string
  isActive?: boolean
  className?: string
}

export function AutoScrollTerminal({ 
  logs, 
  emptyMessage = "Waiting...", 
  isActive = false,
  className = ""
}: AutoScrollTerminalProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom when logs change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [logs])

  return (
    <div 
      ref={scrollRef}
      className={`overflow-y-auto scrollbar-thin scrollbar-thumb-neutral-700 scrollbar-track-transparent ${className}`}
    >
      <div className="space-y-1">
        {logs.length === 0 ? (
          <div className="text-[10px] font-mono text-neutral-700">
            {emptyMessage}
          </div>
        ) : (
          logs.map((log, i) => (
            <div key={i} className="text-[10px] font-mono text-neutral-400 leading-relaxed">
              {log}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

