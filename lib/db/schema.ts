import { pgTable, serial, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core"

// Games table - tracks battle sessions
export const games = pgTable("games", {
  id: serial("id").primaryKey(),
  status: text("status").notNull().default("idle"), // idle, running, finished, cancelled
  sandboxId: text("sandbox_id"), // Vercel sandbox ID for the tower
  sandboxUrl: text("sandbox_url"), // Public URL for the tower sandbox
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

// Game results table - stores final results per agent per game
export const gameResults = pgTable("game_results", {
  id: serial("id").primaryKey(),
  gameId: integer("game_id")
    .notNull()
    .references(() => games.id),
  model: text("model").notNull(), // e.g., "GPT-4", "Claude"
  modelColor: text("model_color"), // agent color for display
  damage: integer("damage").notNull(),
  place: integer("place").notNull(), // 1, 2, 3, 4...
  tokensCount: integer("tokens_count").default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
})

export type Game = typeof games.$inferSelect
export type GameEvent = typeof gameEvents.$inferSelect
export type GameResult = typeof gameResults.$inferSelect
