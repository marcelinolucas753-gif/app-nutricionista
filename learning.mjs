// Aprendizaje a partir de las opiniones 👍 / 👎 de la profesional.
// No se entrena ningún modelo: se eligen unos pocos ejemplos reales de SU propia cuenta y se le
// muestran a la IA como guía en cada pedido. Todo se puede cambiar acá sin tocar el resto de la app.
import { analyzeText, normalizeText } from "./safety.mjs";
import { isFreeMeal } from "./menu-rules.mjs";

export const MAX_EXAMPLES = 6;          // ejemplos de cada tipo que se le muestran a la IA
export const MIN_PLAN_COMPLAINTS = 2;   // un motivo del plan completo debe repetirse para tenerlo en cuenta
const MAX_TEXT = 200;

// Mismos códigos que FEEDBACK_REASONS en ai-metrics.mjs, dichos en lenguaje natural.
export const REASON_PHRASES = {
  no_realista: "poco realista", muy_caro: "demasiado caro", muy_elaborado: "demasiado elaborado",
  no_es_de_la_zona: "poco habitual en la zona", porcion: "porción inadecuada", se_repite: "se repite demasiado", otro: "no le sirvió"
};

/**
 * Arma el resumen que se le manda a la IA. `rows` viene de la base, de la más nueva a la más vieja:
 * { scope, meal_key, rating, reasons, meal_text }. Devuelve null si no hay nada útil.
 * - Se descartan comidas que chocan con las alergias o alimentos evitados de ESTA persona.
 * - Si la misma comida tiene opiniones distintas, vale la más reciente.
 * - Con `slot` (una comida puntual), van primero los ejemplos de esa misma comida.
 */
export function buildLearning(rows, patient = {}, { slot } = {}) {
  const seen = new Set(), liked = [], disliked = [], planCounts = {};
  for (const row of Array.isArray(rows) ? rows : []) {
    if (row.patient_ref && row.patient_ref !== patient?.id) continue; // 👎 «solo para esa persona»
    if (row.scope === "plan") {
      if (row.rating === "down") for (const reason of row.reasons || []) planCounts[reason] = (planCounts[reason] || 0) + 1;
      continue;
    }
    const text = String(row.meal_text || "").trim().slice(0, MAX_TEXT);
    const key = normalizeText(text);
    if (!text || seen.has(key) || isFreeMeal(text) || analyzeText(patient, text).length) continue;
    seen.add(key);
    const example = { meal: row.meal_key, text };
    if (row.rating === "up") liked.push(example);
    else disliked.push({ ...example, problems: (row.reasons || []).map(reason => REASON_PHRASES[reason]).filter(Boolean) });
  }
  const pick = list => [...list.filter(item => item.meal === slot), ...list.filter(item => item.meal !== slot)].slice(0, MAX_EXAMPLES);
  const planComplaints = Object.entries(planCounts).filter(([, count]) => count >= MIN_PLAN_COMPLAINTS)
    .sort((a, b) => b[1] - a[1]).slice(0, 3).map(([reason]) => REASON_PHRASES[reason]).filter(Boolean);
  const result = { liked: pick(liked), disliked: pick(disliked), planComplaints };
  return result.liked.length || result.disliked.length || result.planComplaints.length ? result : null;
}

/** Frase que se agrega a las instrucciones de la IA cuando hay opiniones. */
export const LEARNING_INSTRUCTION = "Si input contiene professionalFeedback, son opiniones reales de la profesional sobre propuestas anteriores. «liked» muestra el tipo de comida que le sirvió: usalo como guía de estilo, sin copiarlas ni repetirlas tal cual. «disliked» muestra comidas que rechazó y por qué (problems): no propongas nada parecido y corregí ese problema. «planComplaints» son quejas frecuentes sobre planes completos. Estas opiniones nunca anulan las alergias, los alimentos evitados ni el resto de las reglas.";
