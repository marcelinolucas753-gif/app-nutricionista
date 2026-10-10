import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { BACKUP_FORMAT, BACKUP_VERSION, decryptSnapshot, encryptSnapshot, parseBackupKey, restoreSnapshot, validateSnapshot } from "../backup.mjs";

const account = { id: "prof-1", email: "a@ejemplo.com", display_name: "Profesional", password_salt: "s", password_hash: "h", active: true, created_at: "2026-01-01T00:00:00Z", password_changed_at: "2026-01-01T00:00:00Z" };
const data = { professional_id: "prof-1", document: { patients: [{ id: "p1", name: "Paciente A", age: 40 }], appointments: [] }, version: 7, updated_at: "2026-10-01T00:00:00Z" };
const v1 = () => ({ format: BACKUP_FORMAT, version: 1, createdAt: "2026-10-01T00:00:00Z", professionals: [account], data: [data] });
const v2 = () => ({
  ...v1(), version: 2,
  portal: {
    accessTokens: [{ id: "11111111-1111-1111-1111-111111111111", professional_id: "prof-1", patient_id: "p1", token_hash: "hash1", short_code: "ABC123", active: true, created_at: "2026-10-02T00:00:00Z", revoked_at: null, last_used_at: null }],
    submissions: [{ id: "22222222-2222-2222-2222-222222222222", access_token_id: "11111111-1111-1111-1111-111111111111", type: "weight", data: { weight: 70.5, date: "2026-10-05" }, created_at: "2026-10-05T10:00:00Z" }]
  },
  aiFeedback: [{ professional_id: "prof-1", scope: "meal", meal_key: "lunch", rating: "down", reasons: ["repetida"], meal_text: "Pollo con arroz", rules_version: "r1", patient_ref: "p1", created_at: "2026-10-06T00:00:00Z" }]
});

function fakeClient() {
  const calls = [];
  return { calls, query: async (sql, params = []) => { calls.push({ sql: sql.replace(/\s+/g, " ").trim(), params }); return { rows: [], rowCount: 0 }; } };
}
const touches = (calls, table) => calls.filter(call => call.sql.includes(table));

test("el respaldo cifrado se descifra con la misma clave y falla con otra", () => {
  const key = randomBytes(32);
  const bytes = encryptSnapshot(v2(), key);
  assert.deepEqual(decryptSnapshot(bytes, key), v2());
  assert.throws(() => decryptSnapshot(bytes, randomBytes(32)), /No se pudo descifrar/);
  assert.throws(() => decryptSnapshot(Buffer.from("no es un respaldo, solo texto de relleno largo"), key), /no parece un respaldo/);
});

test("la clave acepta hexadecimal o Base64 de 32 bytes y rechaza otras", () => {
  const raw = randomBytes(32);
  assert.deepEqual(parseBackupKey(raw.toString("hex")), raw);
  assert.deepEqual(parseBackupKey(raw.toString("base64")), raw);
  assert.throws(() => parseBackupKey("corta"), /32 bytes/);
});

test("el formato actual es la versión 2", () => assert.equal(BACKUP_VERSION, 2));

test("validateSnapshot acepta las versiones 1 y 2 e informa si trae datos del portal", () => {
  assert.deepEqual(validateSnapshot(v1()), { hasPortalData: false });
  assert.deepEqual(validateSnapshot(v2()), { hasPortalData: true });
});

test("validateSnapshot rechaza estructuras incompletas o inconsistentes", () => {
  assert.throws(() => validateSnapshot({ ...v1(), format: "otro" }), /estructura esperada/);
  assert.throws(() => validateSnapshot({ ...v1(), version: 3 }), /estructura esperada/);
  assert.throws(() => validateSnapshot({ ...v1(), data: [{ ...data, professional_id: "otra" }] }), /sin una cuenta/);
  assert.throws(() => validateSnapshot({ ...v1(), data: [{ ...data, document: { patients: [] } }] }), /no tiene una estructura válida/);
  const sinPortal = v2(); delete sinPortal.portal;
  assert.throws(() => validateSnapshot(sinPortal), /portal y las opiniones/);
  const sinOpiniones = v2(); delete sinOpiniones.aiFeedback;
  assert.throws(() => validateSnapshot(sinOpiniones), /portal y las opiniones/);
  const envioHuerfano = v2(); envioHuerfano.portal.submissions[0].access_token_id = "no-existe";
  assert.throws(() => validateSnapshot(envioHuerfano), /envío del portal/);
  const accesoAjeno = v2(); accesoAjeno.portal.accessTokens[0].professional_id = "otra";
  assert.throws(() => validateSnapshot(accesoAjeno), /acceso del portal/);
  const opinionMala = v2(); opinionMala.aiFeedback[0].rating = "meh";
  assert.throws(() => validateSnapshot(opinionMala), /opinión/);
});

test("restaurar un respaldo v2 recupera accesos, envíos y opiniones de cada cuenta", async () => {
  const client = fakeClient();
  const result = await restoreSnapshot(client, v2());
  assert.deepEqual(result, { portalRestored: true, accessTokens: 1, submissions: 1, feedback: 1 });
  const deleteTokens = touches(client.calls, "DELETE FROM patient_access_tokens");
  assert.equal(deleteTokens.length, 1);
  assert.deepEqual(deleteTokens[0].params, [["prof-1"]]);
  const sqls = client.calls.map(call => call.sql);
  const order = ["DELETE FROM patient_access_tokens", "INSERT INTO patient_access_tokens", "INSERT INTO patient_submissions"].map(prefix => sqls.findIndex(sql => sql.startsWith(prefix)));
  assert.ok(order.every(index => index >= 0) && order[0] < order[1] && order[1] < order[2], "primero se borran los accesos, luego se insertan accesos y después envíos");
  const submission = touches(client.calls, "INSERT INTO patient_submissions")[0];
  assert.equal(submission.params[3], JSON.stringify({ weight: 70.5, date: "2026-10-05" }));
  assert.equal(touches(client.calls, "DELETE FROM ai_feedback").length, 1);
  assert.equal(touches(client.calls, "INSERT INTO ai_feedback").length, 1);
});

test("las opiniones se restauran dentro del contexto de su propia cuenta", async () => {
  const client = fakeClient();
  await restoreSnapshot(client, v2());
  const contexts = client.calls.map((call, index) => ({ call, index })).filter(({ call }) => call.sql.startsWith("SELECT set_config"));
  const deleteFeedbackIndex = client.calls.findIndex(call => call.sql.startsWith("DELETE FROM ai_feedback"));
  const lastContextBefore = contexts.filter(({ index }) => index < deleteFeedbackIndex).at(-1);
  assert.deepEqual(lastContextBefore.call.params, ["prof-1"]);
});

test("restaurar un respaldo v1 no toca accesos del portal, envíos ni opiniones existentes", async () => {
  const client = fakeClient();
  const result = await restoreSnapshot(client, v1());
  assert.equal(result.portalRestored, false);
  for (const table of ["patient_access_tokens", "patient_submissions", "ai_feedback"]) assert.equal(touches(client.calls, table).length, 0, table);
  assert.equal(touches(client.calls, "INSERT INTO professional_data").length, 1);
});

test("un respaldo inválido no escribe nada en la base", async () => {
  const client = fakeClient();
  await assert.rejects(() => restoreSnapshot(client, { ...v2(), aiFeedback: "no" }), /portal y las opiniones/);
  assert.equal(client.calls.length, 0);
});
