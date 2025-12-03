-- Games table - tracks battle sessions
CREATE TABLE IF NOT EXISTS games (
  id SERIAL PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'idle',
  started_at TIMESTAMP,
  finished_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Game events table - stores all events for resumable streams
CREATE TABLE IF NOT EXISTS game_events (
  id SERIAL PRIMARY KEY,
  game_id INTEGER NOT NULL REFERENCES games(id),
  type TEXT NOT NULL,
  agent_id TEXT,
  message TEXT,
  data JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Index for efficient event queries
CREATE INDEX IF NOT EXISTS idx_game_events_game_id ON game_events(game_id);
CREATE INDEX IF NOT EXISTS idx_game_events_game_id_id ON game_events(game_id, id);
