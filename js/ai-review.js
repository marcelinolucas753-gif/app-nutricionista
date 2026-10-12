import { $, MEALS, api, escapeHTML, formatDateTime, toast } from "./util.js";
import { S } from "./state.js";
import { REASONS } from "./feedback.js";

/** Dos paneles al pie de «Ajustes de la IA»: las opiniones 👍/👎 guardadas (con opción de borrarlas) y el uso de la IA. */
const REASON_LABEL = Object.fromEntries(REASONS);
const MEAL_LABEL = Object.fromEntries(MEALS);
const LEARNING_DAYS = 120; // mismo plazo que usa el servidor (recentFeedback en ai-metrics.mjs)
const number = value => Number(value || 0).toLocaleString("es-AR");

export function renderAiPanels(root) {
  const feedback = document.createElement("section");
  feedback.className = "form-card ai-panel"; feedback.id = "ai-feedback-panel";
  feedback.innerHTML = `<h2>Opiniones que le diste a la IA</h2><p class="metric-caption">La IA se guía por tus 👍 y 👎 de los últimos ${LEARNING_DAYS} días al armar menús. Si una opinión ya no te representa, borrala y deja de influir.</p>`
    + `<div class="ai-panel-tools"><label>Mostrar<select id="feedback-filter"><option value="all">Todas</option><option value="down">Solo 👎</option><option value="up">Solo 👍</option></select></label><button type="button" class="button button-quiet text-danger" id="feedback-clear">Borrar todas</button></div><div id="feedback-list" class="feedback-list" aria-live="polite">Cargando…</div>`;
  const usage = document.createElement("section");
  usage.className = "form-card ai-panel"; usage.id = "ai-usage-panel";
  usage.innerHTML = `<h2>Uso de la IA</h2><p class="metric-caption">Cuántos pedidos se hicieron, cuánto tardaron y qué falló. Solo se guardan conteos: nada de las personas ni de sus menús.</p>`
    + `<div class="ai-panel-tools"><label>Período<select id="usage-days"><option value="7">Últimos 7 días</option><option value="30" selected>Últimos 30 días</option><option value="90">Últimos 90 días</option></select></label></div><div id="usage-body" aria-live="polite">Cargando…</div>`;
  root.append(feedback, usage);
  bindFeedbackPanel(feedback); bindUsagePanel(usage);
}

// ---------- Opiniones ----------
function feedbackRow(item) {
  const patient = item.patient_ref ? (S.patients.find(person => person.id === item.patient_ref)?.name?.trim() || "una ficha que ya no existe") : "";
  const old = Date.now() - new Date(item.created_at).getTime() > LEARNING_DAYS * 86_400_000;
  const what = item.scope === "plan" ? "Plan completo" : (MEAL_LABEL[item.meal_key] || "Comida");
  const tags = [...(item.reasons || []).map(reason => REASON_LABEL[reason]).filter(Boolean), ...(patient ? [`Solo para ${patient}`] : []), ...(old ? [`Ya no se usa (más de ${LEARNING_DAYS} días)`] : [])];
  return `<article class="feedback-item ${old ? "is-old" : ""}"><span class="feedback-rating" role="img" aria-label="${item.rating === "up" ? "Me sirve" : "No me sirve"}">${item.rating === "up" ? "👍" : "👎"}</span>`
    + `<div class="feedback-body"><strong>${escapeHTML(what)}</strong> <small>${escapeHTML(formatDateTime(item.created_at))}</small>${item.meal_text ? `<p>«${escapeHTML(item.meal_text)}»</p>` : ""}${tags.length ? `<div class="feedback-tags">${tags.map(tag => `<span class="tag">${escapeHTML(tag)}</span>`).join("")}</div>` : ""}</div>`
    + `<button type="button" class="button button-quiet text-danger" data-delete-feedback="${escapeHTML(item.id)}" aria-label="Borrar esta opinión">Borrar</button></article>`;
}

