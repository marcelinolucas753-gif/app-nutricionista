import { calculatePatientRequirements, getLatestMeasurement } from "./nutrition.mjs";

const STORAGE_KEY = "nutri-guia-pacientes-v1";
const APPOINTMENTS_KEY = "nutri-guia-turnos-v1";
const DAYS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
const MEALS = [["breakfast", "Desayuno"], ["snack1", "Colación de la mañana"], ["lunch", "Almuerzo"], ["snack2", "Colación de la tarde"], ["merienda", "Merienda"], ["dinner", "Cena"]];
let patients = [];
let appointments = [];
let legacyPatients = loadPatients();
let legacyAppointments = loadAppointments();
let dataVersion = 0;
let saveTimer;
let authenticated = false;
let saveDirty = false;
let savingCloudData = false;
let dismissedRemoteVersion = 0;
let activePage = "home";
let selectedId = null;
let detailTab = "summary";
let editingId = null;
let currentWizardStep = 1;
let installPrompt = null;
let toastTimer;

function loadPatients() { try { const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); return Array.isArray(value) ? value : []; } catch { return []; } }
function loadAppointments() { try { const value = JSON.parse(localStorage.getItem(APPOINTMENTS_KEY) || "[]"); return Array.isArray(value) ? value : []; } catch { return []; } }
function savePatients() { updateCounts(); queueCloudSave(); }
function saveAppointments() { renderAgenda(); renderHomeAppointments(); queueCloudSave(); }
function queueCloudSave() { if (!authenticated) return; saveDirty=true; clearTimeout(saveTimer); saveTimer = setTimeout(saveCloudData, 250); }
async function saveCloudData() {
  if (!authenticated || savingCloudData) return;
  clearTimeout(saveTimer);
  savingCloudData=true;
  try { while(saveDirty && authenticated) {
    saveDirty=false;
    const response = await fetch("/api/data", { method:"PUT", headers:{"Content-Type":"application/json"}, body:JSON.stringify({patients:structuredClone(patients),appointments:structuredClone(appointments),version:dataVersion}) });
    const body = await response.json();
    if (response.status === 409) { const unsavedChanges=saveDirty; if(unsavedChanges){const file=new Blob([JSON.stringify({format:"nutri-guia-backup",version:3,exportedAt:new Date().toISOString(),patients,appointments},null,2)],{type:"application/json"});const url=URL.createObjectURL(file);const link=document.createElement("a");link.href=url;link.download=`nutri-guia-cambios-sin-sincronizar-${todayISO()}.json`;link.click();URL.revokeObjectURL(url);} authenticated=false; patients=[]; appointments=[]; await refreshAuth(); toast(unsavedChanges ? "Se descargó una copia de los cambios pendientes y se cargó la versión más reciente." : "Los datos cambiaron desde otro dispositivo. Se cargó la versión más reciente."); return false; }
    if (!response.ok) throw new Error(body.error || "No se pudieron guardar los cambios.");
    dataVersion=body.version;
  }} catch (error) { saveDirty=true; toast(error.message || "No se pudieron guardar los cambios en la cuenta."); }
  finally { savingCloudData=false; if(saveDirty&&authenticated) saveTimer=setTimeout(saveCloudData,5000); }
  return !saveDirty;
}
async function loadCloudData() {
  const response=await fetch("/api/data",{cache:"no-store"}); const body=await response.json();
  if(!response.ok) throw new Error(body.error || "No se pudieron cargar las fichas.");
  patients=Array.isArray(body.patients)?body.patients:[]; appointments=Array.isArray(body.appointments)?body.appointments:[]; dataVersion=Number(body.version)||0;
  if(localStorage.getItem("nutri-guia-cloud-import-confirmed-v1")!=="yes" && (legacyPatients.length||legacyAppointments.length) && window.confirm(`Este navegador tiene ${legacyPatients.length} ficha(s) y ${legacyAppointments.length} turno(s) guardados localmente. ¿Querés agregarlos a la cuenta profesional en la que iniciaste sesión? Se conservarán los datos actuales de la cuenta.`)) {
    const patientIds=new Set(patients.map(person=>person.id)); const importedPatients=legacyPatients.filter(person=>!patientIds.has(person.id));
    const appointmentIds=new Set(appointments.map(item=>item.id)); const mergedIds=new Set([...patients,...importedPatients].map(person=>person.id)); const importedAppointments=legacyAppointments.filter(item=>!appointmentIds.has(item.id)&&mergedIds.has(item.patientId));
    patients.push(...importedPatients); appointments.push(...importedAppointments); if(importedPatients.length||importedAppointments.length) { saveDirty=true; const saved=await saveCloudData(); if(saved)localStorage.setItem("nutri-guia-cloud-import-confirmed-v1","yes"); if(saved)toast(`Se agregaron ${importedPatients.length} ficha(s) y ${importedAppointments.length} turno(s) a tu cuenta.`); } else localStorage.setItem("nutri-guia-cloud-import-confirmed-v1","yes");
  }
  updateCounts(); renderAgenda();
}
async function checkForRemoteChanges() {
  if(!authenticated||saveDirty||savingCloudData)return;
  try { const response=await fetch("/api/data/version",{cache:"no-store"}); if(!response.ok)return; const result=await response.json(); const remote=Number(result.version)||0; if(remote>dataVersion&&remote!==dismissedRemoteVersion){if(window.confirm("Hay cambios guardados desde otro dispositivo. ¿Querés cargar la versión más reciente ahora?")){await loadCloudData();dismissedRemoteVersion=0;}else dismissedRemoteVersion=remote;} } catch { /* Se volverá a comprobar cuando haya conexión. */ }
}
function escapeHTML(value = "") { return String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]); }
function includesExactNutritionAmounts(draft) {
  const text = [draft.intro, ...(draft.recommendations || []), ...(draft.reviewNotes || []), ...(draft.days || []).flatMap(day => [day.extra, ...MEALS.map(([key]) => day[key])])].join(" ");
  return /\b\d+(?:[.,]\d+)?\s*(?:kcal|calor[ií]as?|kg|gramos?|gr|g|mililitros?|ml)\b|\b\d+(?:[.,]\d+)?\s*%/i.test(text);
}
function conditionName(key) { return ({ general: "Objetivo general", diabetes2: "Diabetes tipo 2", hipertension: "Hipertensión", ambas: "Diabetes tipo 2 · Hipertensión" })[key] || "Ficha"; }
function budgetName(key) { return ({ economico: "Económico", medio: "Medio", flexible: "Flexible" })[key] || "Medio"; }
function toast(message) { const el = document.getElementById("toast"); el.textContent = message; el.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove("show"), 3400); }
function setPage(page) {
  activePage = page;
  for (const id of ["home", "patients", "form", "detail", "agenda"]) document.getElementById(`page-${id}`).classList.toggle("hidden", id !== page);
  document.getElementById("crumb").textContent = ({ home: "Inicio", patients: "Mis pacientes", form: "Ficha individual", detail: "Plan semanal", agenda: "Agenda" })[page];
  document.querySelectorAll(".nav-item").forEach(button => button.classList.toggle("active", button.dataset.page === (page === "detail" || page === "form" ? "patients" : page)));
  document.getElementById("sidebar").classList.remove("open");
  document.querySelector(".mobile-bottom-nav").classList.toggle("hidden", page === "form");
  window.scrollTo({ top: 0, behavior: "smooth" });
}
function setWizardStep(step) {
  currentWizardStep = Math.min(3, Math.max(1, step));
  document.querySelectorAll("[data-step-section]").forEach(section => section.classList.toggle("hidden", Number(section.dataset.stepSection) !== currentWizardStep));
  const labels = ["", "PASO 1 DE 3 · DATOS BÁSICOS", "PASO 2 DE 3 · PREFERENCIAS", "PASO 3 DE 3 · PRIVACIDAD"];
  document.getElementById("wizard-step-label").textContent = labels[currentWizardStep];
  document.getElementById("wizard-fill").style.width = `${currentWizardStep * 33.333}%`;
  document.getElementById("wizard-back").classList.toggle("hidden", currentWizardStep === 1);
  document.getElementById("wizard-next").classList.toggle("hidden", currentWizardStep === 3);
  document.getElementById("wizard-save").classList.toggle("hidden", currentWizardStep !== 3);
  window.scrollTo({ top: 0, behavior: "smooth" });
}
function activePatients() { return patients.filter(person => !person.archivedAt); }
function upcomingControls() {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const limit = new Date(today); limit.setDate(limit.getDate() + 30);
  return activePatients().flatMap(person => person.consultations || []).filter(item => item.nextControl && new Date(`${item.nextControl}T00:00:00`) >= today && new Date(`${item.nextControl}T00:00:00`) <= limit).length;
}
function updateCounts() {
  document.getElementById("patient-count").textContent = activePatients().length;
  document.getElementById("home-count").textContent = activePatients().length;
  document.getElementById("plan-count").textContent = activePatients().filter(person => person.draft).length;
  document.getElementById("followup-count").textContent = upcomingControls();
  renderHomeAppointments();
  renderAttentionList();
  renderPatients();
}
function appointmentDate(value) { return new Date(value); }
function appointmentStatusName(status) { return ({ reserved: "Reservado", confirmed: "Confirmado", completed: "Realizado", cancelled: "Cancelado", noShow: "No asistió" })[status] || "Reservado"; }
function renderHomeAppointments() {
  const target = document.getElementById("home-appointments"); if (!target) return;
  const now = Date.now(); const rows = appointments.filter(item => !["cancelled", "completed", "noShow"].includes(item.status) && appointmentDate(item.start).getTime() >= now).sort((a,b) => a.start.localeCompare(b.start)).slice(0, 5);
  target.innerHTML = rows.length ? rows.map(item => { const patient = patients.find(person => person.id === item.patientId); return `<article class="appointment-row"><div class="appointment-time"><strong>${appointmentDate(item.start).toLocaleDateString("es-AR", { weekday:"short", day:"numeric", month:"short" })}</strong><span>${appointmentDate(item.start).toLocaleTimeString("es-AR", { hour:"2-digit", minute:"2-digit" })}</span></div><div class="appointment-info"><strong>${escapeHTML(patient ? patientName(patient) : "Paciente eliminado")}</strong><small>${escapeHTML(item.reason || "Control")} · ${escapeHTML(appointmentStatusName(item.status))}</small></div>${patient ? `<button class="button button-quiet" data-appointment-patient="${escapeHTML(patient.id)}">Abrir ficha</button>` : ""}</article>`; }).join("") : `<div class="recent-empty">No hay turnos próximos. Podés agendar uno desde Agenda.</div>`;
  target.querySelectorAll("[data-appointment-patient]").forEach(button => button.addEventListener("click", () => openPatient(button.dataset.appointmentPatient)));
}
function renderAttentionList() {
  const target = document.getElementById("attention-list"); if (!target) return;
  const today = todayISO(); const rows = activePatients().flatMap(person => {
    const consults = person.consultations || []; const overdue = consults.filter(item => item.nextControl && item.nextControl < today).sort((a,b) => b.nextControl.localeCompare(a.nextControl))[0];
    if (overdue) return [{ person, label: `Control vencido · ${formatDate(overdue.nextControl)}`, date: overdue.nextControl }];
    if (!consults.length) return [{ person, label: "Sin consultas registradas", date: "" }];
    return [];
  }).sort((a,b) => (a.date || "0000").localeCompare(b.date || "0000")).slice(0,8);
  target.innerHTML = rows.length ? rows.map(({person,label}) => `<button class="recent-row" data-attention-patient="${escapeHTML(person.id)}"><span class="avatar">${escapeHTML(initials(patientName(person)))}</span><span><strong>${escapeHTML(patientName(person))}</strong><small>${escapeHTML(label)}</small></span><span class="row-arrow">→</span></button>`).join("") : `<div class="recent-empty">No hay controles vencidos ni fichas sin consultas registradas.</div>`;
  target.querySelectorAll("[data-attention-patient]").forEach(button => button.addEventListener("click", () => openPatient(button.dataset.attentionPatient)));
}
function appointmentRange() {
  const selected = new Date(`${document.getElementById("agenda-date").value || todayISO()}T12:00:00`); const mode = document.getElementById("agenda-view").value;
  if (mode === "day") { const start = new Date(selected); start.setHours(0,0,0,0); const end = new Date(start); end.setDate(end.getDate()+1); return [start,end]; }
  if (mode === "month") { const start = new Date(selected.getFullYear(), selected.getMonth(), 1); const end = new Date(selected.getFullYear(), selected.getMonth()+1, 1); return [start,end]; }
  const start = new Date(selected); start.setDate(start.getDate()-((start.getDay()+6)%7)); start.setHours(0,0,0,0); const end = new Date(start); end.setDate(end.getDate()+7); return [start,end];
}
function renderAgenda() {
  const target = document.getElementById("appointment-list"); if (!target) return;
  const [start,end] = appointmentRange(); const rows = appointments.filter(item => appointmentDate(item.start) >= start && appointmentDate(item.start) < end).sort((a,b) => a.start.localeCompare(b.start));
  target.innerHTML = rows.length ? rows.map(item => { const patient = patients.find(person => person.id === item.patientId); return `<article class="appointment-row"><div class="appointment-time"><strong>${appointmentDate(item.start).toLocaleDateString("es-AR", { weekday:"short", day:"numeric", month:"short" })}</strong><span>${appointmentDate(item.start).toLocaleTimeString("es-AR", { hour:"2-digit", minute:"2-digit" })} · ${Number(item.duration) || 30} min</span></div><div class="appointment-info"><strong>${escapeHTML(patient ? patientName(patient) : "Paciente eliminado")}</strong><small>${escapeHTML(item.reason || "Control")} · ${escapeHTML(appointmentStatusName(item.status))}${item.notes ? ` · ${escapeHTML(item.notes)}` : ""}</small></div><div class="appointment-actions">${patient ? `<button class="button button-quiet" data-appointment-patient="${escapeHTML(patient.id)}">Ficha</button>` : ""}<button class="button button-quiet" data-edit-appointment="${escapeHTML(item.id)}">Editar</button><button class="button button-quiet" data-cancel-appointment="${escapeHTML(item.id)}">Cancelar</button><button class="button button-quiet text-danger" data-delete-appointment="${escapeHTML(item.id)}">Eliminar</button></div></article>`; }).join("") : `<div class="empty-state">No hay turnos para este período. Elegí otra fecha o agendá un turno.</div>`;
  target.querySelectorAll("[data-appointment-patient]").forEach(button => button.addEventListener("click", () => openPatient(button.dataset.appointmentPatient)));
  target.querySelectorAll("[data-edit-appointment]").forEach(button => button.addEventListener("click", () => openAppointmentForm(button.dataset.editAppointment)));
  target.querySelectorAll("[data-cancel-appointment]").forEach(button => button.addEventListener("click", () => { const item = appointments.find(row => row.id === button.dataset.cancelAppointment); if (item && window.confirm("¿Cancelar este turno?")) { item.status = "cancelled"; saveAppointments(); toast("Turno cancelado."); } }));
  target.querySelectorAll("[data-delete-appointment]").forEach(button => button.addEventListener("click", () => { if (!window.confirm("¿Eliminar este turno de forma permanente?")) return; appointments = appointments.filter(item => item.id !== button.dataset.deleteAppointment); saveAppointments(); toast("Turno eliminado."); }));
}
function openAppointmentForm(id = null, patientId = "") {
  const old = appointments.find(item => item.id === id); const start = old?.start || `${document.getElementById("agenda-date").value || todayISO()}T09:00`;
  document.getElementById("appointment-form-wrap").classList.remove("hidden");
  document.getElementById("appointment-form-wrap").innerHTML = `<form id="appointment-form" class="record-form form-card"><h3>${old ? "Editar o reprogramar turno" : "Nuevo turno"}</h3><input type="hidden" name="id" value="${escapeHTML(old?.id || "")}"/><div class="form-row"><label>Paciente<select name="patientId" required><option value="">Elegir paciente</option>${activePatients().map(person => `<option value="${escapeHTML(person.id)}" ${(old?.patientId || patientId) === person.id ? "selected" : ""}>${escapeHTML(patientName(person))}</option>`).join("")}</select></label><label>Fecha y hora<input name="start" type="datetime-local" required value="${escapeHTML(start.slice(0,16))}"/></label></div><div class="form-row"><label>Duración (minutos)<input name="duration" type="number" min="10" max="240" step="5" value="${Number(old?.duration) || 30}" required/></label><label>Motivo<input name="reason" maxlength="160" value="${escapeHTML(old?.reason || "Control")}"/></label></div><label>Estado<select name="status">${[["reserved","Reservado"],["confirmed","Confirmado"],["completed","Realizado"],["cancelled","Cancelado"],["noShow","No asistió"]].map(([value,label]) => `<option value="${value}" ${(old?.status || "reserved") === value ? "selected" : ""}>${label}</option>`).join("")}</select></label><label>Notas<textarea name="notes" rows="2" maxlength="1000">${escapeHTML(old?.notes || "")}</textarea></label><div class="form-actions"><button type="button" class="button button-quiet" id="close-appointment-form">Cerrar</button><button class="button button-primary" type="submit">Guardar turno</button></div></form>`;
  const form = document.getElementById("appointment-form");
  document.getElementById("close-appointment-form").addEventListener("click", () => document.getElementById("appointment-form-wrap").classList.add("hidden"));
  form.addEventListener("submit", event => { event.preventDefault(); const data = Object.fromEntries(new FormData(form)); if (data.status === "cancelled" && old?.status !== "cancelled" && !window.confirm("¿Cancelar este turno?")) return; const startMs = appointmentDate(data.start).getTime(); const endMs = startMs + Number(data.duration)*60000; const collision = appointments.find(item => item.id !== data.id && !["cancelled", "completed", "noShow"].includes(item.status) && startMs < appointmentDate(item.start).getTime() + Number(item.duration || 30)*60000 && endMs > appointmentDate(item.start).getTime()); if (collision) { toast("Ese horario se superpone con otro turno. Elegí otro horario."); return; } const saved = { ...data, id: data.id || crypto.randomUUID(), duration: Number(data.duration), updatedAt: Date.now(), createdAt: old?.createdAt || Date.now() }; if (old) appointments = appointments.map(item => item.id === old.id ? saved : item); else appointments.push(saved); document.getElementById("appointment-form-wrap").classList.add("hidden"); saveAppointments(); toast("Turno guardado."); });
}
function initials(name = "Paciente") { return name.trim().split(/\s+/).slice(0, 2).map(word => word[0]).join("").toUpperCase() || "P"; }
function patientName(person) { return person.name?.trim() || "Paciente sin nombre"; }
function renderPatients() {
  const recent = [...activePatients()].sort((a,b) => b.updatedAt - a.updatedAt).slice(0, 4);
  document.getElementById("recent-list").innerHTML = recent.length ? recent.map(person => `<button class="recent-row" data-open="${escapeHTML(person.id)}"><span class="avatar">${escapeHTML(initials(patientName(person)))}</span><span><strong>${escapeHTML(patientName(person))}</strong><small>${escapeHTML(conditionName(person.condition))} · ${person.age} años</small></span><span class="row-arrow">→</span></button>`).join("") : `<div class="recent-empty">Todavía no hay fichas. Cuando agregues una, aparecerá acá.</div>`;
  const list = document.getElementById("patient-list");
  if (!list) return;
  const query = (document.getElementById("patient-search")?.value || "").trim().toLocaleLowerCase("es-AR");
  const status = document.getElementById("patient-status")?.value || "active";
  const ordered = [...patients].filter(person => status === "all" || (status === "archived" ? Boolean(person.archivedAt) : !person.archivedAt)).filter(person => !query || `${patientName(person)} ${person.goal || ""} ${person.id || ""}`.toLocaleLowerCase("es-AR").includes(query)).sort((a,b) => b.updatedAt - a.updatedAt);
  list.innerHTML = ordered.length ? ordered.map(person => `<button class="patient-card" data-open="${escapeHTML(person.id)}"><div class="patient-card-top"><span class="avatar">${escapeHTML(initials(patientName(person)))}</span><span><h3>${escapeHTML(patientName(person))}</h3><small>${person.age} años · Actualizado ${new Date(person.updatedAt).toLocaleDateString("es-AR")}</small></span></div><div class="patient-tags"><span class="tag">${escapeHTML(conditionName(person.condition))}</span><span class="tag">${person.archivedAt ? "Archivado" : escapeHTML(person.goal || "Sin objetivo")}</span></div><div class="patient-card-bottom"><span>${person.draft ? "Plan guardado" : "Sin plan generado"}</span><span>Abrir ficha →</span></div></button>`).join("") : `<div class="empty-state">${query ? "No encontramos fichas con esa búsqueda." : status === "archived" ? "Todavía no hay fichas archivadas." : "Todavía no hay fichas. Creá la primera para empezar."}</div>`;
  document.querySelectorAll("[data-open]").forEach(button => button.addEventListener("click", () => openPatient(button.dataset.open)));
}
function openForm(id = null) {
  editingId = id;
  setWizardStep(1);
  const form = document.getElementById("patient-form");
  form.reset();
  const person = id ? patients.find(item => item.id === id) : null;
  document.getElementById("form-title").textContent = person ? "Editar ficha" : "Nueva ficha";
  if (person) {
    for (const key of ["name", "age", "condition", "goal", "likes", "avoids", "budget", "schedule", "context"]) if (form.elements[key]) form.elements[key].value = person[key] || "";
    if (form.elements.equationSex) form.elements.equationSex.value = person.equationSex || "";
    if (form.elements.activityLevel) form.elements.activityLevel.value = person.activityLevel || "";
    const latest = getLatestMeasurement(person);
    if (latest) for (const [key, value] of [["initialWeight", "weight"], ["initialHeight", "height"], ["initialWaist", "waist"], ["initialHip", "hip"]]) form.elements[key].value = latest[value] || "";
    form.elements.consent.checked = Boolean(person.consentedAt && person.consentVersion === 3);
  }
  setPage("form");
}
function openPatient(id) {
  const person = patients.find(item => item.id === id);
  if (!person) return;
  selectedId = id;
  detailTab = "summary";
  renderDetail(person);
  setPage("detail");
}
function renderDetail(person) {
  const el = document.getElementById("page-detail");
  const hasDraft = person.draft && Array.isArray(person.draft.days);
  const consultations = person.consultations || [];
  const measurements = person.measurements || [];
  const versions = person.planVersions || [];
  const latestConsult = [...consultations].sort((a,b) => b.date.localeCompare(a.date))[0];
  const latestMeasure = getLatestMeasurement(person);
  const requirements = calculatePatientRequirements(person);
  const mealProfileMessage = requirements ? `Objetivo energético para el borrador: ${requirements.dailyEnergyKcal} kcal/día; distribución interna 60% carbohidratos, 25% grasas y 15% proteínas.` : "No hay una estimación disponible: pueden faltar datos o el contexto requiere evitar este cálculo. El borrador se generará sin ese ajuste.";
  const tab = name => detailTab === name;
  const consultationsHTML = [...consultations].sort((a,b) => b.date.localeCompare(a.date)).map(item => `<details class="history-card"><summary><strong>${formatDate(item.date)} · ${escapeHTML(item.reason || "Consulta")}</strong></summary><form class="form-card history-edit" data-consultation="${escapeHTML(item.id)}"><label>Motivo<input name="reason" maxlength="160" value="${escapeHTML(item.reason || "")}" /></label><label>Observaciones<textarea name="notes" rows="2" maxlength="1200">${escapeHTML(item.notes || "")}</textarea></label><label>Adherencia y dificultades<textarea name="adherence" rows="2" maxlength="1000">${escapeHTML(item.adherence || "")}</textarea></label><label>Recomendaciones<textarea name="recommendations" rows="2" maxlength="1000">${escapeHTML(item.recommendations || "")}</textarea></label><label>Próximo control<input name="nextControl" type="date" value="${escapeHTML(item.nextControl || "")}" /></label><button class="button button-primary" type="submit">Guardar consulta</button></form></details>`).join("");
  const measurementRows = [...measurements].sort((a,b) => b.date.localeCompare(a.date)).map(item => { const bmi = item.bmi || (item.id === latestMeasure?.id ? latestMeasure.bmi : null); return `<tr><td>${formatDate(item.date)}</td><td>${item.weight ? `${escapeHTML(item.weight)} kg` : "—"}</td><td>${item.height ? `${escapeHTML(item.height)} cm` : "—"}</td><td>${bmi ? escapeHTML(bmi) : "—"}</td><td>${item.waist ? `${escapeHTML(item.waist)} cm` : "—"}</td><td>${item.hip ? `${escapeHTML(item.hip)} cm` : "—"}</td></tr>`; }).join("");
  const patientAppointments = appointments.filter(item => item.patientId === person.id && !["cancelled", "completed", "noShow"].includes(item.status)).sort((a,b) => a.start.localeCompare(b.start));
  const nextAppointment = patientAppointments.find(item => appointmentDate(item.start).getTime() >= Date.now());
  const appointmentMessage = nextAppointment ? `${formatDate(nextAppointment.start.slice(0,10))} · ${appointmentDate(nextAppointment.start).toLocaleTimeString("es-AR", {hour:"2-digit", minute:"2-digit"})}` : "Sin turno futuro agendado";
  const versionRows = versions.map((item, index) => `<details class="history-card"><summary><strong>Versión ${versions.length - index} · ${formatDateTime(item.savedAt)}</strong></summary><p>${escapeHTML(item.draft?.intro || "Borrador anterior")}</p><button type="button" class="button button-quiet" data-restore-plan="${index}">Restaurar como borrador</button></details>`).join("");
  el.innerHTML = `<section class="detail-header"><div><div class="eyebrow">FICHA INDIVIDUAL</div><h1>${escapeHTML(patientName(person))}</h1><p class="detail-meta">${escapeHTML(String(person.age))} años · ${escapeHTML(conditionName(person.condition))} · ${escapeHTML(person.archivedAt ? "Archivado" : "Activo")}</p></div><div class="detail-actions no-print"><button type="button" class="button button-quiet" id="generate-portal">Generar acceso paciente</button><button type="button" class="button button-quiet" id="edit-patient">Editar ficha</button><button type="button" class="button button-quiet" id="archive-patient">${person.archivedAt ? "Reactivar" : "Archivar"}</button><button type="button" class="button button-quiet text-danger" id="delete-patient">Eliminar</button></div></section><nav class="detail-tabs no-print" aria-label="Secciones de la ficha"><button type="button" data-tab="summary" class="${tab("summary") ? "active" : ""}">Resumen</button><button type="button" data-tab="consultations" class="${tab("consultations") ? "active" : ""}">Consultas</button><button type="button" data-tab="measurements" class="${tab("measurements") ? "active" : ""}">Mediciones</button><button type="button" data-tab="plans" class="${tab("plans") ? "active" : ""}">Planes</button></nav><section class="detail-panel ${tab("summary") ? "" : "hidden"}"><div class="summary-grid"><article class="summary-card"><small>OBJETIVO CONVERSADO</small><strong>${escapeHTML(person.goal || "Sin objetivo registrado")}</strong><span>${escapeHTML(person.likes ? `Gustos: ${person.likes}` : "")}</span></article><article class="summary-card"><small>ÚLTIMA MEDICIÓN</small><strong>${latestMeasure ? `${latestMeasure.weight ? `${escapeHTML(latestMeasure.weight)} kg` : "Peso —"} · ${latestMeasure.height ? `${escapeHTML(latestMeasure.height)} cm` : "Talla —"}` : "Sin mediciones"}</strong><span>${latestMeasure ? `Registrada ${formatDate(latestMeasure.date)}` : "Podés agregarla en Mediciones"}</span></article><article class="summary-card"><small>PRÓXIMO TURNO</small><strong>${escapeHTML(appointmentMessage)}</strong><span><button type="button" class="text-button" id="patient-add-appointment">Agendar o ver en agenda →</button></span></article></div><div class="form-card"><div class="form-section-title"><span>✳</span><div><h2>Seguimiento</h2><p>El IMC se muestra como referencia descriptiva, no como diagnóstico.</p></div></div><p>${latestConsult ? `Última consulta: ${formatDate(latestConsult.date)} · ${escapeHTML(latestConsult.reason || "Consulta")}` : "Todavía no hay consultas registradas."}</p><p>${latestConsult?.adherence ? `Adherencia y dificultades: ${escapeHTML(latestConsult.adherence)}` : "Registrá adherencia, dificultades y próximos pasos en Consultas."}</p><button type="button" class="button button-primary" data-tab="consultations">Registrar consulta</button></div><div class="form-card" id="patient-submissions-container"></div></section><section class="detail-panel ${tab("consultations") ? "" : "hidden"}"><form id="consultation-form" class="form-card record-form"><h2>Nueva consulta</h2><button type="button" class="button button-quiet" id="summarize-consultations">Resumir consultas y sugerir preguntas</button><div id="consultation-ai-result" class="ai-result hidden"></div><div class="form-row"><label>Fecha<input name="date" type="date" value="${todayISO()}" required /></label><label>Motivo<input name="reason" maxlength="160" placeholder="Control, seguimiento…" /></label></div><label>Observaciones<textarea name="notes" rows="2" maxlength="1200"></textarea></label><label>Adherencia y dificultades<textarea name="adherence" rows="2" maxlength="1000"></textarea></label><label>Recomendaciones y cambios acordados<textarea name="recommendations" rows="2" maxlength="1000"></textarea></label><label>Próximo control<input name="nextControl" type="date" /></label><fieldset class="consult-measurements"><legend>Mediciones de esta consulta</legend><label class="check-row"><input type="checkbox" name="saveMeasurements" value="yes" /> Guardar mediciones junto con la consulta</label><div class="form-row three-fields"><label>Peso (kg)<input name="checkWeight" type="number" min="1" max="500" step="0.1" /></label><label>Talla (cm)<input name="checkHeight" type="number" min="50" max="250" step="0.1" /></label><label>Cintura (cm)<input name="checkWaist" type="number" min="1" max="300" step="0.1" /></label></div><label>Cadera (cm)<input name="checkHip" type="number" min="1" max="300" step="0.1" /></label></fieldset><button class="button button-primary" type="submit">Guardar consulta</button></form><div class="history-list">${consultationsHTML || `<div class="empty-state">Todavía no hay consultas.</div>`}</div></section><section class="detail-panel ${tab("measurements") ? "" : "hidden"}"><form id="measurement-form" class="form-card record-form"><h2>Nueva medición</h2><div class="form-row"><label>Fecha<input name="date" type="date" value="${todayISO()}" required /></label><label>Peso (kg)<input name="weight" type="number" min="1" max="500" step="0.1" /></label></div><div class="form-row three-fields"><label>Talla (cm)<input name="height" type="number" min="50" max="250" step="0.1" /></label><label>Cintura (cm)<input name="waist" type="number" min="1" max="300" step="0.1" /></label><label>Cadera (cm)<input name="hip" type="number" min="1" max="300" step="0.1" /></label></div><button class="button button-primary" type="submit">Guardar medición</button></form><div class="table-scroll"><table class="measure-table"><thead><tr><th>Fecha</th><th>Peso</th><th>Talla</th><th>IMC</th><th>Cintura</th><th>Cadera</th></tr></thead><tbody>${measurementRows || `<tr><td colspan="6">Todavía no hay mediciones.</td></tr>`}</tbody></table></div></section><section id="plans-panel" class="detail-panel ${tab("plans") ? "" : "hidden"}"><div class="form-card"><h2>Planes y borradores</h2><p class="energy-banner">${escapeHTML(mealProfileMessage)}</p><form id="energy-adjust-form" class="record-form energy-adjust-form"><label>Ajuste profesional del objetivo energético (kcal/día)<input name="adjustment" type="number" min="-2000" max="2000" step="50" value="${Number(person.energyAdjustmentKcal) || 0}"/><small>Se aplica al gasto estimado en los nuevos borradores.</small></label><button class="button button-quiet" type="submit">Guardar ajuste</button></form><button type="button" class="button button-primary no-print" id="generate-menu">${hasDraft ? "Generar nuevo borrador" : "✳ Generar menú semanal"}</button><span id="generate-status" class="metric-caption"></span>${hasDraft ? `<div class="draft-banner">Borrador para revisar antes de compartir. No es una indicación clínica aprobada.</div><div id="draft-content">${renderDraft(person.draft)}</div>${renderRecipeDrafts(person.recipes)}<div class="detail-actions no-print"><button type="button" class="button button-quiet" id="save-draft">Guardar cambios</button>${person.approvedAt ? `<span class="approval-label">Aprobado para compartir</span><button type="button" class="button button-primary" id="print-menu">Imprimir o guardar como PDF</button>` : `<button type="button" class="button button-primary" id="approve-plan">Aprobar y preparar para enviar</button>`}</div>` : `<div class="empty-state">Todavía no hay un plan. La generación requiere autorización registrada y conexión con la IA.</div>`}</div><section class="plan-history"><h3>Versiones anteriores</h3><div class="history-list">${versionRows || `<div class="recent-empty">Los borradores previos aparecerán acá cuando generes uno nuevo.</div>`}</div></section><div id="print-plan" class="print-only"></div></section>`;

  el.querySelector("#generate-portal")?.addEventListener("click", async () => {
    if (!window.confirm("¿Generar un acceso para que este paciente pueda ver su plan y cargar mediciones?")) return;
    try {
      const res = await fetch("/api/patient-access", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ patientId: person.id }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      const url = `${window.location.origin}/portal/${data.token}`;
      window.prompt("Compartí este enlace o código con el paciente.\nEnlace directo (copialo entero):", url);
      window.alert(`Código de acceso manual (si no usa el enlace): ${data.shortCode}`);
    } catch (e) { toast(e.message || "No se pudo generar el acceso."); }
  });

  const subsEl = el.querySelector("#patient-submissions-container");
  if (person.submissions && person.submissions.length > 0) {
    subsEl.innerHTML = `<h3>Datos cargados por el paciente</h3>
      <div class="history-list">
        ${person.submissions.map(sub => `
          <div class="history-card" style="border-color: #85b395;">
            <strong>${formatDate(sub.data.date)} · ${sub.type === 'weight' ? 'Peso actualizado' : 'Nota pre-consulta'}</strong>
            <p>${sub.type === 'weight' ? `${escapeHTML(sub.data.weight)} kg` : escapeHTML(sub.data.note)}</p>
          </div>
        `).join("")}
      </div>
    `;
  } else {
    subsEl.classList.add("hidden");
  }

  el.querySelector("#patient-add-appointment")?.addEventListener("click", () => { document.getElementById("agenda-date").value = todayISO(); setPage("agenda"); openAppointmentForm(null, person.id); });
  el.querySelector("#edit-patient").addEventListener("click", () => openForm(person.id));
  el.querySelector("#archive-patient").addEventListener("click", () => toggleArchive(person.id));
  el.querySelector("#delete-patient").addEventListener("click", () => deletePatient(person.id));
  el.querySelectorAll("[data-tab]").forEach(button => button.addEventListener("click", () => { detailTab = button.dataset.tab; renderDetail(person); }));
  el.querySelector("#edit-requirements")?.addEventListener("click", () => openForm(person.id));
  el.querySelector("#energy-adjust-form")?.addEventListener("submit", event => { event.preventDefault(); const adjustment = Number(new FormData(event.currentTarget).get("adjustment")) || 0; person.energyAdjustmentKcal = adjustment; person.updatedAt = Date.now(); savePatients(); renderDetail(person); toast("Objetivo energético actualizado para el próximo borrador."); });
  el.querySelector("#consultation-form")?.addEventListener("submit", event => { event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget)); const { checkWeight, checkHeight, checkWaist, checkHip, saveMeasurements, ...consultationData } = data; const consultation = { ...consultationData, id: crypto.randomUUID(), createdAt: Date.now() }; const measureValues = [checkWeight, checkHeight, checkWaist, checkHip].map(value => Number(value) || null); if (saveMeasurements === "yes" && measureValues.some(value => value !== null)) { const [weight, height, waist, hip] = measureValues; const measurement = { date: data.date, weight, height, waist, hip, bmi: weight && height ? Number((weight / ((height / 100) ** 2)).toFixed(1)) : null, id: crypto.randomUUID(), createdAt: Date.now() }; person.measurements ||= []; person.measurements.push(measurement); consultation.measurementId = measurement.id; } person.consultations ||= []; person.consultations.push(consultation); person.updatedAt = Date.now(); savePatients(); detailTab = "consultations"; renderDetail(person); toast("Consulta guardada en la ficha."); });
  el.querySelectorAll("[data-consultation]").forEach(form => form.addEventListener("submit", event => { event.preventDefault(); const data = Object.fromEntries(new FormData(form)); const item = consultations.find(record => record.id === form.dataset.consultation); Object.assign(item, data); person.updatedAt = Date.now(); savePatients(); renderDetail(person); toast("Consulta actualizada."); }));
  el.querySelector("#measurement-form")?.addEventListener("submit", event => { event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget)); const weight = Number(data.weight) || null; const height = Number(data.height) || null; const measurement = { date: data.date, weight, height, waist: Number(data.waist) || null, hip: Number(data.hip) || null, bmi: weight && height ? Number((weight / ((height / 100) ** 2)).toFixed(1)) : null, id: crypto.randomUUID(), createdAt: Date.now() }; person.measurements ||= []; person.measurements.push(measurement); person.updatedAt = Date.now(); savePatients(); renderDetail(person); toast("Medición guardada. El IMC se calculó cuando había peso y talla."); });
  el.querySelectorAll("[data-restore-plan]").forEach(button => button.addEventListener("click", () => { const [version] = person.planVersions.splice(Number(button.dataset.restorePlan), 1); if (person.draft) person.planVersions.unshift({ savedAt: Date.now(), draft: structuredClone(person.draft) }); person.planVersions = person.planVersions.slice(0, 12); person.draft = structuredClone(version.draft); person.approvedAt = null; person.updatedAt = Date.now(); savePatients(); renderDetail(person); toast("Plan restaurado como borrador para revisar."); }));
  el.querySelector("#generate-menu")?.addEventListener("click", () => generateMenu(person));
  el.querySelector("#approve-plan")?.addEventListener("click", () => { saveDraftFromScreen(person.id, false); if(!window.confirm("¿Confirmás que revisaste y aprobás este plan para compartir con el paciente?")) return; person.approvedAt=Date.now(); person.updatedAt=Date.now(); savePatients(); renderDetail(person); toast("Plan aprobado. Ya podés guardarlo como PDF y elegir cómo compartirlo."); });
  el.querySelector("#summarize-consultations")?.addEventListener("click", async event => { const button=event.currentTarget, box=el.querySelector("#consultation-ai-result"); button.disabled=true; box.classList.remove("hidden"); box.textContent="Preparando resumen…"; try { const response=await fetch("/api/ai/consultation-summary",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({patientId:person.id})}); const result=await response.json(); if(!response.ok) throw new Error(result.error); box.innerHTML=`<strong>Resumen para revisar</strong><p>${escapeHTML(result.summary)}</p><strong>Preguntas posibles</strong><ul>${result.questions.map(q=>`<li>${escapeHTML(q)}</li>`).join("")}</ul>`; } catch(error){box.textContent=error.message||"No se pudo preparar el resumen.";} finally{button.disabled=false;} });
  el.querySelectorAll("[data-ai-meal]").forEach(button=>button.addEventListener("click", async()=>{const card=button.closest(".meal-edit"),area=card.querySelector("textarea"),box=card.querySelector(".ai-result"),action=button.dataset.aiMeal;let body={patientId:person.id};let endpoint=""; if(action==="replace"){endpoint="regenerate-meal";body.dayIndex=Number(area.dataset.day);body.mealKey=area.dataset.meal;body.instruction=window.prompt("¿Qué cambio te gustaría probar? (opcional)")||"";}else if(action==="recipe"){endpoint="recipe";body.meal=area.value;body.portions=window.prompt("¿Para cuántas porciones?","2")||"2";}else{endpoint="substitutions";body.meal=area.value;body.ingredient=window.prompt("¿Qué alimento querés sustituir?")||"";if(!body.ingredient)return;} button.disabled=true;box.classList.remove("hidden");box.textContent="Consultando a la IA…";try{const response=await fetch(`/api/ai/${endpoint}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});const result=await response.json();if(!response.ok)throw new Error(result.error);if(action==="replace"){area.value=result.meal;person.approvedAt=null;box.textContent=`${result.meal} · Revisá: ${result.reviewNote}`;}else if(action==="recipe"){person.recipes||=[];person.recipes.push({...result,meal:area.value,id:crypto.randomUUID(),createdAt:Date.now()});person.approvedAt=null;person.updatedAt=Date.now();savePatients();detailTab="plans";renderDetail(person);toast("Receta guardada como propuesta. Revisala antes de aprobar el PDF.");}else{box.innerHTML=`<strong>Ideas de sustitución para revisar</strong><ul>${result.options.map(i=>`<li><strong>${escapeHTML(i.name)}:</strong> ${escapeHTML(i.idea)}</li>`).join("")}</ul><small>${escapeHTML(result.reviewNote)}</small>`;}}catch(error){box.textContent=error.message||"No se pudo completar la sugerencia.";}finally{button.disabled=false;}}));
  el.querySelector("#print-menu")?.addEventListener("click", async () => {
    if(!person.approvedAt){toast("Primero aprobá el plan para preparar el PDF.");return;}
    const changed=[...el.querySelectorAll("textarea[data-day][data-meal]")].some(area => person.draft.days[Number(area.dataset.day)]?.[area.dataset.meal] !== area.value.trim());
    if(changed){saveDraftFromScreen(person.id, true);renderDetail(person);toast("Detecté cambios en el plan. Revisalo y aprobalo nuevamente antes de crear el PDF.");return;}
    saveDraftFromScreen(person.id, false);
    const printPlan = el.querySelector("#print-plan");
    printPlan.innerHTML = renderPrintablePlan(person);
    const images = [...printPlan.querySelectorAll("img")];
    await Promise.race([Promise.all(images.map(image => image.complete ? Promise.resolve() : new Promise(resolve => { image.onload = resolve; image.onerror = resolve; }))), new Promise(resolve => window.setTimeout(resolve, 3500))]);
    window.addEventListener("afterprint", () => { printPlan.innerHTML = ""; }, { once: true });
    window.print();
  });
  el.querySelector("#save-draft")?.addEventListener("click", () => { saveDraftFromScreen(person.id); renderDetail(person); });
}
function todayISO() { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function formatDate(value) { if (!value) return "Sin fecha"; return new Date(`${value}T12:00:00`).toLocaleDateString("es-AR", { day: "numeric", month: "short", year: "numeric" }); }
function formatDateTime(value) { return new Date(value).toLocaleString("es-AR", { dateStyle: "medium", timeStyle: "short" }); }
function toggleArchive(id) { const person = patients.find(item => item.id === id); if (!person) return; person.archivedAt = person.archivedAt ? null : Date.now(); person.updatedAt = Date.now(); savePatients(); if (person.archivedAt) { setPage("patients"); document.getElementById("patient-status").value = "active"; renderPatients(); toast("Ficha archivada. Podés reactivarla desde Archivados."); } else { renderDetail(person); toast("Ficha reactivada."); } }
function renderPrintablePlan(person) {
  const draft = person.draft;
  const mealHeadings = [["breakfast", "Desayuno"], ["snack1", "Colación<br>mañana"], ["lunch", "Almuerzo"], ["merienda", "Merienda"], ["snack2", "Colación<br>tarde"], ["dinner", "Cena"]];
  const mealRows = draft.days.map((day, index) => `<tr><th scope="row">${escapeHTML(day.day || DAYS[index])}</th>${mealHeadings.map(([key]) => `<td>${escapeHTML(day[key] || "—")}</td>`).join("")}</tr>`).join("");
  const recommendations = (draft.recommendations || []).map(item => `<li>${escapeHTML(item)}</li>`).join("");
  const alternatives = draft.days.filter(day => day.extra?.trim()).map((day, index) => `<li><strong>${escapeHTML(day.day || DAYS[index])}:</strong> ${escapeHTML(day.extra)}</li>`).join("");
  return `<article class="print-document"><header class="print-header"><h1>Plan de alimentación</h1><p class="print-meta"><strong>${escapeHTML(patientName(person))}</strong></p></header><section class="print-section"><h2>Menú semanal</h2><table class="print-table week-table"><thead><tr><th>Día</th>${mealHeadings.map(([, title]) => `<th>${title}</th>`).join("")}</tr></thead><tbody>${mealRows}</tbody></table></section><section class="print-section"><h2>Recomendaciones</h2><ul class="print-list">${recommendations}</ul></section>${alternatives ? `<section class="print-section"><h2>Alternativas del menú</h2><ul class="print-list">${alternatives}</ul></section>` : ""}${renderRecipeDrafts(person.recipes, true)}</article>`;
}
function renderRecipeDrafts(recipes = [], printable = false) {
  if (!Array.isArray(recipes) || !recipes.length) return "";
  return `<section class="recipe-drafts ${printable ? "print-section" : "no-print"}"><h3>${printable ? "Recetas" : "Recetas para revisar"}</h3>${!printable ? "<p>Se guardan como propuestas y se incluyen en el PDF cuando aprobás el plan.</p>" : ""}${recipes.map(recipe => `<article class="recipe-draft"><strong>${escapeHTML(recipe.name)} · ${escapeHTML(recipe.portions)}</strong><ul>${(recipe.ingredients || []).map(item => `<li>${escapeHTML(item.quantity)} ${escapeHTML(item.measure)} de ${escapeHTML(item.ingredient)}</li>`).join("")}</ul><ol>${(recipe.steps || []).map(step => `<li>${escapeHTML(step)}</li>`).join("")}</ol><small>${Number(recipe.timeMinutes) || ""} min · ${escapeHTML(recipe.difficulty || "")} ${printable ? "" : `· Revisar: ${escapeHTML(recipe.reviewNote || "")}`}</small></article>`).join("")}</section>`;
}
function renderDraft(draft) {
  const days = draft.days.map((day, index) => `<details class="day-card" ${index === 0 ? "open" : ""}><summary><h3>${escapeHTML(day.day || DAYS[index])}</h3></summary><div class="meals-grid">${MEALS.map(([key, title]) => `<div class="meal-edit"><label>${title}<textarea data-day="${index}" data-meal="${key}" rows="3">${escapeHTML(day[key] || "")}</textarea></label><div class="ai-actions no-print"><button type="button" class="button button-quiet" data-ai-meal="replace">Reemplazar comida</button><button type="button" class="button button-quiet" data-ai-meal="recipe">Crear receta</button><button type="button" class="button button-quiet" data-ai-meal="substitute">Sugerir sustituciones</button></div><div class="ai-result hidden"></div></div>`).join("")}</div>${day.extra ? `<div class="metric-caption" style="margin-top:8px">Alternativa: ${escapeHTML(day.extra)}</div>` : ""}</details>`).join("");
  return `<div class="draft-intro">${escapeHTML(draft.intro || "Propuesta semanal orientativa, pendiente de revisión clínica.")}</div><div class="draft-week">${days}</div><section class="recommendations"><h3>Recomendaciones para conversar</h3><ul>${(draft.recommendations || []).map(item => `<li>${escapeHTML(item)}</li>`).join("")}</ul></section><section class="review-notes"><h3>Para revisar antes de compartir</h3><ul>${(draft.reviewNotes || ["Validá que el borrador sea apropiado para esta persona."]).map(item => `<li>${escapeHTML(item)}</li>`).join("")}</ul></section>`;
}
function saveDraftFromScreen(id, invalidateApproval = true) {
  const person = patients.find(item => item.id === id);
  if (!person?.draft) return;
  document.querySelectorAll("textarea[data-day][data-meal]").forEach(area => { const day = person.draft.days[Number(area.dataset.day)]; if (day) day[area.dataset.meal] = area.value.trim(); });
  if (invalidateApproval) person.approvedAt = null; person.updatedAt = Date.now(); savePatients(); toast(invalidateApproval ? "Cambios guardados. El plan necesita aprobación otra vez." : "Revisión guardada.");
}
async function generateMenu(person) {
  if (!person.consentedAt || person.consentVersion !== 3) { toast("Falta registrar la autorización de la persona para usar IA."); return; }
  const button = document.getElementById("generate-menu");
  const status = document.getElementById("generate-status");
  const requirements = calculatePatientRequirements(person);
  button.disabled = true; button.innerHTML = '<span class="spinner"></span> Preparando borrador…';
  status.textContent = "Conectando con la IA. Puede tardar un momento.";
  try {
    const response = await fetch("/api/generate-menu", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ patientId: person.id, age: Number(person.age), condition: conditionName(person.condition), goal: person.goal, budget: budgetName(person.budget), likes: person.likes || "No especificado", avoids: person.avoids || "No especificado", schedule: person.schedule || "No especificado", context: person.context || "No especificado", requirements: requirements ? { dailyEnergyKcal: requirements.dailyEnergyKcal, macroDistribution: requirements.macroDistribution } : null }) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "No se pudo generar el borrador.");
    if (!Array.isArray(payload.days) || payload.days.length !== 7 || payload.days.some(day => MEALS.some(([key]) => typeof day[key] !== "string" || !day[key].trim()))) throw new Error("La propuesta no incluyó los siete días y sus seis comidas completas. Intentá nuevamente.");
    if (includesExactNutritionAmounts(payload)) throw new Error("La propuesta incluyó calorías, gramos, mililitros o porcentajes. No se guardó; volvé a generarla para obtener porciones caseras.");
    payload.days.forEach((day, index) => { day.day = DAYS[index]; });
    if (person.draft) { person.planVersions ||= []; person.planVersions.unshift({ savedAt: Date.now(), draft: structuredClone(person.draft) }); person.planVersions = person.planVersions.slice(0, 12); }
    person.draft = payload; person.approvedAt = null; person.updatedAt = Date.now(); savePatients(); detailTab = "plans"; renderDetail(person); setPage("detail"); toast("Borrador creado. Revisalo antes de compartirlo.");
  } catch (error) {
    status.textContent = error.message;
    status.className = "no-print text-danger";
    button.disabled = false; button.innerHTML = person.draft ? "↻ Intentar de nuevo" : "✳ Intentar de nuevo";
    if (!error.message.includes("Falta configurar")) toast(error.message);
  }
}
function deletePatient(id) {
  const related = appointments.filter(item => item.patientId === id).length;
  if (!window.confirm(`¿Querés eliminar esta ficha y su borrador de tu cuenta? También se eliminarán ${related} turno(s) asociados. Esta acción no se puede deshacer.`)) return;
  patients = patients.filter(person => person.id !== id); appointments = appointments.filter(item => item.patientId !== id); savePatients(); saveAppointments(); setPage("patients"); toast("Ficha y turnos asociados eliminados de este dispositivo.");
}
document.querySelectorAll(".nav-item, [data-page]").forEach(button => button.addEventListener("click", () => { setPage(button.dataset.page); if (button.dataset.page === "agenda") renderAgenda(); }));
document.getElementById("add-appointment").addEventListener("click", () => openAppointmentForm());
document.getElementById("agenda-view").addEventListener("change", renderAgenda);
document.getElementById("agenda-date").addEventListener("change", renderAgenda);
document.getElementById("agenda-today").addEventListener("click", () => { document.getElementById("agenda-date").value = todayISO(); renderAgenda(); });
for (const [id, direction] of [["agenda-prev", -1], ["agenda-next", 1]]) document.getElementById(id).addEventListener("click", () => { const date = new Date(`${document.getElementById("agenda-date").value || todayISO()}T12:00:00`); const view = document.getElementById("agenda-view").value; if (view === "month") { date.setDate(1); date.setMonth(date.getMonth() + direction); } else date.setDate(date.getDate() + direction * (view === "day" ? 1 : 7)); document.getElementById("agenda-date").value = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`; renderAgenda(); });
document.getElementById("add-patient").addEventListener("click", () => openForm());
document.getElementById("add-patient-list").addEventListener("click", () => openForm());
document.getElementById("view-patients").addEventListener("click", () => setPage("patients"));
document.getElementById("all-patients").addEventListener("click", () => setPage("patients"));
document.getElementById("cancel-form").addEventListener("click", () => setPage(editingId ? "detail" : "home"));
document.getElementById("mobile-menu").addEventListener("click", () => document.getElementById("sidebar").classList.toggle("open"));
document.getElementById("wizard-next").addEventListener("click", () => {
  const section = document.querySelector(`[data-step-section="${currentWizardStep}"]`);
  const invalid = section.querySelector(":invalid");
  if (invalid) { invalid.reportValidity(); return; }
  setWizardStep(currentWizardStep + 1);
});
document.getElementById("wizard-back").addEventListener("click", () => setWizardStep(currentWizardStep - 1));
document.getElementById("mobile-add").addEventListener("click", () => openForm());
document.getElementById("patient-search").addEventListener("input", renderPatients);
document.getElementById("patient-status").addEventListener("change", renderPatients);
document.getElementById("export-data").addEventListener("click", () => {
  const file = new Blob([JSON.stringify({ format: "nutri-guia-backup", version: 2, exportedAt: new Date().toISOString(), patients, appointments }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(file); const link = document.createElement("a"); link.href = url; link.download = `nutri-guia-respaldo-${todayISO()}.json`; link.click(); URL.revokeObjectURL(url); toast("Respaldo descargado. Guardalo en un lugar privado.");
});
document.getElementById("import-data").addEventListener("click", () => document.getElementById("import-file").click());
document.getElementById("import-file").addEventListener("change", async event => {
  const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (!file) return;
  if (file.size > 20_000_000) { toast("El archivo supera el tamaño permitido para importar."); return; }
  try {
    const backup = JSON.parse(await file.text()); const records = Array.isArray(backup) ? backup : backup?.patients;
    if (!Array.isArray(records) || records.length > 10000 || records.some(item => !item || typeof item !== "object" || typeof item.name !== "string" || !Number.isFinite(Number(item.age)))) throw new Error("El archivo no tiene el formato de respaldo de Nutri Guía.");
    const known = new Set(patients.map(item => item.id)); const additions = records.filter(item => { if (!item.id) return true; if (known.has(item.id)) return false; known.add(item.id); return true; }).map(item => ({ ...item, id: item.id || crypto.randomUUID(), createdAt: item.createdAt || Date.now(), updatedAt: item.updatedAt || Date.now(), consultations: Array.isArray(item.consultations) ? item.consultations : [], measurements: Array.isArray(item.measurements) ? item.measurements : [], planVersions: Array.isArray(item.planVersions) ? item.planVersions : [] }));
    const incomingAppointments = Array.isArray(backup?.appointments) ? backup.appointments.filter(item => item && typeof item.id === "string" && typeof item.start === "string" && typeof item.patientId === "string" && [...patients, ...additions].some(person => person.id === item.patientId) && !appointments.some(existing => existing.id === item.id)) : [];
    if (!additions.length && !incomingAppointments.length) { toast("El respaldo no contiene datos nuevos para agregar."); return; }
    if (!window.confirm(`Se agregarán ${additions.length} ficha(s) y ${incomingAppointments.length} turno(s). Los datos actuales no se reemplazarán. ¿Continuar?`)) return;
    patients.push(...additions); appointments.push(...incomingAppointments); savePatients(); saveAppointments(); renderPatients(); toast(`Se importaron ${additions.length} ficha(s) y ${incomingAppointments.length} turno(s).`);
  } catch (error) { toast(error instanceof SyntaxError ? "El archivo no es un JSON válido." : error.message || "No se pudo importar el archivo."); }
});
document.getElementById("patient-form").addEventListener("submit", event => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const data = Object.fromEntries(new FormData(form).entries());
  const old = editingId ? patients.find(person => person.id === editingId) : null;
  const initialMeasurement = { date: todayISO(), weight: Number(data.initialWeight) || null, height: Number(data.initialHeight) || null, waist: Number(data.initialWaist) || null, hip: Number(data.initialHip) || null, id: crypto.randomUUID(), createdAt: Date.now() };
  initialMeasurement.bmi = initialMeasurement.weight && initialMeasurement.height ? Number((initialMeasurement.weight / ((initialMeasurement.height / 100) ** 2)).toFixed(1)) : null;
  const oldLatest = getLatestMeasurement(old);
  const anthropometryChanged = Object.entries({ weight: initialMeasurement.weight, height: initialMeasurement.height, waist: initialMeasurement.waist, hip: initialMeasurement.hip }).some(([key, value]) => (Number(oldLatest?.[key]) || null) !== value);
  const updatedMeasurements = [...(old?.measurements || [])];
  if (Object.values(initialMeasurement).some(value => typeof value === "number" && value > 0) && anthropometryChanged) updatedMeasurements.push(initialMeasurement);
  const previousConsentStillApplies = old?.consentVersion === 3 && Boolean(old?.consentedAt);
  const person = { ...(old || {}), id: old?.id || crypto.randomUUID(), createdAt: old?.createdAt || Date.now(), updatedAt: Date.now(), name: data.name.trim(), age: Number(data.age), condition: data.condition, equationSex: data.equationSex || null, activityLevel: data.activityLevel || null, goal: data.goal.trim(), likes: data.likes.trim(), avoids: data.avoids.trim(), budget: data.budget, schedule: data.schedule.trim(), context: data.context.trim(), measurements: updatedMeasurements, consentedAt: form.elements.consent.checked ? (previousConsentStillApplies ? old.consentedAt : Date.now()) : null, consentVersion: form.elements.consent.checked ? 3 : null };
  if (old) patients = patients.map(item => item.id === old.id ? person : item); else patients.push(person);
  savePatients(); toast("Ficha guardada en tu cuenta privada.");
  if (old) openPatient(old.id); else setPage("patients");
});
document.getElementById("today").textContent = new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short", year: "numeric" }).format(new Date());
document.getElementById("agenda-date").value = todayISO();
renderAgenda();
const loginGate = document.getElementById("login-gate");
const loginForm = document.getElementById("login-form");
const signoutButton = document.getElementById("signout");
const changePasswordButton = document.getElementById("change-password");
const installButton = document.getElementById("install-app");
const standalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
if (!standalone && (location.protocol === "https:" || ["localhost", "127.0.0.1"].includes(location.hostname))) installButton.classList.remove("hidden");
window.addEventListener("beforeinstallprompt", event => { event.preventDefault(); installPrompt = event; installButton.classList.remove("hidden"); });
installButton.addEventListener("click", async () => {
  if (installPrompt) {
    installPrompt.prompt();
    const result = await installPrompt.userChoice;
    if (result.outcome === "accepted") installButton.classList.add("hidden");
    installPrompt = null;
    return;
  }
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  toast(ios ? "En Safari, tocá Compartir y elegí Agregar a pantalla de inicio." : "Abrí el menú del navegador ⋮ y elegí Instalar app o Añadir a pantalla de inicio.");
});
window.addEventListener("appinstalled", () => { installButton.classList.add("hidden"); toast("¡Nutri Guía quedó instalada en tu celular!"); });
let passwordRequired = false;
async function refreshAuth() {
  try {
    const response = await fetch("/api/status", { cache: "no-store" });
    const status = await response.json();
    passwordRequired = true;
    authenticated = Boolean(status.authenticated);
    loginGate.classList.toggle("hidden", authenticated);
    document.querySelector(".app-shell").classList.toggle("hidden", !authenticated);
    signoutButton.classList.toggle("hidden", !authenticated);
    changePasswordButton.classList.toggle("hidden", !authenticated);
    if (authenticated) { document.querySelector(".profile strong").textContent=status.professional?.name || "Profesional"; document.querySelector(".welcome h1").innerHTML=`Hola, ${escapeHTML(status.professional?.name || "profesional")} <span class="wave">✳</span>`; document.querySelector(".profile .avatar").textContent=initials(status.professional?.name || "Profesional"); await loadCloudData(); }
  } catch { authenticated=false; loginGate.classList.remove("hidden"); document.querySelector(".app-shell").classList.add("hidden"); document.getElementById("login-error").textContent="No se pudo conectar con la app. Verificá que el servidor y la base estén disponibles."; }
}
loginForm.addEventListener("submit", async event => {
  event.preventDefault();
  const error = document.getElementById("login-error");
  const button = loginForm.querySelector("button[type=submit]");
  button.disabled = true; error.textContent = "";
  try {
    const response = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: loginForm.elements.email.value, password: loginForm.elements.password.value }) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "No se pudo iniciar sesión.");
    loginForm.reset(); await refreshAuth();
  } catch (err) { error.textContent = err.message; }
  finally { button.disabled = false; }
});
signoutButton.addEventListener("click", async () => { clearTimeout(saveTimer); if(saveDirty) await saveCloudData(); await fetch("/api/logout", { method: "POST" }); authenticated=false; patients=[]; appointments=[]; updateCounts(); await refreshAuth(); });
changePasswordButton.addEventListener("click", async () => { const currentPassword=window.prompt("Ingresá tu contraseña actual:"); if(currentPassword===null)return; const newPassword=window.prompt("Ingresá una contraseña nueva de al menos 12 caracteres:"); if(newPassword===null)return; try{const response=await fetch("/api/change-password",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({currentPassword,newPassword})});const result=await response.json();if(!response.ok)throw new Error(result.error);toast("Contraseña actualizada.");}catch(error){toast(error.message||"No se pudo cambiar la contraseña.");} });
refreshAuth();
setInterval(checkForRemoteChanges,30_000);
if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js?v=11").catch(() => {}));
updateCounts();
