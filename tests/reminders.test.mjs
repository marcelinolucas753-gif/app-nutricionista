import test from "node:test";
import assert from "node:assert/strict";
import { appointmentsNeedingReminder, overdueControls } from "../js/logic.js";
import { buildControlReminderMessage } from "../contact.mjs";
import { validatedDocument } from "../validation.mjs";

const NOW = Date.parse("2026-10-12T10:00:00");
const pad = n => String(n).padStart(2, "0");
// Fecha y hora LOCAL (como las guarda la agenda), así la prueba no depende de la zona horaria del equipo.
const hours = h => { const d = new Date(NOW + h * 3_600_000); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`; };
const person = (id, nextControls, extra = {}) => ({ id, name: `Persona ${id}`, age: 30, consultations: nextControls.map(nextControl => ({ nextControl })), ...extra });

test("turnos para avisar: próximas 48 h, abiertos y sin aviso enviado", () => {
  const list = [
    { id: "a", patientId: "p", start: hours(5) },
    { id: "b", patientId: "p", start: hours(47) },
    { id: "c", patientId: "p", start: hours(49) },                       // todavía falta mucho
    { id: "d", patientId: "p", start: hours(-3) },                       // ya pasó
    { id: "e", patientId: "p", start: hours(6), reminderSentAt: 1 },     // ya avisado
    { id: "f", patientId: "p", start: hours(7), status: "cancelled" },
    { id: "g", patientId: "p", start: "no es una fecha" }
  ];
  assert.deepEqual(appointmentsNeedingReminder(list, NOW).map(item => item.id), ["a", "b"]);
  assert.deepEqual(appointmentsNeedingReminder(list, NOW, 100).map(item => item.id), ["a", "b", "c"]);
  assert.deepEqual(appointmentsNeedingReminder(null, NOW), []);
});

test("controles vencidos: usa el último «próximo control», ignora archivadas y quienes ya tienen turno", () => {
  const patients = [
    person("viejo", ["2026-08-01"]),
    person("reciente", ["2026-10-01"]),
    person("renovado", ["2026-08-01", "2026-12-01"]),                    // anotó un control futuro
    person("hoy", ["2026-10-12"]),                                       // vence hoy: todavía no está vencido
    person("sinfecha", []),
    person("archivada", ["2026-01-01"], { archivedAt: 1 }),
    person("conturno", ["2026-09-01"]),
    person("turnocancelado", ["2026-09-02"]),
    person("avisada", ["2026-09-20"], { controlReminder: { due: "2026-09-20", at: 12345 } }),
    person("avisoviejo", ["2026-09-25"], { controlReminder: { due: "2026-08-01", at: 999 } }) // el aviso era de otro control
  ];
  const appointments = [
    { id: "t1", patientId: "conturno", start: hours(30) },
    { id: "t2", patientId: "turnocancelado", start: hours(30), status: "cancelled" },
    { id: "t3", patientId: "viejo", start: hours(-30) }                  // turno pasado: no cuenta
  ];
  const result = overdueControls(patients, appointments, "2026-10-12", NOW);
  assert.deepEqual(result.map(row => row.person.id), ["viejo", "turnocancelado", "avisada", "avisoviejo", "reciente"]);
  assert.equal(result.find(row => row.person.id === "avisada").reminderSentAt, 12345);
  assert.equal(result.find(row => row.person.id === "avisoviejo").reminderSentAt, null);
  assert.deepEqual(overdueControls(undefined, undefined, "2026-10-12"), []);
});

test("mensaje de recordatorio de control", () => {
  assert.equal(buildControlReminderMessage({ patientName: "Ana Pérez", professionalName: "Lic. Gómez" }), "Hola Ana, ya te toca tu próximo control.\n¿Querés que coordinemos un turno? Decime qué días y horarios te quedan bien.\n— Lic. Gómez");
  assert.match(buildControlReminderMessage({ patientName: "Paciente" }), /^Hola, ya te toca/);
});

test("el aviso de control sobrevive al guardado de la cuenta", () => {
  const doc = validatedDocument({ patients: [{ id: "p1", name: "Ana", age: 30, controlReminder: { due: "2026-09-20", at: 5 } }], appointments: [] });
  assert.deepEqual(doc.patients[0].controlReminder, { due: "2026-09-20", at: 5 });
});
