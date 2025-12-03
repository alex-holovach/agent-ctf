import { pgTable, serial, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core"

// Games table - tracks battle sessions
export const games = pgTable("games", {
  id: serial("id").primaryKey(),
  status: text("status").notNull().default("idle"), // idle, running, finished, cancelled
  startedAt: timestamp("started_at"),
  finishedAt: timestamp("finished_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
})

// Game events table - stores all events for resumable streams
export const gameEvents = pgTable("game_events", {
  id: serial("id").primaryKey(),
  gameId: integer("game_id")
    .notNull()
    .references(() => games.id),
  type: text("type").notNull(), // battle:start, tower:setup, agent:log, etc.
  agentId: text("agent_id"), // optional, for agent-specific events
  message: text("message"),
  data: jsonb("data"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
})

export type Game = typeof games.$inferSelect
export type GameEvent = typeof gameEvents.$inferSelect
