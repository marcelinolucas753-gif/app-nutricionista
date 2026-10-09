import { $, DAYS, MEALS, api, copyText, escapeHTML, formatDateTime, openExternal, patientName, toast } from "./util.js";
import { S, ensureSaved, queueSave } from "./state.js";
import { draftFromTemplate, hasDeclaredAllergies, logHistory, makeTemplate, uid } from "./logic.js";
import { bindFeedback, feedbackHTML } from "./feedback.js";
import { QUICK_OPTIONS, buildReplaceInstruction } from "./meal-options.js";
import { analyzeDraft, analyzeText, describeConflict, hasAllergyConflicts, hasExactNutritionAmounts } from "../safety.mjs";
import { buildShoppingMessage, whatsappLink } from "../contact.mjs";
import { calculatePatientRequirements, derivePortionGuidance } from "../nutrition.mjs";

const TIER_LABEL = { liviano: "porciones livianas", moderado: "porciones moderadas (plato mediano)", abundante: "porciones abundantes (plato grande)", amplio: "porciones amplias, con acompañamiento extra" };
const hasDraft = person => Boolean(person.draft && Array.isArray(person.draft.days));

// ---------- Cambios en pantalla ----------
/** Pasa lo escrito en las cajas de texto al borrador. Devuelve true si algo cambió. */
export function captureDraftEdits(person) {
  if (!hasDraft(person)) return false;
  let changed = false;
  const panel = document.getElementById("plans-panel");
  if (!panel || panel.dataset.patient !== person.id) return false;
  // Si el borrador se reemplazó (nuevo, versión restaurada o plantilla), las cajas de texto
  // todavía muestran el anterior: copiarlas encima haría perder el borrador nuevo.
  if (panel.draftShown !== person.draft) return false;
  panel.querySelectorAll("textarea[data-day][data-meal]").forEach(area => {
    const day = person.draft.days[Number(area.dataset.day)];
    if (!day) return;
    const value = area.value.trim();
    if ((day[area.dataset.meal] || "") !== value) { day[area.dataset.meal] = value; changed = true; }
  });
  if (changed) {
    const wasApproved = Boolean(person.approvedAt);
    person.approvedAt = null; person.updatedAt = Date.now();
    logHistory(person, wasApproved ? "Plan editado: perdió la aprobación y hay que aprobarlo de nuevo" : "Plan editado");
    queueSave();
  }
  return changed;
}

/** Guarda el borrador vigente como versión anterior antes de reemplazarlo. */
function replaceDraft(person, newDraft, why) {
  if (hasDraft(person)) { person.planVersions = [{ savedAt: Date.now(), draft: structuredClone(person.draft) }, ...(person.planVersions || [])].slice(0, 12); }
  person.draft = newDraft; person.approvedAt = null; person.shoppingList = null; person.updatedAt = Date.now();
  logHistory(person, why);
  queueSave();
}

// ---------- Dibujo ----------
function conflictKey(conflict) { return `${conflict.dayIndex}:${conflict.slotKey}`; }

function safetyPanel(person, conflicts) {
  const allergies = hasDeclaredAllergies(person);
  const intro = allergies ? `Alergias e intolerancias cargadas: <strong>${escapeHTML(person.allergies)}</strong>.` : `<strong>Esta ficha no tiene alergias cargadas.</strong> Si la persona tiene alguna, agregala en «Editar ficha» para que el menú se revise.`;
  const note = "Esta revisión busca coincidencias de palabras: no reemplaza tu lectura, no detecta ingredientes ocultos ni contaminación cruzada.";
  if (!conflicts.length) return `<div class="safety-panel safety-ok"><strong>Sin coincidencias con lo cargado en la ficha.</strong><p>${intro}</p><small>${note}</small></div>`;
  const rows = conflicts.map(item => `<li class="${item.severity === "allergy" ? "conflict-allergy" : "conflict-avoid"}">${escapeHTML(describeConflict(item))}</li>`).join("");
  return `<div class="safety-panel ${hasAllergyConflicts(conflicts) ? "safety-danger" : "safety-warn"}"><strong>${hasAllergyConflicts(conflicts) ? "⚠ Revisá antes de seguir: hay comidas con alergias o intolerancias declaradas" : "Hay alimentos que la persona prefiere evitar"}</strong><ul>${rows}</ul><p>${intro}</p><small>${note}</small></div>`;
}

