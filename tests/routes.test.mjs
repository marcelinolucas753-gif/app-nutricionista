// Pruebas de las rutas del servidor con una base PostgreSQL real.
//
// Solo corren si se indica TEST_DATABASE_ADMIN_URL: una conexión de administrador a un PostgreSQL DE PRUEBA
// (por ejemplo postgresql://postgres:clave@127.0.0.1:5432/postgres). Estas pruebas crean y borran su propia base
// (nutri_routes_test); nunca tocan otra. En GitHub (CI) esa base ya está configurada; en tu computadora, sin la
// variable, se omiten y el resto de las pruebas corre igual.
//
// La base de prueba pertenece a un usuario SIN permisos de administrador, igual que en producción: así la
// separación entre cuentas (seguridad por filas) se verifica de verdad.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes, scryptSync } from "node:crypto";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import pg from "pg";

const ADMIN_URL = process.env.TEST_DATABASE_ADMIN_URL;
const SKIP = ADMIN_URL ? false : "Falta TEST_DATABASE_ADMIN_URL (una base PostgreSQL de prueba); estas pruebas se omiten.";
const root = fileURLToPath(new URL("..", import.meta.url));
const DB = "nutri_routes_test", ROLE = "nutri_routes_test";

let base, server, serverLog = "", db, appUrl;

const freePort = () => new Promise((resolve, reject) => { const probe = createServer(); probe.listen(0, "127.0.0.1", () => { const { port } = probe.address(); probe.close(() => resolve(port)); }); probe.on("error", reject); });

