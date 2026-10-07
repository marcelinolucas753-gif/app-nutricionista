import { $, CLOSED_STATUSES, appointmentStatusName, escapeHTML, openExternal, patientName, toast, todayISO } from "./util.js";
import { uid } from "./logic.js";
import { S, activePatients, findPatient, queueSave } from "./state.js";
import { nav, setPage } from "./nav.js";
import { buildReminderMessage, whatsappLink } from "../contact.mjs";

const when = value => new Date(value);
const isOpen = item => !CLOSED_STATUSES.includes(item.status);

/** Abre WhatsApp con el recordatorio escrito y marca que se envió. */
export function sendReminder(appointmentId) {
  const item = S.appointments.find(row => row.id === appointmentId);
  const person = item && findPatient(item.patientId);
  if (!item || !person) return;
  const link = whatsappLink(person.phone, buildReminderMessage({ patientName: person.name, start: item.start, professionalName: S.professional?.name }));
  if (!link) { toast("Esta ficha no tiene un celular válido. Cargalo en «Editar ficha» para poder avisar por WhatsApp."); return; }
  if (!openExternal(link)) { toast("El navegador bloqueó la ventana de WhatsApp. Permití ventanas emergentes e intentá de nuevo."); return; }
  item.reminderSentAt = Date.now();
  queueSave();
  renderAgenda(); renderHomeAppointments();
  toast("Se abrió WhatsApp con el mensaje armado. Falta que toques «Enviar» allá.");
}

function reminderButton(item, person) {
  if (!person || !isOpen(item) || when(item.start).getTime() < Date.now()) return "";
  const sent = item.reminderSentAt ? `Aviso enviado el ${new Date(item.reminderSentAt).toLocaleDateString("es-AR", { day: "numeric", month: "short" })}` : "";
  return `<button class="button button-quiet" data-remind="${escapeHTML(item.id)}">${item.reminderSentAt ? "Reenviar aviso" : "Avisar por WhatsApp"}</button>${sent ? `<small class="reminder-sent">${escapeHTML(sent)}</small>` : ""}`;
}

export function renderHomeAppointments() {
  const target = $("home-appointments"); if (!target) return;
  const rows = S.appointments.filter(item => isOpen(item) && when(item.start).getTime() >= Date.now()).sort((a, b) => a.start.localeCompare(b.start)).slice(0, 5);
  target.innerHTML = rows.length ? rows.map(item => {
    const person = findPatient(item.patientId);
    return `<article class="appointment-row"><div class="appointment-time"><strong>${when(item.start).toLocaleDateString("es-AR", { weekday: "short", day: "numeric", month: "short" })}</strong><span>${when(item.start).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}</span></div><div class="appointment-info"><strong>${escapeHTML(person ? patientName(person) : "Paciente eliminado")}</strong><small>${escapeHTML(item.reason || "Control")} · ${escapeHTML(appointmentStatusName(item.status))}</small></div><div class="appointment-actions">${reminderButton(item, person)}${person ? `<button class="button button-quiet" data-appointment-patient="${escapeHTML(person.id)}">Abrir ficha</button>` : ""}</div></article>`;
  }).join("") : `<div class="recent-empty">No hay turnos próximos. Podés agendar uno desde Agenda.</div>`;
  bindRowButtons(target);
}

function bindRowButtons(target) {
  target.querySelectorAll("[data-appointment-patient]").forEach(button => button.addEventListener("click", () => nav.openPatient(button.dataset.appointmentPatient)));
  target.querySelectorAll("[data-remind]").forEach(button => button.addEventListener("click", () => sendReminder(button.dataset.remind)));
}

function range() {
  const selected = new Date(`${$("agenda-date").value || todayISO()}T12:00:00`);
  const mode = $("agenda-view").value;
  if (mode === "day") { const start = new Date(selected); start.setHours(0, 0, 0, 0); const end = new Date(start); end.setDate(end.getDate() + 1); return [start, end]; }
  if (mode === "month") return [new Date(selected.getFullYear(), selected.getMonth(), 1), new Date(selected.getFullYear(), selected.getMonth() + 1, 1)];
  const start = new Date(selected); start.setDate(start.getDate() - ((start.getDay() + 6) % 7)); start.setHours(0, 0, 0, 0);
  const end = new Date(start); end.setDate(end.getDate() + 7);
  return [start, end];
}

export function renderAgenda() {
  const target = $("appointment-list"); if (!target) return;
  const [start, end] = range();
  const rows = S.appointments.filter(item => when(item.start) >= start && when(item.start) < end).sort((a, b) => a.start.localeCompare(b.start));
  target.innerHTML = rows.length ? rows.map(item => {
    const person = findPatient(item.patientId);
    return `<article class="appointment-row"><div class="appointment-time"><strong>${when(item.start).toLocaleDateString("es-AR", { weekday: "short", day: "numeric", month: "short" })}</strong><span>${when(item.start).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })} · ${Number(item.duration) || 30} min</span></div><div class="appointment-info"><strong>${escapeHTML(person ? patientName(person) : "Paciente eliminado")}</strong><small>${escapeHTML(item.reason || "Control")} · ${escapeHTML(appointmentStatusName(item.status))}${item.notes ? ` · ${escapeHTML(item.notes)}` : ""}</small></div><div class="appointment-actions">${reminderButton(item, person)}${person ? `<button class="button button-quiet" data-appointment-patient="${escapeHTML(person.id)}">Ficha</button>` : ""}<button class="button button-quiet" data-edit-appointment="${escapeHTML(item.id)}">Editar</button>${isOpen(item) ? `<button class="button button-quiet" data-cancel-appointment="${escapeHTML(item.id)}">Cancelar</button>` : ""}<button class="button button-quiet text-danger" data-delete-appointment="${escapeHTML(item.id)}">Eliminar</button></div></article>`;
  }).join("") : `<div class="empty-state">No hay turnos para este período. Elegí otra fecha o agendá un turno.</div>`;
  bindRowButtons(target);
  target.querySelectorAll("[data-edit-appointment]").forEach(button => button.addEventListener("click", () => openAppointmentForm(button.dataset.editAppointment)));
  target.querySelectorAll("[data-cancel-appointment]").forEach(button => button.addEventListener("click", () => {
    const item = S.appointments.find(row => row.id === button.dataset.cancelAppointment);
    if (item && window.confirm("¿Cancelar este turno?")) { item.status = "cancelled"; changed(); toast("Turno cancelado."); }
  }));
  target.querySelectorAll("[data-delete-appointment]").forEach(button => button.addEventListener("click", () => {
    if (!window.confirm("¿Eliminar este turno de forma permanente?")) return;
    S.appointments = S.appointments.filter(item => item.id !== button.dataset.deleteAppointment);
    changed(); toast("Turno eliminado.");
  }));
}

