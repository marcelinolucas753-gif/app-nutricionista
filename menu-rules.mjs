/**
 * Reglas para que los menús de la IA sean prácticos, realistas y propios de la zona.
 *
 * ──────────────────────────────────────────────────────────────────────────
 *  PARTE 1 · LO QUE SE PUEDE CORREGIR SIN SABER PROGRAMAR
 *  Todo lo de esta sección es texto: se puede cambiar, sumar o borrar
 *  elementos de las listas (cada uno entre comillas y separado por coma).
 *  Son BORRADORES para que la profesional los revise y corrija.
 * ──────────────────────────────────────────────────────────────────────────
 */

/** Zona de referencia que se le explica a la IA. */
export const REGION = "Resistencia, Chaco (nordeste argentino)";

/** Alimentos habituales y accesibles en la zona. La IA los prioriza. */
export const FOODS_COMMON = [
  "pan, tostadas, galletitas de agua, galletas de salvado",
  "queso cremoso, queso port salut, ricota, yogur, leche",
  "huevo, pollo, carne vacuna de cortes económicos (nalga, paleta, peceto, carnaza), cerdo, carne picada",
  "arroz, fideos, polenta, avena, lentejas, porotos, garbanzos",
  "mandioca, batata, papa, zapallo, choclo",
  "tomate, cebolla, morrón, zanahoria, zapallito, calabaza, acelga, lechuga, repollo",
  "banana, naranja, mandarina, manzana, pera, pomelo, mamón, sandía y melón en verano",
  "mate cocido, té, café con leche, mermelada, dulce de membrillo o de batata"
];

/** Alimentos que NO se usan por ser caros, difíciles de conseguir o poco habituales en la zona. */
export const FOODS_AVOID_BY_DEFAULT = [
  "salmón y otros pescados importados o caros",
  "pescado en general (se consume poco en la zona); solo si la ficha indica que a la persona le gusta",
  "quinoa, chía, semillas de lino en cantidad, arándanos y frutos rojos, kale, espárragos",
  "tofu, tempeh, seitán, hummus, bebidas vegetales caras, harinas especiales, proteína en polvo",
  "pistachos, almendras y nueces como base de una comida (solo un puñado chico como colación, si corresponde)"
];

/** Cómo deben ser las comidas livianas (desayuno, merienda y colaciones). */
export const LIGHT_MEAL_STYLE = {
  breakfast: "infusión (mate cocido, té, café con leche o leche) más tostadas o pan con queso, mermelada o dulce; a veces huevos revueltos, yogur o una fruta. Se prepara en menos de 10 minutos. Sin verduras cocidas, sin tortillas, tartas, guisos ni preparaciones al horno.",
  merienda: "igual de simple que el desayuno: infusión más tostadas o pan con queso o mermelada, galletitas, yogur o una fruta. Sin preparaciones elaboradas.",
  snack: "una fruta, un yogur (solo o con cereal) o un sándwich simple (pan con queso, jamón cocido, huevo duro o tomate)."
};

/** Dónde almuerza la persona (lo que aparece en la ficha) y qué le pedimos a la IA. */
export const LUNCH_PLACES = {
  home: { label: "En su casa", rule: "Almuerza en su casa: puede cocinar, pero igual evitá recetas largas." },
  work_microwave: { label: "En el trabajo, con microondas y heladera", rule: "Almuerza en el trabajo con microondas y heladera: elegí viandas que se preparen de un día para el otro y se recalienten, o platos fríos fáciles de transportar." },
  work_basic: { label: "En el trabajo, sin heladera ni microondas", rule: "Almuerza en el trabajo SIN heladera ni microondas: el almuerzo tiene que poder comerse frío o a temperatura ambiente y aguantar varias horas (por ejemplo sándwich completo, ensalada con arroz o fideos fríos, tarta fría simple ya hecha). No propongas platos que se echen a perder o que requieran calentarse." },
  outside: { label: "Afuera (comedor, vianda comprada o restaurante)", rule: "Come afuera: el almuerzo tiene que ser una pauta simple para elegir en el lugar (por ejemplo, plato de carne o pollo con ensalada), no una receta para cocinar." }
};

/**
 * Sábado y domingo: almuerzo y cena son libres, con una pauta simple.
 * Estos textos NO nombran alimentos a propósito: así nunca chocan con una
 * alergia, una intolerancia o algo que la persona evita.
 */
export const WEEKEND_FREE = {
  general: "Libre: elegí lo que más te guste. Pauta: armá un plato equilibrado, con la mitad de vegetales, una porción de proteína y un acompañamiento a elección. Tomá agua.",
  diabetes2: "Libre: elegí lo que más te guste. Pauta: la mitad del plato de vegetales, una porción de proteína y un solo acompañamiento con carbohidratos. Tomá agua o bebidas sin azúcar.",
  hipertension: "Libre: elegí lo que más te guste. Pauta: la mitad del plato de vegetales, una porción de proteína y un acompañamiento a elección. Cociná con hierbas y especias, sin agregar sal en la mesa, y evitá los productos procesados y salados.",
  ambas: "Libre: elegí lo que más te guste. Pauta: la mitad del plato de vegetales, una porción de proteína y un solo acompañamiento con carbohidratos. Cociná con hierbas y especias, sin agregar sal en la mesa, evitá los productos procesados y salados, y tomá agua o bebidas sin azúcar."
};

