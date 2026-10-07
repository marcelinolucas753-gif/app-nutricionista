-- Sesiones del portal del paciente: el navegador de la persona recibe un token
-- propio (distinto del enlace y del código) que vence y deja de servir apenas
-- el profesional revoca el acceso.
CREATE TABLE IF NOT EXISTS patient_sessions (
  token_hash TEXT PRIMARY KEY,
  access_token_id UUID NOT NULL REFERENCES patient_access_tokens(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS patient_sessions_expiration_idx ON patient_sessions(expires_at);
CREATE INDEX IF NOT EXISTS patient_sessions_access_idx ON patient_sessions(access_token_id);

ALTER TABLE patient_access_tokens ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ;
