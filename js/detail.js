import { $, CLOSED_STATUSES, api, appointmentStatusName, conditionName, copyText, escapeHTML, formatDate, formatDateTime, formatTime, openExternal, patientName, toast, todayISO } from "./util.js";
import { S, ensureSaved, findPatient, queueSave } from "./state.js";
import { nav, setPage } from "./nav.js";
import { GOAL_STATUS_LABELS, acceptWeightSubmission, addGoal, dismissSubmission, logHistory, measurementSeries, pendingSubmissions, removeGoal, setGoalStatus, sortedGoals, toggleGoalVisibility, uid, weightChange } from "./logic.js";
import { getLatestMeasurement } from "../nutrition.mjs";
import { lineChartSVG } from "../charts.mjs";
import { buildPortalMessage, whatsappLink } from "../contact.mjs";
import { bindPlans, captureDraftEdits, plansHTML } from "./plans.js";
import { refreshAll } from "./patients.js";
import { scheduleFor } from "./agenda.js";

const TABS = [["summary", "Resumen"], ["consultations", "Consultas"], ["measurements", "Mediciones"], ["goals", "Metas"], ["plans", "Planes"], ["history", "Historial"]];
const bmiOf = (weight, height) => weight && height ? Number((weight / ((height / 100) ** 2)).toFixed(1)) : null;
const num = value => { const n = Number(value); return Number.isFinite(n) && n > 0 ? n : null; };

function current() { return findPatient(nav.state.selectedId); }

export function openPatient(id) {
  if (!findPatient(id)) return;
  nav.state.selectedId = id; nav.state.detailTab = "summary";
  renderDetail(); setPage("detail");
}

