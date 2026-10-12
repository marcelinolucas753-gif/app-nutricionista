import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { AI_KIND_LABELS, RULES_VERSION, measureAi, parseFeedbackId, parseUsageDays, setEventSink, summarizeUsage, usagePrices, validateFeedback } from "../ai-metrics.mjs";
import { createRecipe, generateWeeklyMenu } from "../ai.mjs";
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
    { scope: "plan", mealKey: null, rating: "up", reasons: [], mealText: null, patientRef: null });
  assert.deepEqual(validateFeedback({ scope: "meal", mealKey: "breakfast", rating: "down", reasons: ["muy_elaborado", "muy_elaborado", "inventado", "no_es_de_la_zona"], mealText: "  Tortilla de acelga  " }),
    { scope: "meal", mealKey: "breakfast", rating: "down", reasons: ["muy_elaborado", "no_es_de_la_zona"], mealText: "Tortilla de acelga", patientRef: null });
  // «Solo para esta persona»: únicamente con 👎 sobre una comida y un código de ficha válido.
  const only = { scope: "meal", mealKey: "dinner", rating: "down", patientOnly: true, patientId: "ficha-1" };
  assert.equal(validateFeedback(only).patientRef, "ficha-1");
  assert.equal(validateFeedback({ ...only, rating: "up" }).patientRef, null);
  assert.equal(validateFeedback({ ...only, patientId: "" }).patientRef, null);
  assert.equal(validateFeedback({ ...only, patientId: "x".repeat(200) }).patientRef, null);
  assert.equal(validateFeedback({ ...only, patientOnly: "yes" }).patientRef, null);
  assert.equal(validateFeedback({ scope: "meal", mealKey: "dinner", rating: "up", mealText: "a".repeat(900) }).mealText.length, 400);
  assert.equal(validateFeedback({ scope: "meal", mealKey: "dinner", rating: "down", reasons: "muy_caro" }).reasons.length, 0);
  for (const bad of [{}, { scope: "otro", rating: "up" }, { scope: "plan", rating: "tal vez" }, { scope: "meal", rating: "up", mealKey: "postre" }, { scope: "meal", rating: "up" }]) {
    assert.throws(() => validateFeedback(bad), error => error.status === 400, JSON.stringify(bad));
  }
});

test("resumen de uso: suma pedidos, errores, reintentos y tokens, y calcula el costo solo con tarifas cargadas", () => {
  // La base devuelve los conteos como texto.
  const kinds = [
    { kind: "ai_weekly_menu", requests: "4", errors: "1", retries: "2", avg_ms: "30000", input_tokens: "8000", output_tokens: "6000" },
    { kind: "ai_recipe", requests: "6", errors: "0", retries: "0", avg_ms: "10000", input_tokens: "3000", output_tokens: "2000" }
  ];
  const errors = [{ kind: "ai_weekly_menu", error_status: 502, error_message: "La IA aplicó un límite temporal.", created_at: "2026-10-10T12:00:00Z" }];
  const sin = summarizeUsage(kinds, errors, { days: 30 });
  assert.deepEqual(sin.totals, { requests: 10, errors: 1, retries: 2, inputTokens: 11000, outputTokens: 8000, avgSeconds: 18 });
  assert.equal(sin.costUsd, null);
  assert.equal(sin.pricesConfigured, false);
  assert.equal(sin.byKind[0].label, AI_KIND_LABELS.ai_weekly_menu);
  assert.equal(sin.byKind[0].avgSeconds, 30);
  assert.deepEqual(sin.recentErrors, [{ label: "Menú semanal", status: 502, message: "La IA aplicó un límite temporal.", at: "2026-10-10T12:00:00Z" }]);
  // 11.000 tokens de entrada a 2 dólares el millón + 8.000 de salida a 10 el millón = 0,022 + 0,08 = 0,10 dólares.
  const con = summarizeUsage(kinds, errors, { days: 30, prices: { input: 2, output: 10 } });
  assert.equal(con.costUsd, 0.1);
  assert.equal(con.pricesConfigured, true);
  const vacio = summarizeUsage([], [], { days: 7 });
  assert.deepEqual(vacio.totals, { requests: 0, errors: 0, retries: 0, inputTokens: 0, outputTokens: 0, avgSeconds: 0 });
  assert.equal(vacio.byKind.length, 0);
  assert.equal(summarizeUsage([{ kind: "ai_desconocida", requests: "1" }]).byKind[0].label, "ai_desconocida");
});

