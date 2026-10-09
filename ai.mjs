/**
 * Funciones de IA (OpenAI). Cada una recibe la ficha ya leída de la base y
 * devuelve un borrador validado. Las respuestas se revisan contra las alergias
 * e intolerancias declaradas; si hay coincidencias se pide una corrección una
 * vez y, si persisten, no se devuelve nada.
 */
import { fail } from "./validation.mjs";
import { calculatePatientRequirements, derivePortionGuidance } from "./nutrition.mjs";
import { DAY_NAMES, MEAL_SLOTS, analyzeDraft, analyzeText, describeConflict, hasExactNutritionAmounts } from "./safety.mjs";
import { noteCall } from "./ai-metrics.mjs";
import { LEARNING_INSTRUCTION } from "./learning.mjs";
import { LUNCH_PLACES, applyFreeWeekend, baseRecommendationsFor, describeElaborate, describeRepeated, findElaborateLightMeals, findRepeatedMeals, isFreeMeal, lunchPlaceRule, menuStyleInstructions, mergeRecommendations, singleMealStyleRule } from "./menu-rules.mjs";

const mealKeys = MEAL_SLOTS.map(([key]) => key);

const CONDITION_LABELS = { general: "Objetivo general", diabetes2: "Diabetes tipo 2", hipertension: "Hipertensión", ambas: "Diabetes tipo 2 · Hipertensión" };
const BUDGET_LABELS = { economico: "Económico", medio: "Medio", flexible: "Flexible" };

const weeklySchema = {
  type: "object", additionalProperties: false, required: ["intro", "days", "recommendations", "reviewNotes"],
  properties: {
    intro: { type: "string" },
    days: { type: "array", minItems: 7, maxItems: 7, items: { type: "object", additionalProperties: false, required: ["day", "breakfast", "snack1", "lunch", "snack2", "merienda", "dinner", "extra"], properties: { day: { type: "string" }, breakfast: { type: "string" }, snack1: { type: "string" }, lunch: { type: "string" }, snack2: { type: "string" }, merienda: { type: "string" }, dinner: { type: "string" }, extra: { type: "string" } } } },
    recommendations: { type: "array", minItems: 3, maxItems: 6, items: { type: "string" } },
    reviewNotes: { type: "array", minItems: 1, maxItems: 5, items: { type: "string" } }
  }
};
const consultationSchema = { type: "object", additionalProperties: false, required: ["summary", "questions"], properties: { summary: { type: "string" }, questions: { type: "array", minItems: 3, maxItems: 6, items: { type: "string" } } } };
const mealSchema = { type: "object", additionalProperties: false, required: ["meal", "reviewNote"], properties: { meal: { type: "string" }, reviewNote: { type: "string" } } };
const recipeSchema = {
  type: "object", additionalProperties: false, required: ["name", "portions", "ingredients", "steps", "timeMinutes", "difficulty", "reviewNote"],
  properties: {
    name: { type: "string" }, portions: { type: "string" },
    ingredients: { type: "array", minItems: 2, maxItems: 14, items: { type: "object", additionalProperties: false, required: ["quantity", "measure", "ingredient"], properties: { quantity: { type: "string" }, measure: { type: "string" }, ingredient: { type: "string" } } } },
    steps: { type: "array", minItems: 2, maxItems: 10, items: { type: "string" } }, timeMinutes: { type: "integer", minimum: 5, maximum: 240 }, difficulty: { type: "string", enum: ["Fácil", "Media", "Avanzada"] }, reviewNote: { type: "string" }
  }
};
const substitutesSchema = { type: "object", additionalProperties: false, required: ["options", "reviewNote"], properties: { options: { type: "array", minItems: 3, maxItems: 5, items: { type: "object", additionalProperties: false, required: ["name", "idea"], properties: { name: { type: "string" }, idea: { type: "string" } } } }, reviewNote: { type: "string" } } };
const shoppingSchema = {
  type: "object", additionalProperties: false, required: ["categories", "reviewNote"],
  properties: {
    categories: { type: "array", minItems: 2, maxItems: 12, items: { type: "object", additionalProperties: false, required: ["name", "items"], properties: { name: { type: "string" }, items: { type: "array", minItems: 1, maxItems: 30, items: { type: "object", additionalProperties: false, required: ["item", "quantity"], properties: { item: { type: "string" }, quantity: { type: "string" } } } } } } },
    reviewNote: { type: "string" }
  }
};

