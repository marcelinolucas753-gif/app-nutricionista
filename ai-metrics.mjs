/**
 * Medición de la IA: cuánto tarda, cuántos tokens usa, si hubo reintentos y si falló.
 * También guarda la opinión de la profesional (pulgar arriba o abajo) sobre lo que propone.
 *
 * No guarda datos de la persona: ni nombre, ni ficha, ni alergias, ni el menú completo.
 * Registrar nunca puede romper la función de IA: si falla el guardado, se ignora.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { fail } from "./validation.mjs";
import { MEAL_SLOTS } from "./safety.mjs";
import * as rules from "./menu-rules.mjs";

const meters = new AsyncLocalStorage();
const MEAL_KEYS = MEAL_SLOTS.map(([key]) => key);

/** Motivos del pulgar abajo. Los textos para mostrar están en js/feedback.js. */
export const FEEDBACK_REASONS = ["no_realista", "muy_caro", "muy_elaborado", "no_es_de_la_zona", "porcion", "se_repite", "otro"];

/** Cambia solo cuando se edita algo de menu-rules.mjs (listas, pautas, palabras). */
export const RULES_VERSION = createHash("sha256")
  .update(JSON.stringify(Object.entries(rules).filter(([, value]) => typeof value !== "function")))
  .digest("hex").slice(0, 8);

/** Lo llama callOpenAI en cada intento, salga bien o mal. */
export function noteCall({ model, usage } = {}) {
  const meter = meters.getStore();
  if (!meter) return;
  meter.calls += 1;
  if (model) meter.model = model;
  meter.inputTokens += Number(usage?.input_tokens) || 0;
  meter.outputTokens += Number(usage?.output_tokens) || 0;
}

async function saveEvent(event) {
  if (!event.professionalId) return;
  const { withProfessional } = await import("./db.mjs"); // recién acá, para no exigir la base en las pruebas
  await withProfessional(event.professionalId, client => client.query(
    `INSERT INTO ai_events (professional_id, kind, model, rules_version, calls, latency_ms, input_tokens, output_tokens, outcome, error_status, error_message)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [event.professionalId, event.kind, event.model, event.rulesVersion, event.calls, event.latencyMs, event.inputTokens, event.outputTokens, event.outcome, event.errorStatus, event.errorMessage]
  ));
}

let sink = saveEvent;
/** Solo para pruebas: reemplaza el guardado en la base. */
export function setEventSink(fn) { sink = fn || saveEvent; }

/**
 * Ejecuta una función de IA y registra una fila por pedido (aunque haya hecho varias llamadas).
 * Devuelve lo mismo que la función, o repite su error.
 */
export async function measureAi(kind, professionalId, task) {
  const meter = { calls: 0, inputTokens: 0, outputTokens: 0, model: null };
  const started = performance.now();
  let error = null;
  try {
    return await meters.run(meter, task);
  } catch (caught) {
    error = caught;
    throw caught;
  } finally {
    const event = {
      professionalId, kind, model: meter.model, rulesVersion: RULES_VERSION, calls: meter.calls,
      latencyMs: Math.round(performance.now() - started),
      inputTokens: meter.inputTokens || null, outputTokens: meter.outputTokens || null,
      outcome: error ? "error" : "ok",
      errorStatus: error ? (Number.isInteger(error.status) ? error.status : 500) : null,
      errorMessage: error ? (error.status ? String(error.message).slice(0, 200) : "Error inesperado") : null
    };
    // Una línea por pedido en el registro del servidor (Render → Logs). Sin identificadores.
    const { professionalId: _omit, ...line } = event;
    console.log(JSON.stringify({ evt: "ai", ...line }));
    Promise.resolve().then(() => sink(event)).catch(() => {});
  }
}

/** Revisa lo que manda el navegador antes de guardar la opinión. */
export function validateFeedback(body = {}) {
  const scope = body.scope === "plan" || body.scope === "meal" ? body.scope : null;
  if (!scope) throw fail("Indicá si la opinión es sobre el plan o sobre una comida.");
  if (body.rating !== "up" && body.rating !== "down") throw fail("La valoración tiene que ser positiva o negativa.");
  if (scope === "meal" && !MEAL_KEYS.includes(body.mealKey)) throw fail("No encontramos esa comida del plan.");
  const reasons = body.rating === "down" && Array.isArray(body.reasons)
    ? [...new Set(body.reasons.filter(reason => FEEDBACK_REASONS.includes(reason)))].slice(0, 4) : [];
  const mealText = scope === "meal" && typeof body.mealText === "string" ? body.mealText.trim().slice(0, 400) : "";
  // «Solo para esta persona»: únicamente en un 👎 sobre una comida, y con el código de ficha.
  const patientRef = scope === "meal" && body.rating === "down" && body.patientOnly === true && typeof body.patientId === "string" && body.patientId && body.patientId.length <= 120 ? body.patientId : null;
  return { scope, mealKey: scope === "meal" ? body.mealKey : null, rating: body.rating, reasons, mealText: mealText || null, patientRef };
}

export async function saveFeedback(professionalId, input) {
  const { withProfessional } = await import("./db.mjs");
  await withProfessional(professionalId, client => client.query(
    `INSERT INTO ai_feedback (professional_id, scope, meal_key, rating, reasons, meal_text, rules_version, patient_ref)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [professionalId, input.scope, input.mealKey, input.rating, input.reasons, input.mealText, RULES_VERSION, input.patientRef || null]
  ));
}

