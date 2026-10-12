import assert from "node:assert/strict";
import test from "node:test";
import { MAX_BANK_MEALS_PER_SLOT, MAX_BANK_MEAL_LENGTH, MAX_OWN_MEALS_SHOWN, OWN_MEALS_INSTRUCTION, cleanAiSettings, cleanMealBank, menuStyleInstructions, ownMealsFor, resolveMenuSettings, singleMealSettingsRule, usableMealBank } from "../menu-rules.mjs";
import { generateWeeklyMenu, regenerateMeal } from "../ai.mjs";
import { validatedDocument } from "../validation.mjs";

test("cleanMealBank deja solo tipos de comida válidos, textos cortos, sin repetidos ni pautas libres", () => {
  assert.equal(cleanMealBank(null), null);
  assert.equal(cleanMealBank([]), null);
  assert.equal(cleanMealBank({ desayuno: ["algo"] }), null); // tipo inexistente
  const bank = cleanMealBank({
    breakfast: ["  Mate   cocido con tostadas ", "mate cocido con tostadas", "", 7, null, "Libre: elegí lo que quieras"],
    lunch: ["a".repeat(500)], snack1: "no es lista", __proto__: { dinner: ["x"] }
  });
  assert.deepEqual(bank.breakfast, ["Mate cocido con tostadas"]);
  assert.equal(bank.lunch[0].length, MAX_BANK_MEAL_LENGTH);
  assert.equal("snack1" in bank, false);
  assert.equal("dinner" in bank, false);
  const many = cleanMealBank({ dinner: Array.from({ length: 100 }, (_, i) => `Cena número ${i}`) });
  assert.equal(many.dinner.length, MAX_BANK_MEALS_PER_SLOT);
});

test("el banco viaja dentro de los ajustes y se valida al guardar la cuenta", () => {
  assert.deepEqual(cleanAiSettings({ mealBank: { lunch: ["Guiso de lentejas"] } }).mealBank, { lunch: ["Guiso de lentejas"] });
  const doc = validatedDocument({ patients: [], appointments: [], aiSettings: { mealBank: { lunch: ["Guiso de lentejas", 3], hack: ["x"] } } });
  assert.deepEqual(doc.aiSettings.mealBank, { lunch: ["Guiso de lentejas"] });
});

test("usableMealBank saca lo que choca con alergias, alimentos evitados y aparatos que la persona no tiene", () => {
  const bank = { lunch: ["Guiso de lentejas con arroz", "Pollo al horno con papas", "Tarta de queso y tomate", "Fideos con tuco"], dinner: ["Revuelto de huevo con tomate"] };
  const allergic = usableMealBank(bank, { allergies: "huevo", avoids: "lentejas" });
  assert.equal(allergic.lunch.includes("Guiso de lentejas con arroz"), false);
  assert.ok(allergic.lunch.includes("Fideos con tuco"));
  assert.equal("dinner" in allergic, false); // todo lo de la cena tenía huevo
  const noOven = usableMealBank(bank, { kitchen: ["microwave"] });
  assert.equal(noOven.lunch.includes("Pollo al horno con papas"), false);
  assert.ok(noOven.lunch.includes("Fideos con tuco"));
  assert.deepEqual(usableMealBank(bank, {}), cleanMealBank(bank)); // sin restricciones, queda todo
  assert.equal(usableMealBank({ lunch: ["Pasta con camarones"] }, { allergies: "mariscos" }), null);
});

test("ownMealsFor muestra una muestra acotada por tipo de comida y puede limitarse a un tipo", () => {
  const bank = { breakfast: Array.from({ length: 20 }, (_, i) => `Desayuno ${i}`), lunch: ["Guiso"] };
  const all = ownMealsFor(bank, undefined, () => 0.3);
  assert.equal(all.breakfast.length, MAX_OWN_MEALS_SHOWN);
  assert.deepEqual(all.lunch, ["Guiso"]);
  assert.deepEqual(Object.keys(ownMealsFor(bank, ["lunch"])), ["lunch"]);
  assert.equal(ownMealsFor(bank, ["dinner"]), null);
  assert.equal(ownMealsFor(null), null);
  const a = ownMealsFor(bank, ["breakfast"], () => 0).breakfast, b = ownMealsFor(bank, ["breakfast"], () => 0.99).breakfast;
  assert.notDeepEqual(a, b); // distinta muestra cada vez
});

