/**
 * Validación y limpieza de lo que llega al servidor. Se separó de server.mjs
 * para poder probarla sin base de datos.
 */

export function fail(message, status = 400) { return Object.assign(new Error(message), { status }); }

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export function isIsoDate(value) {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
  const time = Date.parse(`${value}T12:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

import { COOKING_TIMES, KITCHEN_TOOLS, cleanAiSettings } from "./menu-rules.mjs";

const text = (value, max) => typeof value === "string" ? value.slice(0, max) : "";
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

function cleanGoals(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 100).filter(goal => goal && typeof goal === "object" && typeof goal.id === "string" && goal.id && typeof goal.text === "string").map(goal => ({
    id: goal.id.slice(0, 120),
    text: text(goal.text, 300),
    targetDate: isIsoDate(goal.targetDate) ? goal.targetDate : "",
    status: ["active", "achieved", "dropped"].includes(goal.status) ? goal.status : "active",
    visibleToPatient: goal.visibleToPatient === true,
    createdAt: finite(goal.createdAt, Date.now()),
    updatedAt: finite(goal.updatedAt, Date.now())
  }));
}

function cleanHistory(list) {
  if (!Array.isArray(list)) return [];
  return list.filter(item => item && typeof item === "object" && typeof item.text === "string").slice(-300).map(item => ({ at: finite(item.at, Date.now()), text: text(item.text, 300) }));
}

function cleanShoppingList(list) {
  if (!list || typeof list !== "object" || !Array.isArray(list.categories)) return null;
  return {
    createdAt: finite(list.createdAt, Date.now()),
    reviewNote: text(list.reviewNote, 600),
    categories: list.categories.slice(0, 30).filter(category => category && typeof category.name === "string").map(category => ({
      name: text(category.name, 80),
      items: (Array.isArray(category.items) ? category.items : []).slice(0, 80).filter(item => item && typeof item.item === "string").map(item => ({ item: text(item.item, 120), quantity: text(item.quantity, 80) }))
    }))
  };
}

function cleanDraftShape(draft) {
  if (!draft || typeof draft !== "object" || !Array.isArray(draft.days)) return null;
  return draft;
}

function cleanTemplates(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 200).filter(item => item && typeof item === "object" && typeof item.id === "string" && item.id && typeof item.name === "string" && cleanDraftShape(item.draft)).map(item => ({
    id: item.id.slice(0, 120),
    name: text(item.name, 80),
    createdAt: finite(item.createdAt, Date.now()),
    draft: item.draft
  }));
}

/**
 * Valida el documento completo de una cuenta profesional. Lo que es obligatorio
 * rechaza el guardado; los campos opcionales nuevos se limpian en silencio para
 * que un dato raro nunca impida guardar todo lo demás.
 */
export function validatedDocument(body) {
  if (!body || !Array.isArray(body.patients) || !Array.isArray(body.appointments) || body.patients.length > 10000 || body.appointments.length > 50000) throw fail("El respaldo no tiene un formato válido.");
  const patientIds = new Set();
  const patients = [];
  for (const raw of body.patients) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw) || typeof raw.id !== "string" || !raw.id || raw.id.length > 120 || typeof raw.name !== "string" || raw.name.length > 80 || !Number.isFinite(Number(raw.age))) throw fail("Una ficha no tiene los campos básicos esperados.");
    if (patientIds.has(raw.id)) throw fail("Hay fichas repetidas en el envío.");
    patientIds.add(raw.id);
    const patient = { ...raw };
    delete patient.submissions; // lo cargado desde el portal vive en su propia tabla
    if ("phone" in patient) patient.phone = text(patient.phone, 40);
    if ("email" in patient) patient.email = text(patient.email, 120);
    if ("allergies" in patient) patient.allergies = text(patient.allergies, 1000);
    if ("cookingTime" in patient) patient.cookingTime = Object.hasOwn(COOKING_TIMES, patient.cookingTime) ? patient.cookingTime : "";
    if ("kitchen" in patient) patient.kitchen = Array.isArray(patient.kitchen) ? [...new Set(patient.kitchen.filter(key => typeof key === "string" && Object.hasOwn(KITCHEN_TOOLS, key)))] : [];
    if ("goals" in patient) patient.goals = cleanGoals(patient.goals);
    if ("history" in patient) patient.history = cleanHistory(patient.history);
    if ("shoppingList" in patient) patient.shoppingList = cleanShoppingList(patient.shoppingList);
    if ("handledSubmissions" in patient) patient.handledSubmissions = Array.isArray(patient.handledSubmissions) ? patient.handledSubmissions.filter(id => typeof id === "string").slice(-2000).map(id => id.slice(0, 80)) : [];
    patients.push(patient);
  }
  const appointmentIds = new Set();
  for (const item of body.appointments) {
    if (!item || typeof item !== "object" || Array.isArray(item) || typeof item.id !== "string" || !item.id || item.id.length > 120 || typeof item.patientId !== "string" || !patientIds.has(item.patientId) || typeof item.start !== "string" || !Number.isFinite(Date.parse(item.start)) || !Number.isFinite(Number(item.duration)) || Number(item.duration) < 10 || Number(item.duration) > 240) throw fail("Un turno no está vinculado a una ficha válida o tiene datos incorrectos.");
    if (appointmentIds.has(item.id)) throw fail("Hay turnos repetidos en el envío.");
    appointmentIds.add(item.id);
  }
  const document = { patients, appointments: body.appointments, templates: cleanTemplates(body.templates) };
  // Una versión vieja de la app no manda los ajustes: en ese caso el servidor conserva los guardados.
  if (body.aiSettings !== undefined) document.aiSettings = cleanAiSettings(body.aiSettings);
  return document;
}

/** Peso cargado por la persona desde el portal. */
export function validatePortalWeight(body) {
  const weight = Number(body?.weight);
  if (!Number.isFinite(weight) || weight < 20 || weight > 500) throw fail("Ingresá un peso válido en kilos (entre 20 y 500).");
  if (!isIsoDate(body?.date)) throw fail("La fecha no es válida.");
  const limit = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  if (body.date > limit || body.date < "2000-01-01") throw fail("La fecha no puede ser futura.");
  return { date: body.date, weight: Math.round(weight * 10) / 10 };
}

/** Nota previa a la consulta cargada desde el portal. */
export function validatePortalNote(body) {
  const note = typeof body?.note === "string" ? body.note.trim() : "";
  if (!note) throw fail("Escribí una nota antes de enviarla.");
  if (note.length > 1500) throw fail("La nota es demasiado larga (máximo 1500 caracteres).");
  const date = isIsoDate(body?.date) ? body.date : new Date().toISOString().slice(0, 10);
  return { date, note };
}
