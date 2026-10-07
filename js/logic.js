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