function bindFeedbackPanel(panel) {
  const list = panel.querySelector("#feedback-list"), filter = panel.querySelector("#feedback-filter"), clear = panel.querySelector("#feedback-clear");
  let items = [];
  const draw = () => {
    const shown = items.filter(item => filter.value === "all" || item.rating === filter.value);
    clear.disabled = !items.length;
    list.innerHTML = shown.length ? shown.map(feedbackRow).join("") : `<div class="recent-empty">${items.length ? "No hay opiniones con ese filtro." : "Todavía no diste opiniones. Aparecen acá cuando usás 👍 o 👎 en un menú o en una comida."}</div>`;
  };
  const load = async () => {
    try { items = (await api("/api/feedback")).items || []; draw(); }
    catch (error) { list.textContent = error.message || "No se pudieron cargar tus opiniones."; }
  };
  filter.addEventListener("change", draw);
  list.addEventListener("click", async event => {
    const button = event.target.closest("[data-delete-feedback]");
    if (!button) return;
    button.disabled = true;
    try { await api(`/api/feedback/${encodeURIComponent(button.dataset.deleteFeedback)}`, { method: "DELETE" }); items = items.filter(item => item.id !== button.dataset.deleteFeedback); draw(); toast("Opinión borrada. La IA ya no la tiene en cuenta."); }
    catch (error) { button.disabled = false; toast(error.message || "No se pudo borrar la opinión."); }
  });
  clear.addEventListener("click", async () => {
    if (!items.length || !window.confirm(`¿Borrar las ${items.length} opiniones? La IA vuelve a armar menús sin esa guía. No se puede deshacer.`)) return;
    clear.disabled = true;
    try { await api("/api/feedback/all", { method: "DELETE" }); items = []; draw(); toast("Se borraron todas las opiniones."); }
    catch (error) { clear.disabled = false; toast(error.message || "No se pudieron borrar las opiniones."); }
  });
  load();
}

// ---------- Uso de la IA ----------
function usageHTML(data) {
  if (!data.totals.requests) return `<div class="recent-empty">Todavía no hay pedidos a la IA en este período.</div>`;
  const rows = data.byKind.map(row => `<tr><th scope="row">${escapeHTML(row.label)}</th><td>${number(row.requests)}</td><td>${number(row.errors)}</td><td>${number(row.retries)}</td><td>${row.avgSeconds.toLocaleString("es-AR")} s</td><td>${number(row.inputTokens)}</td><td>${number(row.outputTokens)}</td></tr>`).join("");
  const total = data.totals;
  const cost = data.costUsd !== null
    ? `<p class="usage-cost"><strong>Costo estimado: US$ ${data.costUsd.toLocaleString("es-AR", { minimumFractionDigits: 2 })}</strong> <small>según las tarifas cargadas en el servidor; es una estimación, no tu factura.</small></p>`
    : `<p class="metric-caption">Para ver el costo estimado, quien administra el servicio carga en Render las variables <code>OPENAI_PRICE_INPUT_PER_MILLION</code> y <code>OPENAI_PRICE_OUTPUT_PER_MILLION</code> (dólares por millón de tokens, según la tarifa del modelo).</p>`;
  const errors = data.recentErrors.length ? `<h3>Últimos errores</h3><ul class="usage-errors">${data.recentErrors.map(item => `<li><strong>${escapeHTML(item.label)}</strong> · ${escapeHTML(formatDateTime(item.at))}<br><span>${escapeHTML(item.message)}${item.status ? ` (${escapeHTML(item.status)})` : ""}</span></li>`).join("")}</ul>` : "";
  return `<div class="usage-summary"><div><span class="metric-label">PEDIDOS</span><b>${number(total.requests)}</b></div><div><span class="metric-label">CON ERROR</span><b>${number(total.errors)}</b></div><div><span class="metric-label">CON REINTENTO</span><b>${number(total.retries)}</b></div><div><span class="metric-label">TIEMPO PROMEDIO</span><b>${total.avgSeconds.toLocaleString("es-AR")} s</b></div></div>${cost}`
    + `<div class="table-scroll"><table class="measure-table"><thead><tr><th scope="col">Función</th><th scope="col">Pedidos</th><th scope="col">Errores</th><th scope="col">Reintentos</th><th scope="col">Tiempo prom.</th><th scope="col">Tokens entrada</th><th scope="col">Tokens salida</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><th scope="row">Total</th><td>${number(total.requests)}</td><td>${number(total.errors)}</td><td>${number(total.retries)}</td><td>${total.avgSeconds.toLocaleString("es-AR")} s</td><td>${number(total.inputTokens)}</td><td>${number(total.outputTokens)}</td></tr></tfoot></table></div>`
    + `<p class="metric-caption">Un reintento significa que la IA tuvo que corregir algo (alergias, comidas repetidas, colaciones) y se hizo una segunda llamada. Los tokens son la medida con la que se cobra el servicio.</p>${errors}`;
}

function bindUsagePanel(panel) {
  const body = panel.querySelector("#usage-body"), select = panel.querySelector("#usage-days");
  const load = async () => {
    body.textContent = "Cargando…";
    try { body.innerHTML = usageHTML(await api(`/api/usage?days=${encodeURIComponent(select.value)}`)); }
    catch (error) { body.textContent = error.message || "No se pudo cargar el uso de la IA."; }
  };
  select.addEventListener("change", load);
  load();
}
