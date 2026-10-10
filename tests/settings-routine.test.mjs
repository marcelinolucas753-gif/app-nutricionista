import test from "node:test";
import assert from "node:assert/strict";
import { FOODS_AVOID_BY_DEFAULT, FOODS_COMMON, cleanAiSettings, describeMissingEquipment, findMissingEquipment, menuStyleInstructions, resolveMenuSettings, routineRule } from "../menu-rules.mjs";
import { validatedDocument } from "../validation.mjs";
import { generateWeeklyMenu, regenerateMeal } from "../ai.mjs";

const DAYS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
const LUNCHES = ["Pollo con arroz", "Guiso de lentejas", "Milanesa con puré", "Fideos con tuco", "Carne con ensalada", "Libre", "Libre"];
const menu = (overrides = {}) => ({
  intro: "x", recommendations: ["Tomá agua.", "Llevá vianda.", "Variá las frutas."], reviewNotes: ["Validá."],
  days: DAYS.map((day, i) => ({ day, breakfast: "Mate cocido con tostadas", snack1: "Fruta", lunch: LUNCHES[i], snack2: "Yogur con granola", merienda: "Té con pan y queso", dinner: i > 4 ? "Libre" : `Cena ${i}`, extra: "", ...(overrides[i] || {}) }))
});
function mockAI(responses) {
  const calls = [], original = globalThis.fetch;
  process.env.OPENAI_API_KEY = "clave-de-prueba";
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body); calls.push({ instructions: body.instructions, input: JSON.parse(body.input) });
    const next = responses[Math.min(calls.length - 1, responses.length - 1)];
    return { ok: true, status: 200, json: async () => ({ status: "completed", output: [{ content: [{ type: "output_text", text: JSON.stringify(next) }] }] }) };
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}
const patient = (extra = {}) => ({ age: 40, condition: "general", goal: "Ordenar horarios", allergies: "", avoids: "", lunchPlace: "home", ...extra });

// --- Ajustes editables ---------------------------------------------------------------------------
test("cleanAiSettings limpia listas, descarta lo que no es texto y recorta", () => {
  assert.deepEqual(cleanAiSettings(null), { foodsCommon: null, foodsAvoid: null, extraRules: "" });
  const clean = cleanAiSettings({ foodsCommon: ["  pan   y  queso ", "pan y queso", "", 5, null, "a".repeat(500)], foodsAvoid: "no es lista", extraRules: "x".repeat(2000) });
  assert.equal(clean.foodsCommon.length, 2);
  assert.equal(clean.foodsCommon[0], "pan y queso");
  assert.equal(clean.foodsCommon[1].length, 200);
  assert.equal(clean.foodsAvoid, null);
  assert.equal(clean.extraRules.length, 800);
  assert.equal(cleanAiSettings({ foodsCommon: Array.from({ length: 100 }, (_, i) => `a${i}`) }).foodsCommon.length, 40);
});

test("resolveMenuSettings usa las listas originales si no hay propias y saca lo que choca con la ficha", () => {
  const defaults = resolveMenuSettings(null, {});
  assert.deepEqual(defaults.foodsCommon, FOODS_COMMON);
  assert.deepEqual(defaults.foodsAvoid, FOODS_AVOID_BY_DEFAULT);
  const own = resolveMenuSettings({ foodsCommon: ["pan, queso, huevo", "pollo, arroz"], foodsAvoid: ["mariscos"], extraRules: "Siempre una fruta en la merienda." }, { allergies: "huevo" });
  assert.deepEqual(own.foodsCommon, ["pan, queso", "pollo, arroz"]);
  assert.deepEqual(own.foodsAvoid, ["mariscos"]);
  const text = menuStyleInstructions(own);
  assert.match(text, /pan, queso; pollo, arroz/);
  assert.match(text, /mariscos/);
  assert.match(text, /Reglas propias de la profesional.*Siempre una fruta/);
  assert.ok(!text.includes("huevo, pollo"));
});