test("las instrucciones mencionan las comidas propias solo si hay banco", () => {
  assert.equal(menuStyleInstructions(resolveMenuSettings(null, {})).includes(OWN_MEALS_INSTRUCTION), false);
  assert.ok(menuStyleInstructions(resolveMenuSettings({ mealBank: { lunch: ["Guiso"] } }, {})).includes(OWN_MEALS_INSTRUCTION));
  assert.equal(singleMealSettingsRule(resolveMenuSettings(null, {})).includes("ownMeals"), false);
  assert.ok(singleMealSettingsRule(resolveMenuSettings({ mealBank: { lunch: ["Guiso"] } }, {})).includes("ownMeals"));
});

// --- la IA recibe el banco ---------------------------------------------------------------------
function mockAI(response) {
  const calls = [], original = globalThis.fetch;
  process.env.OPENAI_API_KEY = "clave-de-prueba";
  globalThis.fetch = async (_url, options) => {
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
const settings = { mealBank: { lunch: ["Guiso de lentejas con arroz", "Tarta de queso y tomate"], breakfast: ["Café con leche y 2 tostadas con dulce"] } };

test("el menú semanal manda el banco a la IA (filtrado por la ficha) solo si existe", async () => {
  let ai = mockAI(weekly());
  try {
    await generateWeeklyMenu({ ...patient, avoids: "tomate" }, null, settings);
    assert.deepEqual(ai.calls[0].input.ownMeals, { lunch: ["Guiso de lentejas con arroz"], breakfast: ["Café con leche y 2 tostadas con dulce"] });
    assert.ok(ai.calls[0].instructions.includes(OWN_MEALS_INSTRUCTION));
  } finally { ai.restore(); }
  ai = mockAI(weekly());
  try {
    await generateWeeklyMenu(patient, null, null);
    assert.equal("ownMeals" in ai.calls[0].input, false);
    assert.equal(ai.calls[0].instructions.includes(OWN_MEALS_INSTRUCTION), false);
  } finally { ai.restore(); }
});

test("reemplazar una comida usa solo el banco de ese tipo de comida", async () => {
  const ai = mockAI({ meal: "Café con leche y tostadas con queso", reviewNote: "Revisá." });
  try {
    await regenerateMeal(patient, { dayIndex: 0, mealKey: "breakfast", instruction: "", settings });
    assert.deepEqual(ai.calls[0].input.ownMeals, { breakfast: ["Café con leche y 2 tostadas con dulce"] });
    assert.ok(ai.calls[0].instructions.includes("ownMeals"));
  } finally { ai.restore(); }
  const ai2 = mockAI({ meal: "Té con tostadas", reviewNote: "Revisá." });
  try {
    await regenerateMeal(patient, { dayIndex: 0, mealKey: "snack1", instruction: "", settings });
    assert.equal("ownMeals" in ai2.calls[0].input, false); // no hay comidas propias de ese tipo
  } finally { ai2.restore(); }
});

// --- alimentos de estación ----------------------------------------------------------------------
import { SEASONAL_FOODS, seasonOf, seasonalFoodsRule } from "../menu-rules.mjs";

test("la estación se calcula para el hemisferio sur", () => {
  const at = month => seasonOf(new Date(2026, month, 15));
  assert.deepEqual([0, 1, 2, 4, 5, 7, 8, 10, 11].map(at), ["verano", "verano", "otoño", "otoño", "invierno", "invierno", "primavera", "primavera", "verano"]);
});

test("los alimentos de estación llegan a la IA sin los que chocan con la ficha", () => {
  const rule = seasonalFoodsRule({}, new Date(2026, 0, 10));
  assert.match(rule, /Estamos en verano/);
  for (const food of SEASONAL_FOODS.verano) assert.ok(rule.includes(food), food);
  const filtered = seasonalFoodsRule({ allergies: "melón", avoids: "tomate" }, new Date(2026, 0, 10));
  assert.equal(filtered.includes("melón"), false);
  assert.equal(filtered.includes("tomate"), false);
  assert.ok(filtered.includes("sandía"));
  assert.equal(seasonalFoodsRule({ avoids: SEASONAL_FOODS.invierno.join(", ") }, new Date(2026, 6, 10)), "");
  for (const season of ["verano", "otoño", "invierno", "primavera"]) assert.ok(SEASONAL_FOODS[season].length >= 8, season);
});

test("la IA recibe la regla de estación en el menú semanal y al reemplazar una comida", async () => {
  const expected = seasonalFoodsRule(patient);
  let ai = mockAI(weekly());
  try { await generateWeeklyMenu(patient); assert.ok(ai.calls[0].instructions.includes(expected)); } finally { ai.restore(); }
  ai = mockAI({ meal: "Té con tostadas", reviewNote: "Revisá." });
  try { await regenerateMeal(patient, { dayIndex: 0, mealKey: "breakfast", instruction: "" }); assert.ok(ai.calls[0].instructions.includes(expected)); } finally { ai.restore(); }
});
