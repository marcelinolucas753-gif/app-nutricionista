CREATE TABLE IF NOT EXISTS patient_access_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id TEXT NOT NULL REFERENCES professionals(id) ON DELETE CASCADE,
  patient_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  short_code TEXT NOT NULL UNIQUE,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS patient_access_tokens_code_idx ON patient_access_tokens(short_code);
CREATE INDEX IF NOT EXISTS patient_access_tokens_prof_patient_idx ON patient_access_tokens(professional_id, patient_id);

CREATE TABLE IF NOT EXISTS patient_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  access_token_id UUID NOT NULL REFERENCES patient_access_tokens(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('weight', 'note')),
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS patient_submissions_token_idx ON patient_submissions(access_token_id);
