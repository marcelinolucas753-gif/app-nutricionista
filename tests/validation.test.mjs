import test from "node:test";
import assert from "node:assert/strict";
import { isIsoDate, validatePortalNote, validatePortalWeight, validatedDocument } from "../validation.mjs";

const patient = (extra = {}) => ({ id: "p1", name: "Ana", age: 40, ...extra });

test("acepta un documento mínimo y agrega plantillas vacías", () => {
  const doc = validatedDocument({ patients: [patient()], appointments: [] });
  assert.deepEqual(doc.templates, []);
  assert.equal(doc.patients[0].id, "p1");
});

test("rechaza fichas o turnos inválidos", () => {
  assert.throws(() => validatedDocument({ patients: [{ id: "", name: "x", age: 1 }], appointments: [] }), /campos básicos/);
  assert.throws(() => validatedDocument({ patients: [patient(), patient()], appointments: [] }), /repetidas/);
  assert.throws(() => validatedDocument({ patients: [patient()], appointments: [{ id: "a", patientId: "otro", start: "2026-01-01T10:00", duration: 30 }] }), /turno/i);
  assert.throws(() => validatedDocument({ patients: [patient()], appointments: [{ id: "a", patientId: "p1", start: "2026-01-01T10:00", duration: 5 }] }), /turno/i);
  assert.throws(() => validatedDocument(null), /formato/);
});

test("quita lo que solo debe vivir en el servidor y limpia campos nuevos", () => {
  const doc = validatedDocument({
    patients: [patient({ submissions: [{ type: "note" }], phone: "x".repeat(100), allergies: "a".repeat(2000), goals: [{ id: "g1", text: "Caminar", status: "rara", targetDate: "2026-13-45", visibleToPatient: "si" }, { nope: true }], history: [{ at: 1, text: "ok" }, "basura"], handledSubmissions: ["s1", 5], shoppingList: { categories: [{ name: "Verdulería", items: [{ item: "Zapallo", quantity: "1" }, null] }] } })],
    appointments: []
  });
  const saved = doc.patients[0];
  assert.equal("submissions" in saved, false);
  assert.equal(saved.phone.length, 40);
  assert.equal(saved.allergies.length, 1000);
  assert.equal(saved.goals.length, 1);
  assert.equal(saved.goals[0].status, "active");
  assert.equal(saved.goals[0].targetDate, "");
  assert.equal(saved.goals[0].visibleToPatient, false);
  assert.deepEqual(saved.history.map(item => item.text), ["ok"]);
  assert.deepEqual(saved.handledSubmissions, ["s1"]);
  assert.equal(saved.shoppingList.categories[0].items.length, 1);
});

test("conserva plantillas válidas y descarta las rotas", () => {
  const draft = { days: [] };
  const doc = validatedDocument({ patients: [], appointments: [], templates: [{ id: "t1", name: "Base", draft }, { id: "t2", name: "Sin menú" }, null] });
  assert.equal(doc.templates.length, 1);
  assert.equal(doc.templates[0].id, "t1");
});

test("fechas ISO", () => {
  assert.equal(isIsoDate("2026-02-28"), true);
  assert.equal(isIsoDate("2026-02-30"), false);
  assert.equal(isIsoDate("28/02/2026"), false);
  assert.equal(isIsoDate(5), false);
});

test("datos que carga la persona desde el portal", () => {
  const today = new Date().toISOString().slice(0, 10);
  assert.deepEqual(validatePortalWeight({ weight: "70.46", date: today }), { date: today, weight: 70.5 });
  assert.throws(() => validatePortalWeight({ weight: 5, date: today }), /peso/i);
  assert.throws(() => validatePortalWeight({ weight: 70, date: "2099-01-01" }), /futura/);
  assert.throws(() => validatePortalWeight({ weight: 70, date: "ayer" }), /fecha/i);
  assert.equal(validatePortalNote({ note: "  Tengo dudas  ", date: today }).note, "Tengo dudas");
  assert.throws(() => validatePortalNote({ note: "   " }), /nota/i);
  assert.throws(() => validatePortalNote({ note: "x".repeat(1501) }), /larga/);
});
