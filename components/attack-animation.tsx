"use client"

import { useEffect, useState } from "react"

interface AttackAnimationProps {
  from: { x: number; y: number }
  to: { x: number; y: number }
  color: string
  payload: string
}

export function AttackAnimation({ from, to, color, payload }: AttackAnimationProps) {
  const [position, setPosition] = useState(0)

  useEffect(() => {
    const animation = setInterval(() => {
      setPosition((prev) => {
        if (prev >= 100) return 100
        return prev + 5
      })
    }, 20)

    return () => clearInterval(animation)
  }, [])

  const x = from.x + (to.x - from.x) * (position / 100)
  const y = from.y + (to.y - from.y) * (position / 100)

  return (
    <>
      {/* Attack projectile */}
      <div
        className="absolute pointer-events-none transition-all duration-100"
        style={{
          left: `${x}%`,
          top: `${y}%`,
          transform: "translate(-50%, -50%)",
        }}
      >
        <div className={`w-3 h-3 rounded-full bg-gradient-to-r ${color} animate-ping absolute`} />
        <div className={`w-3 h-3 rounded-full bg-gradient-to-r ${color}`} />
      </div>

      {/* Payload label */}
      <div
        className="absolute pointer-events-none transition-all duration-100"
        style={{
          left: `${x}%`,
          top: `${y - 3}%`,
          transform: "translate(-50%, -50%)",
          opacity: Math.max(0, 1 - position / 100),
        }}
      >
        <div
          className={`px-2 py-1 rounded text-[10px] font-mono font-bold bg-gradient-to-r ${color} text-primary-foreground whitespace-nowrap`}
        >
          {payload}
        </div>
      </div>
    </>
  )
}
