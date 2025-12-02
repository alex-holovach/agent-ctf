import { relations } from "drizzle-orm"
import { games, agents, attacks } from "./schema"

export const gamesRelations = relations(games, ({ many }) => ({
  agents: many(agents),
  attacks: many(attacks),
}))

export const agentsRelations = relations(agents, ({ one, many }) => ({
  game: one(games, {
    fields: [agents.gameId],
    references: [games.id],
  }),
  attacks: many(attacks),
}))

export const attacksRelations = relations(attacks, ({ one }) => ({
  game: one(games, {
    fields: [attacks.gameId],
    references: [games.id],
  }),
  agent: one(agents, {
    fields: [attacks.agentId],
    references: [agents.id],
  }),
}))
