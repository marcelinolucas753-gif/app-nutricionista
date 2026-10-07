import test from "node:test";
import assert from "node:assert/strict";
import { analyzeText, hasExactNutritionAmounts } from "../safety.mjs";
import {
  BASE_RECOMMENDATIONS, WEEKEND_FREE, applyFreeWeekend, findElaborateLightMeals, lunchPlaceRule,
  mergeRecommendations, menuStyleInstructions, weekendFreeText
} from "../menu-rules.mjs";
import { generateWeeklyMenu } from "../ai.mjs";

const DAYS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
function menu(overrides = {}) {
  return {
    intro: "Propuesta semanal.",
    days: DAYS.map((day, index) => ({
      day, breakfast: "Mate cocido con tostadas con queso y mermelada", snack1: "Una manzana", lunch: "Pollo con arroz y ensalada",
      snack2: "Un yogur con cereal", merienda: "Té con pan y dulce", dinner: "Tortilla de papa", extra: "", ...(overrides[index] || {})
    })),
    recommendations: ["Llevá la vianda lista la noche anterior.", "Respetá los horarios de las comidas y no te saltees el desayuno ni la merienda.", "Probá variar las frutas."],
    reviewNotes: ["Validá alergias, medicación y adecuación individual."]
  };
}

test("detecta desayunos y meriendas elaborados, y no marca los simples", () => {
  const simple = menu();
  simple.days[1].breakfast = "Café con leche con huevos revueltos y tostadas";
  assert.deepEqual(findElaborateLightMeals(simple), []);

  const complex = menu({ 0: { breakfast: "Tortilla de acelga y morrón" }, 3: { merienda: "Tarta de verduras al horno" } });
  const found = findElaborateLightMeals(complex);
  assert.equal(found.length, 2);
  assert.deepEqual(found.map(item => [item.dayIndex, item.slot]), [[0, "breakfast"], [3, "merienda"]]);
  assert.ok(found[0].words.includes("tortilla"));
  // La tortilla en la cena no es un problema: solo se controlan desayuno y merienda.
  assert.deepEqual(findElaborateLightMeals(menu({ 2: { dinner: "Tortilla de acelga" } })), []);
});

test("sábado y domingo quedan libres con pauta; lunes a viernes no se tocan", () => {
  const draft = applyFreeWeekend(menu(), "diabetes2");
  for (const index of [5, 6]) {
    assert.equal(draft.days[index].lunch, weekendFreeText("diabetes2"));
    assert.equal(draft.days[index].dinner, weekendFreeText("diabetes2"));
    assert.ok(draft.days[index].lunch.startsWith("Libre"));
    assert.equal(draft.days[index].breakfast, "Mate cocido con tostadas con queso y mermelada");
  }
  for (const index of [0, 1, 2, 3, 4]) assert.equal(draft.days[index].lunch, "Pollo con arroz y ensalada");
  assert.notEqual(weekendFreeText("diabetes2"), weekendFreeText("general"));
  assert.equal(weekendFreeText("inexistente"), WEEKEND_FREE.general);
});

test("las pautas y recomendaciones base no tienen cantidades exactas ni chocan con alergias", () => {
  const patient = { allergies: "gluten, huevo, leche, pescado, maní, soja", avoids: "carne, cerdo, arroz, pan" };
  const texts = [...Object.values(WEEKEND_FREE), ...Object.values(BASE_RECOMMENDATIONS).flat()];
  for (const text of texts) {
    assert.equal(hasExactNutritionAmounts(text), false, text);
    assert.deepEqual(analyzeText(patient, text), [], text);
  }
});

test("las recomendaciones base van primero, sin repetirse, hasta seis", () => {
  const base = BASE_RECOMMENDATIONS.hipertension;
  const merged = mergeRecommendations("hipertension", [base[0], "Llevá una botella de agua al trabajo.", "", "Armá la compra del fin de semana.", "Otra más.", "Y otra.", "Y una más."]);
  assert.deepEqual(merged.slice(0, 3), base);
  assert.equal(merged.length, 6);
  assert.equal(new Set(merged).size, merged.length);
  assert.equal(mergeRecommendations("general", []).length, 3);
});

