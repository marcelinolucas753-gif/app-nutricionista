export { DAY_NAMES as DAYS, MEAL_SLOTS as MEALS } from "../safety.mjs";

export const $ = id => document.getElementById(id);

export function escapeHTML(value = "") {
  return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

export function todayISO() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function addDaysISO(iso, days) {
  const date = new Date(`${iso}T12:00:00`);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function formatDate(value) {
  if (!value) return "Sin fecha";
  return new Date(`${String(value).slice(0, 10)}T12:00:00`).toLocaleDateString("es-AR", { day: "numeric", month: "short", year: "numeric" });
}
export function formatDateTime(value) { return new Date(value).toLocaleString("es-AR", { dateStyle: "medium", timeStyle: "short" }); }
export function formatTime(value) { return new Date(value).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }); }

export function initials(name = "Paciente") { return name.trim().split(/\s+/).slice(0, 2).map(word => word[0]).join("").toUpperCase() || "P"; }
export function patientName(person) { return person?.name?.trim() || "Paciente sin nombre"; }
export function conditionName(key) { return ({ general: "Objetivo general", diabetes2: "Diabetes tipo 2", hipertension: "Hipertensión", ambas: "Diabetes tipo 2 · Hipertensión" })[key] || "Ficha"; }
export function appointmentStatusName(status) { return ({ reserved: "Reservado", confirmed: "Confirmado", completed: "Realizado", cancelled: "Cancelado", noShow: "No asistió" })[status] || "Reservado"; }
export const CLOSED_STATUSES = ["cancelled", "completed", "noShow"];

let toastTimer;
export function toast(message) {
  const el = $("toast");
  if (!el) return;
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 4200);
}

export function download(filename, text, type = "application/json") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url; link.download = filename; link.click();
  URL.revokeObjectURL(url);
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* sin permiso del portapapeles */ }
  const area = document.createElement("textarea");
  area.value = text; area.setAttribute("readonly", ""); area.style.position = "fixed"; area.style.opacity = "0";
  document.body.append(area); area.select();
  let ok = false; try { ok = document.execCommand("copy"); } catch { /* no disponible */ }
  area.remove();
  return ok;
}

/** Abre WhatsApp con el mensaje armado. Devuelve false si el navegador bloqueó la ventana. */
export function openExternal(url) {
  // Con "noopener" el navegador siempre devuelve null, así que no se puede saber si se bloqueó.
  const opened = window.open(url, "_blank");
  if (!opened) return false;
  try { opened.opener = null; } catch { /* sin acceso: no importa */ }
  return true;
}

export async function api(path, { method = "GET", body } = {}) {
  const response = await fetch(path, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined, cache: "no-store" });
  let payload = {};
  try { payload = await response.json(); } catch { /* respuesta sin cuerpo */ }
  if (!response.ok) throw Object.assign(new Error(payload.error || "No se pudo completar la solicitud."), { status: response.status });
  return payload;
}
