import test from "node:test";
import assert from "node:assert/strict";
import { analyzeText, hasExactNutritionAmounts } from "../safety.mjs";
import {
  BASE_RECOMMENDATIONS, MAX_SAME_LUNCH_OR_DINNER, WEEKEND_FREE, applyFreeWeekend, cleanPlateWording, describeRepeated, findElaborateLightMeals, findRepeatedMeals, findSnackProblems, describeSnackProblem, isFreeMeal, lunchPlaceRule,
  mergeRecommendations, menuStyleInstructions, singleMealStyleRule, weekendFreeText
} from "../menu-rules.mjs";
import { generateShoppingList, generateWeeklyMenu } from "../ai.mjs";

const DAYS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
// Cada día tiene su almuerzo y su cena, así el menú de prueba no cuenta como «repetido».
const LUNCHES = ["Pollo con arroz y ensalada", "Guiso de lentejas", "Milanesa al horno con puré", "Fideos con salsa y queso", "Carne al horno con verduras", "Asado", "Pizza"];
const DINNERS = ["Tortilla de papa", "Sopa de verduras", "Tarta de zapallo", "Revuelto de huevo con ensalada", "Pollo al horno con calabaza", "Empanadas", "Sándwiches"];
function menu(overrides = {}) {
  return {
    intro: "Propuesta semanal.",
    days: DAYS.map((day, index) => ({
      day, breakfast: "Mate cocido con tostadas con queso y mermelada", snack1: "Una manzana", lunch: LUNCHES[index],
      snack2: "Un yogur con cereal", merienda: "Té con pan y dulce", dinner: DINNERS[index], extra: "", ...(overrides[index] || {})
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
  for (const index of [0, 1, 2, 3, 4]) assert.equal(draft.days[index].lunch, LUNCHES[index]);
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

// --- Repetición de almuerzos y cenas ------------------------------------------------------------
const same = (slot, text, days) => Object.fromEntries(days.map(index => [index, { [slot]: text }]));

test("findRepeatedMeals: permite repetir hasta el máximo y marca lo que lo supera", () => {
  assert.equal(MAX_SAME_LUNCH_OR_DINNER, 2);
  assert.deepEqual(findRepeatedMeals(menu()), []);
  assert.deepEqual(findRepeatedMeals(menu(same("lunch", "Pollo con arroz", [0, 1]))), []);
  const found = findRepeatedMeals(menu(same("lunch", "Pollo con arroz", [0, 1, 3])));
  assert.equal(found.length, 1);
  assert.deepEqual([found[0].slot, found[0].dayIndexes], ["lunch", [0, 1, 3]]);
  assert.match(describeRepeated(found[0]), /almuerzo «Pollo con arroz» se repite 3 días/);
});

test("findRepeatedMeals: ignora diferencias de mayúsculas y tildes, el fin de semana y las comidas libres", () => {
  const draft = menu({ 0: { dinner: "Sopa de Verduras" }, 1: { dinner: "sopa de verduras" }, 2: { dinner: "Sopa de verdúras" }, 5: { lunch: "Pollo con arroz" }, 6: { lunch: "Pollo con arroz" } });
  assert.equal(findRepeatedMeals(draft).length, 1);
  const libres = menu(same("lunch", "Libre (elegí lo que te guste)", [0, 1, 2, 3, 4]));
  assert.deepEqual(findRepeatedMeals(libres), []);
  assert.equal(isFreeMeal("Libre: elegí lo que prefieras"), true);
  assert.equal(isFreeMeal("Librito de pollo"), false);
});

test("generateWeeklyMenu: pide variar un almuerzo repetido y usa la versión corregida", async () => {
  const ai = mockAI([menu(same("lunch", "Pollo con arroz", [0, 1, 2, 3])), menu()]);
  try {
    const result = await generateWeeklyMenu(patient({ lunchPlace: "home" }));
    assert.equal(ai.calls.length, 2);
    assert.ok(ai.calls[1].input.mustFix.some(item => /Pollo con arroz/.test(item) && /almuerzo/.test(item)));
    assert.equal(result.days[3].lunch, LUNCHES[3]);
    assert.ok(!result.reviewNotes.some(note => /Se repite/.test(note)));
  } finally { ai.restore(); }
});

test("generateWeeklyMenu: si la IA insiste con la repetición, entrega el menú con un aviso", async () => {
  const bad = menu(same("dinner", "Sopa de verduras", [0, 1, 2]));
  const ai = mockAI([bad, bad]);
  try {
    const result = await generateWeeklyMenu(patient({ lunchPlace: "home" }));
    assert.equal(ai.calls.length, 2);
    assert.ok(result.reviewNotes.some(note => /Se repite el mismo cena \(3 días/.test(note)));
  } finally { ai.restore(); }
});

// --- Lista de compras ---------------------------------------------------------------------------
test("generateShoppingList: las comidas libres no llevan la pauta del fin de semana a la lista", async () => {
  const shopping = { sections: [], reviewNote: "Cantidades orientativas." };
  const ai = mockAI([shopping]);
  try {
    const draft = applyFreeWeekend(menu(), "diabetes2");
    await generateShoppingList(patient(), draft.days);
    const meals = ai.calls[0].input.meals;
    assert.match(meals[5].lunch, /^Libre/);
    assert.match(meals[5].dinner, /no sumar nada/);
    assert.ok(!meals[5].lunch.includes(weekendFreeText("diabetes2").slice(20)));
    assert.equal(meals[0].lunch, LUNCHES[0]);
    assert.equal(meals[5].breakfast, "Mate cocido con tostadas con queso y mermelada");
    assert.match(ai.calls[0].instructions, /Libre/);
  } finally { ai.restore(); }
});

// --- Redacción: sin «plato grande» al empezar ----------------------------------------------------
test("cleanPlateWording cambia «plato grande de…» por «porción de…» y no toca el resto", () => {
  assert.equal(cleanPlateWording("Plato grande de carne al horno con puré"), "Porción de carne al horno con puré");
  assert.equal(cleanPlateWording("plato mediano de pollo con arroz"), "Porción de pollo con arroz");
  assert.equal(cleanPlateWording("Plato grande con pollo y arroz"), "Pollo y arroz");
  assert.equal(cleanPlateWording("Pollo con arroz y un plato chico de ensalada"), "Pollo con arroz y porción de ensalada");
  for (const text of ["Pollo con arroz y ensalada", "Porción de carne con puré", "Ensalada de plato", ""]) assert.equal(cleanPlateWording(text), text);
});

test("generateWeeklyMenu y reemplazo de comida: la redacción sale sin «plato grande» y la IA recibe la regla", async () => {
  const ai = mockAI([menu({ 0: { lunch: "Plato grande de carne al horno con puré", dinner: "Plato mediano de pollo con ensalada" } })]);
  try {
    const result = await generateWeeklyMenu(patient({ lunchPlace: "home" }));
    assert.equal(result.days[0].lunch, "Porción de carne al horno con puré");
    assert.equal(result.days[0].dinner, "Porción de pollo con ensalada");
    assert.match(ai.calls[0].instructions, /Nunca escribas «plato grande»/);
  } finally { ai.restore(); }
  const single = mockAI([{ meal: "Plato grande de milanesa al horno con ensalada", reviewNote: "Revisá." }]);
  try {
    const { regenerateMeal } = await import("../ai.mjs");
    const result = await regenerateMeal({ ...patient(), draft: menu() }, { dayIndex: 0, mealKey: "lunch", instruction: "" });
    assert.equal(result.meal, "Porción de milanesa al horno con ensalada");
    assert.match(single.calls[0].instructions, /Nunca escribas «plato grande»/);
  } finally { single.restore(); }
});

// --- Colaciones y merienda: yogur completo o infusión con algo aparte ----------------------------
test("findSnackProblems marca yogur con infusión, yogur solo e infusión sola, y acepta las combinaciones buenas", () => {
  assert.deepEqual(findSnackProblems(menu()), []);
  for (const good of ["Yogur con granola y banana", "Yogur con copos de maíz", "Té con tostadas y queso", "Mate cocido con un sándwich de jamón y queso", "Café con leche con galletitas", "Una manzana", "Sándwich de queso y tomate"]) {
    assert.deepEqual(findSnackProblems(menu({ 1: { snack2: good } })), [], good);
  }
  const bad = menu({ 0: { snack2: "Yogur chico con té" }, 2: { merienda: "Un yogur" }, 3: { merienda: "Mate cocido" }, 4: { snack1: "Yogur con mate" } });
  const found = findSnackProblems(bad);
  assert.deepEqual(found.map(item => [item.dayIndex, item.slot, item.problem]), [
    [0, "snack2", "yogur_con_infusion"], [2, "merienda", "yogur_solo"], [3, "merienda", "infusion_sola"], [4, "snack1", "yogur_con_infusion"]
  ]);
  assert.match(describeSnackProblem(found[0]), /colación de la tarde.*mezcla yogur con una infusión/);
});

test("el estilo de colaciones y merienda pide yogur completo o infusión con algo aparte", () => {
  const text = menuStyleInstructions();
  assert.match(text, /Nunca un yogur chico solo ni yogur junto con una infusión/);
  assert.match(singleMealStyleRule("snack2"), /granola/);
});

test("generateWeeklyMenu: corrige «yogur chico con té» con un reintento", async () => {
  const ai = mockAI([menu({ 1: { snack2: "Yogur chico con té" } }), menu({ 1: { snack2: "Yogur con granola y banana" } })]);
  try {
    const result = await generateWeeklyMenu(patient({ lunchPlace: "home" }));
    assert.equal(ai.calls.length, 2);
    assert.ok(ai.calls[1].input.mustFix.some(item => /Martes/.test(item) && /yogur/i.test(item)));
    assert.equal(result.days[1].snack2, "Yogur con granola y banana");
    assert.ok(!result.reviewNotes.some(note => /colaciones/.test(note)));
  } finally { ai.restore(); }
});

test("generateWeeklyMenu: si la IA insiste con una merienda incompleta, entrega el menú con un aviso", async () => {
  const bad = menu({ 3: { merienda: "Un yogur" } });
  const ai = mockAI([bad, bad]);
  try {
    const result = await generateWeeklyMenu(patient({ lunchPlace: "home" }));
    assert.equal(ai.calls.length, 2);
    assert.ok(result.reviewNotes.some(note => /Jueves \(merienda\)/.test(note)));
  } finally { ai.restore(); }
});

test("reemplazar una colación: vuelve a pedir si viene «yogur con infusión»", async () => {
  const ai = mockAI([{ meal: "Yogur chico con té", reviewNote: "x" }, { meal: "Té con tostadas y queso", reviewNote: "x" }]);
  try {
    const { regenerateMeal } = await import("../ai.mjs");
    const result = await regenerateMeal({ ...patient(), draft: menu() }, { dayIndex: 0, mealKey: "snack2", instruction: "" });
    assert.equal(ai.calls.length, 2);
    assert.equal(result.meal, "Té con tostadas y queso");
    assert.ok(ai.calls[1].input.mustFix[0].includes("yogur"));
  } finally { ai.restore(); }
});
