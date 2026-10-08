-- Medición de la IA y opiniones de la profesional.
-- No guarda datos de la persona: ni nombre, ni ficha, ni alergias, ni el menú completo.
-- Se puede ejecutar varias veces sin romper nada (migrate.mjs corre todos los archivos al iniciar).

CREATE TABLE IF NOT EXISTS ai_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  professional_id TEXT REFERENCES professionals(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,                 -- ai_weekly_menu, ai_meal_replacement, ai_recipe…
  model TEXT,
  rules_version TEXT,                 -- cambia cuando se editan las reglas de menu-rules.mjs
  calls INTEGER NOT NULL DEFAULT 0,   -- llamadas a OpenAI (2 o más = hubo reintento)
  latency_ms INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER,
  output_tokens INTEGER,
  outcome TEXT NOT NULL CHECK (outcome IN ('ok', 'error')),
  error_status INTEGER,
  error_message TEXT,                 -- solo mensajes propios de la app, nunca texto de la ficha
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_events_kind_date_idx ON ai_events(kind, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_events_professional_date_idx ON ai_events(professional_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_feedback (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  professional_id TEXT REFERENCES professionals(id) ON DELETE SET NULL,
  scope TEXT NOT NULL CHECK (scope IN ('plan', 'meal')),
  meal_key TEXT,
  rating TEXT NOT NULL CHECK (rating IN ('up', 'down')),
  reasons TEXT[] NOT NULL DEFAULT '{}',
  meal_text TEXT,                     -- solo la comida (máx. 400 caracteres), sin datos de la persona
  rules_version TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_feedback_professional_date_idx ON ai_feedback(professional_id, created_at DESC);

ALTER TABLE ai_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_events_isolation ON ai_events;
CREATE POLICY ai_events_isolation ON ai_events
  USING (professional_id = current_setting('app.professional_id', true))
  WITH CHECK (professional_id = current_setting('app.professional_id', true));

ALTER TABLE ai_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_feedback FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_feedback_isolation ON ai_feedback;
CREATE POLICY ai_feedback_isolation ON ai_feedback
  USING (professional_id = current_setting('app.professional_id', true))
  WITH CHECK (professional_id = current_setting('app.professional_id', true));
