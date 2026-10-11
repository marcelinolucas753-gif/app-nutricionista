/**
 * Controles de seguridad alimentaria y de formato del menú.
 *
 * Este archivo se usa tanto en el navegador como en el servidor. No decide nada
 * clínico: detecta coincidencias entre lo que la ficha declara (alergias,
 * intolerancias, alimentos que se evitan) y lo que dice el texto del menú, para
 * que el profesional las revise. Una lista vacía de coincidencias NO garantiza
 * que el menú sea seguro: puede haber ingredientes ocultos o nombres que no
 * estén en las listas.
 */

export const MEAL_SLOTS = [
  ["breakfast", "Desayuno"],
  ["snack1", "Colación de la mañana"],
  ["lunch", "Almuerzo"],
  ["snack2", "Colación de la tarde"],
  ["merienda", "Merienda"],
  ["dinner", "Cena"]
];
export const DAY_NAMES = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

/** Detecta calorías, gramos, mililitros o porcentajes (los menús usan medidas caseras). */
export function hasExactNutritionAmounts(value) {
  const text = String(value ?? "");
  return /(?<![\w])\d+(?:[.,]\d+)?\s*(?:kcal|calor[ií]as?|kg|gramos?|gr|g|mg|mililitros?|ml)(?![\p{L}\d])/iu.test(text)
    || /\d+(?:[.,]\d+)?\s*%/.test(text);
}

