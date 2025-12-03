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
      className={`overflow-y-auto overflow-x-hidden terminal-scrollbar ${className}`}
      style={{
        scrollbarWidth: 'thin',
        scrollbarColor: '#404040 transparent',
      }}
    >
      <style jsx>{`
        .terminal-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .terminal-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .terminal-scrollbar::-webkit-scrollbar-thumb {
          background: #404040;
          border-radius: 2px;
        }
        .terminal-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #525252;
        }
      `}</style>
      <div className="space-y-1 min-w-0">
        {logs.length === 0 ? (
          <div className="text-[10px] font-mono text-neutral-700">
            {emptyMessage}
          </div>
        ) : (
          logs.map((log, i) => (
            <div key={i} className="text-[10px] font-mono text-neutral-400 leading-relaxed break-all">
              {log}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

