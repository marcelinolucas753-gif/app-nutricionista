/**
 * Estimación de gasto con Harris-Benedict revisada (Roza & Shizgal, 1984).
 * Calcula gasto basal y una estimación de gasto diario multiplicando por un
 * factor de actividad elegido por el profesional. Es una aproximación, no una
 * medición ni una indicación clínica; no extrapolar a embarazo, menores o
 * estados de desnutrición/enfermedad aguda.
 *
 * Factores convencionales de actividad (1.2, 1.375, 1.55, 1.725, 1.9): son
 * supuestos configurables, no coeficientes que formen parte de Harris-Benedict.
 */
export const ACTIVITY_FACTORS = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  high: 1.725,
  veryHigh: 1.9
};

export function getLatestMeasurement(person) {
  const ordered = [...(person?.measurements || [])].sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));
  if (!ordered.length) return null;
  const latest = { ...ordered[0] };
  for (const key of ["weight", "height", "waist", "hip"]) {
    if (latest[key] == null) latest[key] = ordered.slice(1).find(item => item[key] != null)?.[key] ?? null;
  }
  latest.bmi = latest.weight && latest.height ? Number((latest.weight / ((latest.height / 100) ** 2)).toFixed(1)) : null;
  return latest;
}

export function calculateHarrisBenedict({ age, weightKg, heightCm, equationSex }) {
  const years = Number(age);
  const weight = Number(weightKg);
  const height = Number(heightCm);
  if (!Number.isFinite(years) || years < 18 || years > 110 || !Number.isFinite(weight) || weight <= 0 || weight > 500 || !Number.isFinite(height) || height <= 0 || height > 250 || !["female", "male"].includes(equationSex)) return null;
  const basalKcal = equationSex === "male"
    ? 88.362 + (13.397 * weight) + (4.799 * height) - (5.677 * years)
    : 447.593 + (9.247 * weight) + (3.098 * height) - (4.330 * years);
  return Math.round(basalKcal);
}

/**
 * Reparto orientativo de kcal por comida (suma 100%). Es una distribución
 * convencional, no una indicación clínica; el profesional puede ajustarla
 * cambiando el objetivo energético desde la ficha.
 */
const MEAL_SLOT_SHARE = { breakfast: 0.20, snack1: 0.05, lunch: 0.30, merienda: 0.10, snack2: 0.05, dinner: 0.30 };
const MEAL_SLOT_LABELS = {
  breakfast: "Desayuno", snack1: "Colación de la mañana", lunch: "Almuerzo",
  merienda: "Merienda", snack2: "Colación de la tarde", dinner: "Cena"
};
const MAIN_MEAL_KEYS = ["breakfast", "lunch", "dinner"];

function portionTierForMainMeal(kcal) {
  if (kcal < 350) return { tier: "liviano", hint: "comida de tamaño chico: la porción principal del tamaño de una mano ahuecada, más una porción chica de proteína" };
  if (kcal < 550) return { tier: "moderado", hint: "comida de tamaño mediano (plato de unos 23 cm): una porción de proteína del tamaño de la palma de la mano, un puño de carbohidrato y vegetales a voluntad" };
  if (kcal < 750) return { tier: "abundante", hint: "comida de tamaño grande: una porción de proteína del tamaño de la palma y un puño y medio de carbohidrato, más vegetales" };
  return { tier: "amplio", hint: "comida de tamaño grande con un acompañamiento extra, por ejemplo una porción adicional de legumbre, cereal o pan" };
}
function portionTierForSnack(kcal) {
  if (kcal < 120) return { tier: "muy liviana", hint: "una fruta chica, o una infusión sola" };
  if (kcal < 220) return { tier: "liviana", hint: "una fruta mediana, o un yogur chico" };
  if (kcal < 320) return { tier: "moderada", hint: "un yogur con cereal, o una fruta con un puñado chico de frutos secos" };
  return { tier: "abundante", hint: "un sándwich chico, o una fruta con un puñado grande de frutos secos" };
}

/**
 * Traduce el objetivo energético en un tamaño de porción orientativo por
 * comida, en medidas caseras. Es una regla fija (no depende de que la IA
 * "adivine" el tamaño): la IA solo elige los alimentos; el tamaño de la
 * porción lo decide esta función a partir de las kcal del paciente.
 */
export function derivePortionGuidance(requirements) {
  if (!requirements?.dailyEnergyKcal) return null;
  const total = requirements.dailyEnergyKcal;
  const perSlot = {};
  for (const key of Object.keys(MEAL_SLOT_SHARE)) {
    const kcal = Math.round(total * MEAL_SLOT_SHARE[key]);
    const tierInfo = MAIN_MEAL_KEYS.includes(key) ? portionTierForMainMeal(kcal) : portionTierForSnack(kcal);
    perSlot[key] = { label: MEAL_SLOT_LABELS[key], approxShareKcal: kcal, tier: tierInfo.tier, hint: tierInfo.hint };
  }
  const proteinPercent = Number(requirements.macroDistribution?.proteinPercent) || 0;
  const proteinEmphasis = proteinPercent >= 20
    ? "El objetivo tiene énfasis en proteínas: priorizá una porción de proteína (carne, pollo, pescado, huevo, legumbres) bien presente en cada comida principal."
    : null;
  const overallTier = perSlot.lunch?.tier || perSlot.dinner?.tier || "moderado";
  return { perSlot, proteinEmphasis, overallTier };
}

export function calculatePatientRequirements(person) {
  const context = `${person?.condition || ""} ${person?.goal || ""} ${person?.context || ""}`;
  if (/\b(embarazad[oa]s?|embarazo|gestaci[oó]n|lactancia|desnutrici[oó]n|desnutrid[oa]s?|enfermedad aguda)\b/i.test(context)) return null;
  const latest = getLatestMeasurement(person);
  if (!latest || !person?.activityLevel || !ACTIVITY_FACTORS[person.activityLevel]) return null;
  const basalKcal = calculateHarrisBenedict({ age: person.age, weightKg: latest.weight, heightCm: latest.height, equationSex: person.equationSex });
  if (!basalKcal) return null;
  const activityFactor = ACTIVITY_FACTORS[person.activityLevel];
  const estimatedDailyEnergyKcal = Math.round(basalKcal * activityFactor);
  const adjustmentKcal = Number(person.energyAdjustmentKcal) || 0;
  const dailyEnergyKcal = Math.max(500, Math.round(estimatedDailyEnergyKcal + adjustmentKcal));
  return {
    method: "Harris-Benedict revisada (Roza y Shizgal, 1984)",
    basalKcal,
    activityFactor,
    estimatedDailyEnergyKcal,
    adjustmentKcal,
    dailyEnergyKcal,
    macroDistribution: { carbohydratePercent: 60, fatPercent: 25, proteinPercent: 15 }
  };
}