function recipesHTML(person, printable = false) {
  const recipes = person.recipes;
  if (!Array.isArray(recipes) || !recipes.length) return "";
  return `<section class="recipe-drafts ${printable ? "print-section" : "no-print"}"><h3>${printable ? "Recetas" : "Recetas para revisar"}</h3>${printable ? "" : "<p>Se guardan como propuestas y se incluyen en el PDF cuando aprobás el plan.</p>"}${recipes.map((recipe, index) => {
    const hits = printable ? [] : analyzeText(person, `${recipe.name} ${(recipe.ingredients || []).map(item => item.ingredient).join(" ")}`);
    return `<article class="recipe-draft"><strong>${escapeHTML(recipe.name)} · ${escapeHTML(recipe.portions)}</strong>${hits.length ? `<div class="inline-alert">⚠ ${escapeHTML(hits.map(describeConflict).join("; "))}</div>` : ""}<ul>${(recipe.ingredients || []).map(item => `<li>${escapeHTML(item.quantity)} ${escapeHTML(item.measure)} de ${escapeHTML(item.ingredient)}</li>`).join("")}</ul><ol>${(recipe.steps || []).map(step => `<li>${escapeHTML(step)}</li>`).join("")}</ol><small>${Number(recipe.timeMinutes) || ""} min · ${escapeHTML(recipe.difficulty || "")}${printable ? "" : ` · Revisar: ${escapeHTML(recipe.reviewNote || "")}`}</small>${printable ? "" : `<div><button type="button" class="button button-quiet text-danger no-print" data-delete-recipe="${index}">Quitar receta</button></div>`}</article>`;
  }).join("")}</section>`;
}

function draftHTML(person, conflicts) {
  const marked = new Set(conflicts.map(conflictKey));
  const draft = person.draft;
  const days = draft.days.map((day, index) => `<details class="day-card" ${index === 0 || conflicts.some(item => item.dayIndex === index) ? "open" : ""}><summary><h3>${escapeHTML(day.day || DAYS[index])}</h3></summary><div class="meals-grid">${MEALS.map(([key, title]) => `<div class="meal-edit ${marked.has(`${index}:${key}`) ? "has-conflict" : ""}"><label>${title}<textarea data-day="${index}" data-meal="${key}" rows="3">${escapeHTML(day[key] || "")}</textarea></label><div class="ai-actions no-print"><button type="button" class="button button-quiet" data-ai-meal="replace">Reemplazar comida</button><button type="button" class="button button-quiet" data-ai-meal="recipe">Crear receta</button><button type="button" class="button button-quiet" data-ai-meal="substitute">Sugerir sustituciones</button>${feedbackHTML("meal", key)}</div><div class="ai-result hidden"></div></div>`).join("")}</div>${day.extra ? `<div class="metric-caption extra-line ${marked.has(`${index}:extra`) ? "has-conflict" : ""}">Alternativa: ${escapeHTML(day.extra)}</div>` : ""}</details>`).join("");
  return `<div class="draft-intro">${escapeHTML(draft.intro || "Propuesta semanal orientativa, pendiente de revisión clínica.")}</div><div class="plan-feedback no-print"><small>¿Te sirve esta propuesta?</small> ${feedbackHTML("plan")}</div><div class="draft-week">${days}</div><section class="recommendations"><h3>Recomendaciones para conversar</h3><ul>${(draft.recommendations || []).map(item => `<li>${escapeHTML(item)}</li>`).join("")}</ul></section><section class="review-notes"><h3>Para revisar antes de compartir</h3><ul>${(draft.reviewNotes || ["Validá que el borrador sea apropiado para esta persona."]).map(item => `<li>${escapeHTML(item)}</li>`).join("")}</ul></section>`;
}

