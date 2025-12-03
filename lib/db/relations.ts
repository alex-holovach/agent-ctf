import { relations } from "drizzle-orm"
import { games, gameEvents } from "./schema"

export const gamesRelations = relations(games, ({ many }) => ({
  events: many(gameEvents),
}))

export const gameEventsRelations = relations(gameEvents, ({ one }) => ({
  game: one(games, {
    fields: [gameEvents.gameId],
    references: [games.id],
  }),
}))
