import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { RULES_VERSION, measureAi, setEventSink, validateFeedback } from "../ai-metrics.mjs";
import { generateWeeklyMenu } from "../ai.mjs";
import { fail } from "../validation.mjs";

const DAYS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
const menu = (overrides = {}) => ({
  intro: "Propuesta semanal.",
  days: DAYS.map((day, index) => ({ day, breakfast: "Mate cocido con tostadas y queso", snack1: "Una manzana", lunch: `Pollo con arroz ${index}`, snack2: "Un yogur con cereal", merienda: "Té con pan y dulce", dinner: `Sopa de verduras ${index}`, extra: "", ...(overrides[index] || {}) })),
  recommendations: ["Llevá la vianda lista la noche anterior.", "Probá variar las frutas.", "Tomá agua."],
  reviewNotes: ["Validá alergias, medicación y adecuación individual."]
});

function mockAI(responses) {
  const original = globalThis.fetch;
  let calls = 0;
  process.env.OPENAI_API_KEY = "clave-de-prueba";
  globalThis.fetch = async () => {
    const next = responses[Math.min(calls++, responses.length - 1)];
    return { ok: true, status: 200, json: async () => ({ status: "completed", usage: { input_tokens: 1000, output_tokens: 400 }, output: [{ content: [{ type: "output_text", text: JSON.stringify(next) }] }] }) };
  };
  return () => { globalThis.fetch = original; };
}

function captureEvents() {
  const events = [];
  setEventSink(async event => { events.push(event); });
  mock.method(console, "log", () => {});
  return { events, flush: () => new Promise(resolve => setImmediate(resolve)), restore: () => { setEventSink(null); mock.restoreAll(); } };
}

test("registra una fila por pedido con llamadas, tokens y tiempo, sin datos de la persona", async () => {
  const capture = captureEvents();
  const restoreFetch = mockAI([menu({ 0: { breakfast: "Tortilla de acelga" } }), menu()]);
  const patient = { age: 40, condition: "general", goal: "Ordenar horarios", allergies: "maní", likes: "milanesa", lunchPlace: "home" };
  try {
    await measureAi("ai_weekly_menu", "prof-1", () => generateWeeklyMenu(patient));
    await capture.flush();
    assert.equal(capture.events.length, 1);
    const [event] = capture.events;
    assert.equal(event.kind, "ai_weekly_menu");
    assert.equal(event.professionalId, "prof-1");
    assert.equal(event.calls, 2); // el desayuno elaborado pidió un reintento
    assert.equal(event.inputTokens, 2000);
    assert.equal(event.outputTokens, 800);
    assert.equal(event.outcome, "ok");
    assert.equal(event.errorStatus, null);
    assert.ok(event.latencyMs >= 0);
    assert.equal(event.rulesVersion, RULES_VERSION);
    assert.ok(event.model);
    const stored = JSON.stringify(event);
    for (const secret of ["maní", "milanesa", "Ordenar horarios"]) assert.ok(!stored.includes(secret), secret);
  } finally { restoreFetch(); capture.restore(); }
});

test("si la IA falla, registra el error y lo vuelve a lanzar", async () => {
  const capture = captureEvents();
  try {
    await assert.rejects(() => measureAi("ai_recipe", "prof-1", async () => { throw fail("La IA aplicó un límite temporal.", 502); }), /límite temporal/);
    await assert.rejects(() => measureAi("ai_recipe", "prof-1", async () => { throw new Error("detalle interno con datos"); }), /detalle interno/);
    await capture.flush();
    assert.deepEqual(capture.events.map(event => [event.outcome, event.errorStatus, event.errorMessage]), [
      ["error", 502, "La IA aplicó un límite temporal."],
      ["error", 500, "Error inesperado"] // los errores no previstos no guardan su mensaje
    ]);
    assert.equal(capture.events[0].calls, 0);
  } finally { capture.restore(); }
});

test("un fallo al guardar la medición no rompe la función de IA", async () => {
  mock.method(console, "log", () => {});
  setEventSink(async () => { throw new Error("la base no responde"); });
  try {
    assert.equal(await measureAi("ai_recipe", "prof-1", async () => "listo"), "listo");
    await new Promise(resolve => setImmediate(resolve));
  } finally { setEventSink(null); mock.restoreAll(); }
});

test("la versión de reglas es un código corto y estable", () => {
  assert.match(RULES_VERSION, /^[0-9a-f]{8}$/);
});

test("validateFeedback acepta opiniones válidas y descarta lo que no corresponde", () => {
  assert.deepEqual(validateFeedback({ scope: "plan", rating: "up", reasons: ["muy_caro"], mealKey: "lunch", mealText: "x" }),
    { scope: "plan", mealKey: null, rating: "up", reasons: [], mealText: null });
  assert.deepEqual(validateFeedback({ scope: "meal", mealKey: "breakfast", rating: "down", reasons: ["muy_elaborado", "muy_elaborado", "inventado", "no_es_de_la_zona"], mealText: "  Tortilla de acelga  " }),
    { scope: "meal", mealKey: "breakfast", rating: "down", reasons: ["muy_elaborado", "no_es_de_la_zona"], mealText: "Tortilla de acelga" });
  assert.equal(validateFeedback({ scope: "meal", mealKey: "dinner", rating: "up", mealText: "a".repeat(900) }).mealText.length, 400);
  assert.equal(validateFeedback({ scope: "meal", mealKey: "dinner", rating: "down", reasons: "muy_caro" }).reasons.length, 0);
  for (const bad of [{}, { scope: "otro", rating: "up" }, { scope: "plan", rating: "tal vez" }, { scope: "meal", rating: "up", mealKey: "postre" }, { scope: "meal", rating: "up" }]) {
    assert.throws(() => validateFeedback(bad), error => error.status === 400, JSON.stringify(bad));
  }
});
