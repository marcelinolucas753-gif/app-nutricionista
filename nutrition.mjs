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