async function http(method, path, { cookie, bearer, body, headers = {} } = {}) {
  const response = await fetch(base + path, {
    method, redirect: "manual",
    headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  let json = null; try { json = JSON.parse(text); } catch { /* no es JSON */ }
  return { status: response.status, json, text, headers: response.headers };
}

async function addProfessional(id, email, password, name) {
  const salt = randomBytes(16).toString("hex");
  await db.query("INSERT INTO professionals (id,email,display_name,password_salt,password_hash) VALUES ($1,$2,$3,$4,$5)", [id, email, name, salt, scryptSync(password, salt, 64).toString("hex")]);
}
async function login(email, password) {
  const result = await http("POST", "/api/login", { body: { email, password } });
  assert.equal(result.status, 200, `ingreso de ${email}: ${result.text}`);
  return result.headers.getSetCookie()[0].split(";")[0];
}
/** Ejecuta consultas como una cuenta (activa la seguridad por filas, igual que el servidor). */
async function asProfessional(id, callback) {
  const client = await db.connect();
  try { await client.query("BEGIN"); await client.query("SELECT set_config('app.professional_id',$1,true)", [id]); const result = await callback(client); await client.query("COMMIT"); return result; }
  catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; } finally { client.release(); }
}
const isoDay = offset => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

const PASS_A = "clave-larga-de-ana-1", PASS_B = "clave-larga-de-beto-2";
const NOTE_PRIVATE = "NOTA PRIVADA DE LA CONSULTA", NOTE_INTERNAL = "NOTA INTERNA DE REVISION", GOAL_HIDDEN = "META SOLO PARA LA PROFESIONAL";
let cookieA, cookieB, portalCode, portalLink;

function patientDocument() {
  return {
    patients: [{
      id: "p-a", name: "Paciente Ana", age: 41, condition: "general", goal: "Ordenar horarios", allergies: "", approvedAt: Date.now(),
      consultations: [{ id: "c1", date: "2026-09-01", reason: "Primera consulta", notes: NOTE_PRIVATE, adherence: "alta", recommendations: "Algo privado" }],
      measurements: [{ id: "m1", date: "2026-09-01", weight: 70, height: 165, createdAt: 1 }],
      draft: { intro: "Propuesta semanal.", days: Array.from({ length: 7 }, (_, i) => ({ day: `Día ${i + 1}`, breakfast: "Mate con tostadas", snack1: "Fruta", lunch: "Pollo con arroz", snack2: "Yogur con granola", merienda: "Té con pan", dinner: "Sopa de verduras", extra: "" })), recommendations: ["Tomá agua."], reviewNotes: [NOTE_INTERNAL] },
      goals: [{ id: "g1", text: "Caminar 20 minutos", status: "active", visibleToPatient: true }, { id: "g2", text: GOAL_HIDDEN, status: "active", visibleToPatient: false }],
      recipes: [], shoppingList: null
    }],
    appointments: [], templates: []
  };
}

describe("rutas del servidor con una base real", { skip: SKIP }, () => {
  before(async () => {
    const admin = new pg.Client({ connectionString: ADMIN_URL }); await admin.connect();
    try {
      await admin.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`); await admin.query(`DROP ROLE IF EXISTS ${ROLE}`);
      await admin.query(`CREATE ROLE ${ROLE} LOGIN PASSWORD 'routes'`); await admin.query(`CREATE DATABASE ${DB} OWNER ${ROLE}`);
    } finally { await admin.end(); }
    const url = new URL(ADMIN_URL); url.username = ROLE; url.password = "routes"; url.pathname = `/${DB}`; appUrl = url.toString();
    const migrate = spawnSync(process.execPath, ["migrate.mjs"], { cwd: root, env: { ...process.env, DATABASE_URL: appUrl }, encoding: "utf8" });
    assert.equal(migrate.status, 0, `migrate.mjs falló: ${migrate.stdout}${migrate.stderr}`);
    db = new pg.Pool({ connectionString: appUrl, max: 4 });
    await addProfessional("prof-a", "ana@prueba.com", PASS_A, "Ana Profesional");
    await addProfessional("prof-b", "beto@prueba.com", PASS_B, "Beto Profesional");
    const port = await freePort();
    const env = { ...process.env, DATABASE_URL: appUrl, PORT: String(port), NODE_ENV: "development", HOST: "127.0.0.1" };
    for (const key of ["BACKUP_ENCRYPTION_KEY", "BACKUP_DIR", "OPENAI_API_KEY", "TRUST_PROXY"]) delete env[key];
    server = spawn(process.execPath, ["server.mjs"], { cwd: root, env });
    server.stdout.on("data", chunk => { serverLog += chunk; }); server.stderr.on("data", chunk => { serverLog += chunk; });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`El servidor no arrancó:\n${serverLog}`)), 15_000);
      server.stdout.on("data", () => { if (serverLog.includes("lista en")) { clearTimeout(timer); resolve(); } });
      server.on("exit", code => { clearTimeout(timer); reject(new Error(`El servidor se cerró (${code}):\n${serverLog}`)); });
    });
    base = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    server?.removeAllListeners("exit"); server?.kill();
    await db?.end().catch(() => {});
    const admin = new pg.Client({ connectionString: ADMIN_URL });
    try { await admin.connect(); await admin.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`); await admin.query(`DROP ROLE IF EXISTS ${ROLE}`); } catch { /* limpieza de mejor esfuerzo */ } finally { await admin.end().catch(() => {}); }
  });

  test("la base de prueba aplica la seguridad por filas (el usuario no es administrador)", async () => {
    const result = await db.query("SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user");
    assert.deepEqual(result.rows[0], { rolsuper: false, rolbypassrls: false });
  });

  test("salud y estado sin sesión", async () => {
    const health = await http("GET", "/api/health");
    assert.equal(health.status, 200); assert.equal(health.json.ok, true);
    const status = await http("GET", "/api/status");
    assert.equal(status.json.authenticated, false); assert.equal(status.json.professional, null);
    for (const path of ["/api/data", "/api/data/version", "/api/feedback", "/api/usage"]) assert.equal((await http("GET", path)).status, 401, path);
    for (const [method, path] of [["PUT", "/api/data"], ["POST", "/api/generate-menu"], ["POST", "/api/feedback"], ["DELETE", "/api/feedback/all"], ["POST", "/api/patient-access"]]) assert.equal((await http(method, path, { body: {} })).status, 401, `${method} ${path}`);
  });

  test("encabezados de seguridad y archivos privados que nunca se entregan", async () => {
    const home = await http("GET", "/");
    assert.equal(home.status, 200);
    assert.equal(home.headers.get("x-frame-options"), "DENY");
    assert.equal(home.headers.get("x-content-type-options"), "nosniff");
    assert.match(home.headers.get("content-security-policy"), /default-src 'self'/);
    assert.equal(home.headers.get("cache-control"), "no-store");
    for (const path of ["/server.mjs", "/.env", "/package.json", "/db.mjs", "/migrations/001_professional_accounts.sql", "/backups/x.enc", "/js/..%2fserver.mjs", "/tests/routes.test.mjs"]) assert.equal((await http("GET", path)).status, 404, path);
    assert.equal((await http("GET", "/js/util.js")).status, 200);
    assert.equal((await http("GET", "/portal")).status, 200);
    assert.equal((await http("PATCH", "/api/data", { body: {} })).status, 405);
  });

  test("ingreso: contraseña incorrecta o cuenta inexistente dan el mismo mensaje; el correcto entrega una cookie protegida", async () => {
    const wrong = await http("POST", "/api/login", { body: { email: "ana@prueba.com", password: "incorrecta-1234" } });
    const unknown = await http("POST", "/api/login", { body: { email: "nadie@prueba.com", password: "incorrecta-1234" } });
    assert.equal(wrong.status, 401); assert.equal(unknown.status, 401);
    assert.equal(wrong.json.error, unknown.json.error);
    const ok = await http("POST", "/api/login", { body: { email: "ANA@prueba.com", password: PASS_A } });
    assert.equal(ok.status, 200);
    const cookie = ok.headers.getSetCookie()[0];
    assert.match(cookie, /^nutri_session=/); assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Strict/);
    cookieA = cookie.split(";")[0]; cookieB = await login("beto@prueba.com", PASS_B);
    const status = await http("GET", "/api/status", { cookie: cookieA });
    assert.equal(status.json.authenticated, true); assert.equal(status.json.professional.name, "Ana Profesional");
    const out = await http("POST", "/api/logout", { cookie: await login("ana@prueba.com", PASS_A) });
    assert.equal(out.status, 200);
  });

  test("un pedido que cambia datos y viene de otro sitio se rechaza", async () => {
    const evil = await http("POST", "/api/logout", { cookie: cookieA, headers: { Origin: "https://sitio-malicioso.example" } });
    assert.equal(evil.status, 403);
    const same = await http("POST", "/api/feedback", { cookie: cookieA, body: { scope: "plan", rating: "up" }, headers: { Origin: base } });
    assert.equal(same.status, 200);
    await asProfessional("prof-a", client => client.query("DELETE FROM ai_feedback"));
  });

  test("cada cuenta guarda y ve solo sus fichas, y un guardado con versión vieja no pisa lo nuevo", async () => {
    const first = await http("GET", "/api/data", { cookie: cookieA });
    assert.equal(first.status, 200); assert.equal(first.json.version, 0);
    const saved = await http("PUT", "/api/data", { cookie: cookieA, body: { ...patientDocument(), version: 0 } });
    assert.equal(saved.status, 200); assert.equal(saved.json.version, 1);
    const stale = await http("PUT", "/api/data", { cookie: cookieA, body: { ...patientDocument(), version: 0 } });
    assert.equal(stale.status, 409);
    const savedB = await http("PUT", "/api/data", { cookie: cookieB, body: { patients: [{ id: "p-b", name: "Paciente Beto", age: 50, condition: "general" }], appointments: [], version: 0 } });
    assert.equal(savedB.status, 200);
    const seenA = (await http("GET", "/api/data", { cookie: cookieA })).json, seenB = (await http("GET", "/api/data", { cookie: cookieB })).json;
    assert.deepEqual(seenA.patients.map(item => item.id), ["p-a"]); assert.deepEqual(seenB.patients.map(item => item.id), ["p-b"]);
    assert.equal((await http("GET", "/api/data/version", { cookie: cookieA })).json.version, 1);
    // La base misma (no solo el servidor) impide que una cuenta lea las filas de otra.
    const leaked = await asProfessional("prof-a", client => client.query("SELECT professional_id FROM professional_data"));
    assert.deepEqual(leaked.rows.map(row => row.professional_id), ["prof-a"]);
    // Un guardado inválido se rechaza completo.
    assert.equal((await http("PUT", "/api/data", { cookie: cookieA, body: { patients: [{ id: "", name: "x", age: 1 }], appointments: [], version: 1 } })).status, 400);
  });

  test("no se puede dar acceso al portal a la ficha de otra cuenta", async () => {
    assert.equal((await http("POST", "/api/patient-access", { cookie: cookieB, body: { patientId: "p-a" } })).status, 404);
    assert.equal((await http("POST", "/api/patient-access", { cookie: cookieA, body: { patientId: "no-existe" } })).status, 404);
  });

  test("IA: sin la autorización registrada de la persona no se genera nada", async () => {
    const result = await http("POST", "/api/generate-menu", { cookie: cookieA, body: { patientId: "p-a" } });
    assert.equal(result.status, 403); assert.match(result.json.error, /autorización/);
    assert.equal((await http("POST", "/api/generate-menu", { cookie: cookieB, body: { patientId: "p-a" } })).status, 404); // la ficha es de otra cuenta
  });

  test("portal: el acceso se crea, la persona entra y NO ve las notas ni lo interno de la profesional", async () => {
    const created = await http("POST", "/api/patient-access", { cookie: cookieA, body: { patientId: "p-a" } });
    assert.equal(created.status, 200); assert.match(created.json.shortCode, /^[A-HJ-NP-Z2-9]{8}$/);
    portalCode = created.json.shortCode; portalLink = created.json.token;
    const info = await http("GET", "/api/patient-access/p-a", { cookie: cookieA });
    assert.equal(info.json.active, true); assert.equal(info.json.shortCode, portalCode);
    const auth = await http("POST", "/api/portal/auth", { body: { code: portalCode.toLowerCase() } });
    assert.equal(auth.status, 200); const session = auth.json.token;
    const data = await http("GET", "/api/portal/data", { bearer: session });
    assert.equal(data.status, 200);
    assert.equal(data.json.patientName, "Paciente Ana"); assert.equal(data.json.professionalName, "Ana Profesional");
    assert.equal(data.json.draft.days.length, 7);
    assert.deepEqual(data.json.consultations, [{ date: "2026-09-01" }]);
    assert.deepEqual(data.json.goals.map(goal => goal.text), ["Caminar 20 minutos"]);
    for (const secret of [NOTE_PRIVATE, NOTE_INTERNAL, GOAL_HIDDEN, "Algo privado", "reviewNotes", "ana@prueba.com"]) assert.ok(!data.text.includes(secret), `el portal no debe mostrar: ${secret}`);
    assert.equal((await http("GET", "/api/portal/data")).status, 401);
    assert.equal((await http("GET", "/api/portal/data", { bearer: "token-inventado" })).status, 401);
    // El enlace largo también sirve para entrar.
    assert.equal((await http("POST", "/api/portal/auth", { body: { token: portalLink } })).status, 200);
  });

  test("portal: lo que envía la persona llega a la profesional y se validan los datos", async () => {
    const session = (await http("POST", "/api/portal/auth", { body: { code: portalCode } })).json.token;
    assert.equal((await http("POST", "/api/portal/weight", { bearer: session, body: { weight: 69.54, date: isoDay(-1) } })).status, 200);
    assert.equal((await http("POST", "/api/portal/note", { bearer: session, body: { note: "Tengo una duda sobre la cena", date: isoDay(0) } })).status, 200);
    for (const bad of [{ weight: 10, date: isoDay(0) }, { weight: 70, date: "no-es-fecha" }, { weight: 70, date: isoDay(30) }, { weight: "mucho", date: isoDay(0) }]) assert.equal((await http("POST", "/api/portal/weight", { bearer: session, body: bad })).status, 400, JSON.stringify(bad));
    assert.equal((await http("POST", "/api/portal/note", { bearer: session, body: { note: "   " } })).status, 400);
    assert.equal((await http("POST", "/api/portal/note", { bearer: session, body: { note: "x".repeat(1600) } })).status, 400);
    const mine = (await http("GET", "/api/data", { cookie: cookieA })).json.patients[0];
    assert.deepEqual(mine.submissions.map(item => item.type).sort(), ["note", "weight"]);
    assert.equal(mine.submissions.find(item => item.type === "weight").data.weight, 69.5);
    assert.deepEqual((await http("GET", "/api/data", { cookie: cookieB })).json.patients.map(item => item.submissions.length), [0]);
    const seen = await http("GET", "/api/portal/data", { bearer: session });
    assert.deepEqual(seen.json.pendingWeights.map(item => item.weight), [69.5]);
  });

  test("portal: cerrar la sesión en todos los dispositivos deja el código vigente", async () => {
    const phone = (await http("POST", "/api/portal/auth", { body: { code: portalCode } })).json.token;
    const tablet = (await http("POST", "/api/portal/auth", { body: { code: portalCode } })).json.token;
    assert.equal((await http("GET", "/api/portal/data", { bearer: tablet })).status, 200);
    const closed = await http("POST", "/api/portal/logout-all", { bearer: phone });
    assert.equal(closed.status, 200); assert.ok(closed.json.closed >= 2);
    assert.equal((await http("GET", "/api/portal/data", { bearer: phone })).status, 401);
    assert.equal((await http("GET", "/api/portal/data", { bearer: tablet })).status, 401);
    assert.equal((await http("POST", "/api/portal/logout-all")).status, 401);
    assert.equal((await http("POST", "/api/portal/auth", { body: { code: portalCode } })).status, 200); // puede volver a entrar con su código
  });

  test("portal: la sesión se renueva con el uso hasta un tope y vence sola si no se usa", async () => {
    const token = (await http("POST", "/api/portal/auth", { body: { code: portalCode } })).json.token;
    const hash = (await import("node:crypto")).createHash("sha256").update(token).digest("hex");
    const expiry = async () => (await db.query("SELECT (extract(epoch FROM expires_at) - extract(epoch FROM now())) / 86400 AS days, (extract(epoch FROM (created_at + interval '30 days')) - extract(epoch FROM now())) / 86400 AS cap FROM patient_sessions WHERE token_hash=$1", [hash])).rows[0];
    // Una sesión usada hace poco se renueva a 14 días.
    await db.query("UPDATE patient_sessions SET created_at = now() - interval '1 day', expires_at = now() + interval '2 days' WHERE token_hash=$1", [hash]);
    assert.equal((await http("GET", "/api/portal/data", { bearer: token })).status, 200);
    let state = await expiry(); assert.ok(state.days > 13.9 && state.days < 14.1, `renovada a ${state.days} días`);
    // Cerca del tope absoluto de 30 días no se pasa de ese tope.
    await db.query("UPDATE patient_sessions SET created_at = now() - interval '25 days', expires_at = now() + interval '2 days' WHERE token_hash=$1", [hash]);
    assert.equal((await http("GET", "/api/portal/data", { bearer: token })).status, 200);
    state = await expiry(); assert.ok(state.days > 4.9 && state.days < 5.1 && Math.abs(state.days - state.cap) < 0.01, `renovada a ${state.days} días (tope ${state.cap})`);
    // Sin uso, vence.
    await db.query("UPDATE patient_sessions SET expires_at = now() - interval '1 minute' WHERE token_hash=$1", [hash]);
    assert.equal((await http("GET", "/api/portal/data", { bearer: token })).status, 401);
  });

  test("portal: si la profesional revoca el acceso, las sesiones y el código dejan de servir", async () => {
    const token = (await http("POST", "/api/portal/auth", { body: { code: portalCode } })).json.token;
    assert.equal((await http("DELETE", "/api/patient-access/p-a", { cookie: cookieB })).status, 200); // otra cuenta: no revoca nada
    assert.equal((await http("GET", "/api/portal/data", { bearer: token })).status, 200);
    assert.equal((await http("DELETE", "/api/patient-access/p-a", { cookie: cookieA })).status, 200);
    assert.equal((await http("GET", "/api/portal/data", { bearer: token })).status, 401);
    assert.equal((await http("POST", "/api/portal/auth", { body: { code: portalCode } })).status, 401);
    assert.equal((await http("GET", "/api/patient-access/p-a", { cookie: cookieA })).json.active, false);
  });

  test("opiniones: se guardan, se listan, se borran de a una o todas, y cada cuenta ve solo las suyas", async () => {
    const mealDown = { scope: "meal", mealKey: "lunch", rating: "down", reasons: ["muy_caro", "se_repite"], mealText: "Salmón con espárragos", patientOnly: true, patientId: "p-a" };
    for (const body of [{ scope: "plan", rating: "up" }, mealDown, { scope: "meal", mealKey: "breakfast", rating: "up", mealText: "Mate con tostadas" }]) assert.equal((await http("POST", "/api/feedback", { cookie: cookieA, body })).status, 200);
    assert.equal((await http("POST", "/api/feedback", { cookie: cookieA, body: { scope: "meal", rating: "up" } })).status, 400);
    const list = (await http("GET", "/api/feedback", { cookie: cookieA })).json.items;
    assert.equal(list.length, 3);
    assert.equal(list[0].meal_text, "Mate con tostadas"); // la más nueva primero
    const down = list.find(item => item.rating === "down");
    assert.deepEqual(down.reasons, ["muy_caro", "se_repite"]); assert.equal(down.patient_ref, "p-a"); assert.match(down.id, /^\d+$/);
    assert.deepEqual((await http("GET", "/api/feedback", { cookie: cookieB })).json.items, []);
    assert.equal((await http("DELETE", `/api/feedback/${down.id}`, { cookie: cookieB })).status, 404); // no es de su cuenta
    assert.equal((await http("GET", "/api/feedback", { cookie: cookieA })).json.items.length, 3);
    for (const bad of ["abc", "1;DROP", "0", "99999999999"]) assert.equal((await http("DELETE", `/api/feedback/${bad}`, { cookie: cookieA })).status, 404, bad);
    assert.equal((await http("DELETE", `/api/feedback/${down.id}`, { cookie: cookieA })).status, 200);
    assert.equal((await http("DELETE", `/api/feedback/${down.id}`, { cookie: cookieA })).status, 404); // ya no existe
    assert.equal((await http("GET", "/api/feedback", { cookie: cookieA })).json.items.length, 2);
    await http("POST", "/api/feedback", { cookie: cookieB, body: { scope: "plan", rating: "down", reasons: ["otro"] } });
    const cleared = await http("DELETE", "/api/feedback/all", { cookie: cookieA });
    assert.equal(cleared.json.removed, 2);
    assert.deepEqual((await http("GET", "/api/feedback", { cookie: cookieA })).json.items, []);
    assert.equal((await http("GET", "/api/feedback", { cookie: cookieB })).json.items.length, 1); // lo de la otra cuenta sigue ahí
  });

  test("uso de la IA: resume por función y período, con errores recientes, solo de la propia cuenta", async () => {
    const insert = (client, kind, calls, ms, input, output, outcome, status, message, ago = "0 days") => client.query(
      "INSERT INTO ai_events (professional_id, kind, model, rules_version, calls, latency_ms, input_tokens, output_tokens, outcome, error_status, error_message, created_at) VALUES ('prof-a',$1,'m','r',$2,$3,$4,$5,$6,$7,$8, now() - $9::interval)",
      [kind, calls, ms, input, output, outcome, status, message, ago]);
    await asProfessional("prof-a", async client => {
      await insert(client, "ai_weekly_menu", 1, 20000, 5000, 4000, "ok", null, null);
      await insert(client, "ai_weekly_menu", 2, 40000, 10000, 8000, "ok", null, null);
      await insert(client, "ai_recipe", 1, 5000, 1000, 500, "error", 502, "La IA aplicó un límite temporal.");
      await insert(client, "ai_recipe", 1, 5000, 1000, 500, "ok", null, null, "40 days");
    });
    await asProfessional("prof-b", client => client.query("INSERT INTO ai_events (professional_id, kind, calls, latency_ms, outcome) VALUES ('prof-b','ai_recipe',1,1000,'ok')"));
    const month = (await http("GET", "/api/usage?days=30", { cookie: cookieA })).json;
    assert.equal(month.days, 30);
    assert.deepEqual(month.totals, { requests: 3, errors: 1, retries: 1, inputTokens: 16000, outputTokens: 12500, avgSeconds: 21.7 });
    assert.deepEqual(month.byKind.map(row => [row.label, row.requests]), [["Menú semanal", 2], ["Receta", 1]]);
    assert.equal(month.costUsd, null); assert.equal(month.pricesConfigured, false);
    assert.deepEqual(month.recentErrors.map(item => [item.label, item.status, item.message]), [["Receta", 502, "La IA aplicó un límite temporal."]]);
    assert.equal((await http("GET", "/api/usage?days=90", { cookie: cookieA })).json.totals.requests, 4); // incluye el de hace 40 días
    assert.equal((await http("GET", "/api/usage?days=7", { cookie: cookieA })).json.days, 7);
    assert.equal((await http("GET", "/api/usage?days=cualquiera", { cookie: cookieA })).json.days, 30);
    assert.equal((await http("GET", "/api/usage?days=30", { cookie: cookieB })).json.totals.requests, 1);
  });

  test("cambio de contraseña: valida lo actual y la longitud, y cierra las demás sesiones", async () => {
    const other = await login("beto@prueba.com", PASS_B);
    assert.equal((await http("POST", "/api/change-password", { cookie: cookieB, body: { currentPassword: "incorrecta", newPassword: "una-clave-nueva-larga-9" } })).status, 401);
    assert.equal((await http("POST", "/api/change-password", { cookie: cookieB, body: { currentPassword: PASS_B, newPassword: "corta" } })).status, 400);
    assert.equal((await http("POST", "/api/change-password", { cookie: cookieB, body: { currentPassword: PASS_B, newPassword: "una-clave-nueva-larga-9" } })).status, 200);
    assert.equal((await http("GET", "/api/status", { cookie: cookieB })).json.authenticated, true); // la sesión desde donde se cambió sigue
    assert.equal((await http("GET", "/api/status", { cookie: other })).json.authenticated, false); // las demás se cerraron
    assert.equal((await http("POST", "/api/login", { body: { email: "beto@prueba.com", password: "una-clave-nueva-larga-9" } })).status, 200);
  });

  // Estas dos van al final: bloquean intentos desde esta dirección por 15 minutos en el servidor de prueba.
  test("portal: tras 10 códigos incorrectos seguidos se bloquean los intentos", async () => {
    const statuses = [];
    for (let i = 0; i < 12; i++) statuses.push((await http("POST", "/api/portal/auth", { body: { code: `ZZZZZZZ${i % 10}` } })).status);
    // Otras pruebas ya sumaron algún intento fallido desde esta dirección, así que el bloqueo llega antes del décimo.
    const blockedAt = statuses.indexOf(429);
    assert.ok(blockedAt > 0 && blockedAt <= 10, `se bloqueó en el intento ${blockedAt + 1}`);
    assert.ok(statuses.slice(0, blockedAt).every(status => status === 401));
    assert.ok(statuses.slice(blockedAt).every(status => status === 429));
    assert.equal((await http("POST", "/api/portal/auth", { body: { code: portalCode } })).status, 429); // aunque el código sea el correcto
  });

  test("ingreso: tras 10 intentos fallidos seguidos se bloquea, incluso con la contraseña correcta", async () => {
    const statuses = [];
    for (let i = 0; i < 11; i++) statuses.push((await http("POST", "/api/login", { body: { email: `intruso${i}@prueba.com`, password: "incorrecta-1234" } })).status);
    assert.equal(statuses.filter(status => status === 401).length >= 6, true);
    assert.equal(statuses.at(-1), 429);
    assert.equal((await http("POST", "/api/login", { body: { email: "ana@prueba.com", password: PASS_A } })).status, 429);
  });
});
