import { $, conditionName, download, escapeHTML, formatDate, initials, patientName, toast, todayISO } from "./util.js";
import { S, activePatients, backupJSON, findPatient, queueSave } from "./state.js";
import { nav, setPage } from "./nav.js";
import { logHistory, uid } from "./logic.js";
import { getLatestMeasurement } from "../nutrition.mjs";
import { renderAgenda, renderHomeAppointments } from "./agenda.js";

let wizardStep = 1;
const CONSENT_VERSION = 3;

// ---------- Inicio y lista ----------
function upcomingControls() {
  const today = todayISO();
  const limit = new Date(); limit.setDate(limit.getDate() + 30);
  const limitISO = `${limit.getFullYear()}-${String(limit.getMonth() + 1).padStart(2, "0")}-${String(limit.getDate()).padStart(2, "0")}`;
  return activePatients().flatMap(person => person.consultations || []).filter(item => item.nextControl && item.nextControl >= today && item.nextControl <= limitISO).length;
}

function renderAttention() {
  const target = $("attention-list"); if (!target) return;
  const today = todayISO();
  const rows = activePatients().flatMap(person => {
    const consults = person.consultations || [];
    const overdue = consults.filter(item => item.nextControl && item.nextControl < today).sort((a, b) => b.nextControl.localeCompare(a.nextControl))[0];
    const latestControl = consults.map(item => item.nextControl).filter(Boolean).sort().pop();
    if (overdue && (!latestControl || latestControl < today)) return [{ person, label: `Control vencido · ${formatDate(overdue.nextControl)}`, date: overdue.nextControl }];
    if (!consults.length) return [{ person, label: "Sin consultas registradas", date: "" }];
    return [];
  }).sort((a, b) => (a.date || "0000").localeCompare(b.date || "0000")).slice(0, 8);
  target.innerHTML = rows.length ? rows.map(({ person, label }) => `<button class="recent-row" data-open="${escapeHTML(person.id)}"><span class="avatar">${escapeHTML(initials(patientName(person)))}</span><span><strong>${escapeHTML(patientName(person))}</strong><small>${escapeHTML(label)}</small></span><span class="row-arrow">→</span></button>`).join("") : `<div class="recent-empty">No hay controles vencidos ni fichas sin consultas registradas.</div>`;
}

export function renderPatients() {
  const active = activePatients();
  $("patient-count").textContent = active.length;
  $("home-count").textContent = active.length;
  $("plan-count").textContent = active.filter(person => person.draft).length;
  $("followup-count").textContent = upcomingControls();
  renderAttention();
  const recent = [...active].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 4);
  $("recent-list").innerHTML = recent.length ? recent.map(person => `<button class="recent-row" data-open="${escapeHTML(person.id)}"><span class="avatar">${escapeHTML(initials(patientName(person)))}</span><span><strong>${escapeHTML(patientName(person))}</strong><small>${escapeHTML(conditionName(person.condition))} · ${escapeHTML(person.age)} años</small></span><span class="row-arrow">→</span></button>`).join("") : `<div class="recent-empty">Todavía no hay fichas. Cuando agregues una, aparecerá acá.</div>`;
  const query = ($("patient-search")?.value || "").trim().toLocaleLowerCase("es-AR");
  const status = $("patient-status")?.value || "active";
  const ordered = S.patients
    .filter(person => status === "all" || (status === "archived" ? Boolean(person.archivedAt) : !person.archivedAt))
    .filter(person => !query || `${patientName(person)} ${person.goal || ""}`.toLocaleLowerCase("es-AR").includes(query))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  $("patient-list").innerHTML = ordered.length ? ordered.map(person => `<button class="patient-card" data-open="${escapeHTML(person.id)}"><div class="patient-card-top"><span class="avatar">${escapeHTML(initials(patientName(person)))}</span><span><h3>${escapeHTML(patientName(person))}</h3><small>${escapeHTML(person.age)} años · Actualizado ${new Date(person.updatedAt).toLocaleDateString("es-AR")}</small></span></div><div class="patient-tags"><span class="tag">${escapeHTML(conditionName(person.condition))}</span>${person.allergies ? `<span class="tag tag-alert">Alergias</span>` : ""}<span class="tag">${person.archivedAt ? "Archivado" : escapeHTML(person.goal || "Sin objetivo")}</span></div><div class="patient-card-bottom"><span>${person.draft ? "Plan guardado" : "Sin plan generado"}</span><span>Abrir ficha →</span></div></button>`).join("") : `<div class="empty-state">${query ? "No encontramos fichas con esa búsqueda." : status === "archived" ? "Todavía no hay fichas archivadas." : "Todavía no hay fichas. Creá la primera para empezar."}</div>`;
  document.querySelectorAll("[data-open]").forEach(button => { button.onclick = () => nav.openPatient(button.dataset.open); });
}