/** Llama a OpenAI y registra tiempo y tokens para la medición (ai-metrics.mjs). */
export async function callOpenAI(args) {
  const model = process.env.OPENAI_MODEL || "gpt-6-luna";
  let usage;
  try { return await requestOpenAI(args, model, found => { usage = found; }); }
  finally { noteCall({ model, usage }); }
}

async function requestOpenAI({ name, schema, instructions, input }, model, onUsage) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw fail("Falta configurar la clave de OpenAI en el servidor.", 503);
  let response;
  try {
    response = await fetch(process.env.OPENAI_BASE_URL || "https://api.openai.com/v1/responses", {
      method: "POST", headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" }, signal: AbortSignal.timeout(60_000),
      body: JSON.stringify({ model, instructions, input: JSON.stringify(input), text: { format: { type: "json_schema", name, strict: true, schema } } })
    });
  } catch (error) { throw fail(error?.name === "TimeoutError" ? "La solicitud de IA tardó demasiado. Volvé a intentar." : "No se pudo conectar con la IA. Revisá la conexión y volvé a intentar.", 502); }
  let payload; try { payload = await response.json(); } catch { throw fail("La IA devolvió una respuesta que no se pudo leer.", 502); }
  onUsage(payload?.usage);
  if (!response.ok) {
    const code = payload?.error?.code || payload?.error?.type || "";
    if (response.status === 401 || code === "invalid_api_key") throw fail("La clave de IA configurada no fue aceptada.", 502);
    if (response.status === 429) throw fail("La IA aplicó un límite temporal o de uso. Volvé a intentar más tarde.", 502);
    if (code === "insufficient_quota" || code === "billing_hard_limit_reached") throw fail("La cuenta de IA alcanzó su límite de facturación.", 502);
    throw fail(`El servicio de IA respondió con un error (${response.status}).`, 502);
  }
  const outputText = Array.isArray(payload?.output) ? payload.output.flatMap(item => Array.isArray(item?.content) ? item.content : []).filter(item => item?.type === "output_text" && typeof item.text === "string").map(item => item.text).join("") : "";
  if (payload?.status !== "completed" || !outputText) throw fail("La IA no completó una respuesta con el formato esperado. Volvé a intentar.", 502);
  try { return JSON.parse(outputText); } catch { throw fail("La IA devolvió un formato incorrecto. No se guardó nada; volvé a intentar.", 502); }
}

const ALLERGY_RULE = "Si el input tiene el campo allergies con contenido, son alergias o intolerancias DECLARADAS: nunca incluyas esos alimentos, sus derivados evidentes (por ejemplo, queso, yogur o manteca si hay alergia a la leche) ni platos que normalmente los llevan como ingrediente principal. Si aparece el campo mustFix, corregí exactamente esos puntos. Un producto 'sin gluten' o 'sin lactosa' solo puede usarse si corresponde a la restricción declarada, y siempre pedí revisar la etiqueta.";
const CONFLICT_ERROR = "La IA propuso alimentos que coinciden con alergias o intolerancias de la ficha, incluso después de pedirle una corrección. No se guardó nada. Volvé a intentar o revisá cómo están cargadas las alergias.";

function patientContext(patient) {
  return {
    age: Number(patient.age), condition: CONDITION_LABELS[patient.condition] || "Ficha", goal: patient.goal,
    likes: patient.likes || "", avoids: patient.avoids || "", allergies: patient.allergies || "", schedule: patient.schedule || "", context: patient.context || "",
    lunchPlace: LUNCH_PLACES[patient.lunchPlace]?.label || "No especificado"
  };
}

function checkMenuStructure(output) {
  if (!Array.isArray(output.days) || output.days.length !== 7 || output.days.some(day => mealKeys.some(key => typeof day[key] !== "string" || !day[key].trim())) || hasExactNutritionAmounts(JSON.stringify(output))) {
    throw fail("La IA no devolvió siete días completos en porciones caseras; no se guardó el resultado. Volvé a intentar.", 502);
  }
}

