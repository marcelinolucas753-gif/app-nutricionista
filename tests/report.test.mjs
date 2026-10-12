import test from "node:test";
import assert from "node:assert/strict";
import { buildProgressReport } from "../js/logic.js";
import { progressReportHTML } from "../js/report.js";

const patient = {
  id: "p1", name: "Ana Pérez", age: 40, allergies: "maní", condition: "diabetes2",
  measurements: [
    { date: "2026-09-01", weight: 80, height: 165, createdAt: 1 },
    { date: "2026-09-15", weight: 78.5, waist: 90, createdAt: 2 },
    { date: "2026-10-01", weight: 77.2, waist: 88, hip: 100, createdAt: 3 },
    { date: "2026-10-01", weight: 77.0, createdAt: 4 },           // misma fecha: gana la última carga
    { date: "mal", weight: 99 }, { date: "2026-10-05", weight: -3 }
  ],
  goals: [
    { id: "g1", text: "Caminar 20 minutos", status: "active", visibleToPatient: true, targetDate: "2026-11-01" },
    { id: "g2", text: "META PRIVADA de la profesional", status: "active", visibleToPatient: false },
    { id: "g3", text: "Tomar más agua", status: "achieved", visibleToPatient: true },
    { id: "g4", text: "Meta abandonada", status: "dropped", visibleToPatient: true }
  ],
  consultations: [{ id: "c1", date: "2026-09-01", notes: "NOTA CLÍNICA PRIVADA: ansiedad por comida", nextControl: "2026-11-01" }],
  history: [{ at: 1, text: "HISTORIAL INTERNO" }],
  approvedAt: 123,
  draft: { days: [], recommendations: ["Tomá agua durante el día.", "Respetá los horarios."], reviewNotes: ["NOTA PARA LA PROFESIONAL: revisar glucemia"] }
};

test("el informe incluye solo lo que la persona puede ver", () => {
  const report = buildProgressReport(patient, { name: "Ana Pérez", professionalName: "Lic. Gómez", today: "2026-10-12" });
  assert.equal(report.hasContent, true);
  assert.deepEqual(report.rows.map(row => row.date), ["2026-09-01", "2026-09-15", "2026-10-01"]);
  assert.equal(report.rows[2].weight, 77); assert.equal(report.rows[2].hip, 100); assert.equal(report.rows[0].height, 165);
  assert.deepEqual(report.change, { from: 80, to: 77, delta: -3, since: "2026-09-01" });
  assert.deepEqual(report.goals.active.map(goal => goal.text), ["Caminar 20 minutos"]);
  assert.deepEqual(report.goals.achieved.map(goal => goal.text), ["Tomar más agua"]);
  assert.deepEqual(report.recommendations, ["Tomá agua durante el día.", "Respetá los horarios."]);
  const html = progressReportHTML(report);
  for (const secret of ["PRIVADA", "NOTA CLÍNICA", "HISTORIAL INTERNO", "NOTA PARA LA PROFESIONAL", "maní", "Diabetes", "abandonada"]) assert.equal(html.includes(secret), false, secret);
  for (const shown of ["Ana Pérez", "Lic. Gómez", "Caminar 20 minutos", "Tomar más agua", "Tomá agua durante el día.", "−3 kg", "<svg"]) assert.ok(html.includes(shown), shown);
});

test("sin plan aprobado no hay recomendaciones, y sin datos el informe queda vacío", () => {
  assert.deepEqual(buildProgressReport({ ...patient, approvedAt: null }).recommendations, []);
  const empty = buildProgressReport({ id: "x", name: "Sin datos", measurements: [], goals: [{ text: "oculta", visibleToPatient: false, status: "active" }] });
  assert.equal(empty.hasContent, false);
  assert.equal(buildProgressReport(null).hasContent, false);
});

test("el texto de la persona se escapa en el informe", () => {
  const html = progressReportHTML(buildProgressReport({ ...patient, name: "<img src=x onerror=alert(1)>", goals: [{ text: "<script>alert(1)</script>", status: "active", visibleToPatient: true }] }, { name: "<img src=x onerror=alert(1)>", professionalName: "<b>Dra</b>" }));
  assert.equal(html.includes("<img"), false);
  assert.equal(html.includes("<script>"), false);
  assert.equal(html.includes("<b>Dra</b>"), false);
});