export function refreshAll() { renderPatients(); renderHomeAppointments(); renderAgenda(); }

// ---------- Formulario ----------
function setWizardStep(step) {
  wizardStep = Math.min(3, Math.max(1, step));
  document.querySelectorAll("[data-step-section]").forEach(section => section.classList.toggle("hidden", Number(section.dataset.stepSection) !== wizardStep));
  $("wizard-step-label").textContent = ["", "PASO 1 DE 3 · DATOS BÁSICOS", "PASO 2 DE 3 · PREFERENCIAS Y ALERGIAS", "PASO 3 DE 3 · PRIVACIDAD"][wizardStep];
  $("wizard-fill").style.width = `${wizardStep * 33.333}%`;
  $("wizard-back").classList.toggle("hidden", wizardStep === 1);
  $("wizard-next").classList.toggle("hidden", wizardStep === 3);
  $("wizard-save").classList.toggle("hidden", wizardStep !== 3);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

export function openForm(id = null) {
  nav.state.editingId = id;
  setWizardStep(1);
  const form = $("patient-form");
  form.reset();
  const person = id ? findPatient(id) : null;
  $("form-title").textContent = person ? "Editar ficha" : "Nueva ficha";
  if (person) {
    for (const key of ["name", "age", "condition", "goal", "likes", "allergies", "avoids", "budget", "schedule", "context", "phone", "email", "equationSex", "activityLevel"]) if (form.elements[key]) form.elements[key].value = person[key] ?? "";
    const latest = getLatestMeasurement(person);
    if (latest) for (const [field, key] of [["initialWeight", "weight"], ["initialHeight", "height"], ["initialWaist", "waist"], ["initialHip", "hip"]]) form.elements[field].value = latest[key] || "";
    form.elements.consent.checked = Boolean(person.consentedAt && person.consentVersion === CONSENT_VERSION);
  }
  setPage("form");
}

function bmiOf(weight, height) { return weight && height ? Number((weight / ((height / 100) ** 2)).toFixed(1)) : null; }

function submitPatient(event) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const data = Object.fromEntries(new FormData(form).entries());
  const old = nav.state.editingId ? findPatient(nav.state.editingId) : null;
  const measurement = { date: todayISO(), weight: Number(data.initialWeight) || null, height: Number(data.initialHeight) || null, waist: Number(data.initialWaist) || null, hip: Number(data.initialHip) || null, id: uid(), createdAt: Date.now() };
  measurement.bmi = bmiOf(measurement.weight, measurement.height);
  const oldLatest = getLatestMeasurement(old);
  const changedBody = ["weight", "height", "waist", "hip"].some(key => (Number(oldLatest?.[key]) || null) !== measurement[key]);
  const measurements = [...(old?.measurements || [])];
  if (changedBody && ["weight", "height", "waist", "hip"].some(key => measurement[key] > 0)) measurements.push(measurement);
  const consentStillValid = old?.consentVersion === CONSENT_VERSION && Boolean(old?.consentedAt);
  const person = {
    ...(old || {}), id: old?.id || uid(), createdAt: old?.createdAt || Date.now(), updatedAt: Date.now(),
    name: data.name.trim(), age: Number(data.age), condition: data.condition, equationSex: data.equationSex || null, activityLevel: data.activityLevel || null,
    phone: (data.phone || "").trim(), email: (data.email || "").trim(),
    goal: data.goal.trim(), likes: data.likes.trim(), allergies: (data.allergies || "").trim(), avoids: data.avoids.trim(), budget: data.budget, schedule: data.schedule.trim(), context: data.context.trim(),
    measurements,
    consentedAt: form.elements.consent.checked ? (consentStillValid ? old.consentedAt : Date.now()) : null,
    consentVersion: form.elements.consent.checked ? CONSENT_VERSION : null
  };
  if (old && (old.allergies || "") !== person.allergies) {
    logHistory(person, person.allergies ? "Alergias o intolerancias actualizadas" : "Se quitaron las alergias o intolerancias declaradas");
    if (person.draft) toast("Cambiaste las alergias: revisá el plan guardado en la pestaña Planes.");
  }
  if (!old) logHistory(person, "Ficha creada");
  if (old) S.patients = S.patients.map(item => item.id === old.id ? person : item); else S.patients.push(person);
  queueSave(); refreshAll();
  toast("Ficha guardada en tu cuenta privada.");
  if (old) nav.openPatient(old.id); else setPage("patients");
}

