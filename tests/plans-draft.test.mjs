import test from "node:test";
import assert from "node:assert/strict";
import { bindPlans, captureDraftEdits } from "../js/plans.js";

const DAYS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
const MEALS = ["breakfast", "snack1", "lunch", "snack2", "merienda", "dinner"];
const draftWith = text => ({ intro: "", recommendations: [], reviewNotes: [], days: DAYS.map(day => ({ day, extra: "", ...Object.fromEntries(MEALS.map(meal => [meal, `${text} · ${meal}`])) })) });

/** Simula la pantalla del plan: una caja de texto por comida, con lo que muestra el borrador actual. */
function renderPlansPanel(person) {
  const areas = person.draft.days.flatMap((day, dayIndex) => MEALS.map(meal => ({ dataset: { day: String(dayIndex), meal }, value: day[meal] })));
  const panel = { dataset: { patient: person.id }, querySelectorAll: selector => (selector.startsWith("textarea") ? areas : []) };
  const el = { querySelector: selector => (selector === "#plans-panel" ? panel : null), querySelectorAll: () => [] };
  globalThis.document = { getElementById: id => (id === "plans-panel" ? panel : null) };
  bindPlans(el, person, () => {});
  return areas;
}
const newPerson = () => ({ id: "ficha-1", draft: draftWith("Menú viejo"), history: [], approvedAt: null });

test("un borrador nuevo no se pisa con el texto viejo que sigue en pantalla", () => {
  const person = newPerson();
  renderPlansPanel(person);
  // «Generar nuevo borrador»: el borrador se reemplaza y la pantalla se vuelve a dibujar,
  // pero antes de redibujar todavía están las cajas de texto del menú anterior.
  person.draft = draftWith("Menú nuevo");
  const changed = captureDraftEdits(person);
  assert.equal(changed, false);
  assert.equal(person.draft.days[0].breakfast, "Menú nuevo · breakfast");
  assert.equal(person.draft.days[6].dinner, "Menú nuevo · dinner");
  assert.deepEqual(person.history, []); // no debe figurar como «Plan editado»
});

test("restaurar una versión anterior o aplicar una plantilla tampoco se pisa", () => {
  const person = newPerson();
  renderPlansPanel(person);
  person.draft = structuredClone(draftWith("Versión restaurada"));
  assert.equal(captureDraftEdits(person), false);
  assert.equal(person.draft.days[3].lunch, "Versión restaurada · lunch");
});

test("lo que la profesional escribe en una comida sí se conserva", () => {
  const person = newPerson();
  const areas = renderPlansPanel(person);
  areas.find(area => area.dataset.day === "2" && area.dataset.meal === "dinner").value = "  Sopa de verduras  ";
  person.approvedAt = Date.now();
  assert.equal(captureDraftEdits(person), true);
  assert.equal(person.draft.days[2].dinner, "Sopa de verduras");
  assert.equal(person.approvedAt, null); // editar quita la aprobación, como antes
  assert.equal(person.history.length, 1);
});

test("después de dibujar la pantalla con el borrador nuevo, volver a editar funciona", () => {
  const person = newPerson();
  renderPlansPanel(person);
  person.draft = draftWith("Menú nuevo");
  const areas = renderPlansPanel(person); // se redibuja con el borrador nuevo
  areas[0].value = "Mate cocido con tostadas";
  assert.equal(captureDraftEdits(person), true);
  assert.equal(person.draft.days[0].breakfast, "Mate cocido con tostadas");
  assert.equal(person.draft.days[1].breakfast, "Menú nuevo · breakfast");
});