function shoppingHTML(person) {
  const list = person.shoppingList;
  const canMake = hasDraft(person);
  const body = list?.categories?.length ? `<div class="shopping-grid">${list.categories.map(category => `<section class="shopping-category"><h4>${escapeHTML(category.name)}</h4><ul>${(category.items || []).map(item => `<li>${escapeHTML(item.item)}${item.quantity ? ` <span class="qty">— ${escapeHTML(item.quantity)}</span>` : ""}</li>`).join("")}</ul></section>`).join("")}</div><small class="metric-caption">${escapeHTML(list.reviewNote || "Cantidades orientativas: revisalas antes de compartir.")} ${person.approvedAt ? "La persona la ve en su portal." : "La persona la verá en su portal cuando apruebes el plan."}</small><div class="detail-actions no-print"><button type="button" class="button button-quiet" id="copy-shopping">Copiar</button>${person.phone ? `<button type="button" class="button button-quiet" id="whatsapp-shopping">Enviar por WhatsApp</button>` : ""}<button type="button" class="button button-quiet text-danger" id="delete-shopping">Quitar lista</button></div>` : `<div class="recent-empty">${canMake ? "Todavía no hay lista de compras para este menú." : "Primero necesitás un menú semanal."}</div>`;
  return `<section class="form-card no-print"><div class="form-section-title"><span>🛒</span><div><h2>Lista de compras</h2><p>Se arma a partir del menú de la semana, agrupada por sección.</p></div></div>${body}${canMake ? `<button type="button" class="button button-quiet" id="make-shopping">${list ? "↻ Armar de nuevo" : "Armar lista de compras"}</button><span id="shopping-status" class="metric-caption"></span>` : ""}</section>`;
}

let templatesOpen = false;
function templatesHTML(person) {
  const items = S.templates.map(template => `<div class="template-row"><span><strong>${escapeHTML(template.name)}</strong><small>${new Date(template.createdAt).toLocaleDateString("es-AR")}</small></span><span><button type="button" class="button button-quiet" data-use-template="${escapeHTML(template.id)}">Usar</button><button type="button" class="button button-quiet text-danger" data-delete-template="${escapeHTML(template.id)}">Eliminar</button></span></div>`).join("");
  return `<details class="form-card no-print template-box" ${templatesOpen ? "open" : ""}><summary><strong>Plantillas de menú</strong> <small>(${S.templates.length})</small></summary><p class="metric-caption">Guardá un menú que te sirvió y reutilizalo con otras personas. Siempre se revisa de nuevo contra las alergias de la ficha.</p>${items || `<div class="recent-empty">Todavía no guardaste plantillas.</div>`}${hasDraft(person) ? `<button type="button" class="button button-quiet" id="save-template">Guardar este menú como plantilla</button>` : ""}</details>`;
}