/** Vuelve a dibujar la ficha. Antes guarda lo que se estaba editando en el plan. */
export function renderDetail() {
  const person = current();
  if (!person) { setPage("patients"); return; }
  captureDraftEdits(person);
  const el = $("page-detail");
  const tab = nav.state.detailTab;
  const show = name => tab === name ? "" : "hidden";
  const consultations = [...(person.consultations || [])].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const latest = getLatestMeasurement(person);
  const upcoming = S.appointments.filter(item => item.patientId === person.id && !CLOSED_STATUSES.includes(item.status) && new Date(item.start).getTime() >= Date.now()).sort((a, b) => a.start.localeCompare(b.start))[0];
  const pending = pendingSubmissions(person);
  const change = weightChange(person);
  const lastConsult = consultations[0];
  const contact = [person.phone && `📱 ${escapeHTML(person.phone)}`, person.email && `✉ ${escapeHTML(person.email)}`].filter(Boolean).join(" · ");

  el.innerHTML = `<section class="detail-header"><div><div class="eyebrow">FICHA INDIVIDUAL</div><h1>${escapeHTML(patientName(person))}</h1><p class="detail-meta">${escapeHTML(String(person.age))} años · ${escapeHTML(conditionName(person.condition))} · ${person.archivedAt ? "Archivado" : "Activo"}${contact ? ` · ${contact}` : ""}</p></div><div class="detail-actions no-print"><button type="button" class="button button-quiet" id="generate-portal">Acceso del paciente</button><button type="button" class="button button-quiet" id="edit-patient">Editar ficha</button><button type="button" class="button button-quiet" id="archive-patient">${person.archivedAt ? "Reactivar" : "Archivar"}</button><button type="button" class="button button-quiet text-danger" id="delete-patient">Eliminar</button></div></section>
${person.allergies ? `<div class="allergy-banner"><strong>Alergias o intolerancias:</strong> ${escapeHTML(person.allergies)}</div>` : `<div class="allergy-banner allergy-missing">Sin alergias cargadas. Si la persona tiene alguna, agregala en «Editar ficha» para que los menús se revisen.</div>`}
<nav class="detail-tabs no-print" aria-label="Secciones de la ficha">${TABS.map(([key, label]) => `<button type="button" data-tab="${key}" class="${tab === key ? "active" : ""}">${label}${key === "summary" && pending.length ? ` <b class="nav-count">${pending.length}</b>` : ""}</button>`).join("")}</nav>

<section class="detail-panel ${show("summary")}"><div class="summary-grid"><article class="summary-card"><small>OBJETIVO CONVERSADO</small><strong>${escapeHTML(person.goal || "Sin objetivo registrado")}</strong><span>${escapeHTML(person.likes ? `Gustos: ${person.likes}` : "")}</span></article><article class="summary-card"><small>ÚLTIMA MEDICIÓN</small><strong>${latest ? `${latest.weight ? `${escapeHTML(latest.weight)} kg` : "Peso —"} · ${latest.height ? `${escapeHTML(latest.height)} cm` : "Talla —"}` : "Sin mediciones"}</strong><span>${latest ? `Registrada ${formatDate(latest.date)}${change ? ` · ${change.delta > 0 ? "+" : ""}${String(change.delta).replace(".", ",")} kg desde ${formatDate(change.since)}` : ""}` : "Podés agregarla en Mediciones"}</span></article><article class="summary-card"><small>PRÓXIMO TURNO</small><strong>${upcoming ? `${formatDate(upcoming.start.slice(0, 10))} · ${formatTime(upcoming.start)}` : "Sin turno futuro agendado"}</strong><span><button type="button" class="text-button" id="patient-add-appointment">Agendar o ver en agenda →</button></span></article></div>
${pending.length ? `<div class="form-card submissions-card"><h3>Datos cargados por la persona (${pending.length})</h3><p class="metric-caption">Revisalos antes de pasarlos a la ficha. Los pesos aceptados se suman a las mediciones.</p><div class="history-list">${pending.map(item => `<div class="history-card submission"><div><strong>${formatDate(item.data?.date)} · ${item.type === "weight" ? "Peso" : "Nota previa a la consulta"}</strong><p>${item.type === "weight" ? `${escapeHTML(item.data?.weight)} kg` : escapeHTML(item.data?.note)}</p></div><div class="submission-actions">${item.type === "weight" ? `<button type="button" class="button button-primary" data-accept="${escapeHTML(item.id)}">Agregar a mediciones</button>` : ""}<button type="button" class="button button-quiet" data-dismiss="${escapeHTML(item.id)}">${item.type === "weight" ? "Descartar" : "Marcar como leída"}</button></div></div>`).join("")}</div></div>` : ""}
<div class="form-card"><div class="form-section-title"><span>✳</span><div><h2>Seguimiento</h2><p>El IMC se muestra como referencia descriptiva, no como diagnóstico.</p></div></div><p>${lastConsult ? `Última consulta: ${formatDate(lastConsult.date)} · ${escapeHTML(lastConsult.reason || "Consulta")}` : "Todavía no hay consultas registradas."}</p><p>${lastConsult?.adherence ? `Adherencia y dificultades: ${escapeHTML(lastConsult.adherence)}` : "Registrá adherencia, dificultades y próximos pasos en Consultas."}</p><button type="button" class="button button-primary" data-tab="consultations">Registrar consulta</button></div>
<div class="form-card" id="portal-access"><h3>Portal de la persona</h3><p class="metric-caption">Cargando estado del acceso…</p></div></section>

<section class="detail-panel ${show("consultations")}"><form id="consultation-form" class="form-card record-form"><h2>Nueva consulta</h2><button type="button" class="button button-quiet" id="summarize-consultations">Resumir consultas y sugerir preguntas</button><div id="consultation-ai-result" class="ai-result hidden"></div><div class="form-row"><label>Fecha<input name="date" type="date" value="${todayISO()}" required /></label><label>Motivo<input name="reason" maxlength="160" placeholder="Control, seguimiento…" /></label></div><label>Observaciones<textarea name="notes" rows="2" maxlength="1200"></textarea></label><label>Adherencia y dificultades<textarea name="adherence" rows="2" maxlength="1000"></textarea></label><label>Recomendaciones y cambios acordados<textarea name="recommendations" rows="2" maxlength="1000"></textarea></label><label>Próximo control<input name="nextControl" type="date" /></label><fieldset class="consult-measurements"><legend>Mediciones de esta consulta</legend><label class="check-row"><input type="checkbox" name="saveMeasurements" value="yes" /> Guardar mediciones junto con la consulta</label><div class="form-row three-fields"><label>Peso (kg)<input name="checkWeight" type="number" min="1" max="500" step="0.1" /></label><label>Talla (cm)<input name="checkHeight" type="number" min="50" max="250" step="0.1" /></label><label>Cintura (cm)<input name="checkWaist" type="number" min="1" max="300" step="0.1" /></label></div><label>Cadera (cm)<input name="checkHip" type="number" min="1" max="300" step="0.1" /></label></fieldset><button class="button button-primary" type="submit">Guardar consulta</button></form><div class="history-list">${consultations.map(item => `<details class="history-card"><summary><strong>${formatDate(item.date)} · ${escapeHTML(item.reason || "Consulta")}</strong></summary><form class="form-card history-edit" data-consultation="${escapeHTML(item.id)}"><label>Motivo<input name="reason" maxlength="160" value="${escapeHTML(item.reason || "")}" /></label><label>Observaciones<textarea name="notes" rows="2" maxlength="1200">${escapeHTML(item.notes || "")}</textarea></label><label>Adherencia y dificultades<textarea name="adherence" rows="2" maxlength="1000">${escapeHTML(item.adherence || "")}</textarea></label><label>Recomendaciones<textarea name="recommendations" rows="2" maxlength="1000">${escapeHTML(item.recommendations || "")}</textarea></label><label>Próximo control<input name="nextControl" type="date" value="${escapeHTML(item.nextControl || "")}" /></label><button class="button button-primary" type="submit">Guardar consulta</button></form></details>`).join("") || `<div class="empty-state">Todavía no hay consultas.</div>`}</div></section>

<section class="detail-panel ${show("measurements")}">${chartsHTML(person)}<form id="measurement-form" class="form-card record-form"><h2>Nueva medición</h2><div class="form-row"><label>Fecha<input name="date" type="date" value="${todayISO()}" required /></label><label>Peso (kg)<input name="weight" type="number" min="1" max="500" step="0.1" /></label></div><div class="form-row three-fields"><label>Talla (cm)<input name="height" type="number" min="50" max="250" step="0.1" /></label><label>Cintura (cm)<input name="waist" type="number" min="1" max="300" step="0.1" /></label><label>Cadera (cm)<input name="hip" type="number" min="1" max="300" step="0.1" /></label></div><button class="button button-primary" type="submit">Guardar medición</button></form><div class="table-scroll"><table class="measure-table"><thead><tr><th>Fecha</th><th>Peso</th><th>Talla</th><th>IMC</th><th>Cintura</th><th>Cadera</th></tr></thead><tbody>${[...(person.measurements || [])].sort((a, b) => String(b.date).localeCompare(String(a.date))).map(item => `<tr><td>${formatDate(item.date)}${item.source === "patient" ? ` <small class="tag">enviado por la persona</small>` : ""}</td><td>${item.weight ? `${escapeHTML(item.weight)} kg` : "—"}</td><td>${item.height ? `${escapeHTML(item.height)} cm` : "—"}</td><td>${item.bmi ? escapeHTML(item.bmi) : "—"}</td><td>${item.waist ? `${escapeHTML(item.waist)} cm` : "—"}</td><td>${item.hip ? `${escapeHTML(item.hip)} cm` : "—"}</td></tr>`).join("") || `<tr><td colspan="6">Todavía no hay mediciones.</td></tr>`}</tbody></table></div></section>

<section class="detail-panel ${show("goals")}"><form id="goal-form" class="form-card record-form"><h2>Nueva meta</h2><p class="metric-caption">Metas simples y alcanzables, acordadas con la persona. Las que marques como visibles aparecen en su portal.</p><label>Meta<input name="text" required maxlength="300" placeholder="Ej.: caminar 30 minutos, 4 veces por semana" /></label><div class="form-row"><label>Fecha objetivo <span class="optional">(opcional)</span><input name="targetDate" type="date" /></label><label class="check-row"><input type="checkbox" name="visible" /> Mostrar en el portal de la persona</label></div><button class="button button-primary" type="submit">Agregar meta</button></form><div class="history-list">${sortedGoals(person).map(goal => `<article class="history-card goal goal-${goal.status}"><div><strong>${escapeHTML(goal.text)}</strong><small>${GOAL_STATUS_LABELS[goal.status]}${goal.targetDate ? ` · para el ${formatDate(goal.targetDate)}` : ""} · ${goal.visibleToPatient ? "visible en el portal" : "solo vos la ves"}</small></div><div class="submission-actions no-print">${goal.status !== "achieved" ? `<button type="button" class="button button-quiet" data-goal="${escapeHTML(goal.id)}" data-status="achieved">Lograda</button>` : ""}${goal.status !== "active" ? `<button type="button" class="button button-quiet" data-goal="${escapeHTML(goal.id)}" data-status="active">Retomar</button>` : ""}${goal.status === "active" ? `<button type="button" class="button button-quiet" data-goal="${escapeHTML(goal.id)}" data-status="dropped">Dejar de lado</button>` : ""}<button type="button" class="button button-quiet" data-goal-visibility="${escapeHTML(goal.id)}">${goal.visibleToPatient ? "Ocultar" : "Mostrar"}</button><button type="button" class="button button-quiet text-danger" data-goal-remove="${escapeHTML(goal.id)}">Eliminar</button></div></article>`).join("") || `<div class="empty-state">Todavía no hay metas.</div>`}</div></section>

${plansHTML(person, tab === "plans")}

<section class="detail-panel ${show("history")}"><div class="form-card"><h2>Historial de cambios</h2><p class="metric-caption">Registro de lo que se hizo en esta ficha (plan generado o aprobado, metas, alergias, datos de la persona). Se guardan los últimos 300.</p><ol class="timeline">${[...(person.history || [])].reverse().map(item => `<li><time>${formatDateTime(item.at)}</time><span>${escapeHTML(item.text)}</span></li>`).join("") || `<li><span>Todavía no hay movimientos registrados.</span></li>`}</ol></div></section>`;

  bindDetail(el, person);
  bindPlans(el, person, renderDetail);
  if (tab === "summary") loadPortalAccess(el, person);
}