export async function generateWeeklyMenu(patient, learning = null) {
  const requirements = calculatePatientRequirements(patient);
  const portionGuidance = requirements ? derivePortionGuidance(requirements) : null;
  const base = {
    ...patientContext(patient), budget: BUDGET_LABELS[patient.budget] || "Medio",
    likes: patient.likes || "No especificado", avoids: patient.avoids || "No especificado", schedule: patient.schedule || "No especificado", context: patient.context || "No especificado",
    requirements: requirements ? { dailyEnergyKcal: requirements.dailyEnergyKcal, macroDistribution: requirements.macroDistribution } : null,
    portionGuidance, baseRecommendations: baseRecommendationsFor(patient.condition),
    ...(learning ? { professionalFeedback: learning } : {})
  };
  const instructions = `Sos un asistente para un estudiante avanzado de nutrición. Redactás borradores educativos para revisión profesional; no diagnostiques ni inventes información clínica. Usa alimentos cotidianos, económicos según presupuesto, y medidas caseras fáciles de entender (taza, rodaja, unidad, cucharada, plato o tamaño de la palma). No indiques gramos por alimento ni calorías o porcentajes de macros en el menú. Si input contiene portionGuidance, usá el campo perSlot (una entrada por breakfast, snack1, lunch, snack2, merienda, dinner) como regla OBLIGATORIA de tamaño de porción para esa comida: el campo hint de cada entrada ya describe, en medidas caseras, qué tan grande debe ser esa comida; elegí alimentos reales que encajen en ese tamaño, sin repetir los números de approxShareKcal ni mencionar la palabra kcal o calorías en el texto. Si portionGuidance incluye proteinEmphasis, aplicá esa indicación en las comidas principales. Si no hay requirements ni portionGuidance, usá porciones moderadas estándar y decilo en reviewNotes. No prometas precisión ni cambies mantenimiento por déficit/superávit. ${ALLERGY_RULE} Respetá los alimentos evitados, preferencias y horarios que efectivamente se indiquen en la ficha. No agregues exclusiones alimentarias que no estén indicadas. Para una alimentación vegetariana, respetá la preferencia si está expresada. No afirmes que un producto está libre de contaminación cruzada; recordá revisar etiqueta y manipulación cuando corresponda. Para diabetes tipo 2 e hipertensión, da recomendaciones generales prudentes sin ajustar medicamentos. Si falta información necesaria, dilo en reviewNotes. En español rioplatense. Cada día incluye desayuno (breakfast), colación matutina (snack1), almuerzo (lunch), colación vespertina (snack2), merienda (merienda), cena (dinner) y extra con una alternativa opcional. Las notas de revisión recuerdan validar alergias, medicación y adecuación individual. ${menuStyleInstructions()} ${lunchPlaceRule(patient.lunchPlace)} ${LEARNING_INSTRUCTION} Si aparece el campo mustFix, corregí exactamente esos puntos y dejá todo lo demás igual.`;
  // Dos intentos como máximo. Las alergias son obligatorias: si persisten, no se devuelve nada.
  // Las comidas livianas elaboradas se corrigen una vez; si la IA insiste, se avisa en las notas de revisión.
  let mustFix, fallback;
  for (let attempt = 0; attempt < 2; attempt++) {
    const output = await callOpenAI({ name: "weekly_meal_draft", schema: weeklySchema, instructions, input: mustFix ? { ...base, mustFix } : base });
    checkMenuStructure(output);
    const allergies = analyzeDraft(patient, output).filter(item => item.severity === "allergy");
    const issues = { elaborate: findElaborateLightMeals(output), repeated: findRepeatedMeals(output) };
    const hasIssues = issues.elaborate.length > 0 || issues.repeated.length > 0;
    if (!allergies.length) {
      if (!hasIssues || attempt === 1) return finishMenu(patient, output, issues);
      fallback = { output, issues }; // borrador seguro, por si el segundo intento trae una alergia
    } else if (attempt === 1) {
      if (fallback) return finishMenu(patient, fallback.output, fallback.issues);
      throw fail(CONFLICT_ERROR, 502);
    }
    mustFix = [...allergies.map(describeConflict), ...issues.elaborate.map(describeElaborate), ...issues.repeated.map(describeRepeated)];
  }
  throw fail(CONFLICT_ERROR, 502);
}

