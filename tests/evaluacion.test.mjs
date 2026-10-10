import test from "node:test";
import assert from "node:assert/strict";
import { mock } from "node:test";
import { checkMenu, formatReport, runEvaluation } from "../evaluacion/evaluar.mjs";
import { FICHAS_EJEMPLO } from "../evaluacion/fichas-ejemplo.mjs";
import { calculatePatientRequirements } from "../nutrition.mjs";

const DAYS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
const LUNCHES = ["Pollo con arroz", "Guiso de lentejas", "Fideos con tuco", "Carne con ensalada", "Pastel de papa", "Libre", "Libre"];
const good = () => ({
  intro: "x", recommendations: ["Tomá agua.", "Llevá vianda.", "Variá las frutas."], reviewNotes: ["Validá."],
  days: DAYS.map((day, i) => ({ day, breakfast: "Mate cocido con tostadas y queso", snack1: "Una manzana", lunch: LUNCHES[i], snack2: "Yogur con granola", merienda: "Té con pan y dulce", dinner: i > 4 ? "Libre" : `Sopa número ${i}`, extra: "" }))
});

function mockAI(responses) {
  const original = globalThis.fetch; let calls = 0;
  process.env.OPENAI_API_KEY = "clave-de-prueba";
  globalThis.fetch = async () => {
    const next = responses[Math.min(calls++, responses.length - 1)];
    return { ok: true, status: 200, json: async () => ({ status: "completed", usage: { input_tokens: 10, output_tokens: 5 }, output: [{ content: [{ type: "output_text", text: JSON.stringify(next) }] }] }) };
  };
  return () => { globalThis.fetch = original; };
}

test("las fichas de ejemplo tienen los datos mínimos y calculan requerimientos", () => {
  assert.ok(FICHAS_EJEMPLO.length >= 5);
  for (const ficha of FICHAS_EJEMPLO) {
    assert.ok(ficha.age && ficha.condition && ficha.goal, ficha.name);
    assert.ok(calculatePatientRequirements(ficha), `${ficha.name} sin requerimientos`);
  }
});

test("checkMenu aprueba un menú bien armado y marca cada problema", () => {
  const patient = { allergies: "", avoids: "", kitchen: ["microwave"] };
  assert.ok(checkMenu(patient, good()).every(check => check.ok));
  const bad = good();
  bad.days[0].lunch = "Plato grande de pollo al horno";
  bad.days[1].lunch = bad.days[2].lunch = bad.days[3].lunch = "Pollo al horno";
  bad.days[0].snack2 = "Yogur chico con té";
  bad.days[1].breakfast = "Tortilla de acelga";
  bad.days[5].lunch = "Asado";
  const failed = checkMenu(patient, bad).filter(check => !check.ok).map(check => check.name);
  for (const name of ["Fin de semana libre", "Sin «plato grande/mediano…»", "Desayunos y meriendas simples", "Sin almuerzos/cenas repetidos", "Colaciones y merienda completas", "Respeta el equipamiento de cocina"]) assert.ok(failed.includes(name), name);
  assert.ok(checkMenu({}, { days: [] }).some(check => !check.ok));
});

test("runEvaluation genera un menú por ficha, cuenta reintentos y arma el resumen", async () => {
  mock.method(console, "log", () => {});
  // La primera ficha recibe un menú con alergia-libre pero con colación mal armada → reintento; el resto sale bien.
  const bad = good(); bad.days[2].snack2 = "Yogur chico con té";
  const restore = mockAI([bad, good(), good(), good(), good(), good(), good()]);
  try {
    const evaluation = await runEvaluation({ fichas: FICHAS_EJEMPLO.slice(0, 2) });
    assert.equal(evaluation.results.length, 2);
    assert.equal(evaluation.summary.generated, 2);
    assert.equal(evaluation.results[0].calls, 2);
    assert.equal(evaluation.summary.withRetry, 1);
    assert.equal(evaluation.results[0].inputTokens, 20);
    const report = formatReport(evaluation, { withMenus: true });
    assert.match(report, /EVALUACIÓN DE LA IA/);
    assert.match(report, /Lunes: Desayuno/);
    assert.match(report, /Con reintento: 1/);
  } finally { restore(); mock.restoreAll(); }
});

test("si la IA falla en una ficha, se anota el error y se sigue con las demás", async () => {
  mock.method(console, "log", () => {});
  const original = globalThis.fetch;
  process.env.OPENAI_API_KEY = "clave-de-prueba";
  globalThis.fetch = async () => ({ ok: false, status: 429, json: async () => ({ error: { code: "rate_limit" } }) });
  try {
    const evaluation = await runEvaluation({ fichas: FICHAS_EJEMPLO.slice(0, 2) });
    assert.equal(evaluation.summary.errors, 2);
    assert.match(formatReport(evaluation), /No se pudo generar/);
  } finally { globalThis.fetch = original; mock.restoreAll(); }
});
