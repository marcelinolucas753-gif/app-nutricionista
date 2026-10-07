import test from "node:test";
import assert from "node:assert/strict";
import { acceptWeightSubmission, addGoal, backupAdvice, dismissSubmission, draftFromTemplate, logHistory, makeTemplate, measurementSeries, pendingSubmissions, removeGoal, setGoalStatus, sortedGoals, toggleGoalVisibility, weightChange } from "../js/logic.js";
import { validatedDocument } from "../validation.mjs";

test("el historial guarda como máximo 300 entradas", () => {
  const patient = {};
  for (let i = 0; i < 305; i++) logHistory(patient, `cambio ${i}`, i);
  assert.equal(patient.history.length, 300);
  assert.equal(patient.history[0].text, "cambio 5");
  logHistory(patient, "");
  assert.equal(patient.history.length, 300);
});

test("metas: alta, estado, visibilidad y baja dejan rastro en el historial", () => {
  const patient = {};
  assert.equal(addGoal(patient, { text: "   " }), null);
  const goal = addGoal(patient, { text: "Caminar 3 veces por semana", targetDate: "2026-12-01", visibleToPatient: true });
  assert.equal(goal.status, "active");
  assert.equal(goal.visibleToPatient, true);
  assert.equal(addGoal(patient, { text: "Sin fecha", targetDate: "mañana" }).targetDate, "");
  assert.equal(setGoalStatus(patient, goal.id, "achieved"), true);
  assert.equal(setGoalStatus(patient, goal.id, "achieved"), false);
  assert.equal(setGoalStatus(patient, goal.id, "inventado"), false);
  assert.equal(toggleGoalVisibility(patient, goal.id), true);
  assert.equal(patient.goals[0].visibleToPatient, false);
  assert.equal(sortedGoals(patient)[0].status, "active");
  assert.equal(removeGoal(patient, goal.id), true);
  assert.equal(patient.goals.length, 1);
  assert.ok(patient.history.length >= 5);
});

test("las metas y el historial pasan la validación del servidor", () => {
  const patient = { id: "p1", name: "A", age: 30 };
  addGoal(patient, { text: "Meta", visibleToPatient: true });
  const doc = validatedDocument({ patients: [patient], appointments: [] });
  assert.equal(doc.patients[0].goals.length, 1);
  assert.equal(doc.patients[0].goals[0].visibleToPatient, true);
  assert.equal(doc.patients[0].history.length, 1);
});

test("plantillas: se copian sin compartir referencias y marcan la revisión", () => {
  const draft = { intro: "Hola", days: [{ day: "Lunes", breakfast: "Té" }, { day: "Martes", breakfast: "Mate" }], recommendations: ["Tomar agua"], reviewNotes: [], approvedAt: 123, secreto: "x" };
  assert.equal(makeTemplate("  ", draft), null);
  assert.equal(makeTemplate("Base", { intro: "sin días" }), null);
  const template = makeTemplate("Base", draft);
  assert.equal(template.draft.secreto, undefined);
  assert.equal(template.draft.approvedAt, undefined);
  draft.days[0].breakfast = "Cambiado";
  assert.equal(template.draft.days[0].breakfast, "Té");
  const applied = draftFromTemplate(template, ["Lun", "Mar"]);
  assert.equal(applied.days[0].day, "Lun");
  assert.ok(applied.reviewNotes.some(note => note.includes("plantilla")));
  applied.days[0].breakfast = "Otro";
  assert.equal(template.draft.days[0].breakfast, "Té");
  const doc = validatedDocument({ patients: [], appointments: [], templates: [template, { id: "roto" }] });
  assert.equal(doc.templates.length, 1);
});

test("pesos enviados por la persona: aceptar agrega una medición y lo marca como atendido", () => {
  const patient = { measurements: [{ id: "m0", date: "2026-09-01", weight: 80, height: 170, createdAt: 1 }] };
  patient.submissions = [{ id: "s1", type: "weight", data: { date: "2026-10-01", weight: 78.5 } }, { id: "s2", type: "note", data: { date: "2026-10-02", note: "Dudas" } }, { id: "s3", type: "weight", data: { date: "2026-10-03", weight: "mucho" } }];
  assert.equal(pendingSubmissions(patient).length, 3);
  const measurement = acceptWeightSubmission(patient, patient.submissions[0]);
  assert.equal(measurement.weight, 78.5);
  assert.equal(measurement.bmi, 27.2);
  assert.equal(patient.measurements.length, 2);
  assert.equal(acceptWeightSubmission(patient, patient.submissions[1]), null);
  assert.equal(acceptWeightSubmission(patient, patient.submissions[2]), null);
  assert.equal(dismissSubmission(patient, patient.submissions[1]), true);
  assert.deepEqual(pendingSubmissions(patient).map(item => item.id), ["s3"]);
  assert.deepEqual(patient.handledSubmissions, ["s1", "s2"]);
  assert.equal(pendingSubmissions({}).length, 0);
});

test("series de mediciones: una por fecha, ordenadas, sin valores vacíos", () => {
  const patient = { measurements: [
    { date: "2026-10-05", weight: 79, waist: 90, createdAt: 3 },
    { date: "2026-09-01", weight: 82, waist: null, createdAt: 1 },
    { date: "2026-10-05", weight: 78.8, createdAt: 4 },
    { date: "2026-09-20", weight: null, waist: 92, hip: 100, createdAt: 2 },
    { date: "fecha-rota", weight: 70, createdAt: 5 }
  ] };
  const series = measurementSeries(patient);
  assert.deepEqual(series.weight, [{ date: "2026-09-01", value: 82 }, { date: "2026-10-05", value: 78.8 }]);
  assert.deepEqual(series.waist.map(point => point.date), ["2026-09-20", "2026-10-05"]);
  assert.equal(series.hip.length, 1);
  assert.deepEqual(weightChange(patient), { from: 82, to: 78.8, delta: -3.2, since: "2026-09-01" });
  assert.equal(weightChange({ measurements: [{ date: "2026-09-01", weight: 80 }] }), null);
});

test("avisos de respaldo", () => {
  const now = Date.parse("2026-10-06T12:00:00Z");
  assert.equal(backupAdvice({ configured: false }, now).level, "warn");
  assert.equal(backupAdvice(null, now).level, "warn");
  assert.equal(backupAdvice({ configured: true, count: 0, lastAt: null }, now).level, "warn");
  assert.equal(backupAdvice({ configured: true, count: 3, lastAt: now - 3 * 86_400_000 }, now).level, "warn");
  const ok = backupAdvice({ configured: true, count: 3, lastAt: now - 3_600_000 }, now);
  assert.equal(ok.level, "ok");
  assert.match(ok.text, /3/);
});
