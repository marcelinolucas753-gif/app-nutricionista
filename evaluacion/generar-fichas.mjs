// Genera 100 fichas inventadas y variadas para probar los menús (no son personas reales).
// Es determinista: siempre produce las mismas 100 (para poder comparar antes y después de un cambio).
// Uso: node evaluacion/generar-fichas.mjs   → escribe evaluacion/fichas-100.json
import { writeFileSync } from "node:fs";

function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const random = rng(20261012);
const pick = list => list[Math.floor(random() * list.length)];
const between = (a, b) => a + Math.floor(random() * (b - a + 1));
const chance = p => random() < p;

// Frases tal como las escribiría una persona (con variantes, tildes, jerga y abreviaturas).
const ALLERGIES = [
  "maní", "alergia al maní y frutos secos", "huevo", "alérgica al huevo", "mariscos", "alergia a mariscos y pescados", "pescado",
  "celiaquía", "celíaco, sin TACC", "intolerancia al gluten", "alergia al trigo", "intolerancia a la lactosa", "no tolera la leche",
  "alergia a la proteína de la leche de vaca (APLV)", "alergia a la soja", "frutos secos (nueces, almendras)", "alergia al kiwi y a la banana",
  "sésamo", "alergia a la frutilla", "intolerancia a la fructosa", "maní, huevo", "lactosa y gluten", "alergia a las nueces", "camarones",
  "alérgico a la leche y derivados", "TACC", "no puede comer gluten (celíaca)", "alergia al pescado y mariscos", "huevos", "alergia a la avellana"
];
const AVOIDS = [
  "cerdo", "no come cerdo por religión", "hígado y achuras", "picante", "vegetariana", "vegana", "ovolactovegetariano", "no come carne roja",
  "no come pescado", "no le gustan las verduras cocidas", "no come carne", "fiambres y embutidos", "lácteos", "no toma leche", "cebolla",
  "evita las frituras", "no come mondongo ni achuras", "no como carne de vaca, solo pollo", "huevo", "morrón", "no le gusta el queso", "no come legumbres",
  "no tolera el ajo ni la cebolla", "evita el pollo", "no come ni carne ni pollo ni pescado", "pescado y mariscos", "gluten", "sin lactosa", "alimentos con soja"
];
const LIKES = ["milanesa, pastas", "pollo, arroz", "asado, ensalada", "frutas, yogur", "guiso de lentejas, polenta", "empanadas, pizza", "tortilla de papa, ensaladas", "mandioca, pescado de río", "sopa, puré", "tostadas, mate cocido", "carne al horno, papas", "fideos con tuco, pan casero", "verduras, huevo", "tarta de verduras, arroz con pollo", ""];
const GOALS = {
  general: ["Bajar de peso", "Ordenar horarios y comer más variado", "Ganar masa muscular", "Mejorar la energía durante el día", "Comer más sano en familia", "Mantener el peso", "Mejorar hábitos de merienda y colaciones"],
  diabetes2: ["Mejorar el control de la glucemia", "Bajar de peso y controlar la glucemia", "Reducir la hemoglobina glicosilada"],
  hipertension: ["Reducir la sal", "Bajar de peso y controlar la presión", "Mejorar la alimentación para la presión"],
  ambas: ["Control general de diabetes e hipertensión", "Bajar de peso y controlar glucemia y presión"]
};
const SCHEDULES = ["Trabaja de 8 a 17", "Trabaja de mañana", "Trabaja de tarde", "Turno noche en un hospital", "Estudia a la mañana", "Jubilado, está en su casa", "Ama de casa", "Trabaja desde casa", "Camionero, come en rutas", "Docente, dos turnos", "Trabaja en el campo", "Vendedora ambulante, come en la calle"];
const SPECIAL = [
  { context: "Embarazada de 20 semanas.", sex: "female", age: [22, 38] }, { context: "Embarazada de 34 semanas, con náuseas.", sex: "female", age: [22, 38] }, { context: "Embarazada de 12 semanas.", sex: "female", age: [22, 38] },
  { context: "Embarazada, tercer trimestre.", sex: "female", age: [22, 38] }, { context: "Embarazada de 8 semanas, muchas náuseas.", sex: "female", age: [22, 38] }, { context: "Embarazada de 28 semanas.", sex: "female", age: [22, 38] },
  { context: "En período de lactancia.", sex: "female", age: [22, 40] }, { context: "Lactancia exclusiva, bebé de 3 meses.", sex: "female", age: [22, 40] }, { context: "Está amamantando.", sex: "female", age: [22, 40] },
  { context: "Dificultad para masticar, usa prótesis dental.", age: [68, 84] }, { context: "Vive solo y cocina poco; problemas para masticar.", age: [68, 84] }, { context: "Adulto mayor, poco apetito.", age: [70, 85] },
  { context: "Entrena fuerza 5 veces por semana.", age: [20, 35] }, { context: "Corre 3 veces por semana.", age: [25, 45] }, { context: "Juega al fútbol los fines de semana.", age: [20, 40] },
  { context: "Muy poco presupuesto, vive con tres hijos.", age: [28, 45] }, { context: "Come lo que cocina el comedor del trabajo.", age: [30, 55] }
];
const KITCHENS = [[], ["oven"], ["microwave"], ["airfryer"], ["oven", "microwave"], ["oven", "microwave", "airfryer"], ["microwave", "airfryer"]];
const LUNCH_PLACES = ["home", "work_microwave", "work_basic", "outside"];
const ACTIVITY = ["sedentary", "light", "moderate", "high"];

