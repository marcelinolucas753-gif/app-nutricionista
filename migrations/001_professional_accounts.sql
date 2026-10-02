CREATE TABLE IF NOT EXISTS professionals (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  password_changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS professional_data (
  professional_id TEXT PRIMARY KEY REFERENCES professionals(id) ON DELETE CASCADE,
  document JSONB NOT NULL DEFAULT '{"patients":[],"appointments":[]}'::jsonb,
  version BIGINT NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_sessions (
  token_hash TEXT PRIMARY KEY,
  professional_id TEXT NOT NULL REFERENCES professionals(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS app_sessions_expiration_idx ON app_sessions(expires_at);

CREATE TABLE IF NOT EXISTS audit_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  professional_id TEXT REFERENCES professionals(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  result TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_events_professional_date_idx ON audit_events(professional_id, created_at DESC);

ALTER TABLE professional_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE professional_data FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS professional_data_isolation ON professional_data;
CREATE POLICY professional_data_isolation ON professional_data
  USING (professional_id = current_setting('app.professional_id', true))
  WITH CHECK (professional_id = current_setting('app.professional_id', true));

ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_events_isolation ON audit_events;
CREATE POLICY audit_events_isolation ON audit_events
  USING (professional_id = current_setting('app.professional_id', true))
  WITH CHECK (professional_id = current_setting('app.professional_id', true));