test("el servidor limpia los ajustes y conserva los guardados si una versión vieja de la app no los manda", () => {
  const base = { patients: [], appointments: [] };
  assert.equal("aiSettings" in validatedDocument(base), false);
  assert.deepEqual(validatedDocument({ ...base, aiSettings: { foodsCommon: ["pan"], extraRules: "  hola  " } }).aiSettings, { foodsCommon: ["pan"], foodsAvoid: null, extraRules: "hola" });
});

test("el menú semanal y el reemplazo usan los ajustes propios", async () => {
  const settings = { foodsCommon: ["mandioca, batata"], foodsAvoid: ["mariscos"], extraRules: "Siempre una fruta en la merienda." };
  let ai = mockAI([menu()]);
  try {
    await generateWeeklyMenu(patient(), null, settings);
    assert.match(ai.calls[0].instructions, /mandioca, batata/);
    assert.match(ai.calls[0].instructions, /Siempre una fruta en la merienda/);
  } finally { ai.restore(); }
  ai = mockAI([{ meal: "Mandioca con queso", reviewNote: "x" }]);
  try {
    await regenerateMeal({ ...patient(), draft: menu() }, { dayIndex: 0, mealKey: "lunch", instruction: "", settings });
    assert.match(ai.calls[0].instructions, /mariscos/);
    assert.match(ai.calls[0].instructions, /Siempre una fruta/);
  } finally { ai.restore(); }
});

// --- Rutina: tiempo y equipamiento -------------------------------------------------------------
test("routineRule: vacía sin datos; con datos describe tiempo y aparatos que faltan", () => {
  assert.equal(routineRule({}), "");
  assert.equal(routineRule({ kitchen: ["inventado"] }), "");
  const rule = routineRule({ cookingTime: "poco", kitchen: ["microwave"] });
  assert.match(rule, /POCO tiempo/);
  assert.match(rule, /que tiene: microondas/);
  assert.match(rule, /NO tiene: horno, freidora de aire/);
});

test("findMissingEquipment solo marca aparatos que faltan y solo si la ficha indica equipamiento", () => {
  const draft = menu({ 0: { lunch: "Pollo al horno con papas" }, 1: { dinner: "Milanesas en freidora de aire" }, 2: { lunch: "Pastel gratinado" } });
  assert.deepEqual(findMissingEquipment(draft, {}), []);
  assert.deepEqual(findMissingEquipment(draft, { kitchen: ["oven", "airfryer"] }), []);
  const found = findMissingEquipment(draft, { kitchen: ["microwave"] });
  assert.deepEqual(found.map(item => [item.dayIndex, item.tool]), [[0, "oven"], [1, "airfryer"], [2, "oven"]]);
  assert.match(describeMissingEquipment(found[0]), /necesita horno, que la persona no tiene/);
});

test("generateWeeklyMenu: sin horno en la ficha, corrige «al horno» con un reintento y manda la rutina a la IA", async () => {
  const ai = mockAI([menu({ 0: { lunch: "Pollo al horno con papas" } }), menu()]);
  try {
    const result = await generateWeeklyMenu(patient({ cookingTime: "poco", kitchen: ["microwave"] }));
    assert.equal(ai.calls.length, 2);
    assert.equal(ai.calls[0].input.cookingTime, "Poco tiempo (menos de 15 minutos por comida)");
    assert.equal(ai.calls[0].input.kitchen, "Microondas");
    assert.match(ai.calls[0].instructions, /POCO tiempo/);
    assert.ok(ai.calls[1].input.mustFix.some(item => /horno/.test(item)));
    assert.equal(result.days[0].lunch, LUNCHES[0]);
  } finally { ai.restore(); }
});

test("la ficha guarda tiempo para cocinar y equipamiento válidos, y descarta lo demás", () => {
  const person = { id: "p1", name: "Ana", age: 30, cookingTime: "raro", kitchen: ["oven", "oven", "tractor", 3] };
  const doc = validatedDocument({ patients: [person], appointments: [] });
  assert.equal(doc.patients[0].cookingTime, "");
  assert.deepEqual(doc.patients[0].kitchen, ["oven"]);
  assert.equal(validatedDocument({ patients: [{ ...person, cookingTime: "poco" }], appointments: [] }).patients[0].cookingTime, "poco");
});
