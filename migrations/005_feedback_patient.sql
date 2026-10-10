-- Opinión «solo para esta persona»: se guarda el código interno de la ficha (no su nombre ni sus datos)
-- para que ese 👎 solo cuente al armar el menú de esa ficha. Se puede ejecutar varias veces.
ALTER TABLE ai_feedback ADD COLUMN IF NOT EXISTS patient_ref TEXT;
