/**
 * Lógica de la ficha sin tocar la pantalla (historial, metas, plantillas,
 * datos cargados desde el portal, avisos de respaldo). Está separada para poder
 * probarla con `node --test` sin navegador.
 */
import { getLatestMeasurement } from "../nutrition.mjs";

export function uid() {
  return globalThis.crypto?.randomUUID?.() ?? `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const bmiOf = (weight, height) => weight && height ? Number((weight / ((height / 100) ** 2)).toFixed(1)) : null;

// ---------- Historial de cambios ----------
export function logHistory(patient, text, now = Date.now()) {
  if (!patient || !text) return;
  patient.history = Array.isArray(patient.history) ? patient.history : [];
  patient.history.push({ at: now, text: String(text).slice(0, 300) });
  if (patient.history.length > 300) patient.history = patient.history.slice(-300);
}

// ---------- Metas ----------
export const GOAL_STATUS_LABELS = { active: "En curso", achieved: "Lograda", dropped: "Dejada de lado" };

export function addGoal(patient, { text, targetDate = "", visibleToPatient = false }, now = Date.now()) {
  const clean = String(text ?? "").trim().slice(0, 300);
  if (!clean) return null;
  const goal = { id: uid(), text: clean, targetDate: ISO_DATE.test(targetDate) ? targetDate : "", status: "active", visibleToPatient: visibleToPatient === true, createdAt: now, updatedAt: now };
  patient.goals = Array.isArray(patient.goals) ? patient.goals : [];
  patient.goals.push(goal);
  logHistory(patient, `Meta agregada: ${clean}`, now);
  return goal;
}

export function setGoalStatus(patient, id, status, now = Date.now()) {
  const goal = (patient.goals || []).find(item => item.id === id);
  if (!goal || !GOAL_STATUS_LABELS[status] || goal.status === status) return false;
  goal.status = status; goal.updatedAt = now;
  logHistory(patient, `Meta «${goal.text}»: ${GOAL_STATUS_LABELS[status].toLowerCase()}`, now);
  return true;
}

export function toggleGoalVisibility(patient, id, now = Date.now()) {
  const goal = (patient.goals || []).find(item => item.id === id);
  if (!goal) return false;
  goal.visibleToPatient = !goal.visibleToPatient; goal.updatedAt = now;
  logHistory(patient, `Meta «${goal.text}»: ${goal.visibleToPatient ? "ahora la ve la persona en su portal" : "oculta para la persona"}`, now);
  return true;
}

export function removeGoal(patient, id, now = Date.now()) {
  const goal = (patient.goals || []).find(item => item.id === id);
  if (!goal) return false;
  patient.goals = patient.goals.filter(item => item.id !== id);
  logHistory(patient, `Meta eliminada: ${goal.text}`, now);
  return true;
}

export function sortedGoals(patient) {
  const order = { active: 0, achieved: 1, dropped: 2 };
  return [...(patient.goals || [])].sort((a, b) => (order[a.status] - order[b.status]) || String(a.targetDate || "9999").localeCompare(String(b.targetDate || "9999")) || a.createdAt - b.createdAt);
}

// ---------- Plantillas de menú ----------
const TEMPLATE_DRAFT_KEYS = ["intro", "days", "recommendations", "reviewNotes"];

export function makeTemplate(name, draft, now = Date.now()) {
  const clean = String(name ?? "").trim().slice(0, 80);
  if (!clean || !draft || !Array.isArray(draft.days)) return null;
  const copy = {};
  for (const key of TEMPLATE_DRAFT_KEYS) if (draft[key] !== undefined) copy[key] = JSON.parse(JSON.stringify(draft[key]));
  return { id: uid(), name: clean, createdAt: now, draft: copy };
}

export function draftFromTemplate(template, dayNames) {
  const draft = JSON.parse(JSON.stringify(template.draft));
  draft.days.forEach((day, index) => { if (dayNames?.[index]) day.day = dayNames[index]; });
  draft.reviewNotes = [...(draft.reviewNotes || []), "Este plan viene de una plantilla: validá que sea adecuado para esta persona, sus alergias y su medicación."];
  return draft;
}

// ---------- Datos cargados desde el portal ----------
export function pendingSubmissions(patient) {
  const handled = new Set(Array.isArray(patient?.handledSubmissions) ? patient.handledSubmissions : []);
  return (patient?.submissions || []).filter(item => item && !handled.has(item.id));
}

function markHandled(patient, id) {
  patient.handledSubmissions = Array.isArray(patient.handledSubmissions) ? patient.handledSubmissions : [];
  if (!patient.handledSubmissions.includes(id)) patient.handledSubmissions.push(id);
  if (patient.handledSubmissions.length > 2000) patient.handledSubmissions = patient.handledSubmissions.slice(-2000);
}

/** Pasa un peso enviado por la persona a las mediciones de la ficha. */
export function acceptWeightSubmission(patient, submission, now = Date.now()) {
  const weight = Number(submission?.data?.weight);
  const date = submission?.data?.date;
  if (submission?.type !== "weight" || !Number.isFinite(weight) || weight <= 0 || !ISO_DATE.test(String(date))) return null;
  const height = getLatestMeasurement(patient)?.height ?? null;
  const measurement = { id: uid(), date, weight, height: null, waist: null, hip: null, bmi: bmiOf(weight, height), createdAt: now, source: "patient" };
  patient.measurements = Array.isArray(patient.measurements) ? patient.measurements : [];
  patient.measurements.push(measurement);
  markHandled(patient, submission.id);
  logHistory(patient, `Peso enviado por la persona (${weight} kg, ${date}) agregado a las mediciones`, now);
  return measurement;
}

export function dismissSubmission(patient, submission, now = Date.now()) {
  if (!submission?.id) return false;
  markHandled(patient, submission.id);
  logHistory(patient, submission.type === "weight" ? "Peso enviado por la persona descartado" : "Nota previa a la consulta marcada como leída", now);
  return true;
}

// ---------- Mediciones para los gráficos ----------
export function measurementSeries(patient) {
  const sorted = [...(patient?.measurements || [])].sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")) || (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0));
  const build = key => {
    const byDate = new Map();
    for (const item of sorted) if (Number.isFinite(Number(item[key])) && Number(item[key]) > 0 && ISO_DATE.test(String(item.date))) byDate.set(item.date, Number(item[key]));
    return [...byDate].map(([date, value]) => ({ date, value }));
  };
  return { weight: build("weight"), waist: build("waist"), hip: build("hip") };
}

export function weightChange(patient) {
  const { weight } = measurementSeries(patient);
  if (weight.length < 2) return null;
  const first = weight[0], last = weight[weight.length - 1];
  return { from: first.value, to: last.value, delta: Math.round((last.value - first.value) * 10) / 10, since: first.date };
}

// ---------- Aviso sobre respaldos ----------
export function backupAdvice(status, now = Date.now()) {
  if (!status || !status.configured) return { level: "warn", text: "Los respaldos automáticos no están activados en el servidor. Mientras tanto, descargá un respaldo manual desde Mis pacientes." };
  if (!status.lastAt) return { level: "warn", text: "Todavía no se hizo ningún respaldo automático. Se genera uno al iniciar el servidor y luego cada 24 horas." };
  const hours = (now - Number(status.lastAt)) / 3_600_000;
  if (hours > 48) return { level: "warn", text: "El último respaldo automático tiene más de dos días. Revisá que el servidor esté funcionando y que el disco de respaldos exista." };
  return { level: "ok", text: `Último respaldo automático: ${new Date(Number(status.lastAt)).toLocaleString("es-AR", { dateStyle: "medium", timeStyle: "short" })}. Respaldos guardados: ${status.count}.` };
}

// ---------- Restricciones ----------
/** True si la ficha declara alguna alergia o intolerancia. */
export function hasDeclaredAllergies(patient) {
  return Boolean(String(patient?.allergies ?? "").trim());
}

// ---------- Avisos pendientes (Inicio) ----------
const CLOSED_APPOINTMENT = ["cancelled", "completed", "noShow"];
const isOpenAppointment = item => !CLOSED_APPOINTMENT.includes(item?.status);

/** Turnos abiertos que empiezan dentro de las próximas `hours` horas y todavía no tienen aviso enviado. */
export function appointmentsNeedingReminder(appointments, now = Date.now(), hours = 48) {
  const limit = now + hours * 3_600_000;
  return (Array.isArray(appointments) ? appointments : [])
    .filter(item => isOpenAppointment(item) && !item.reminderSentAt && Number.isFinite(Date.parse(item.start)) && Date.parse(item.start) >= now && Date.parse(item.start) <= limit)
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

/**
 * Personas con el control vencido: la fecha de «próximo control» más lejana que anotó ya pasó
 * y no tienen ningún turno futuro. `today` es la fecha de hoy (AAAA-MM-DD).
 */
export function overdueControls(patients, appointments, today, now = Date.now()) {
  const list = Array.isArray(appointments) ? appointments : [];
  return (Array.isArray(patients) ? patients : []).filter(person => !person.archivedAt).flatMap(person => {
    const dates = (person.consultations || []).map(item => item?.nextControl).filter(date => typeof date === "string" && ISO_DATE.test(date)).sort();
    const due = dates.at(-1);
    if (!due || due >= today) return [];
    const hasFutureAppointment = list.some(item => item.patientId === person.id && isOpenAppointment(item) && Date.parse(item.start) >= now);
    return hasFutureAppointment ? [] : [{ person, due, reminderSentAt: person.controlReminder?.due === due ? person.controlReminder.at || null : null }];
  }).sort((a, b) => a.due.localeCompare(b.due));
}

// ---------- Informe de evolución para la persona (se imprime / guarda como PDF) ----------
const MAX_REPORT_ROWS = 40;

/**
 * Qué lleva el informe. Es lo que la persona puede ver: mediciones, metas marcadas como visibles y las
 * recomendaciones del plan aprobado. Nunca notas de consultas, historial, resúmenes de IA ni alergias.
 */
export function buildProgressReport(patient, { name = "", professionalName = "", today = "" } = {}) {
  const series = measurementSeries(patient);
  const byDate = new Map();
  for (const item of [...(patient?.measurements || [])].sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")) || (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0))) {
    if (!ISO_DATE.test(String(item.date))) continue;
    const row = byDate.get(item.date) || { date: item.date, weight: null, height: null, waist: null, hip: null };
    for (const key of ["weight", "height", "waist", "hip"]) { const value = Number(item[key]); if (Number.isFinite(value) && value > 0) row[key] = value; }
    byDate.set(item.date, row);
  }
  const rows = [...byDate.values()].filter(row => row.weight || row.height || row.waist || row.hip).slice(-MAX_REPORT_ROWS);
  const visibleGoals = (patient?.goals || []).filter(goal => goal?.visibleToPatient === true && typeof goal.text === "string" && goal.text.trim());
  const recommendations = patient?.approvedAt && Array.isArray(patient?.draft?.recommendations)
    ? patient.draft.recommendations.filter(item => typeof item === "string" && item.trim()).slice(0, 10) : [];
  return {
    name: String(name || patient?.name || "").trim(), professionalName: String(professionalName || "").trim(), generatedOn: today,
    series, rows, change: weightChange(patient),
    goals: { active: visibleGoals.filter(goal => goal.status === "active" || !goal.status), achieved: visibleGoals.filter(goal => goal.status === "achieved") },
    recommendations,
    hasContent: rows.length > 0 || visibleGoals.length > 0 || recommendations.length > 0
  };
}