/**
 * Recomendaciones base por condición. Aparecen siempre en el plan y la IA suma
 * recomendaciones personalizadas. Evitá números con g, ml o % (los planes usan
 * medidas caseras) y evitá nombrar alimentos concretos (por las alergias).
 */
export const BASE_RECOMMENDATIONS = {
  general: [
    "Respetá los horarios de las comidas y no te saltees el desayuno ni la merienda.",
    "Tomá agua durante todo el día y elegila antes que las gaseosas o los jugos.",
    "Dejá la mitad del plato para los vegetales en el almuerzo y la cena."
  ],
  diabetes2: [
    "Mantené horarios regulares y no pases muchas horas sin comer.",
    "Elegí un solo acompañamiento con carbohidratos por comida.",
    "Evitá las gaseosas, los jugos azucarados y el azúcar agregado; elegí agua o infusiones sin azúcar."
  ],
  hipertension: [
    "Cociná con hierbas, ajo, limón y especias en lugar de sal, y no pongas el salero en la mesa.",
    "Limitá los productos procesados y salados, y los caldos y sopas en sobre.",
    "Mirá las etiquetas y preferí los productos con menos sodio."
  ],
  ambas: [
    "Mantené horarios regulares y un solo acompañamiento con carbohidratos por comida.",
    "Cociná con hierbas, ajo, limón y especias en lugar de sal, y limitá los productos procesados, salados y los caldos en sobre.",
    "Evitá las gaseosas y los jugos azucarados; elegí agua o infusiones sin azúcar."
  ]
};

/**
 * Palabras que delatan una preparación elaborada en el desayuno o la merienda.
 * Si la IA las usa, la app le pide una vez que las cambie por algo más simple.
 */
export const ELABORATE_WORDS = [
  "tortilla", "tarta", "guiso", "saltado", "salteado", "empanada", "milanesa", "al horno", "horneado",
  "omelette", "omelet", "souffle", "revuelto de verduras", "salsa",
  "acelga", "espinaca", "morron", "brocoli", "berenjena", "zapallito", "puerro", "coliflor", "repollo"
];

/**
 * Cuántas veces puede repetirse EXACTAMENTE el mismo almuerzo (o la misma cena)
 * de lunes a viernes. Repetir hasta 2 veces es práctico (se cocina una vez y se
 * come dos); más que eso, la app le pide a la IA que lo cambie.
 */
export const MAX_SAME_LUNCH_OR_DINNER = 2;

/**
 * ──────────────────────────────────────────────────────────────────────────
 *  PARTE 2 · LÓGICA (no hace falta tocarla)
 * ──────────────────────────────────────────────────────────────────────────
 */
import { DAY_NAMES, normalizeText } from "./safety.mjs";

const WEEKEND_INDEXES = [5, 6];
const WEEKEND_SLOTS = ["lunch", "dinner"];
const LIGHT_SLOTS = [["breakfast", "desayuno"], ["merienda", "merienda"]];
const SLOT_LABELS = { breakfast: "el desayuno", merienda: "la merienda" };

/** Texto de reglas que se agrega a las instrucciones de la IA. */
export function menuStyleInstructions() {
  return [
    `Contexto: la persona vive en ${REGION}. Priorizá alimentos y preparaciones que se consumen habitualmente allí, accesibles y de precio razonable, aunque el presupuesto no sea el más bajo. Alimentos habituales de referencia: ${FOODS_COMMON.join("; ")}.`,
    `No uses alimentos caros, difíciles de conseguir o poco habituales en la zona: ${FOODS_AVOID_BY_DEFAULT.join("; ")}. No propongas platos poco realistas para el día a día.`,
    `El desayuno (breakfast) debe ser: ${LIGHT_MEAL_STYLE.breakfast}`,
    `La merienda (merienda) debe ser: ${LIGHT_MEAL_STYLE.merienda}`,
    `Las colaciones (snack1 y snack2) deben ser: ${LIGHT_MEAL_STYLE.snack}`,
    "Almuerzo y cena pueden ser más variados, pero prácticos: pocos ingredientes, pasos simples y repetí ingredientes entre comidas para evitar desperdicio. Variá entre los días sin inventar platos complejos.",
    `No repitas exactamente el mismo almuerzo ni la misma cena más de ${MAX_SAME_LUNCH_OR_DINNER} veces de lunes a viernes; sí podés repetir ingredientes base y preparaciones parecidas para que sea práctico.`,
    "Prioridad: adherencia y practicidad. Pensá primero qué puede preparar y comer esta persona sin esfuerzo en su rutina.",
    "Sábado y domingo (días 6 y 7): el almuerzo (lunch) y la cena (dinner) son LIBRES. En esos cuatro campos escribí solamente la palabra «Libre»; el sistema agrega la pauta. El desayuno, las colaciones y la merienda de esos días sí se proponen como el resto de la semana.",
    "En recommendations escribí solo 3 recomendaciones PERSONALIZADAS para esta persona (por ejemplo sobre su rutina, sus gustos o dificultades), sin repetir las de baseRecommendations."
  ].join(" ");
}

