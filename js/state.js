import { $, api, download, toast, todayISO } from "./util.js";

const LEGACY_PATIENTS_KEY = "nutri-guia-pacientes-v1";
const LEGACY_APPOINTMENTS_KEY = "nutri-guia-turnos-v1";
const LEGACY_DONE_KEY = "nutri-guia-cloud-import-confirmed-v1";

/** Estado compartido de la app. Las pantallas lo leen y llaman a `queueSave()` después de cambiarlo. */
export const S = {
  patients: [], appointments: [], templates: [], aiSettings: { foodsCommon: null, foodsAvoid: null, extraRules: "" },
  version: 0, authenticated: false, professional: null, backup: null,
  dirty: false, saving: false, dismissedRemote: 0, saveTimer: null, retryTimer: null
};

/** Funciones que otras pantallas completan al arrancar, para no depender unas de otras. */
export const hooks = { rerender: () => {}, reauth: async () => {} };

function legacyList(key) {
  try { const value = JSON.parse(localStorage.getItem(key) || "[]"); return Array.isArray(value) ? value : []; } catch { return []; }
}

function payload() {
  return { patients: S.patients.map(({ submissions, ...rest }) => rest), appointments: S.appointments, templates: S.templates, aiSettings: S.aiSettings, version: S.version };
}

export function backupJSON() {
  return JSON.stringify({ format: "nutri-guia-backup", version: 3, exportedAt: new Date().toISOString(), patients: S.patients.map(({ submissions, ...rest }) => rest), appointments: S.appointments, templates: S.templates }, null, 2);
}

export function queueSave() {
  if (!S.authenticated) return;
  S.dirty = true;
  clearTimeout(S.saveTimer);
  S.saveTimer = setTimeout(() => { flushSave(); }, 250);
}

let chain = Promise.resolve(true);
/** Guarda ahora y espera. Devuelve true si no quedó nada sin guardar. */
export function flushSave() {
  clearTimeout(S.saveTimer);
  chain = chain.then(saveLoop, saveLoop);
  return chain;
}

async function saveLoop() {
  if (!S.authenticated) return !S.dirty;
  S.saving = true;
  try {
    while (S.dirty && S.authenticated) {
      S.dirty = false;
      let response, body = {};
      response = await fetch("/api/data", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload()) });
      try { body = await response.json(); } catch { /* sin cuerpo */ }
      if (response.status === 409) { await handleConflict(); return false; }
      if (!response.ok) throw new Error(body.error || "No se pudieron guardar los cambios.");
      S.version = body.version;
    }
  } catch (error) {
    S.dirty = true;
    toast(error.message || "No se pudieron guardar los cambios en la cuenta.");
    clearTimeout(S.retryTimer);
    S.retryTimer = setTimeout(() => { if (S.dirty && S.authenticated) flushSave(); }, 5000);
  } finally { S.saving = false; }
  return !S.dirty;
}

/**
 * Otro dispositivo guardó antes. Lo que hay en pantalla no se pudo guardar, así
 * que se descarga una copia antes de cargar la versión más reciente.
 */
async function handleConflict() {
  try { download(`nutri-guia-cambios-sin-sincronizar-${todayISO()}.json`, backupJSON()); } catch { /* si no se puede descargar, igual se avisa */ }
  S.dirty = false;
  await hooks.reauth();
  toast("Los datos cambiaron desde otro dispositivo. Se descargó una copia de tus últimos cambios y se cargó la versión más reciente.");
}

export async function loadCloudData() {
  const body = await api("/api/data");
  S.patients = Array.isArray(body.patients) ? body.patients : [];
  S.appointments = Array.isArray(body.appointments) ? body.appointments : [];
  S.templates = Array.isArray(body.templates) ? body.templates : [];
  S.aiSettings = { foodsCommon: body.aiSettings?.foodsCommon || null, foodsAvoid: body.aiSettings?.foodsAvoid || null, extraRules: body.aiSettings?.extraRules || "" };
  S.version = Number(body.version) || 0;
  await offerLegacyImport();
  hooks.rerender();
}

async function offerLegacyImport() {
  const patients = legacyList(LEGACY_PATIENTS_KEY), appointments = legacyList(LEGACY_APPOINTMENTS_KEY);
  if (localStorage.getItem(LEGACY_DONE_KEY) === "yes" || !(patients.length || appointments.length)) return;
  if (!window.confirm(`Este navegador tiene ${patients.length} ficha(s) y ${appointments.length} turno(s) guardados localmente. ¿Querés agregarlos a la cuenta profesional en la que iniciaste sesión? Se conservarán los datos actuales de la cuenta.`)) return;
  const known = new Set(S.patients.map(person => person.id));
  const newPatients = patients.filter(person => person && typeof person.id === "string" && !known.has(person.id));
  const allIds = new Set([...S.patients, ...newPatients].map(person => person.id));
  const knownAppointments = new Set(S.appointments.map(item => item.id));
  const newAppointments = appointments.filter(item => item && !knownAppointments.has(item.id) && allIds.has(item.patientId));
  S.patients.push(...newPatients); S.appointments.push(...newAppointments);
  if (!newPatients.length && !newAppointments.length) { localStorage.setItem(LEGACY_DONE_KEY, "yes"); return; }
  S.dirty = true;
  if (await flushSave()) { localStorage.setItem(LEGACY_DONE_KEY, "yes"); toast(`Se agregaron ${newPatients.length} ficha(s) y ${newAppointments.length} turno(s) a tu cuenta.`); }
}

export async function checkForRemoteChanges() {
  if (!S.authenticated || S.dirty || S.saving) return;
  try {
    const remote = Number((await api("/api/data/version")).version) || 0;
    if (remote > S.version && remote !== S.dismissedRemote) {
      if (window.confirm("Hay cambios guardados desde otro dispositivo. ¿Querés cargar la versión más reciente ahora?")) { await loadCloudData(); S.dismissedRemote = 0; }
      else S.dismissedRemote = remote;
    }
  } catch { /* se vuelve a comprobar cuando haya conexión */ }
}

export const activePatients = () => S.patients.filter(person => !person.archivedAt);
export const findPatient = id => S.patients.find(person => person.id === id);

/** Los pedidos de IA y de acceso leen la ficha desde el servidor: primero hay que guardarla. */
export async function ensureSaved() {
  if (!S.dirty && !S.saving) return true;
  const ok = await flushSave();
  if (!ok) toast("No se pudo guardar la ficha todavía. Revisá la conexión y volvé a intentar.");
  return ok;
}