/** Aplica el fin de semana libre y las recomendaciones base; avisa lo que no se pudo mejorar. */
function finishMenu(patient, output, issues = { elaborate: [], repeated: [] }) {
  output.days.forEach((day, index) => { day.day = DAY_NAMES[index]; });
  applyFreeWeekend(output, patient.condition);
  output.recommendations = mergeRecommendations(patient.condition, output.recommendations);
  const notes = [];
  if (issues.elaborate.length) notes.push(`Revisá estas comidas livianas, que podrían ser más simples: ${issues.elaborate.map(item => `${item.day || `día ${item.dayIndex + 1}`} (${SLOT_SHORT[item.slot]})`).join(", ")}.`);
  for (const item of issues.repeated) notes.push(`Se repite el mismo ${item.label} (${item.dayIndexes.length} días de lunes a viernes): «${item.text}». Conviene variarlo.`);
  if (!patient.lunchPlace) notes.push("No se indicó dónde almuerza la persona: completalo en la ficha para que el almuerzo se adapte a su rutina.");
  output.reviewNotes = [...notes, ...(Array.isArray(output.reviewNotes) ? output.reviewNotes : [])].slice(0, 5);
  return output;
}
const SLOT_SHORT = { breakfast: "desayuno", merienda: "merienda" };

export async function summarizeConsultations(patient) {
  const consultations = [...(patient.consultations || [])].sort((a, b) => String(a.date || "").localeCompare(String(b.date || ""))).slice(-12).map(item => ({ date: item.date, reason: item.reason, notes: item.notes, adherence: item.adherence, recommendations: item.recommendations }));
  if (!consultations.length) throw fail("Esta ficha todavía no tiene consultas registradas.");
  return callOpenAI({ name: "consultation_summary", schema: consultationSchema, instructions: "Resumí las notas de consulta para que un profesional las revise y sugerí preguntas neutrales para el próximo encuentro. No diagnostiques ni infieras hechos que no estén escritos. Si algo no consta, no lo inventes. En español claro y conciso. La respuesta es un borrador interno para revisión.", input: { consultations } });
}

export async function regenerateMeal(patient, { dayIndex, mealKey, instruction, learning = null }) {
  const day = patient.draft?.days?.[dayIndex];
  if (!Number.isInteger(dayIndex) || dayIndex < 0 || dayIndex > 6 || !mealKeys.includes(mealKey) || !day) throw fail("No encontramos esa comida del plan.");
  const requirements = calculatePatientRequirements(patient);
  const slotGuidance = requirements ? derivePortionGuidance(requirements)?.perSlot?.[mealKey] : null;
  const base = {
    ...patientContext(patient),
    requirements: requirements ? { dailyEnergyKcal: requirements.dailyEnergyKcal, macroDistribution: requirements.macroDistribution } : null,
    portionGuidance: slotGuidance, day: day.day, currentMeal: day[mealKey],
    otherMealsThatDay: mealKeys.filter(other => other !== mealKey).map(other => day[other]), instruction: instruction || "", ...(learning ? { professionalFeedback: learning } : {})
  };
  delete base.context;
  const instructions = `Proponé una sola comida en español rioplatense y medidas caseras. Si input contiene portionGuidance, su campo hint describe, en medidas caseras, el tamaño OBLIGATORIO de esta comida: elegí alimentos reales que encajen en ese tamaño, sin repetir números de kcal ni mencionar calorías. Respetá la comida, las preferencias y restricciones que aparecen en el contexto. ${ALLERGY_RULE} No agregues exclusiones no indicadas. No des gramos, calorías ni porcentajes. Es un borrador que revisará un profesional. No afirmes equivalencia clínica. ${singleMealStyleRule(mealKey)} ${mealKey === "lunch" ? lunchPlaceRule(patient.lunchPlace) : ""} Priorizá alimentos habituales y accesibles de la zona; no uses ingredientes caros o poco comunes. ${LEARNING_INSTRUCTION}`;
  let mustFix;
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await callOpenAI({ name: "replacement_meal", schema: mealSchema, instructions, input: mustFix ? { ...base, mustFix } : base });
    if (!result.meal?.trim() || hasExactNutritionAmounts(result.meal)) throw fail("La sugerencia no vino en medidas caseras. No se aplicó; volvé a intentar.", 502);
    const conflicts = analyzeText(patient, result.meal).filter(item => item.severity === "allergy");
    if (!conflicts.length) return result;
    mustFix = conflicts.map(item => `«${item.food}» coincide con la alergia o intolerancia «${item.restriction}»`);
  }
  throw fail(CONFLICT_ERROR, 502);
}