function chartsHTML(person) {
  const series = measurementSeries(person);
  const parts = [];
  if (series.weight.length) parts.push(`<div class="chart-card"><h3>Peso</h3>${lineChartSVG({ title: "Peso", unit: "kg", series: [{ name: "Peso", color: "var(--primary)", points: series.weight }] })}</div>`);
  if (series.waist.length || series.hip.length) parts.push(`<div class="chart-card"><h3>Cintura y cadera</h3>${lineChartSVG({ title: "Cintura y cadera", unit: "cm", series: [{ name: "Cintura", color: "var(--primary)", points: series.waist }, { name: "Cadera", color: "#c26a2c", points: series.hip }] })}</div>`);
  return parts.length ? `<div class="charts-grid">${parts.join("")}</div>` : `<div class="recent-empty">Cuando cargues mediciones con fecha, acá vas a ver cómo evolucionan.</div>`;
}

function touch(person) { person.updatedAt = Date.now(); queueSave(); }

function bindDetail(el, person) {
  const go = tab => { nav.state.detailTab = tab; renderDetail(); };
  el.querySelectorAll("[data-tab]").forEach(button => button.addEventListener("click", () => go(button.dataset.tab)));
  el.querySelector("#edit-patient").addEventListener("click", () => nav.openForm(person.id));
  el.querySelector("#archive-patient").addEventListener("click", () => toggleArchive(person));
  el.querySelector("#delete-patient").addEventListener("click", () => deletePatient(person));
  el.querySelector("#patient-add-appointment")?.addEventListener("click", () => scheduleFor(person.id));
  el.querySelector("#generate-portal").addEventListener("click", () => { go("summary"); document.getElementById("portal-access")?.scrollIntoView({ behavior: "smooth" }); });

  el.querySelectorAll("[data-accept]").forEach(button => button.addEventListener("click", () => {
    const item = (person.submissions || []).find(row => row.id === button.dataset.accept);
    if (!item || !acceptWeightSubmission(person, item)) { toast("No se pudo agregar ese peso."); return; }
    touch(person); renderDetail(); toast("Peso agregado a las mediciones.");
  }));
  el.querySelectorAll("[data-dismiss]").forEach(button => button.addEventListener("click", () => {
    const item = (person.submissions || []).find(row => row.id === button.dataset.dismiss);
    if (item && dismissSubmission(person, item)) { touch(person); renderDetail(); }
  }));

  el.querySelector("#summarize-consultations")?.addEventListener("click", async event => {
    const button = event.currentTarget, box = el.querySelector("#consultation-ai-result");
    button.disabled = true; box.classList.remove("hidden"); box.textContent = "Preparando resumen…";
    try {
      if (!(await ensureSaved())) throw new Error("No se pudo guardar la ficha antes de consultar.");
      const result = await api("/api/ai/consultation-summary", { method: "POST", body: { patientId: person.id } });
      box.innerHTML = `<strong>Resumen para revisar</strong><p>${escapeHTML(result.summary)}</p><strong>Preguntas posibles</strong><ul>${result.questions.map(question => `<li>${escapeHTML(question)}</li>`).join("")}</ul>`;
    } catch (error) { box.textContent = error.message || "No se pudo preparar el resumen."; }
    finally { button.disabled = false; }
  });

  el.querySelector("#consultation-form")?.addEventListener("submit", event => {
    event.preventDefault();
    const { checkWeight, checkHeight, checkWaist, checkHip, saveMeasurements, ...data } = Object.fromEntries(new FormData(event.currentTarget));
    const consultation = { ...data, id: uid(), createdAt: Date.now() };
    const [weight, height, waist, hip] = [checkWeight, checkHeight, checkWaist, checkHip].map(num);
    if (saveMeasurements === "yes" && [weight, height, waist, hip].some(value => value !== null)) {
      const measurement = { date: data.date, weight, height, waist, hip, bmi: bmiOf(weight, height), id: uid(), createdAt: Date.now() };
      person.measurements = [...(person.measurements || []), measurement]; consultation.measurementId = measurement.id;
    }
    person.consultations = [...(person.consultations || []), consultation];
    logHistory(person, `Consulta registrada (${formatDate(data.date)})`);
    touch(person); go("consultations"); toast("Consulta guardada en la ficha.");
  });
  el.querySelectorAll("[data-consultation]").forEach(form => form.addEventListener("submit", event => {
    event.preventDefault();
    const item = (person.consultations || []).find(record => record.id === form.dataset.consultation);
    if (!item) return;
    Object.assign(item, Object.fromEntries(new FormData(form)));
    logHistory(person, `Consulta editada (${formatDate(item.date)})`);
    touch(person); renderDetail(); toast("Consulta actualizada.");
  }));

  el.querySelector("#measurement-form")?.addEventListener("submit", event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    const weight = num(data.weight), height = num(data.height);
    person.measurements = [...(person.measurements || []), { date: data.date, weight, height, waist: num(data.waist), hip: num(data.hip), bmi: bmiOf(weight, height), id: uid(), createdAt: Date.now() }];
    touch(person); renderDetail(); toast("Medición guardada. El IMC se calculó cuando había peso y talla.");
  });

  el.querySelector("#goal-form")?.addEventListener("submit", event => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    if (!addGoal(person, { text: data.get("text"), targetDate: data.get("targetDate") || "", visibleToPatient: data.get("visible") === "on" })) { toast("Escribí la meta."); return; }
    touch(person); renderDetail(); toast("Meta agregada.");
  });
  el.querySelectorAll("[data-goal]").forEach(button => button.addEventListener("click", () => { if (setGoalStatus(person, button.dataset.goal, button.dataset.status)) { touch(person); renderDetail(); } }));
  el.querySelectorAll("[data-goal-visibility]").forEach(button => button.addEventListener("click", () => { if (toggleGoalVisibility(person, button.dataset.goalVisibility)) { touch(person); renderDetail(); } }));
  el.querySelectorAll("[data-goal-remove]").forEach(button => button.addEventListener("click", () => { if (window.confirm("¿Eliminar esta meta?") && removeGoal(person, button.dataset.goalRemove)) { touch(person); renderDetail(); } }));
}

