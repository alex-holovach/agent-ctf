import { neon } from '@neondatabase/serverless'

const sql = neon(process.env.DATABASE_URL!)

async function migrate() {
  console.log('Running migrations...')
  
  // Create game_events table if not exists
  await sql`
    CREATE TABLE IF NOT EXISTS game_events (
      id SERIAL PRIMARY KEY,
      game_id INTEGER NOT NULL REFERENCES games(id),
      type TEXT NOT NULL,
      agent_id TEXT,
      message TEXT,
      data JSONB,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `
  console.log('Created game_events table')

  // Create indexes
  await sql`CREATE INDEX IF NOT EXISTS idx_game_events_game_id ON game_events(game_id)`
  await sql`CREATE INDEX IF NOT EXISTS idx_game_events_game_id_id ON game_events(game_id, id)`
  console.log('Created indexes')

  console.log('Migrations complete!')
}

migrate().catch(console.error)