test("las tarifas de la IA solo existen si ambas están cargadas y son números", () => {
  assert.deepEqual(usagePrices({ OPENAI_PRICE_INPUT_PER_MILLION: "1.5", OPENAI_PRICE_OUTPUT_PER_MILLION: "6" }), { input: 1.5, output: 6 });
  assert.deepEqual(usagePrices({ OPENAI_PRICE_INPUT_PER_MILLION: "0", OPENAI_PRICE_OUTPUT_PER_MILLION: "0" }), { input: 0, output: 0 });
  for (const env of [{}, { OPENAI_PRICE_INPUT_PER_MILLION: "2" }, { OPENAI_PRICE_INPUT_PER_MILLION: "2", OPENAI_PRICE_OUTPUT_PER_MILLION: "" }, { OPENAI_PRICE_INPUT_PER_MILLION: "caro", OPENAI_PRICE_OUTPUT_PER_MILLION: "6" }, { OPENAI_PRICE_INPUT_PER_MILLION: "-1", OPENAI_PRICE_OUTPUT_PER_MILLION: "6" }]) assert.equal(usagePrices(env), null, JSON.stringify(env));
});

test("período de uso y número de opinión: solo valores válidos", () => {
  assert.deepEqual([7, "30", 90].map(parseUsageDays), [7, 30, 90]);
  for (const bad of [0, 15, "abc", null, undefined, -7, 365]) assert.equal(parseUsageDays(bad), 30, String(bad));
  assert.equal(parseFeedbackId("12345"), "12345");
  for (const bad of ["", "abc", "12a", "-1", "1.5", "1; DROP TABLE x", "1".repeat(20), null, undefined]) assert.equal(parseFeedbackId(bad), null, String(bad));
});

test("las funciones cortas usan OPENAI_MODEL_FAST si existe y el menú semanal siempre el modelo principal", async () => {
  const original = globalThis.fetch, previous = { main: process.env.OPENAI_MODEL, fast: process.env.OPENAI_MODEL_FAST };
  const used = [];
  process.env.OPENAI_API_KEY = "clave-de-prueba";
  const recipe = { name: "Tortilla de papa", portions: "2 porciones", ingredients: [{ quantity: "2", measure: "unidades", ingredient: "papas" }, { quantity: "1", measure: "pizca", ingredient: "sal" }], steps: ["Pelar las papas.", "Cocinar a fuego bajo."], timeMinutes: 20, difficulty: "Fácil", reviewNote: "Revisar." };
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body); used.push(body.model);
    return { ok: true, status: 200, json: async () => ({ status: "completed", usage: {}, output: [{ content: [{ type: "output_text", text: JSON.stringify(body.text.format.name === "weekly_meal_draft" ? menu() : recipe) }] }] }) };
  };
  mock.method(console, "log", () => {});
  try {
    process.env.OPENAI_MODEL = "modelo-principal"; process.env.OPENAI_MODEL_FAST = "modelo-rapido";
    await createRecipe({ likes: "", avoids: "", allergies: "", goal: "x" }, { meal: "Tortilla de papa", portions: 2 });
    await generateWeeklyMenu({ age: 40, condition: "general", goal: "Ordenar horarios", allergies: "", lunchPlace: "home" });
    assert.deepEqual(used, ["modelo-rapido", "modelo-principal"]);
    used.length = 0; delete process.env.OPENAI_MODEL_FAST;
    await createRecipe({ likes: "", avoids: "", allergies: "", goal: "x" }, { meal: "Tortilla de papa", portions: 2 });
    assert.deepEqual(used, ["modelo-principal"]); // sin la variable todo sigue como antes
  } finally {
    globalThis.fetch = original; mock.restoreAll();
    for (const [key, value] of [["OPENAI_MODEL", previous.main], ["OPENAI_MODEL_FAST", previous.fast]]) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});