/** Opiniones recientes de la profesional (la base solo devuelve las suyas). Si falla, la IA sigue sin ellas. */
export async function recentFeedback(professionalId, limit = 120) {
  try {
    const { withProfessional } = await import("./db.mjs");
    const result = await withProfessional(professionalId, client => client.query(
      `SELECT scope, meal_key, rating, reasons, meal_text, patient_ref FROM ai_feedback
       WHERE professional_id = $1 AND created_at > now() - interval '120 days'
       ORDER BY created_at DESC LIMIT $2`, [professionalId, limit]));
    return result.rows;
  } catch { return []; }
}

// ---- Revisión de opiniones (pantalla «Ajustes de la IA») ----

/** Opiniones propias, de la más nueva a la más vieja (la base solo devuelve las de la cuenta). */
export async function listFeedback(professionalId, limit = 200) {
  const { withProfessional } = await import("./db.mjs");
  const result = await withProfessional(professionalId, client => client.query(
    `SELECT id, scope, meal_key, rating, reasons, meal_text, patient_ref, created_at FROM ai_feedback
     WHERE professional_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2`, [professionalId, Math.min(Math.max(Number(limit) || 200, 1), 500)]));
  return result.rows.map(row => ({ ...row, id: String(row.id) }));
}

/** Números de opinión válidos: solo dígitos (en la base son enteros grandes). */
export function parseFeedbackId(raw) { return /^\d{1,15}$/.test(String(raw ?? "")) ? String(raw) : null; }

export async function deleteFeedback(professionalId, id) {
  const { withProfessional } = await import("./db.mjs");
  const result = await withProfessional(professionalId, client => client.query("DELETE FROM ai_feedback WHERE professional_id = $1 AND id = $2", [professionalId, id]));
  return result.rowCount;
}

export async function deleteAllFeedback(professionalId) {
  const { withProfessional } = await import("./db.mjs");
  const result = await withProfessional(professionalId, client => client.query("DELETE FROM ai_feedback WHERE professional_id = $1", [professionalId]));
  return result.rowCount;
}

// ---- Panel de uso y costo de la IA ----

export const AI_KIND_LABELS = {
  ai_weekly_menu: "Menú semanal", ai_meal_replacement: "Reemplazo de una comida", ai_recipe: "Receta", ai_substitution_ideas: "Sustituciones",
  ai_shopping_list: "Lista de compras", ai_consultation_summary: "Resumen de consultas"
};
export const USAGE_PERIODS = [7, 30, 90];