function printableHTML(person) {
  const draft = person.draft;
  const headings = [["breakfast", "Desayuno"], ["snack1", "Colación<br>mañana"], ["lunch", "Almuerzo"], ["merienda", "Merienda"], ["snack2", "Colación<br>tarde"], ["dinner", "Cena"]];
  const rows = draft.days.map((day, index) => `<tr><th scope="row">${escapeHTML(day.day || DAYS[index])}</th>${headings.map(([key]) => `<td>${escapeHTML(day[key] || "—")}</td>`).join("")}</tr>`).join("");
  const recommendations = (draft.recommendations || []).map(item => `<li>${escapeHTML(item)}</li>`).join("");
  const alternatives = draft.days.filter(day => day.extra?.trim()).map((day, index) => `<li><strong>${escapeHTML(day.day || DAYS[index])}:</strong> ${escapeHTML(day.extra)}</li>`).join("");
  const shopping = person.shoppingList?.categories?.length ? `<section class="print-section"><h2>Lista de compras</h2>${person.shoppingList.categories.map(category => `<h3>${escapeHTML(category.name)}</h3><ul class="print-list">${(category.items || []).map(item => `<li>${escapeHTML(item.item)}${item.quantity ? ` — ${escapeHTML(item.quantity)}` : ""}</li>`).join("")}</ul>`).join("")}</section>` : "";
  return `<article class="print-document"><header class="print-header"><h1>Plan de alimentación</h1><p class="print-meta"><strong>${escapeHTML(patientName(person))}</strong></p></header><section class="print-section"><h2>Menú semanal</h2><table class="print-table week-table"><thead><tr><th>Día</th>${headings.map(([, title]) => `<th>${title}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></section><section class="print-section"><h2>Recomendaciones</h2><ul class="print-list">${recommendations}</ul></section>${alternatives ? `<section class="print-section"><h2>Alternativas del menú</h2><ul class="print-list">${alternatives}</ul></section>` : ""}${recipesHTML(person, true)}${shopping}</article>`;
}

export function plansHTML(person, visible) {
  const requirements = calculatePatientRequirements(person);
  const guidance = requirements ? derivePortionGuidance(requirements) : null;
  const banner = requirements ? `Objetivo energético para el borrador: ${requirements.dailyEnergyKcal} kcal/día; distribución interna 60% carbohidratos, 25% grasas y 15% proteínas. Tamaño de porción orientativo para las comidas principales: ${TIER_LABEL[guidance?.overallTier] || "moderado"}.` : "No hay una estimación disponible: pueden faltar datos o el contexto requiere evitar este cálculo. El borrador se generará sin ese ajuste.";
  const conflicts = hasDraft(person) ? analyzeDraft(person, person.draft) : [];
  const versions = (person.planVersions || []).map((item, index, all) => `<details class="history-card"><summary><strong>Versión ${all.length - index} · ${formatDateTime(item.savedAt)}</strong></summary><p>${escapeHTML(item.draft?.intro || "Borrador anterior")}</p><button type="button" class="button button-quiet" data-restore-plan="${index}">Restaurar como borrador</button></details>`).join("");
  return `<section id="plans-panel" data-patient="${escapeHTML(person.id)}" class="detail-panel ${visible ? "" : "hidden"}"><div class="form-card"><h2>Planes y borradores</h2><p class="energy-banner">${escapeHTML(banner)}</p><form id="energy-adjust-form" class="record-form energy-adjust-form"><label>Ajuste profesional del objetivo energético (kcal/día)<input name="adjustment" type="number" min="-2000" max="2000" step="50" value="${Number(person.energyAdjustmentKcal) || 0}"/><small>Se aplica al gasto estimado en los nuevos borradores.</small></label><button class="button button-quiet" type="submit">Guardar ajuste</button></form><button type="button" class="button button-primary no-print" id="generate-menu">${hasDraft(person) ? "Generar nuevo borrador" : "✳ Generar menú semanal"}</button> <span id="generate-status" class="metric-caption"></span>${hasDraft(person) ? `${safetyPanel(person, conflicts)}<div class="draft-banner">Borrador para revisar antes de compartir. No es una indicación clínica aprobada.</div><div id="draft-content">${draftHTML(person, conflicts)}</div>${recipesHTML(person)}<div class="detail-actions no-print"><button type="button" class="button button-quiet" id="save-draft">Guardar cambios y revisar de nuevo</button>${person.approvedAt ? `<span class="approval-label">Aprobado para compartir</span><button type="button" class="button button-primary" id="print-menu">Imprimir o guardar como PDF</button>` : `<button type="button" class="button button-primary" id="approve-plan">Aprobar y preparar para enviar</button>`}</div>` : `<div class="empty-state">Todavía no hay un plan. Generalo con IA o partí de una plantilla. La generación requiere autorización registrada de la persona.</div>`}</div>${templatesHTML(person)}${shoppingHTML(person)}<section class="plan-history no-print"><h3>Versiones anteriores</h3><div class="history-list">${versions || `<div class="recent-empty">Los borradores previos aparecerán acá cuando generes uno nuevo.</div>`}</div></section><div id="print-plan" class="print-only"></div></section>`;
}

// ---------- Acciones ----------
async function aiCall(path, body) { return api(`/api/ai/${path}`, { method: "POST", body }); }

async function generateMenu(person, rerender) {
  if (!person.consentedAt || person.consentVersion !== 3) { toast("Falta registrar la autorización de la persona para usar IA."); return; }
  if (!hasDeclaredAllergies(person) && !person.noAllergiesConfirmedAt) {
    if (!window.confirm("Esta ficha no tiene alergias ni intolerancias cargadas.\n\n¿Confirmás que la persona no tiene ninguna? (Si tiene, cancelá y cargalas en «Editar ficha» antes de generar.)")) return;
    person.noAllergiesConfirmedAt = Date.now(); logHistory(person, "Se confirmó que no hay alergias declaradas"); queueSave();
  }
  const button = $("generate-menu"), status = $("generate-status");
  button.disabled = true; button.innerHTML = '<span class="spinner"></span> Preparando borrador…';
  status.textContent = "Conectando con la IA. Puede tardar un momento."; status.classList.remove("text-danger");
  try {
    captureDraftEdits(person);
    if (!(await ensureSaved())) throw new Error("No se pudo guardar la ficha antes de generar. Probá de nuevo.");
    const payload = await api("/api/generate-menu", { method: "POST", body: { patientId: person.id } });
    if (!Array.isArray(payload.days) || payload.days.length !== 7 || payload.days.some(day => MEALS.some(([key]) => typeof day[key] !== "string" || !day[key].trim()))) throw new Error("La propuesta no incluyó los siete días y sus seis comidas completas. Intentá nuevamente.");
    if (hasExactNutritionAmounts(payload)) throw new Error("La propuesta incluyó calorías, gramos, mililitros o porcentajes. No se guardó; volvé a generarla para obtener porciones caseras.");
    payload.days.forEach((day, index) => { day.day = DAYS[index]; });
    replaceDraft(person, payload, "Menú semanal generado con IA");
    rerender(); toast("Borrador creado. Revisalo antes de compartirlo.");
  } catch (error) {
    status.textContent = error.message; status.classList.add("text-danger");
    button.disabled = false; button.innerHTML = "↻ Intentar de nuevo";
  }
}

/** «Reemplazar comida»: muestra botones rápidos (y un texto opcional) antes de consultar a la IA. */
function askReplaceOptions(box, onConfirm) {
  box.classList.remove("hidden");
  box.innerHTML = `<div class="quick-options"><strong>¿Qué cambio te gustaría probar? (opcional)</strong>`
    + `<div class="quick-chips">${QUICK_OPTIONS.map(([key, label]) => `<label class="quick-chip"><input type="checkbox" value="${key}"> ${escapeHTML(label)}</label>`).join("")}</div>`
    + `<input type="text" class="quick-text" maxlength="300" placeholder="Otra indicación (por ejemplo: sin pollo)">`
    + `<div class="quick-buttons"><button type="button" class="button" data-quick-go>Reemplazar</button><button type="button" class="button button-quiet" data-quick-cancel>Cancelar</button></div></div>`;
  box.querySelector("[data-quick-go]").addEventListener("click", () => {
    const keys = [...box.querySelectorAll(".quick-chip input:checked")].map(input => input.value);
    onConfirm(buildReplaceInstruction(keys, box.querySelector(".quick-text").value));
  });
  box.querySelector("[data-quick-cancel]").addEventListener("click", () => { box.textContent = ""; box.classList.add("hidden"); });
}

function mealAction(person, button, rerender) {
  if (button.dataset.aiMeal !== "replace") return runMealAction(person, button, rerender);
  askReplaceOptions(button.closest(".meal-edit").querySelector(".ai-result"), instruction => runMealAction(person, button, rerender, instruction));
}

async function runMealAction(person, button, rerender, instruction = "") {
  const card = button.closest(".meal-edit"), area = card.querySelector("textarea"), box = card.querySelector(".ai-result"), action = button.dataset.aiMeal;
  let endpoint, body = { patientId: person.id };
  if (action === "replace") { endpoint = "regenerate-meal"; body.dayIndex = Number(area.dataset.day); body.mealKey = area.dataset.meal; body.instruction = instruction; }
  else if (action === "recipe") { endpoint = "recipe"; const portions = window.prompt("¿Para cuántas porciones?", "2"); if (portions === null) return; body.meal = area.value; body.portions = portions || "2"; }
  else { endpoint = "substitutions"; body.meal = area.value; body.ingredient = window.prompt("¿Qué alimento querés sustituir?") || ""; if (!body.ingredient) return; }
  button.disabled = true; box.classList.remove("hidden"); box.textContent = "Consultando a la IA…";
  try {
    captureDraftEdits(person);
    if (!(await ensureSaved())) throw new Error("No se pudo guardar la ficha antes de consultar. Probá de nuevo.");
    const result = await aiCall(endpoint, body);
    if (action === "replace") {
      area.value = result.meal; box.textContent = `${result.meal} · Revisá: ${result.reviewNote}`;
      captureDraftEdits(person); logHistory(person, "Una comida se reemplazó con ayuda de IA"); person.shoppingList = null; queueSave();
      rerender(); toast("Comida reemplazada. Revisala y aprobá el plan de nuevo. La lista de compras se borró: volvé a armarla.");
    } else if (action === "recipe") {
      person.recipes = [...(person.recipes || []), { ...result, meal: area.value, id: uid(), createdAt: Date.now() }];
      person.approvedAt = null; person.updatedAt = Date.now(); logHistory(person, `Receta agregada: ${result.name}`); queueSave();
      rerender(); toast("Receta guardada como propuesta. Revisala antes de aprobar el PDF.");
    } else {
      box.innerHTML = `<strong>Ideas de sustitución para revisar</strong><ul>${result.options.map(item => `<li><strong>${escapeHTML(item.name)}:</strong> ${escapeHTML(item.idea)}</li>`).join("")}</ul><small>${escapeHTML(result.reviewNote)}</small>`;
    }
  } catch (error) { box.textContent = error.message || "No se pudo completar la sugerencia."; }
  finally { button.disabled = false; }
}

async function makeShopping(person, rerender) {
  const button = $("make-shopping"), status = $("shopping-status");
  button.disabled = true; status.classList.remove("text-danger"); status.textContent = "Armando la lista…";
  try {
    captureDraftEdits(person);
    if (!(await ensureSaved())) throw new Error("No se pudo guardar la ficha antes de armar la lista.");
    const result = await aiCall("shopping-list", { patientId: person.id, days: person.draft.days });
    person.shoppingList = { ...result, createdAt: Date.now() };
    person.updatedAt = Date.now(); logHistory(person, "Lista de compras armada con IA"); queueSave();
    rerender(); toast("Lista armada. Revisala antes de compartirla.");
  } catch (error) { status.textContent = error.message; status.classList.add("text-danger"); button.disabled = false; }
}

function approve(person, rerender) {
  captureDraftEdits(person);
  const conflicts = analyzeDraft(person, person.draft);
  const allergy = conflicts.filter(item => item.severity === "allergy");
  if (allergy.length) {
    const list = allergy.slice(0, 6).map(describeConflict).join("\n");
    if (!window.confirm(`⚠ Este plan tiene ${allergy.length} coincidencia(s) con alergias o intolerancias declaradas:\n\n${list}\n\nLo recomendable es corregirlas antes de aprobar. ¿Aprobás igual, bajo tu responsabilidad?`)) return;
    logHistory(person, `Plan aprobado con ${allergy.length} coincidencia(s) de alergia revisadas por la profesional`);
  } else {
    if (!window.confirm("¿Confirmás que revisaste y aprobás este plan para compartir con la persona?")) return;
    logHistory(person, "Plan aprobado");
  }
  person.approvedAt = Date.now(); person.updatedAt = Date.now(); queueSave(); rerender();
  toast("Plan aprobado. Ya podés guardarlo como PDF y compartir el acceso al portal.");
}

async function printPlan(person, el, rerender) {
  if (!person.approvedAt) { toast("Primero aprobá el plan para preparar el PDF."); return; }
  if (captureDraftEdits(person)) { rerender(); toast("Detecté cambios en el plan. Revisalo y aprobalo nuevamente antes de crear el PDF."); return; }
  const area = el.querySelector("#print-plan");
  area.innerHTML = printableHTML(person);
  const images = [...area.querySelectorAll("img")];
  await Promise.race([Promise.all(images.map(image => image.complete ? Promise.resolve() : new Promise(resolve => { image.onload = resolve; image.onerror = resolve; }))), new Promise(resolve => setTimeout(resolve, 3500))]);
  window.addEventListener("afterprint", () => { area.innerHTML = ""; }, { once: true });
  window.print();
}

export function bindPlans(el, person, rerender) {
  const panel = el.querySelector("#plans-panel");
  if (panel) panel.draftShown = person.draft; // qué borrador están mostrando las cajas de texto
  el.querySelector("#energy-adjust-form")?.addEventListener("submit", event => { event.preventDefault(); person.energyAdjustmentKcal = Number(new FormData(event.currentTarget).get("adjustment")) || 0; person.updatedAt = Date.now(); queueSave(); rerender(); toast("Objetivo energético actualizado para el próximo borrador."); });
  bindFeedback(el);
  el.querySelector("#generate-menu")?.addEventListener("click", () => generateMenu(person, rerender));
  el.querySelector("#approve-plan")?.addEventListener("click", () => approve(person, rerender));
  el.querySelector("#print-menu")?.addEventListener("click", () => printPlan(person, el, rerender));
  el.querySelector("#save-draft")?.addEventListener("click", () => { const changed = captureDraftEdits(person); rerender(); toast(changed ? "Cambios guardados. El plan necesita aprobación otra vez." : "No había cambios. Se volvió a revisar el menú."); });
  el.querySelectorAll("[data-ai-meal]").forEach(button => button.addEventListener("click", () => mealAction(person, button, rerender)));
  el.querySelectorAll("[data-delete-recipe]").forEach(button => button.addEventListener("click", () => { const [removed] = person.recipes.splice(Number(button.dataset.deleteRecipe), 1); person.approvedAt = null; person.updatedAt = Date.now(); logHistory(person, `Receta quitada: ${removed?.name || ""}`); queueSave(); rerender(); }));
  el.querySelectorAll("[data-restore-plan]").forEach(button => button.addEventListener("click", () => {
    const [version] = person.planVersions.splice(Number(button.dataset.restorePlan), 1);
    if (!version) return;
    const current = hasDraft(person) ? { savedAt: Date.now(), draft: structuredClone(person.draft) } : null;
    person.draft = structuredClone(version.draft); person.planVersions = [...(current ? [current] : []), ...person.planVersions].slice(0, 12);
    person.approvedAt = null; person.shoppingList = null; person.updatedAt = Date.now(); logHistory(person, "Se restauró una versión anterior del plan"); queueSave(); rerender();
    toast("Plan restaurado como borrador. Revisalo, aprobalo y volvé a armar la lista de compras.");
  }));
  // Plantillas
  el.querySelector(".template-box")?.addEventListener("toggle", event => { templatesOpen = event.currentTarget.open; });
  el.querySelector("#save-template")?.addEventListener("click", () => {
    captureDraftEdits(person);
    const name = window.prompt("Nombre de la plantilla (por ejemplo: «Hipertensión · económico»):");
    if (name === null) return;
    const template = makeTemplate(name, person.draft);
    if (!template) { toast("Escribí un nombre para la plantilla."); return; }
    S.templates.push(template); queueSave(); rerender(); toast("Plantilla guardada.");
  });
  el.querySelectorAll("[data-use-template]").forEach(button => button.addEventListener("click", () => {
    const template = S.templates.find(item => item.id === button.dataset.useTemplate);
    if (!template) return;
    if (hasDraft(person) && !window.confirm("Esto reemplaza el borrador actual (queda guardado en «Versiones anteriores»). ¿Continuar?")) return;
    replaceDraft(person, draftFromTemplate(template, DAYS), `Se aplicó la plantilla «${template.name}»`);
    rerender();
    const hits = analyzeDraft(person, person.draft).filter(item => item.severity === "allergy").length;
    toast(hits ? `Plantilla aplicada: ⚠ ${hits} coincidencia(s) con alergias de esta ficha. Revisalas.` : "Plantilla aplicada. Revisala antes de aprobar.");
  }));
  el.querySelectorAll("[data-delete-template]").forEach(button => button.addEventListener("click", () => {
    const template = S.templates.find(item => item.id === button.dataset.deleteTemplate);
    if (!template || !window.confirm(`¿Eliminar la plantilla «${template.name}»? Los planes ya aplicados no cambian.`)) return;
    S.templates = S.templates.filter(item => item.id !== template.id); queueSave(); rerender();
  }));
  // Lista de compras
  el.querySelector("#make-shopping")?.addEventListener("click", () => makeShopping(person, rerender));
  el.querySelector("#delete-shopping")?.addEventListener("click", () => { person.shoppingList = null; person.updatedAt = Date.now(); queueSave(); rerender(); });
  el.querySelector("#copy-shopping")?.addEventListener("click", async () => toast(await copyText(buildShoppingMessage(person.shoppingList, { patientName: person.name })) ? "Lista copiada." : "No se pudo copiar."));
  el.querySelector("#whatsapp-shopping")?.addEventListener("click", () => {
    const link = whatsappLink(person.phone, buildShoppingMessage(person.shoppingList, { patientName: person.name }));
    if (!link) toast("El celular de la ficha no es válido. Corregilo en «Editar ficha».");
    else if (!openExternal(link)) toast("El navegador bloqueó la ventana de WhatsApp.");
  });
}