export function changed() { renderAgenda(); renderHomeAppointments(); queueSave(); }

export function openAppointmentForm(id = null, patientId = "") {
  const old = S.appointments.find(item => item.id === id);
  const start = old?.start || `${$("agenda-date").value || todayISO()}T09:00`;
  const wrap = $("appointment-form-wrap");
  wrap.classList.remove("hidden");
  const statuses = [["reserved", "Reservado"], ["confirmed", "Confirmado"], ["completed", "Realizado"], ["cancelled", "Cancelado"], ["noShow", "No asistió"]];
  wrap.innerHTML = `<form id="appointment-form" class="record-form form-card"><h3>${old ? "Editar o reprogramar turno" : "Nuevo turno"}</h3><input type="hidden" name="id" value="${escapeHTML(old?.id || "")}"/><div class="form-row"><label>Paciente<select name="patientId" required><option value="">Elegir paciente</option>${activePatients().map(person => `<option value="${escapeHTML(person.id)}" ${(old?.patientId || patientId) === person.id ? "selected" : ""}>${escapeHTML(patientName(person))}</option>`).join("")}</select></label><label>Fecha y hora<input name="start" type="datetime-local" required value="${escapeHTML(start.slice(0, 16))}"/></label></div><div class="form-row"><label>Duración (minutos)<input name="duration" type="number" min="10" max="240" step="5" value="${Number(old?.duration) || 30}" required/></label><label>Motivo<input name="reason" maxlength="160" value="${escapeHTML(old?.reason || "Control")}"/></label></div><label>Estado<select name="status">${statuses.map(([value, label]) => `<option value="${value}" ${(old?.status || "reserved") === value ? "selected" : ""}>${label}</option>`).join("")}</select></label><label>Notas<textarea name="notes" rows="2" maxlength="1000">${escapeHTML(old?.notes || "")}</textarea></label><div class="form-actions"><button type="button" class="button button-quiet" id="close-appointment-form">Cerrar</button><button class="button button-primary" type="submit">Guardar turno</button></div></form>`;
  $("close-appointment-form").addEventListener("click", () => wrap.classList.add("hidden"));
  const form = $("appointment-form");
  form.addEventListener("submit", event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    if (data.status === "cancelled" && old?.status !== "cancelled" && !window.confirm("¿Cancelar este turno?")) return;
    const startMs = when(data.start).getTime(), endMs = startMs + Number(data.duration) * 60000;
    const clash = S.appointments.find(item => item.id !== data.id && isOpen(item) && startMs < when(item.start).getTime() + Number(item.duration || 30) * 60000 && endMs > when(item.start).getTime());
    if (clash) { toast("Ese horario se superpone con otro turno. Elegí otro horario."); return; }
    const moved = old && old.start !== data.start;
    const saved = { ...(old || {}), ...data, id: data.id || uid(), duration: Number(data.duration), updatedAt: Date.now(), createdAt: old?.createdAt || Date.now() };
    if (moved) delete saved.reminderSentAt; // si cambió el horario, hay que avisar de nuevo
    if (old) S.appointments = S.appointments.map(item => item.id === old.id ? saved : item); else S.appointments.push(saved);
    wrap.classList.add("hidden");
    changed();
    toast("Turno guardado.");
  });
}

function shiftAgenda(direction) {
  const date = new Date(`${$("agenda-date").value || todayISO()}T12:00:00`);
  const view = $("agenda-view").value;
  if (view === "month") { date.setDate(1); date.setMonth(date.getMonth() + direction); } else date.setDate(date.getDate() + direction * (view === "day" ? 1 : 7));
  $("agenda-date").value = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  renderAgenda();
}

export function initAgenda() {
  nav.openAppointmentForm = openAppointmentForm;
  $("agenda-date").value = todayISO();
  $("add-appointment").addEventListener("click", () => openAppointmentForm());
  $("agenda-view").addEventListener("change", renderAgenda);
  $("agenda-date").addEventListener("change", renderAgenda);
  $("agenda-today").addEventListener("click", () => { $("agenda-date").value = todayISO(); renderAgenda(); });
  $("agenda-prev").addEventListener("click", () => shiftAgenda(-1));
  $("agenda-next").addEventListener("click", () => shiftAgenda(1));
}

/** Abre la agenda con el formulario de turno para una persona. */
export function scheduleFor(patientId) {
  $("agenda-date").value = todayISO();
  setPage("agenda");
  renderAgenda();
  openAppointmentForm(null, patientId);
}