/** Cantidad de días del período pedido; si no es uno de los permitidos, 30. */
export function parseUsageDays(raw) { const days = Number(raw); return USAGE_PERIODS.includes(days) ? days : 30; }

/**
 * Tarifas en dólares por millón de tokens. Solo existen si quien administra el servidor las cargó
 * (OPENAI_PRICE_INPUT_PER_MILLION y OPENAI_PRICE_OUTPUT_PER_MILLION): la app no inventa precios.
 */
export function usagePrices(env = process.env) {
  const read = value => (value === undefined || String(value).trim() === "" ? NaN : Number(value));
  const input = read(env.OPENAI_PRICE_INPUT_PER_MILLION), output = read(env.OPENAI_PRICE_OUTPUT_PER_MILLION);
  return Number.isFinite(input) && input >= 0 && Number.isFinite(output) && output >= 0 ? { input, output } : null;
}

/** Convierte lo que devuelve la base (los conteos llegan como texto) en el resumen que ve la profesional. */
export function summarizeUsage(kindRows = [], errorRows = [], { days = 30, prices = null } = {}) {
  const count = value => Number(value) || 0;
  const byKind = kindRows.map(row => ({
    kind: row.kind, label: AI_KIND_LABELS[row.kind] || row.kind, requests: count(row.requests), errors: count(row.errors), retries: count(row.retries),
    avgSeconds: Math.round(count(row.avg_ms) / 100) / 10, inputTokens: count(row.input_tokens), outputTokens: count(row.output_tokens)
  }));
  const requests = byKind.reduce((sum, row) => sum + row.requests, 0);
  const inputTokens = byKind.reduce((sum, row) => sum + row.inputTokens, 0), outputTokens = byKind.reduce((sum, row) => sum + row.outputTokens, 0);
  const totals = {
    requests, errors: byKind.reduce((sum, row) => sum + row.errors, 0), retries: byKind.reduce((sum, row) => sum + row.retries, 0), inputTokens, outputTokens,
    avgSeconds: requests ? Math.round(byKind.reduce((sum, row) => sum + row.avgSeconds * row.requests, 0) / requests * 10) / 10 : 0
  };
  const costUsd = prices ? Math.round((inputTokens / 1e6 * prices.input + outputTokens / 1e6 * prices.output) * 100) / 100 : null;
  const recentErrors = errorRows.map(row => ({ label: AI_KIND_LABELS[row.kind] || row.kind, status: row.error_status ?? null, message: row.error_message || "Error", at: row.created_at }));
  return { days, byKind, totals, costUsd, recentErrors, pricesConfigured: Boolean(prices) };
}

export async function loadUsage(professionalId, days = 30) {
  const period = parseUsageDays(days);
  const { withProfessional } = await import("./db.mjs");
  const [kinds, errors] = await withProfessional(professionalId, async client => [
    await client.query(
      `SELECT kind, count(*) AS requests, count(*) FILTER (WHERE outcome = 'error') AS errors, count(*) FILTER (WHERE calls > 1) AS retries,
              COALESCE(round(avg(latency_ms)), 0) AS avg_ms, COALESCE(sum(input_tokens), 0) AS input_tokens, COALESCE(sum(output_tokens), 0) AS output_tokens
       FROM ai_events WHERE professional_id = $1 AND created_at > now() - make_interval(days => $2::int) GROUP BY kind ORDER BY requests DESC`, [professionalId, period]),
    await client.query(
      `SELECT kind, error_status, error_message, created_at FROM ai_events
       WHERE professional_id = $1 AND outcome = 'error' AND created_at > now() - make_interval(days => $2::int) ORDER BY created_at DESC LIMIT 5`, [professionalId, period])
  ]);
  return summarizeUsage(kinds.rows, errors.rows, { days: period, prices: usagePrices() });
}
