import test from "node:test";
import assert from "node:assert/strict";
import { LEARNING_INSTRUCTION, MAX_EXAMPLES, buildLearning } from "../learning.mjs";
import { generateWeeklyMenu, regenerateMeal } from "../ai.mjs";

const row = (rating, meal_key, meal_text, reasons = [], scope = "meal") => ({ scope, meal_key, rating, reasons, meal_text });

test("sin opiniones útiles no hay nada que mostrarle a la IA", () => {
  assert.equal(buildLearning([], {}), null);
  assert.equal(buildLearning(null, {}), null);
  assert.equal(buildLearning([row("up", "lunch", "")], {}), null);
});

test("separa lo que sirvió de lo rechazado y traduce los motivos", () => {
  const result = buildLearning([
    row("up", "breakfast", "Mate cocido con tostadas y queso"),
    row("down", "breakfast", "Tortilla de acelga y morrón", ["muy_elaborado", "no_es_de_la_zona", "inventado"])
  ], {});
  assert.deepEqual(result.liked.map(item => item.text), ["Mate cocido con tostadas y queso"]);
  assert.deepEqual(result.disliked[0].problems, ["demasiado elaborado", "poco habitual en la zona"]);
});

test("si hay opiniones distintas sobre la misma comida, vale la más reciente", () => {
  const result = buildLearning([row("down", "dinner", "Sopa de verduras", ["otro"]), row("up", "dinner", "sopa de verduras")], {});
  assert.equal(result.liked.length, 0);
  assert.equal(result.disliked.length, 1);
});

test("no muestra comidas que chocan con las alergias o lo que evita esta persona, ni comidas libres", () => {
  const result = buildLearning([
    row("up", "dinner", "Pescado al horno con papas"), row("up", "lunch", "Guiso de carne"),
    row("up", "lunch", "Libre: elegí lo que quieras"), row("up", "lunch", "Pollo con arroz")
  ], { allergies: "pescado", avoids: "carne" });
  assert.deepEqual(result.liked.map(item => item.text), ["Pollo con arroz"]);
});

test("limita la cantidad y, para una comida puntual, pone primero las de esa comida", () => {
  const rows = Array.from({ length: 12 }, (_, i) => row("up", i === 11 ? "merienda" : "lunch", `Comida ${i}`));
  assert.equal(buildLearning(rows, {}).liked.length, MAX_EXAMPLES);
  assert.equal(buildLearning(rows, {}, { slot: "merienda" }).liked[0].text, "Comida 11");
});

test("una queja sobre planes completos solo cuenta si se repite", () => {
  const once = [row("down", null, null, ["muy_caro"], "plan")];
  assert.equal(buildLearning(once, {}), null);
  const twice = [...once, row("down", null, null, ["muy_caro", "se_repite"], "plan"), row("up", null, null, [], "plan")];
  assert.deepEqual(buildLearning(twice, {}).planComplaints, ["demasiado caro"]);
});

test("un 👎 «solo para esta persona» cuenta únicamente para esa ficha", () => {
  const rows = [{ ...row("down", "lunch", "Guiso de lentejas", ["otro"]), patient_ref: "ficha-1" }, row("up", "lunch", "Pollo con arroz")];
  assert.deepEqual(buildLearning(rows, { id: "ficha-1" }).disliked.map(item => item.text), ["Guiso de lentejas"]);
  const other = buildLearning(rows, { id: "ficha-2" });
  assert.equal(other.disliked.length, 0);
  assert.deepEqual(other.liked.map(item => item.text), ["Pollo con arroz"]);
});

// --- La IA recibe las opiniones ---------------------------------------------------------------
function mockAI(response) {
  const calls = [], original = globalThis.fetch;
  process.env.OPENAI_API_KEY = "clave-de-prueba";
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body); calls.push({ instructions: body.instructions, input: JSON.parse(body.input) });
    return { ok: true, status: 200, json: async () => ({ status: "completed", output: [{ content: [{ type: "output_text", text: JSON.stringify(response) }] }] }) };
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}
const LUNCHES = ["Pollo con arroz", "Guiso de lentejas", "Milanesa al horno", "Fideos con tuco", "Carne al horno", "Asado", "Pizza"];
const weekly = () => ({
  intro: "x", recommendations: ["Tomá agua.", "Llevá vianda.", "Variá las frutas."], reviewNotes: ["Validá alergias."],
  days: LUNCHES.map((lunch, i) => ({ day: "d", breakfast: "Mate cocido con tostadas", snack1: "Fruta", lunch, snack2: "Yogur con granola", merienda: "Té con pan", dinner: `Cena ${i}`, extra: "" }))
});
const patient = { age: 40, condition: "general", goal: "Ordenar horarios", allergies: "", avoids: "", lunchPlace: "home", draft: weekly() };
const learning = buildLearning([row("down", "breakfast", "Tortilla de acelga", ["muy_elaborado"])], {});

test("el menú semanal manda las opiniones a la IA solo si existen", async () => {
  let ai = mockAI(weekly());
  try {
    await generateWeeklyMenu(patient, learning);
    assert.deepEqual(ai.calls[0].input.professionalFeedback, learning);
    assert.ok(ai.calls[0].instructions.includes(LEARNING_INSTRUCTION));
  } finally { ai.restore(); }
  ai = mockAI(weekly());
  try {
    await generateWeeklyMenu(patient);
    assert.equal("professionalFeedback" in ai.calls[0].input, false);
  } finally { ai.restore(); }
});

test("reemplazar una comida también usa las opiniones", async () => {
  const ai = mockAI({ meal: "Té con tostadas", reviewNote: "Revisá." });
  try {
    await regenerateMeal(patient, { dayIndex: 0, mealKey: "breakfast", instruction: "", learning });
    assert.deepEqual(ai.calls[0].input.professionalFeedback, learning);
    assert.ok(ai.calls[0].instructions.includes("professionalFeedback"));
  } finally { ai.restore(); }
});
