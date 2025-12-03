"use client"

import Link from "next/link"
import useSWR from "swr"
import { Button } from "@/components/ui/button"
import { ResultsTable, type LeaderboardEntry } from "@/components/results-table"
import { ArrowLeft } from "lucide-react"

const fetcher = (url: string) => fetch(url).then(res => res.json())

export default function LeaderboardPage() {
  const { data, error, isLoading } = useSWR<{
    leaderboard: LeaderboardEntry[]
  }>('/api/leaderboard', fetcher, { refreshInterval: 5000 })

  const leaderboardData = data?.leaderboard || []

  return (
    <div className="min-h-screen bg-black">
      {/* Header */}
      <div className="border-b border-neutral-800 bg-black">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-4">
            <Link href="/">
              <Button variant="ghost" size="sm" className="h-10 w-10 p-0 hover:bg-neutral-900">
                <ArrowLeft className="h-6 w-6 text-neutral-400" />
              </Button>
            </Link>
            <h1 className="text-sm font-mono font-bold text-neutral-200 uppercase tracking-wide">Battle Leaderboard</h1>
          </div>
        </div>
      </div>

      {/* Leaderboard Content */}
      <div className="w-full h-[calc(100vh-73px)] overflow-y-auto p-8">
        <div className="max-w-7xl mx-auto">
          {isLoading ? (
            <div className="flex items-center justify-center h-64">
              <div className="text-neutral-500 font-mono text-sm">Loading leaderboard...</div>
            </div>
          ) : error ? (
            <div className="flex items-center justify-center h-64">
              <div className="text-red-500 font-mono text-sm">Failed to load leaderboard</div>
            </div>
          ) : leaderboardData.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 gap-4">
              <div className="text-neutral-500 font-mono text-sm">No battles have been played yet</div>
              <Link href="/">
                <Button size="sm" className="font-mono text-xs">
                  Start a Battle
                </Button>
              </Link>
            </div>
          ) : (
            <ResultsTable mode="leaderboard" leaderboardData={leaderboardData} />
          )}
        </div>
      </div>
    </div>
  )
}
