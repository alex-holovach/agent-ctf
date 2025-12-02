import { pgTable, serial, text, integer, timestamp, boolean, jsonb } from "drizzle-orm/pg-core"

export const games = pgTable("games", {
  id: serial("id").primaryKey(),
  status: text("status").notNull().default("idle"), // idle, running, finished, cancelled
  towerHealth: integer("tower_health").notNull().default(1000),
  towerCpu: integer("tower_cpu").notNull().default(0),
  towerMemory: integer("tower_memory").notNull().default(0),
  towerRequests: integer("tower_requests").notNull().default(0),
  startedAt: timestamp("started_at"),
  finishedAt: timestamp("finished_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
})

export const agents = pgTable("agents", {
  id: serial("id").primaryKey(),
  gameId: integer("game_id")
    .notNull()
    .references(() => games.id),
  name: text("name").notNull(), // GPT-4, Claude, Gemini, Grok
  color: text("color").notNull(),
  damage: integer("damage").notNull().default(0),
  requests: integer("requests").notNull().default(0),
  exploits: integer("exploits").notNull().default(0),
  portDiscovered: boolean("port_discovered").notNull().default(false),
  thinking: text("thinking").default(""),
  logs: jsonb("logs").default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
})

export const attacks = pgTable("attacks", {
  id: serial("id").primaryKey(),
  gameId: integer("game_id")
    .notNull()
    .references(() => games.id),
  agentId: integer("agent_id")
    .notNull()
    .references(() => agents.id),
  payload: text("payload").notNull(), // GET, POST, DELETE, etc.
  damage: integer("damage").notNull(),
  timestamp: timestamp("timestamp").notNull().defaultNow(),
})

export type Game = typeof games.$inferSelect
export type Agent = typeof agents.$inferSelect
export type Attack = typeof attacks.$inferSelect
