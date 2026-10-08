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
  return { scope, mealKey: scope === "meal" ? body.mealKey : null, rating: body.rating, reasons, mealText: mealText || null };
}

export async function saveFeedback(professionalId, input) {
  const { withProfessional } = await import("./db.mjs");
  await withProfessional(professionalId, client => client.query(
    `INSERT INTO ai_feedback (professional_id, scope, meal_key, rating, reasons, meal_text, rules_version)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [professionalId, input.scope, input.mealKey, input.rating, input.reasons, input.mealText, RULES_VERSION]
  ));
}