/** Minúsculas, sin tildes, con separadores de frase convertidos en "|". */
export function normalizeText(value = "") {
  return String(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[,;:.()\[\]{}\/+\-–—•*\n\r\t!?¡¿"“”]+/g, " | ")
    .replace(/[^a-z0-9| ]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/(?: \|)+ ?/g, " | ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(text) { return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function phraseRegex(phrase) {
  const words = normalizeText(phrase).split(" ").filter(Boolean);
  if (!words.length) return null;
  const last = words.pop();
  const body = [...words.map(escapeRegExp), `${escapeRegExp(last)}(?:es|s)?`].join(" ");
  return new RegExp(`(?<![a-z0-9])${body}(?![a-z0-9])`, "g");
}

const SIN_GLUTEN = /^(?:[a-z0-9]+ ){0,3}(?:sin|libre de) (?:gluten|tacc)(?![a-z0-9])|^(?:[a-z0-9]+ ){0,2}apto celiacos?(?![a-z0-9])/;
const SIN_LACTOSA = /^(?:[a-z0-9]+ ){0,2}(?:sin lactosa|libre de lactosa|deslactosad[oa]s?)(?![a-z0-9])/;
const LECHE_VEGETAL = /^(?:de )?(?:vegetal|vegano|vegana|(?:de )?(?:soja|coco|almendras?|avena|arroz|castanas?|nueces|nuez))(?![a-z0-9])/;
const SIN_CEREAL_GLUTEN = /^de (?:arroz|maiz|mandioca|almendras?|garbanzos?|legumbres|coco|quinoa|lentejas?)(?![a-z0-9])/;
const TORTILLA_NO_HUEVO = /^de (?:trigo|maiz|harina|avena)(?![a-z0-9])/;

const LACTEOS_FOODS = ["leche", "lacteo", "queso", "yogur", "yogurt", "ricota", "manteca", "mantequilla", "crema", "dulce de leche", "muzzarella", "mozzarella", "mozarela", "cremoso", "cuartirolo", "provolone", "parmesano", "sardo", "reggianito", "requeson", "flan", "kefir", "helado", "leche en polvo", "caseina", "suero de leche", "bechamel", "salsa blanca", "postre de leche"];

// Alimentación vegetariana o vegana, y "no como carne": sin estos grupos, escribir «vegetariana» en la ficha
// no detectaba nada (ni bife ni pollo ni jamón). «Carne» sola se toma como carne vacuna y derivados.
const PESCADO_FOODS = ["pescado", "merluza", "salmon", "atun", "caballa", "sardina", "surubi", "dorado", "pacu", "trucha", "lenguado", "anchoa", "bacalao", "pejerrey", "boga", "abadejo", "surimi"];
const MARISCOS_FOODS = ["marisco", "crustaceo", "molusco", "camaron", "camarones", "langostino", "calamar", "mejillon", "pulpo", "cangrejo", "centolla", "vieira", "almeja", "ostra", "langosta", "frutos de mar"];
const CERDO_FOODS = ["cerdo", "bondiola", "panceta", "jamon", "pechito", "tocino", "chorizo"];
const POLLO_FOODS = ["pollo", "pechuga", "muslo", "pata muslo", "suprema", "alita", "pavo", "gallina", "nugget", "ave"];
const CARNE_ROJA_FOODS = ["carne", "carne picada", "carne vacuna", "vacuno", "ternera", "bife", "asado", "vacio", "costilla", "costillar", "matambre", "nalga", "peceto", "cuadril", "lomo", "lomito", "entrana", "osobuco", "falda", "bola de lomo", "roast beef", "cordero", "chorizo", "morcilla", "salchicha", "salame", "mortadela", "fiambre", "paleta", "pate", "bacon"];
// Platos que pueden ser de carne o vegetales («milanesa de berenjena», «hamburguesa de lentejas»).
const PLATOS_DE_CARNE = ["milanesa", "hamburguesa", "albondiga"];
const DE_VEGETAL = /^de (?:soja|vegetal(?:es)?|verduras?|berenjenas?|lentejas?|garbanzos?|legumbres|zapallo|calabaza|zanahorias?|quinoa|arroz|avena|choclo|espinacas?|acelgas?|porotos?|hongos|champinones|seitan)(?![a-z0-9])|^(?:vegetal(?:es)?|veggie|vegana|vegano|vegetariana|vegetariano)(?![a-z0-9])/;
const DE_OTRA_CARNE = /^de (?:pollo|pavo|ave|aves|pescado|merluza|atun|salmon)(?![a-z0-9])/;

/**
 * Cada grupo: triggers (palabras que, dentro de lo declarado, activan el grupo),
 * foods (alimentos a buscar en el menú), strict (alimentos que nunca se
 * "perdonan" aunque diga "sin gluten") y excuse (frases que, justo después del
 * alimento, indican que no corresponde, p. ej. "leche de almendras").
 */
const GROUPS = [
  { id: "lacteos", label: "lácteos", triggers: ["leche", "lacteo", "lacteos", "aplv", "caseina", "proteina de la leche", "proteina de leche", "proteinas de la leche", "queso", "yogur", "vegano", "vegana"], foods: LACTEOS_FOODS, excuse: [LECHE_VEGETAL] },
  { id: "lactosa", label: "lactosa", triggers: ["lactosa"], foods: LACTEOS_FOODS, excuse: [SIN_LACTOSA, LECHE_VEGETAL] },
  { id: "gluten", label: "gluten (TACC)", triggers: ["gluten", "celiaco", "celiaca", "celiaquia", "celiacos", "tacc", "trigo"],
    strict: ["trigo", "harina de trigo", "cebada", "centeno", "malta", "seitan", "semola", "cuscus", "cous cous", "bulgur"],
    foods: ["trigo", "harina de trigo", "cebada", "centeno", "malta", "seitan", "semola", "cuscus", "cous cous", "bulgur", "avena", "pan", "pan rallado", "tostada", "galletita", "galleta", "fideo", "pasta", "tallarin", "espagueti", "spaghetti", "ravioles", "canelones", "noqui", "sorrentinos", "lasana", "pizza", "empanada", "tarta", "masa", "rapidita", "wrap", "milanesa", "rebozado", "empanado", "rebozador", "bizcochuelo", "budin", "torta", "factura", "medialuna", "bizcocho", "grisin", "cracker", "panqueque", "crepe", "cerveza", "sandwich", "sanguche", "tostado", "harina", "cereales", "cereal", "granola", "muesli"],
    excuse: [SIN_GLUTEN, SIN_CEREAL_GLUTEN] },
  { id: "huevo", label: "huevo", triggers: ["huevo", "huevos", "clara", "yema", "albumina", "vegano", "vegana"],
    foods: ["huevo", "clara", "yema", "omelette", "omelet", "tortilla", "mayonesa", "merengue", "souffle", "frittata", "revuelto", "flan", "albumina"], excuse: [TORTILLA_NO_HUEVO] },
  { id: "mani", label: "maní", triggers: ["mani", "cacahuate", "cacahuete"], foods: ["mani", "cacahuate", "cacahuete", "manteca de mani", "pasta de mani", "mantequilla de mani"] },
  { id: "frutos_secos", label: "frutos secos", triggers: ["frutos secos", "fruto seco", "nuez", "nueces", "almendra", "almendras", "avellana", "avellanas", "castana", "castanas", "pistacho", "pistachos", "pecan", "macadamia", "caju", "anacardo"],
    foods: ["frutos secos", "fruto seco", "nuez", "nueces", "almendra", "avellana", "castana", "castana de caju", "caju", "anacardo", "pistacho", "pecan", "macadamia", "mani", "turron"], excuse: [/^moscada(?![a-z0-9])/] },
  { id: "soja", label: "soja", triggers: ["soja", "soya"], foods: ["soja", "soya", "tofu", "tempeh", "edamame", "miso"] },
  { id: "pescado", label: "pescado", triggers: ["pescado", "pescados", "merluza", "salmon", "atun", "caballa", "sardina", "trucha", "surubi", "bacalao"],
    foods: PESCADO_FOODS },
  { id: "mariscos", label: "mariscos", triggers: ["marisco", "mariscos", "crustaceo", "crustaceos", "molusco", "moluscos", "camaron", "camarones", "langostino", "langostinos", "calamar", "mejillon", "frutos de mar"],
    foods: MARISCOS_FOODS },
  { id: "sesamo", label: "sésamo", triggers: ["sesamo", "ajonjoli", "tahini", "tahina"], foods: ["sesamo", "ajonjoli", "tahini", "tahina"] },
  { id: "legumbres", label: "legumbres", triggers: ["legumbre", "legumbres"], foods: ["legumbres", "lenteja", "garbanzo", "poroto", "arveja", "soja", "habas", "hummus"] },
  { id: "cerdo", label: "cerdo", triggers: ["cerdo"], foods: CERDO_FOODS },
  { id: "fiambres", label: "fiambres y embutidos", triggers: ["fiambre", "embutido"], foods: ["fiambre", "embutido", "jamon", "jamon crudo", "jamon cocido", "salame", "mortadela", "paleta", "lomito", "pate", "bacon", "salchicha", "salchichon", "longaniza", "chorizo", "morcilla", "panceta", "tocino"] },
  { id: "pollo", label: "pollo y aves", triggers: ["pollo", "ave", "pavo", "gallina"], foods: POLLO_FOODS, excuse: [DE_VEGETAL] },
  { id: "carne_roja", label: "carne vacuna y derivados", triggers: ["carne", "carne roja", "carnes rojas", "carne vacuna", "carne de vaca", "vacuno"],
    foods: [...CARNE_ROJA_FOODS, ...PLATOS_DE_CARNE], excuse: [DE_VEGETAL, DE_OTRA_CARNE] },
  { id: "vegetariano", label: "carnes y pescados (alimentación vegetariana)", triggers: ["vegetariano", "vegetariana", "vegano", "vegana"],
    foods: [...CARNE_ROJA_FOODS, ...PLATOS_DE_CARNE, ...POLLO_FOODS, ...CERDO_FOODS, ...PESCADO_FOODS, ...MARISCOS_FOODS, "conejo"], excuse: [DE_VEGETAL] },
  { id: "origen_animal", label: "otros alimentos de origen animal (alimentación vegana)", triggers: ["vegano", "vegana"], foods: ["miel", "gelatina", "grenetina"] }
];

const LEADING_PHRASES = [
  /^(?:alergia|alergias|alergico|alergica|alergicos|intolerancia|intolerancias|intolerante)(?: a| al| a la| a los| a las| de| de la| de los)? /,
  /^(?:no me gustan?|no le gustan?|no tolera|no come|no puede comer|no consume|no toma|evita|evitar|nada de|sin|libre de) /,
  /^(?:el|la|los|las|al|a la|a los|a las) /
];

function stripLeading(term) {
  let current = term.trim();
  for (let i = 0; i < 4; i++) {
    let changed = false;
    for (const pattern of LEADING_PHRASES) {
      const next = current.replace(pattern, "");
      if (next !== current) { current = next; changed = true; }
    }
    if (!changed) break;
  }
  return current.trim();
}

/** Convierte el texto libre de alergias/evitar en términos individuales ya normalizados. */
export function parseRestrictionTerms(text, { maxWords = 6 } = {}) {
  const normalized = normalizeText(text);
  if (!normalized) return [];
  const raw = normalized.split(/ \| | y | e | o | ni /).flatMap(part => part.split("|"));
  const terms = [];
  for (const part of raw) {
    const term = stripLeading(part);
    if (!term || term.split(" ").length > maxWords) continue;
    if (/^(?:alergia|intolerancia|alergias|ninguna|ninguno|no|nada|no tiene|sin alergias|n a)$/.test(term)) continue;
    if (!terms.includes(term)) terms.push(term);
  }
  return terms;
}

function groupsForTerm(term) {
  const found = [];
  for (const group of GROUPS) {
    const hit = group.triggers.some(trigger => {
      const regex = phraseRegex(trigger);
      return regex && regex.test(term);
    });
    if (hit) found.push(group);
  }
  return found;
}

function buildMatchers(term) {
  const groups = groupsForTerm(term);
  const matchers = [];
  if (groups.length) {
    for (const group of groups) {
      const strict = new Set((group.strict || []).map(item => normalizeText(item)));
      for (const food of group.foods) matchers.push({ food, regex: phraseRegex(food), excuse: strict.has(normalizeText(food)) ? [] : (group.excuse || []), group: group.id });
    }
  } else {
    matchers.push({ food: term, regex: phraseRegex(term), excuse: [], group: "generic" });
    // Si el término es "pollo asado", también vale buscar solo la palabra principal más larga.
    const words = term.split(" ").filter(word => word.length >= 5);
    if (words.length > 1) for (const word of words) matchers.push({ food: word, regex: phraseRegex(word), excuse: [], group: "generic" });
  }
  return matchers.filter(item => item.regex);
}

function excused(normalized, endIndex, excuseList) {
  if (!excuseList.length) return false;
  const rest = normalized.slice(endIndex).replace(/^ /, "");
  const segment = rest.split("|")[0].trim();
  return excuseList.some(regex => regex.test(segment));
}

/**
 * Busca coincidencias entre las restricciones declaradas y un texto cualquiera.
 * Devuelve [{ restriction, food, group }].
 */
export function matchRestrictions(restrictionText, text) {
  const normalized = ` ${normalizeText(text)} `.trim();
  if (!normalized) return [];
  const results = [];
  for (const term of parseRestrictionTerms(restrictionText)) {
    for (const matcher of buildMatchers(term)) {
      matcher.regex.lastIndex = 0;
      let match;
      while ((match = matcher.regex.exec(normalized))) {
        if (!excused(normalized, match.index + match[0].length, matcher.excuse)) {
          if (!results.some(item => item.restriction === term && item.food === matcher.food)) results.push({ restriction: term, food: matcher.food, group: matcher.group });
        }
        if (match[0].length === 0) matcher.regex.lastIndex += 1;
      }
    }
  }
  return results;
}

/**
 * Revisa el menú semanal de un borrador. `severity` es "allergy" para lo cargado
 * en alergias/intolerancias y "avoid" para alimentos que la persona evita.
 */
export function analyzeDraft(patient, draft) {
  const conflicts = [];
  if (!draft || !Array.isArray(draft.days)) return conflicts;
  const sources = [["allergy", patient?.allergies || ""], ["avoid", patient?.avoids || ""]];
  draft.days.forEach((day, dayIndex) => {
    const slots = [...MEAL_SLOTS, ["extra", "Alternativa"]];
    for (const [key, label] of slots) {
      const text = day?.[key];
      if (typeof text !== "string" || !text.trim()) continue;
      for (const [severity, restrictions] of sources) {
        for (const hit of matchRestrictions(restrictions, text)) {
          if (severity === "avoid" && conflicts.some(item => item.dayIndex === dayIndex && item.slotKey === key && item.food === hit.food && item.severity === "allergy")) continue;
          conflicts.push({ severity, dayIndex, dayLabel: day.day || DAY_NAMES[dayIndex] || `Día ${dayIndex + 1}`, slotKey: key, slotLabel: label, food: hit.food, restriction: hit.restriction });
        }
      }
    }
  });
  return conflicts;
}

/** Revisa un texto suelto (una comida, una receta, una sugerencia). */
export function analyzeText(patient, text) {
  const out = [];
  for (const [severity, restrictions] of [["allergy", patient?.allergies || ""], ["avoid", patient?.avoids || ""]]) {
    for (const hit of matchRestrictions(restrictions, text)) out.push({ severity, food: hit.food, restriction: hit.restriction });
  }
  return out;
}

export function describeConflict(conflict) {
  const where = conflict.dayLabel ? `${conflict.dayLabel} · ${conflict.slotLabel}: ` : "";
  const why = conflict.severity === "allergy" ? "alergia o intolerancia declarada" : "alimento que la persona evita";
  return `${where}«${conflict.food}» (${why}: ${conflict.restriction})`;
}

export function hasAllergyConflicts(conflicts) { return conflicts.some(item => item.severity === "allergy"); }