test("las instrucciones incluyen la zona, el desayuno simple y el fin de semana libre", () => {
  const text = menuStyleInstructions();
  assert.match(text, /Resistencia, Chaco/);
  assert.match(text, /menos de 10 minutos/);
  assert.match(text, /LIBRES/);
  assert.match(lunchPlaceRule("work_basic"), /SIN heladera/);
  assert.equal(lunchPlaceRule(""), "");
});

// --- Flujo completo con una IA simulada ---------------------------------------------------------
function mockAI(responses) {
  const calls = [];
  const original = globalThis.fetch;
  process.env.OPENAI_API_KEY = "clave-de-prueba";
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ instructions: body.instructions, input: JSON.parse(body.input) });
    const next = responses[Math.min(calls.length - 1, responses.length - 1)];
    return { ok: true, status: 200, json: async () => ({ status: "completed", output: [{ content: [{ type: "output_text", text: JSON.stringify(next) }] }] }) };
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}
const patient = (extra = {}) => ({ age: 40, condition: "hipertension", goal: "Ordenar horarios", allergies: "", avoids: "", ...extra });

test("generateWeeklyMenu: pide corregir un desayuno elaborado y devuelve fin de semana libre y recomendaciones base", async () => {
  const ai = mockAI([menu({ 0: { breakfast: "Tortilla de acelga y morrón" } }), menu()]);
  try {
    const result = await generateWeeklyMenu(patient({ lunchPlace: "work_basic" }));
    assert.equal(ai.calls.length, 2);
    assert.ok(ai.calls[1].input.mustFix.some(item => /tortilla/.test(item)));
    assert.match(ai.calls[0].instructions, /SIN heladera/);
    assert.ok(ai.calls[0].input.baseRecommendations.length >= 3);
    assert.equal(result.days[0].breakfast, "Mate cocido con tostadas con queso y mermelada");
    assert.ok(result.days[5].lunch.startsWith("Libre") && result.days[6].dinner.startsWith("Libre"));
    assert.deepEqual(result.recommendations.slice(0, 3), BASE_RECOMMENDATIONS.hipertension);
    assert.equal(result.days.length, 7);
    assert.ok(result.reviewNotes.length <= 5);
  } finally { ai.restore(); }
});

test("generateWeeklyMenu: sin el campo de almuerzo agrega un aviso y no reintenta si todo está bien", async () => {
  const ai = mockAI([menu()]);
  try {
    const result = await generateWeeklyMenu(patient());
    assert.equal(ai.calls.length, 1);
    assert.ok(result.reviewNotes.some(note => /dónde almuerza/.test(note)));
  } finally { ai.restore(); }
});

test("generateWeeklyMenu: si la IA insiste con algo elaborado, lo entrega con un aviso en lugar de fallar", async () => {
  const bad = menu({ 2: { merienda: "Tarta de zapallito" } });
  const ai = mockAI([bad, bad]);
  try {
    const result = await generateWeeklyMenu(patient({ lunchPlace: "home" }));
    assert.equal(ai.calls.length, 2);
    assert.match(result.reviewNotes[0], /Miércoles \(merienda\)/);
  } finally { ai.restore(); }
});

test("generateWeeklyMenu: si el segundo intento trae una alergia, usa el primer borrador seguro", async () => {
  const first = menu({ 0: { breakfast: "Tortilla de acelga" } });
  const second = menu({ 1: { dinner: "Pescado al horno con papas" } });
  const ai = mockAI([first, second]);
  try {
    const result = await generateWeeklyMenu(patient({ allergies: "pescado", lunchPlace: "home" }));
    assert.equal(ai.calls.length, 2);
    assert.ok(!JSON.stringify(result.days).toLowerCase().includes("pescado"));
    assert.match(result.reviewNotes[0], /Lunes \(desayuno\)/);
  } finally { ai.restore(); }
});

test("generateWeeklyMenu: una alergia que persiste en ambos intentos no devuelve nada", async () => {
  const bad = menu({ 1: { dinner: "Pescado al horno con papas" } });
  const ai = mockAI([bad, bad]);
  try {
    await assert.rejects(() => generateWeeklyMenu(patient({ allergies: "pescado" })), /alergias o intolerancias/);
  } finally { ai.restore(); }
});