// ---------- Respaldo ----------
async function importBackup(event) {
  const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (!file) return;
  if (file.size > 20_000_000) { toast("El archivo supera el tamaño permitido para importar."); return; }
  try {
    const backup = JSON.parse(await file.text());
    const records = Array.isArray(backup) ? backup : backup?.patients;
    if (!Array.isArray(records) || records.length > 10000 || records.some(item => !item || typeof item !== "object" || typeof item.name !== "string" || !Number.isFinite(Number(item.age)))) throw new Error("El archivo no tiene el formato de respaldo de Nutri Guía.");
    const known = new Set(S.patients.map(item => item.id));
    const additions = records.filter(item => { if (!item.id) return true; if (known.has(item.id)) return false; known.add(item.id); return true; }).map(({ submissions, ...item }) => ({ ...item, id: item.id || uid(), createdAt: item.createdAt || Date.now(), updatedAt: item.updatedAt || Date.now(), consultations: Array.isArray(item.consultations) ? item.consultations : [], measurements: Array.isArray(item.measurements) ? item.measurements : [], planVersions: Array.isArray(item.planVersions) ? item.planVersions : [] }));
    const allIds = new Set([...S.patients, ...additions].map(person => person.id));
    const knownAppointments = new Set(S.appointments.map(item => item.id));
    const incoming = Array.isArray(backup?.appointments) ? backup.appointments.filter(item => item && typeof item.id === "string" && typeof item.start === "string" && allIds.has(item.patientId) && !knownAppointments.has(item.id)) : [];
    const knownTemplates = new Set(S.templates.map(item => item.id));
    const templates = Array.isArray(backup?.templates) ? backup.templates.filter(item => item && typeof item.id === "string" && !knownTemplates.has(item.id)) : [];
    if (!additions.length && !incoming.length && !templates.length) { toast("El respaldo no contiene datos nuevos para agregar."); return; }
    if (!window.confirm(`Se agregarán ${additions.length} ficha(s), ${incoming.length} turno(s) y ${templates.length} plantilla(s). Los datos actuales no se reemplazarán. ¿Continuar?`)) return;
    S.patients.push(...additions); S.appointments.push(...incoming); S.templates.push(...templates);
    queueSave(); refreshAll();
    toast(`Se importaron ${additions.length} ficha(s), ${incoming.length} turno(s) y ${templates.length} plantilla(s).`);
  } catch (error) { toast(error instanceof SyntaxError ? "El archivo no es un JSON válido." : error.message || "No se pudo importar el archivo."); }
}

export function exportBackup() {
  download(`nutri-guia-respaldo-${todayISO()}.json`, backupJSON());
  toast("Respaldo descargado. Guardalo en un lugar privado.");
}

export function initPatients() {
  nav.openForm = openForm;
  $("add-patient").addEventListener("click", () => openForm());
  $("add-patient-list").addEventListener("click", () => openForm());
  $("mobile-add").addEventListener("click", () => openForm());
  $("view-patients").addEventListener("click", () => setPage("patients"));
  $("all-patients").addEventListener("click", () => setPage("patients"));
  $("cancel-form").addEventListener("click", () => { if (nav.state.editingId) nav.openPatient(nav.state.editingId); else setPage("home"); });
  $("wizard-next").addEventListener("click", () => {
    const invalid = document.querySelector(`[data-step-section="${wizardStep}"]`).querySelector(":invalid");
    if (invalid) { invalid.reportValidity(); return; }
    setWizardStep(wizardStep + 1);
  });
  $("wizard-back").addEventListener("click", () => setWizardStep(wizardStep - 1));
  $("patient-search").addEventListener("input", renderPatients);
  $("patient-status").addEventListener("change", renderPatients);
  $("export-data").addEventListener("click", exportBackup);
  $("import-data").addEventListener("click", () => $("import-file").click());
  $("import-file").addEventListener("change", importBackup);
  $("patient-form").addEventListener("submit", submitPatient);
}