// ---------- Acceso al portal ----------
async function loadPortalAccess(el, person) {
  const box = el.querySelector("#portal-access");
  if (!box) return;
  let status = { active: false };
  try { status = await api(`/api/patient-access/${encodeURIComponent(person.id)}`); } catch { status = null; }
  if (!document.body.contains(box)) return;
  drawPortalAccess(box, person, status, null);
}

function drawPortalAccess(box, person, status, fresh) {
  const link = fresh ? `${location.origin}/portal/${fresh.token}` : "";
  const message = fresh ? buildPortalMessage({ patientName: person.name, link, code: fresh.shortCode, professionalName: S.professional?.name }) : "";
  const whatsapp = fresh ? whatsappLink(person.phone, message) : null;
  box.innerHTML = `<h3>Portal de la persona</h3><p class="metric-caption">La persona entra con un enlace o un código, ve su plan aprobado, sus metas visibles y su lista de compras, y puede cargar su peso o dejarte una nota. Un solo acceso por persona: al generar uno nuevo, el anterior deja de funcionar.</p>
  ${status === null ? `<div class="inline-alert">No se pudo consultar el estado del acceso. Revisá la conexión.</div>` : status.active ? `<p><span class="status-pill ok">Acceso activo</span> Código: <strong class="code">${escapeHTML(status.shortCode)}</strong></p>` : `<p><span class="status-pill">Sin acceso activo</span></p>`}
  ${fresh ? `<div class="share-box"><strong>Acceso nuevo creado</strong><p>Compartilo ahora: el enlace completo solo se muestra esta vez.</p><input class="share-link" readonly value="${escapeHTML(link)}" /><p>Código manual: <strong class="code">${escapeHTML(fresh.shortCode)}</strong></p><div class="detail-actions"><button type="button" class="button button-quiet" id="copy-access">Copiar mensaje</button>${whatsapp ? `<button type="button" class="button button-primary" id="whatsapp-access">Enviar por WhatsApp</button>` : `<small class="metric-caption">Cargá un celular válido en la ficha para enviar por WhatsApp.</small>`}</div></div>` : ""}
  <div class="detail-actions no-print"><button type="button" class="button button-primary" id="create-access">${status?.active ? "Generar acceso nuevo" : "Generar acceso"}</button>${status?.active ? `<button type="button" class="button button-quiet text-danger" id="revoke-access">Quitar acceso</button>` : ""}</div>
  ${person.approvedAt ? "" : `<small class="metric-caption">Todavía no aprobaste el plan: la persona verá el portal sin menú hasta que lo apruebes.</small>`}`;
  box.querySelector("#create-access").addEventListener("click", async event => {
    if (status?.active && !window.confirm("Ya hay un acceso activo. Si generás uno nuevo, el anterior deja de funcionar. ¿Continuar?")) return;
    event.currentTarget.disabled = true;
    try {
      if (!(await ensureSaved())) throw new Error("No se pudo guardar la ficha antes de generar el acceso.");
      const result = await api("/api/patient-access", { method: "POST", body: { patientId: person.id } });
      logHistory(person, "Se generó un acceso al portal"); touch(person);
      drawPortalAccess(box, person, { active: true, shortCode: result.shortCode }, result);
    } catch (error) { toast(error.message || "No se pudo generar el acceso."); event.currentTarget.disabled = false; }
  });
  box.querySelector("#revoke-access")?.addEventListener("click", async () => {
    if (!window.confirm("¿Quitar el acceso? La persona ya no podrá entrar con su enlace ni su código.")) return;
    try { await api(`/api/patient-access/${encodeURIComponent(person.id)}`, { method: "DELETE" }); logHistory(person, "Se quitó el acceso al portal"); touch(person); drawPortalAccess(box, person, { active: false }, null); toast("Acceso quitado."); }
    catch (error) { toast(error.message || "No se pudo quitar el acceso."); }
  });
  box.querySelector("#copy-access")?.addEventListener("click", async () => toast(await copyText(message) ? "Mensaje copiado." : "No se pudo copiar."));
  box.querySelector("#whatsapp-access")?.addEventListener("click", () => { if (!openExternal(whatsapp)) toast("El navegador bloqueó la ventana de WhatsApp."); });
  box.querySelector(".share-link")?.addEventListener("focus", event => event.currentTarget.select());
}