/** Regla puntual según dónde almuerza la persona. */
export function lunchPlaceRule(lunchPlace) {
  return LUNCH_PLACES[lunchPlace]?.rule || "";
}

/** Regla de estilo para reemplazar una sola comida. */
export function singleMealStyleRule(mealKey) {
  if (mealKey === "breakfast") return `Esta comida es un desayuno: ${LIGHT_MEAL_STYLE.breakfast}`;
  if (mealKey === "merienda") return `Esta comida es una merienda: ${LIGHT_MEAL_STYLE.merienda}`;
  if (mealKey === "snack1" || mealKey === "snack2") return `Esta comida es una colación: ${LIGHT_MEAL_STYLE.snack}`;
  return "Que sea práctica, de pocos ingredientes y de la zona.";
}

/** Recomendaciones base según la condición de la ficha. */
export function baseRecommendationsFor(condition) {
  return [...(BASE_RECOMMENDATIONS[condition] || BASE_RECOMMENDATIONS.general)];
}

/** Pauta libre de fin de semana según la condición. */
export function weekendFreeText(condition) {
  return WEEKEND_FREE[condition] || WEEKEND_FREE.general;
}

/** ¿Esta comida es la pauta libre del fin de semana (empieza con «Libre»)? */
export function isFreeMeal(text) { return /^libre\b/i.test(String(text || "").trim()); }

/** Fuerza «Libre» + pauta en almuerzo y cena de sábado y domingo. */
export function applyFreeWeekend(draft, condition) {
  const text = weekendFreeText(condition);
  for (const index of WEEKEND_INDEXES) {
    const day = draft.days?.[index];
    if (!day) continue;
    for (const slot of WEEKEND_SLOTS) day[slot] = text;
  }
  return draft;
}

/** Une las recomendaciones base con las personalizadas de la IA, sin repetirlas. */
export function mergeRecommendations(condition, aiRecommendations = []) {
  const merged = [...baseRecommendationsFor(condition)];
  const seen = new Set(merged.map(item => normalizeText(item)));
  for (const item of aiRecommendations) {
    const text = String(item || "").trim();
    const key = normalizeText(text);
    if (!text || seen.has(key)) continue;
    seen.add(key);
    merged.push(text);
  }
  return merged.slice(0, 6);
}

function elaborateRegex() {
  const words = ELABORATE_WORDS.map(word => normalizeText(word).replace(/ \| /g, " ")).filter(Boolean)
    .map(word => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`(?<![a-z0-9])(?:${words.join("|")})(?:es|s)?(?![a-z0-9])`, "g");
}

/** Devuelve las comidas livianas del borrador que parecen elaboradas. */
export function findElaborateLightMeals(draft) {
  const regex = elaborateRegex();
  const found = [];
  (draft?.days || []).forEach((day, index) => {
    for (const [slot] of LIGHT_SLOTS) {
      const text = normalizeText(day?.[slot] || "");
      const matches = [...new Set(text.match(regex) || [])];
      if (matches.length) found.push({ dayIndex: index, day: day?.day, slot, words: matches });
    }
  });
  return found;
}

export function describeElaborate(item) {
  return `${item.day || `Día ${item.dayIndex + 1}`}: ${SLOT_LABELS[item.slot]} usa «${item.words.join("», «")}»; reemplazalo por algo simple y rápido (${item.slot === "breakfast" ? LIGHT_MEAL_STYLE.breakfast : LIGHT_MEAL_STYLE.merienda})`;
}

const REPEAT_SLOTS = [["lunch", "almuerzo"], ["dinner", "cena"]];
const WEEKDAY_INDEXES = [0, 1, 2, 3, 4];

/** Almuerzos o cenas idénticos que se repiten de lunes a viernes más veces de lo permitido. */
export function findRepeatedMeals(draft) {
  const found = [];
  for (const [slot, label] of REPEAT_SLOTS) {
    const groups = new Map();
    for (const index of WEEKDAY_INDEXES) {
      const text = draft?.days?.[index]?.[slot];
      const key = typeof text === "string" && !isFreeMeal(text) ? normalizeText(text) : "";
      if (key) groups.set(key, [...(groups.get(key) || []), index]);
    }
    for (const indexes of groups.values()) {
      if (indexes.length > MAX_SAME_LUNCH_OR_DINNER) found.push({ slot, label, text: draft.days[indexes[0]][slot], dayIndexes: indexes });
    }
  }
  return found;
}

export function describeRepeated(item) {
  const days = item.dayIndexes.map(index => DAY_NAMES[index]).join(", ");
  return `El ${item.label} «${item.text}» se repite ${item.dayIndexes.length} días de lunes a viernes (${days}); cambialo en al menos ${item.dayIndexes.length - MAX_SAME_LUNCH_OR_DINNER} de esos días por otra opción práctica.`;
}
