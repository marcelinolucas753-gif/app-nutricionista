// Opciones rápidas para «Reemplazar comida»: la profesional toca lo que quiere cambiar
// en lugar de escribirlo. El resultado es el mismo texto de instrucción que ya entiende el servidor.
export const QUICK_OPTIONS = [
  ["simple", "Más simple y rápida", "más simple y rápida de preparar"],
  ["barata", "Más económica", "más económica"],
  ["sin_horno", "Sin horno", "que no necesite horno"],
  ["trabajo", "Para llevar al trabajo", "fácil de llevar y comer en el trabajo"],
  ["sin_harinas", "Con menos harinas", "con menos harinas"],
  ["liviana", "Más liviana", "más liviana"],
  ["regional", "Más de la zona", "con ingredientes y platos típicos de la zona"]
];
const MAX_INSTRUCTION = 500; // el servidor corta en 500 caracteres

/** Une las opciones tocadas y el texto libre en una sola instrucción (vacía si no se eligió nada). */
export function buildReplaceInstruction(selectedKeys = [], freeText = "") {
  const wanted = QUICK_OPTIONS.filter(([key]) => selectedKeys.includes(key)).map(([, , phrase]) => phrase);
  const parts = [];
  if (wanted.length) parts.push(`Que la nueva comida sea ${wanted.join(", ")}.`);
  const extra = String(freeText || "").trim();
  if (extra) parts.push(extra);
  return parts.join(" ").slice(0, MAX_INSTRUCTION);
}
