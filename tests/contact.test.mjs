import test from "node:test";
import assert from "node:assert/strict";
import { buildPortalMessage, buildReminderMessage, buildShoppingMessage, describeAppointmentTime, firstName, normalizePhone, whatsappLink } from "../contact.mjs";

test("normaliza teléfonos argentinos", () => {
  assert.equal(normalizePhone("362 4123456"), "5493624123456");
  assert.equal(normalizePhone("0362 15 4123456"), "5493624123456");
  assert.equal(normalizePhone("(011) 15-5555-1234"), "5491155551234");
  assert.equal(normalizePhone("+54 9 362 412-3456"), "5493624123456");
  assert.equal(normalizePhone("+54 362 4123456"), "5493624123456");
  assert.equal(normalizePhone("5493624123456"), "5493624123456");
  assert.equal(normalizePhone("543624123456"), "5493624123456");
  assert.equal(normalizePhone("0054 9 362 4123456"), "5493624123456");
});

test("acepta números de otros países y rechaza los inválidos", () => {
  assert.equal(normalizePhone("+598 99 123 456"), "59899123456");
  assert.equal(normalizePhone(""), null);
  assert.equal(normalizePhone(null), null);
  assert.equal(normalizePhone("abc"), null);
  assert.equal(normalizePhone("12345"), null);
  assert.equal(normalizePhone("+54 9 362"), null);
});

test("arma el enlace de WhatsApp con el mensaje codificado", () => {
  const link = whatsappLink("362 4123456", "Hola, ¿cómo estás?");
  assert.ok(link.startsWith("https://wa.me/5493624123456?text="));
  assert.equal(decodeURIComponent(link.split("?text=")[1]), "Hola, ¿cómo estás?");
  assert.equal(whatsappLink("nada", "x"), null);
  assert.equal(whatsappLink("3624123456"), "https://wa.me/5493624123456");
});

test("describe el horario del turno sin depender de la zona horaria", () => {
  assert.equal(describeAppointmentTime("2026-10-08T10:30"), "jueves 8 de octubre a las 10:30 hs");
  assert.equal(describeAppointmentTime("2026-01-05T09:05"), "lunes 5 de enero a las 09:05 hs");
  assert.equal(describeAppointmentTime("basura"), "");
});

test("mensajes de recordatorio, acceso y compras", () => {
  const reminder = buildReminderMessage({ patientName: "Ana Pérez", start: "2026-10-08T10:30", professionalName: "Lic. Gómez" });
  assert.match(reminder, /^Hola Ana, te recuerdo tu turno el jueves 8 de octubre a las 10:30 hs\./);
  assert.match(reminder, /— Lic\. Gómez$/);
  assert.equal(firstName("Paciente sin nombre"), "");
  assert.match(buildReminderMessage({ patientName: "Paciente", start: "2026-10-08T10:30" }), /^Hola, te recuerdo/);
  const portal = buildPortalMessage({ patientName: "Ana", link: "https://x.test/portal/abc", code: "AB12CD34" });
  assert.match(portal, /https:\/\/x\.test\/portal\/abc/);
  assert.match(portal, /AB12CD34/);
  const shopping = buildShoppingMessage({ categories: [{ name: "Verdulería", items: [{ item: "Zapallitos", quantity: "3 unidades" }] }] }, { patientName: "Ana" });
  assert.match(shopping, /Lista de compras para Ana/);
  assert.match(shopping, /• Zapallitos — 3 unidades/);
});