export async function createRecipe(patient, { meal, portions }) {
  if (!meal) throw fail("Elegí una comida para preparar la receta.");
  const base = { meal, preferences: patient.likes || "", avoid: patient.avoids || "", allergies: patient.allergies || "", goal: patient.goal || "", requestedPortions: Math.min(12, Math.max(1, Number(portions) || 2)) };
  const instructions = `Convertí la comida en una receta sencilla para pacientes, con cantidades expresadas solo en medidas caseras (taza, unidad, cucharada, rodaja, plato, etc.), sin gramos ni mililitros. Incluí pasos claros, porciones, tiempo y dificultad. Respeta únicamente las restricciones efectivamente indicadas. ${ALLERGY_RULE} No afirmes equivalencias clínicas ni seguridad ante contaminación cruzada; el profesional revisa el borrador.`;
  let mustFix;
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await callOpenAI({ name: "household_recipe", schema: recipeSchema, instructions, input: mustFix ? { ...base, mustFix } : base });
    if (hasExactNutritionAmounts(JSON.stringify(result))) throw fail("La receta incluyó cantidades que no son medidas caseras. No se guardó; volvé a intentar.", 502);
    const recipeText = [result.name, ...(result.ingredients || []).map(item => `${item.quantity} ${item.measure} ${item.ingredient}`)].join(" | ");
    const conflicts = analyzeText(patient, recipeText).filter(item => item.severity === "allergy");
    if (!conflicts.length) return result;
    mustFix = conflicts.map(item => `«${item.food}» coincide con la alergia o intolerancia «${item.restriction}»`);
  }
  throw fail(CONFLICT_ERROR, 502);
}

export async function suggestSubstitutions(patient, { meal, ingredient }) {
  if (!meal || !ingredient) throw fail("Indicá la comida y el alimento que querés reemplazar.");
  const base = { meal, ingredient, preferences: patient.likes || "", avoid: patient.avoids || "", allergies: patient.allergies || "", goal: patient.goal || "" };
  const instructions = `Sugiere tres a cinco ideas para reemplazar un ingrediente dentro de una comida. No afirmes que sean nutricional o clínicamente equivalentes; explica en una nota qué debe comprobar el profesional. Usa medidas caseras, respeta preferencias y restricciones registradas, y no agregues exclusiones que no estén indicadas. ${ALLERGY_RULE} Respuesta en español rioplatense.`;
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await callOpenAI({ name: "meal_substitution_ideas", schema: substitutesSchema, instructions, input: base });
    if (hasExactNutritionAmounts(JSON.stringify(result))) throw fail("La respuesta incluyó cantidades que no son medidas caseras. Volvé a intentarlo.", 502);
    const safe = result.options.filter(option => !analyzeText(patient, `${option.name} | ${option.idea}`).some(item => item.severity === "allergy"));
    if (safe.length) return { ...result, options: safe };
  }
  throw fail(CONFLICT_ERROR, 502);
}

// Las comidas libres del fin de semana no llevan compras: la IA no debe ver la pauta larga.
const FREE_MEAL_FOR_SHOPPING = "Libre (la persona elige): no sumar nada a la lista";

export async function generateShoppingList(patient, days) {
  if (!Array.isArray(days) || !days.length || days.length > 7) throw fail("No hay un menú semanal para armar la lista.");
  const meals = days.map(day => Object.fromEntries([["day", String(day?.day || "").slice(0, 20)], ...mealKeys.map(key => [key, isFreeMeal(day?.[key]) ? FREE_MEAL_FOR_SHOPPING : String(day?.[key] || "").slice(0, 600)])]));
  const result = await callOpenAI({
    name: "weekly_shopping_list", schema: shoppingSchema,
    instructions: "Armá una lista de compras para UNA persona durante una semana, a partir del menú semanal del input. Agrupá por sección de la compra (verdulería, frutas, carnes y huevos, lácteos, almacén, panadería, etc.). Sumá lo que se repite. Las cantidades son aproximadas, en unidades de compra o medidas caseras (unidades, atados, docena, paquete, lata, frasco, bolsa, bandeja, cabeza, tazas) y SIN gramos, kilos, mililitros, calorías ni porcentajes. Las comidas que dicen «Libre» no llevan compras: no agregues ningún alimento por ellas. No agregues alimentos que no estén en el menú, salvo condimentos básicos (sal, aceite, vinagre) que podés incluir en almacén. En español rioplatense. En reviewNote aclará que son cantidades orientativas que el profesional debe revisar.",
    input: { meals }
  });
  if (hasExactNutritionAmounts(JSON.stringify(result))) throw fail("La lista incluyó cantidades en gramos o litros. No se guardó; volvé a intentar.", 502);
  return result;
}