// ---------- Archivar y eliminar ----------
function toggleArchive(person) {
  person.archivedAt = person.archivedAt ? null : Date.now();
  logHistory(person, person.archivedAt ? "Ficha archivada" : "Ficha reactivada");
  touch(person); refreshAll();
  if (person.archivedAt) { $("patient-status").value = "active"; setPage("patients"); refreshAll(); toast("Ficha archivada. Podés reactivarla desde Archivados."); }
  else { renderDetail(); toast("Ficha reactivada."); }
}

async function deletePatient(person) {
  const related = S.appointments.filter(item => item.patientId === person.id).length;
  if (!window.confirm(`¿Querés eliminar esta ficha y su borrador de tu cuenta? También se eliminarán ${related} turno(s) asociados. Esta acción no se puede deshacer.`)) return;
  try { await api(`/api/patient-access/${encodeURIComponent(person.id)}`, { method: "DELETE" }); } catch { /* si no había acceso, no importa */ }
  S.patients = S.patients.filter(item => item.id !== person.id);
  S.appointments = S.appointments.filter(item => item.patientId !== person.id);
  queueSave(); refreshAll(); setPage("patients");
  toast("Ficha y turnos asociados eliminados de tu cuenta.");
}

export function initDetail() {
  nav.openPatient = openPatient;
  nav.refreshDetail = renderDetail;
}
