-- Create games table
CREATE TABLE IF NOT EXISTS games (
  id SERIAL PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'idle',
  tower_health INTEGER NOT NULL DEFAULT 1000,
  tower_cpu INTEGER NOT NULL DEFAULT 0,
  tower_memory INTEGER NOT NULL DEFAULT 0,
  tower_requests INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMP,
  finished_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Create agents table
CREATE TABLE IF NOT EXISTS agents (
  id SERIAL PRIMARY KEY,
  game_id INTEGER NOT NULL REFERENCES games(id),
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  damage INTEGER NOT NULL DEFAULT 0,
  requests INTEGER NOT NULL DEFAULT 0,
  exploits INTEGER NOT NULL DEFAULT 0,
  port_discovered BOOLEAN NOT NULL DEFAULT false,
  thinking TEXT DEFAULT '',
  logs JSONB DEFAULT '[]',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Create attacks table
CREATE TABLE IF NOT EXISTS attacks (
  id SERIAL PRIMARY KEY,
  game_id INTEGER NOT NULL REFERENCES games(id),
  agent_id INTEGER NOT NULL REFERENCES agents(id),
  payload TEXT NOT NULL,
  damage INTEGER NOT NULL,
  timestamp TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_agents_game_id ON agents(game_id);
CREATE INDEX IF NOT EXISTS idx_attacks_game_id ON attacks(game_id);
CREATE INDEX IF NOT EXISTS idx_attacks_agent_id ON attacks(agent_id);
