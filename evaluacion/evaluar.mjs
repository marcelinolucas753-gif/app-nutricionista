// Evalúa los menús que arma la IA: genera uno por cada ficha de ejemplo y revisa lo que importa.
// La lógica está acá para poder probarla; el comando que se ejecuta es evaluar-ia.mjs (en la carpeta principal).
import { generateWeeklyMenu } from "../ai.mjs";
import { measureAi, setEventSink } from "../ai-metrics.mjs";
import { analyzeDraft, hasExactNutritionAmounts, MEAL_SLOTS } from "../safety.mjs";
import { findElaborateLightMeals, findMissingEquipment, findRepeatedMeals, findSnackProblems, isFreeMeal } from "../menu-rules.mjs";
import { FICHAS_EJEMPLO } from "./fichas-ejemplo.mjs";

const PLATE_SIZE = /\bplato\s+(grande|mediano|mediana|chico|chica|pequeño|pequeña)\b/i;

/** Revisa un menú terminado. Cada chequeo dice si pasó y, si no, qué encontró. */
export function checkMenu(patient, menu) {
  const days = Array.isArray(menu?.days) ? menu.days : [];
  const complete = days.length === 7 && days.every(day => MEAL_SLOTS.every(([key]) => typeof day?.[key] === "string" && day[key].trim()));
  const weekendFree = complete && [5, 6].every(i => isFreeMeal(days[i].lunch) && isFreeMeal(days[i].dinner));
  const plate = days.flatMap((day, i) => MEAL_SLOTS.filter(([key]) => PLATE_SIZE.test(day?.[key] || "")).map(([key]) => `${day.day || i + 1} (${key})`));
  const allergies = analyzeDraft(patient, menu).filter(item => item.severity === "allergy");
  const avoided = analyzeDraft(patient, menu).filter(item => item.severity === "avoid");
  const checks = [
    ["Menú completo (7 días, 6 comidas)", complete, ""],
    ["Fin de semana libre", weekendFree, ""],
    ["Sin «plato grande/mediano…»", plate.length === 0, plate.join(", ")],
    ["Desayunos y meriendas simples", findElaborateLightMeals(menu).length === 0, findElaborateLightMeals(menu).map(item => `${item.day} ${item.slot}: ${item.words.join("/")}`).join("; ")],
    ["Sin almuerzos/cenas repetidos", findRepeatedMeals(menu).length === 0, findRepeatedMeals(menu).map(item => `${item.label}: ${item.text}`).join("; ")],
    ["Colaciones y merienda completas", findSnackProblems(menu).length === 0, findSnackProblems(menu).map(item => `${item.day} ${item.slot}: ${item.text}`).join("; ")],
    ["Respeta el equipamiento de cocina", findMissingEquipment(menu, patient).length === 0, findMissingEquipment(menu, patient).map(item => `${item.day} ${item.slot}: ${item.text}`).join("; ")],
    ["Sin alergias", allergies.length === 0, allergies.map(item => `${item.food} / ${item.restriction}`).join("; ")],
    ["Sin alimentos que evita", avoided.length === 0, avoided.map(item => `${item.food} / ${item.restriction}`).join("; ")],
    ["Sin gramos ni calorías", !hasExactNutritionAmounts(JSON.stringify(menu)), ""]
  ];
  return checks.map(([name, ok, detail]) => ({ name, ok, detail }));
}

/** Genera un menú por ficha (y por repetición) y devuelve resultados y métricas. */
export async function runEvaluation({ fichas = FICHAS_EJEMPLO, repetitions = 1, generate = generateWeeklyMenu, onProgress = () => {} } = {}) {
  const results = [];
  for (const patient of fichas) {
    for (let run = 1; run <= repetitions; run++) {
      const events = [];
      setEventSink(async event => { events.push(event); });
      let menu = null, error = null;
      try { menu = await measureAi("ai_eval", "evaluacion", () => generate(patient)); }
      catch (caught) { error = caught?.message || "Error desconocido"; }
      await new Promise(resolve => setImmediate(resolve));
      setEventSink(null);
      const event = events[0] || {};
      const checks = menu ? checkMenu(patient, menu) : [];
      const item = { ficha: patient.name, run, error, calls: event.calls ?? 0, latencyMs: event.latencyMs ?? 0, inputTokens: event.inputTokens ?? null, outputTokens: event.outputTokens ?? null, checks, notes: menu?.reviewNotes || [], menu };
      results.push(item); onProgress(item);
    }
  }
  return { generatedAt: new Date().toISOString(), results, summary: summarize(results) };
}

export function summarize(results) {
  const total = results.length, withMenu = results.filter(item => item.menu);
  const failedChecks = {};
  for (const item of withMenu) for (const check of item.checks) if (!check.ok) failedChecks[check.name] = (failedChecks[check.name] || 0) + 1;
  const avg = list => list.length ? Math.round(list.reduce((a, b) => a + b, 0) / list.length) : 0;
  return {
    total, generated: withMenu.length, errors: total - withMenu.length,
    perfect: withMenu.filter(item => item.checks.every(check => check.ok)).length,
    withRetry: withMenu.filter(item => item.calls > 1).length,
    avgSeconds: Math.round(avg(withMenu.map(item => item.latencyMs)) / 100) / 10,
    avgCalls: withMenu.length ? Math.round(withMenu.reduce((a, item) => a + item.calls, 0) / withMenu.length * 10) / 10 : 0,
    failedChecks
  };
}

/** Texto legible del resultado, para leer en pantalla o guardar. */
export function formatReport(evaluation, { withMenus = false } = {}) {
  const lines = ["EVALUACIÓN DE LA IA", `Fecha: ${evaluation.generatedAt}`, ""];
  for (const item of evaluation.results) {
    lines.push(`● ${item.ficha} (intento ${item.run})`);
    if (item.error) { lines.push(`   ✗ No se pudo generar: ${item.error}`, ""); continue; }
    lines.push(`   ${item.calls} llamada(s) a la IA${item.calls > 1 ? " (hubo reintento)" : ""} · ${(item.latencyMs / 1000).toFixed(1)} s`);
    for (const check of item.checks) lines.push(`   ${check.ok ? "✓" : "✗"} ${check.name}${check.ok || !check.detail ? "" : ` → ${check.detail}`}`);
    if (item.notes.length) lines.push(`   Notas de revisión: ${item.notes.join(" | ")}`);
    if (withMenus && item.menu) for (const day of item.menu.days) lines.push(`   ${day.day}: ${MEAL_SLOTS.map(([key, label]) => `${label}: ${day[key]}`).join(" · ")}`);
    lines.push("");
  }
  const s = evaluation.summary;
  lines.push("RESUMEN", `Menús generados: ${s.generated} de ${s.total}${s.errors ? ` (${s.errors} con error)` : ""}`, `Sin ningún problema: ${s.perfect} de ${s.generated}`, `Con reintento: ${s.withRetry} · promedio ${s.avgCalls} llamadas y ${s.avgSeconds} s por menú`);
  const failed = Object.entries(s.failedChecks);
  lines.push(failed.length ? `Chequeos que fallaron: ${failed.map(([name, n]) => `${name} (${n})`).join("; ")}` : "Todos los chequeos pasaron.");
  return lines.join("\n");
}
