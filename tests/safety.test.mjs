import test from "node:test";
import assert from "node:assert/strict";
import { analyzeDraft, analyzeText, hasAllergyConflicts, hasExactNutritionAmounts, matchRestrictions, normalizeText, parseRestrictionTerms } from "../safety.mjs";

const foods = (restrictions, text) => matchRestrictions(restrictions, text).map(item => item.food);

test("detecta cantidades exactas pero no medidas caseras", () => {
  for (const text of ["100 g de arroz", "250ml de leche", "500 kcal", "2 gramos", "el 10% del total", "30 % de grasa", "5 gr"]) assert.equal(hasExactNutritionAmounts(text), true, text);
  for (const text of ["1 taza de arroz", "2 gajos de naranja", "1/2 plato", "una porción del tamaño de la palma", "Pan integral con queso fresco"]) assert.equal(hasExactNutritionAmounts(text), false, text);
});

test("normaliza tildes, ñ y puntuación", () => {
  assert.equal(normalizeText("Maní, ÑOQUIS (de papa)"), "mani | noquis | de papa |".replace(/ \|$/, " |").trim());
  assert.ok(!normalizeText("Café con leche.").includes("é"));
});

test("separa las restricciones declaradas", () => {
  assert.deepEqual(parseRestrictionTerms("Alergia a la leche de vaca, intolerancia a la lactosa y celiaquía; no come cerdo"), ["leche de vaca", "lactosa", "celiaquia", "cerdo"]);
  assert.deepEqual(parseRestrictionTerms("ninguna"), []);
  assert.deepEqual(parseRestrictionTerms(""), []);
});

test("alergia a la leche: lácteos sí, leches vegetales no", () => {
  assert.deepEqual(foods("alergia a la leche", "Yogur natural con frutas"), ["yogur"]);
  assert.ok(foods("alergia a la leche", "Tostada con queso fresco").includes("queso"));
  assert.deepEqual(foods("alergia a la leche", "Café con leche de almendras"), []);
});

test("intolerancia a la lactosa acepta productos sin lactosa", () => {
  assert.deepEqual(foods("lactosa", "Leche deslactosada con cereales"), []);
  assert.ok(foods("lactosa", "Vaso de leche con avena").includes("leche"));
});

test("celiaquía: marca el gluten pero no los productos sin TACC", () => {
  assert.deepEqual(foods("celíaca", "Tostadas de pan sin gluten con palta"), []);
  assert.deepEqual(foods("celiaquía", "Galletas de arroz con queso"), []);
  const mixed = foods("celíaca", "Fideos de trigo y galletas sin gluten");
  assert.ok(mixed.includes("trigo") && mixed.includes("fideo"));
  assert.ok(foods("gluten", "Pan con jamón").includes("pan"));
});

test("el trigo nunca se perdona aunque aparezca la frase sin gluten", () => {
  assert.ok(foods("celíaca", "Pan de trigo, galletas sin gluten").includes("trigo"));
});

test("frutos secos, maní y otros", () => {
  assert.ok(foods("frutos secos", "Yogur con nueces").includes("nueces"));
  assert.deepEqual(foods("frutos secos", "Postre con nuez moscada"), []);
  assert.deepEqual(foods("maní", "Ensalada con nueces"), []);
  assert.ok(foods("maní", "Pasta de maní con banana").includes("mani"));
  assert.ok(foods("alergia a los mariscos", "Arroz con langostinos").includes("langostino"));
  assert.ok(foods("huevo", "Tortilla de papas").includes("tortilla"));
  assert.deepEqual(foods("huevo", "Tortilla de maíz con palta"), []);
  assert.ok(foods("soja", "Salteado con tofu").includes("tofu"));
});

test("alergias no declaradas generan búsqueda literal", () => {
  assert.deepEqual(foods("alergia al kiwi", "Ensalada de frutas: kiwi, manzana"), ["kiwi"]);
  assert.deepEqual(foods("kiwi", "Manzana y pera"), []);
});

test("analyzeDraft ubica día y comida, y distingue alergia de preferencia", () => {
  const patient = { allergies: "alergia a la leche", avoids: "no me gusta el hígado" };
  const draft = { days: Array.from({ length: 7 }, (_, i) => ({ day: ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"][i], breakfast: i === 1 ? "Yogur con frutas" : "Té con tostadas", snack1: "Fruta", lunch: i === 2 ? "Hígado salteado con arroz" : "Pollo con ensalada", snack2: "Infusión", merienda: "Mate", dinner: "Sopa de verduras", extra: "" })) };
  const conflicts = analyzeDraft(patient, draft);
  assert.equal(conflicts.length, 2);
  const milk = conflicts.find(item => item.severity === "allergy");
  assert.equal(milk.dayLabel, "Martes");
  assert.equal(milk.slotKey, "breakfast");
  assert.equal(milk.food, "yogur");
  const liver = conflicts.find(item => item.severity === "avoid");
  assert.equal(liver.dayLabel, "Miércoles");
  assert.equal(hasAllergyConflicts(conflicts), true);
  assert.equal(hasAllergyConflicts(conflicts.filter(item => item.severity === "avoid")), false);
});

test("sin alergias cargadas no hay conflictos", () => {
  assert.deepEqual(analyzeText({}, "Queso, nueces y pan"), []);
  assert.deepEqual(analyzeDraft({}, null), []);
});
