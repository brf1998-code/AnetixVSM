CREATE TABLE IF NOT EXISTS centers (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'machine',
  hours_per_day NUMERIC(6,2) NOT NULL DEFAULT 8,
  outside_days INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  example BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS jobs (
  id SERIAL PRIMARY KEY,
  job_no TEXT NOT NULL,
  part_no TEXT,
  description TEXT,
  qty INTEGER NOT NULL DEFAULT 1,
  customer TEXT,
  commit_date DATE NOT NULL,
  priority INTEGER NOT NULL DEFAULT 100,
  hot BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'released',
  hold TEXT,
  hold_owner TEXT,
  hold_until DATE,
  hold_at TIMESTAMPTZ,
  locked_finish DATE,
  shipped_at TIMESTAMPTZ,
  example BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS jobs_job_no ON jobs (job_no);

CREATE TABLE IF NOT EXISTS ops (
  id SERIAL PRIMARY KEY,
  job_id INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  center_id INTEGER NOT NULL,
  what TEXT,
  hours NUMERIC(7,2) NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'waiting',
  locked_start DATE,
  arrived_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  done_at TIMESTAMPTZ,
  done_by TEXT
);

CREATE INDEX IF NOT EXISTS ops_job ON ops (job_id, seq);

CREATE TABLE IF NOT EXISTS log (
  id SERIAL PRIMARY KEY,
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  job_id INTEGER,
  op_id INTEGER,
  what TEXT NOT NULL,
  who TEXT
);

CREATE INDEX IF NOT EXISTS log_job ON log (job_id, at);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

INSERT INTO settings (key, value) VALUES ('ship_days', '2');
