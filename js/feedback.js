import { api, escapeHTML } from "./util.js";

// Los mismos códigos que FEEDBACK_REASONS en ai-metrics.mjs (el servidor descarta cualquier otro).
const REASONS = [
  ["no_realista", "Poco realista"], ["muy_caro", "Muy caro"], ["muy_elaborado", "Muy elaborado"],
  ["no_es_de_la_zona", "No es de la zona"], ["porcion", "Porción"], ["se_repite", "Se repite"], ["otro", "Otro"]
];

/** Botones 👍 👎 para el plan completo (scope «plan») o para una comida (scope «meal»). */
export function feedbackHTML(scope, mealKey = "") {
  const meal = scope === "meal" ? ` data-feedback-meal="${escapeHTML(mealKey)}"` : "";
  return `<span class="feedback no-print" data-feedback-scope="${scope}"${meal}>`
    + `<button type="button" class="button button-quiet" data-rating="up" aria-label="Esta propuesta me sirve" title="Me sirve">👍</button>`
    + `<button type="button" class="button button-quiet" data-rating="down" aria-label="Esta propuesta no me sirve" title="No me sirve">👎</button></span>`;
}

async function send(box, rating, reasons) {
  const mealKey = box.dataset.feedbackMeal || undefined;
  const mealText = mealKey ? box.closest(".meal-edit")?.querySelector("textarea")?.value : undefined;
  box.textContent = "Guardando…";
  try {
    await api("/api/feedback", { method: "POST", body: { scope: box.dataset.feedbackScope, rating, reasons, mealKey, mealText } });
    box.textContent = "¡Gracias! ✓";
  } catch { box.textContent = "No se pudo guardar tu opinión."; }
}

function askReasons(box) {
  box.innerHTML = `<span class="feedback-reasons">${REASONS.map(([key, label]) => `<label><input type="checkbox" value="${key}"> ${label}</label>`).join("")}`
    + `<button type="button" class="button button-quiet" data-send>Enviar</button></span>`;
  box.querySelector("[data-send]").addEventListener("click", () => send(box, "down", [...box.querySelectorAll("input:checked")].map(input => input.value)));
}

/** Conecta todos los botones de opinión que haya dentro de `root`. */
export function bindFeedback(root) {
  root.querySelectorAll(".feedback").forEach(box => box.addEventListener("click", event => {
    const button = event.target.closest("[data-rating]");
    if (!button) return;
    if (button.dataset.rating === "up") send(box, "up", []); else askReasons(box);
  }));
}