const plan = [["general", 40], ["diabetes2", 20], ["hipertension", 20], ["ambas", 20]].flatMap(([condition, n]) => Array(n).fill(condition));
// Mezcla estable para que no queden agrupadas por condición.
for (let i = plan.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [plan[i], plan[j]] = [plan[j], plan[i]]; }

const fichas = plan.map((condition, index) => {
  const special = chance(0.2) ? pick(SPECIAL) : null;
  const sex = special?.sex || pick(["female", "male"]);
  const [lo, hi] = special?.age || (condition === "general" ? [18, 70] : condition === "diabetes2" ? [40, 78] : condition === "hipertension" ? [40, 80] : [45, 80]);
  const height = sex === "female" ? between(150, 175) : between(160, 190);
  const bmi = condition === "general" ? 18.5 + random() * 14 : 24 + random() * 12;
  const weight = Math.round(bmi * (height / 100) ** 2 * 10) / 10;
  const allergy = chance(0.45) ? (chance(0.12) ? `${pick(ALLERGIES)}, ${pick(ALLERGIES)}` : pick(ALLERGIES)) : "";
  const avoid = chance(0.45) ? pick(AVOIDS) : "";
  const lunchPlace = pick(LUNCH_PLACES);
  const id = `t${String(index + 1).padStart(3, "0")}`;
  return {
    id, name: `Prueba ${String(index + 1).padStart(3, "0")}`, age: between(lo, hi), condition, goal: pick(GOALS[condition]),
    likes: pick(LIKES), avoids: avoid, allergies: allergy, budget: pick(["economico", "economico", "medio", "flexible"]),
    schedule: pick(SCHEDULES), lunchPlace, cookingTime: pick(["poco", "medio", "mucho", ""]), kitchen: pick(KITCHENS),
    context: special?.context || (chance(0.3) ? pick(["Come en familia.", "Vive sola.", "Hace las compras una vez por semana.", "Le cuesta cocinar entre semana."]) : ""),
    equationSex: sex, activityLevel: pick(ACTIVITY), budgetNote: undefined,
    measurements: [{ id: "m1", date: "2026-09-01", weight, height, createdAt: 1 }]
  };
}).map(({ budgetNote, ...ficha }) => ficha);

writeFileSync(new URL("./fichas-100.json", import.meta.url), JSON.stringify(fichas, null, 1));
const count = key => fichas.filter(f => f[key]).length;
console.log(`100 fichas · alergias: ${count("allergies")} · evitados: ${count("avoids")} · embarazo/lactancia: ${fichas.filter(f => /embaraz|lactancia|amamant/i.test(f.context)).length}`);
