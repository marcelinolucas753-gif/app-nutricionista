import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { pool, withProfessional, writeAudit } from "./db.mjs";
import { createEncryptedBackup, validateBackupKey, backupStatus } from "./backup.mjs";
import { fail, validatedDocument, validatePortalNote, validatePortalWeight } from "./validation.mjs";
import { measureAi, saveFeedback, validateFeedback } from "./ai-metrics.mjs";
import { createRecipe, generateShoppingList, generateWeeklyMenu, regenerateMeal, suggestSubstitutions, summarizeConsultations } from "./ai.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));
const rootPath = root.endsWith(sep) ? root.slice(0, -1) : root;
const port = Number(process.env.PORT || 4173);
const production = process.env.NODE_ENV === "production";
const scrypt = promisify(scryptCallback);
if (production && (!process.env.DATABASE_URL || !process.env.BACKUP_ENCRYPTION_KEY)) {
  throw new Error("En producción configurá DATABASE_URL y BACKUP_ENCRYPTION_KEY para proteger los respaldos.");
}
if (production) validateBackupKey();

const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg" };

// Solo estos archivos se publican. Todo lo demás (server.mjs, .env, migraciones,
// respaldos, package.json…) nunca se entrega, aunque esté en la misma carpeta.
const PUBLIC_FILES = new Set(["/index.html", "/portal.html", "/app.js", "/portal.js", "/styles.css", "/sw.js", "/manifest.webmanifest", "/icon.svg", "/icon-192.png", "/icon-512.png", "/nutrition.mjs", "/safety.mjs", "/contact.mjs", "/charts.mjs", "/features.css"]);
const PUBLIC_PREFIXES = ["/js/", "/recetas/"];
function isPublicPath(pathname) { return PUBLIC_FILES.has(pathname) || PUBLIC_PREFIXES.some(prefix => pathname.startsWith(prefix) && pathname.length > prefix.length); }

const rateBuckets = new Map();
function rateAllowed(key, limit, windowMs) {
  const now = Date.now();
  if (rateBuckets.size > 1000) for (const [bucketKey, bucket] of rateBuckets) if (bucket.expiresAt <= now) rateBuckets.delete(bucketKey);
  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.expiresAt <= now) { rateBuckets.set(key, { startedAt: now, expiresAt: now + windowMs, count: 1 }); return true; }
  if (bucket.count >= limit) return false;
  bucket.count += 1; return true;
}
function clientIp(req) { return req.socket.remoteAddress || "unknown"; }
function portalClientKey(req) { const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim(); return forwarded || req.socket.remoteAddress || "unknown"; }
function failuresBlocked(key, limit) { const bucket = rateBuckets.get(key); return Boolean(bucket && bucket.expiresAt > Date.now() && bucket.count >= limit); }
function recordFailure(key, windowMs) {
  const now = Date.now(); const bucket = rateBuckets.get(key);
  if (!bucket || bucket.expiresAt <= now) rateBuckets.set(key, { startedAt: now, expiresAt: now + windowMs, count: 1 }); else bucket.count += 1;
}
const PORTAL_WINDOW_MS = 15 * 60 * 1000;
const PORTAL_SESSION_DAYS = 30;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sin I, O, 0 ni 1 para evitar confusiones al dictarlo

function digest(token) { return createHash("sha256").update(token).digest("hex"); }
function newShortCode() { const bytes = randomBytes(8); let code = ""; for (const byte of bytes) code += CODE_ALPHABET[byte % CODE_ALPHABET.length]; return code; }
function sessionCookie(token, maxAge) { return `nutri_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${production ? "; Secure" : ""}`; }
function json(res, status, body, headers = {}) { res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...headers }); res.end(JSON.stringify(body)); }

async function readJson(req, maxBytes = 100_000) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (Buffer.byteLength(raw) > maxBytes) throw fail("La solicitud supera el tamaño permitido.", 413);
  }
  try { return JSON.parse(raw || "{}"); } catch { throw fail("No se pudo leer la solicitud.", 400); }
}

async function sessionFor(req) {
  const raw = (req.headers.cookie || "").split(";").map(part => part.trim()).find(part => part.startsWith("nutri_session="))?.slice("nutri_session=".length);
  if (!raw || !process.env.DATABASE_URL) return null;
  try {
    const result = await pool.query("SELECT p.id,p.display_name,p.email,s.token_hash FROM app_sessions s JOIN professionals p ON p.id=s.professional_id WHERE s.token_hash=$1 AND s.expires_at>now() AND p.active=true", [digest(raw)]);
    return result.rows[0] || null;
  } catch { return null; }
}
async function requireSession(req, res) {
  const user = await sessionFor(req);
  if (!user) { json(res, 401, { error: "Iniciá sesión con tu cuenta profesional." }); return null; }
  return user;
}

async function loadPatient(professionalId, patientId) {
  if (typeof patientId !== "string" || !patientId || patientId.length > 120) throw fail("No encontramos esa ficha.", 404);
  return withProfessional(professionalId, async client => {
    const result = await client.query("SELECT document FROM professional_data WHERE professional_id=$1", [professionalId]);
    return result.rows[0]?.document?.patients?.find(patient => patient.id === patientId) || null;
  });
}
function requireAiConsent(patient) {
  if (!patient) throw fail("No encontramos esa ficha.", 404);
  if (!patient.consentedAt || patient.consentVersion !== 3) throw fail("Esta ficha necesita volver a registrar la autorización para usar IA.", 403);
}

// ---- Portal del paciente ----
async function portalSessionFor(req) {
  const header = String(req.headers.authorization || "");
  const raw = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!raw || raw.length > 200) return null;
  const result = await pool.query("SELECT a.id, a.professional_id, a.patient_id FROM patient_sessions s JOIN patient_access_tokens a ON a.id=s.access_token_id WHERE s.token_hash=$1 AND s.expires_at>now() AND a.active=true", [digest(raw)]);
  return result.rows[0] ? { accessId: result.rows[0].id, professionalId: result.rows[0].professional_id, patientId: result.rows[0].patient_id, tokenHash: digest(raw) } : null;
}
async function requirePortalSession(req) {
  const access = await portalSessionFor(req);
  if (!access) throw fail("Tu sesión venció o el acceso fue revocado. Ingresá de nuevo con tu código.", 401);
  return access;
}

async function handle(req, res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Security-Policy", "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; object-src 'none'; img-src 'self' data:; font-src 'self' https://fonts.gstatic.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; script-src 'self'; connect-src 'self'");
  if (production) res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  const pathname = new URL(req.url, "http://localhost").pathname;

  if (pathname === "/api/health" && req.method === "GET") {
    try { if (!process.env.DATABASE_URL) throw new Error("database not configured"); await pool.query("SELECT 1"); json(res, 200, { ok: true, storage: "ready" }); }
    catch { json(res, 503, { ok: false, storage: "unavailable" }); }
    return;
  }
  if (pathname === "/api/status" && req.method === "GET") {
    const user = await sessionFor(req);
    let storageReady = false; try { if (process.env.DATABASE_URL) { await pool.query("SELECT 1"); storageReady = true; } } catch { /* no detail exposed */ }
    json(res, 200, { passwordRequired: true, authenticated: Boolean(user), professional: user ? { id: user.id, name: user.display_name } : null, storageReady, aiConfigured: Boolean(process.env.OPENAI_API_KEY), backup: user ? await backupStatus() : null }); return;
  }
  if (pathname === "/api/login" && req.method === "POST") {
    try {
      if (!process.env.DATABASE_URL) throw fail("Falta configurar la base de datos compartida en el servidor.", 503);
      if (!rateAllowed(`login:${clientIp(req)}`, 10, 15 * 60 * 1000)) throw fail("Demasiados intentos. Esperá 15 minutos y volvé a intentar.", 429);
      const body = await readJson(req, 4000); const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : ""; const password = typeof body.password === "string" ? body.password : "";
      if (!email || !password || password.length > 200) throw fail("El correo o la contraseña no coinciden.", 401);
      const result = await pool.query("SELECT id,display_name,email,password_salt,password_hash FROM professionals WHERE email=$1 AND active=true", [email]);
      const account = result.rows[0];
      const supplied = account ? await scrypt(password, account.password_salt, 64) : randomBytes(64);
      const expected = Buffer.from(account?.password_hash || "", "hex");
      const valid = account && expected.length === supplied.length && timingSafeEqual(expected, supplied);
      if (!valid) { await writeAudit(null, "login", "denied").catch(() => {}); throw fail("El correo o la contraseña no coinciden.", 401); }
      const token = randomBytes(32).toString("base64url"); const tokenHash = digest(token);
      await pool.query("DELETE FROM app_sessions WHERE expires_at<=now()");
      await pool.query("INSERT INTO app_sessions (token_hash,professional_id,expires_at) VALUES ($1,$2,now()+interval '12 hours')", [tokenHash, account.id]);
      await writeAudit(account.id, "login", "success");
      json(res, 200, { ok: true, professional: { id: account.id, name: account.display_name } }, { "Set-Cookie": sessionCookie(token, 43200) });
    } catch (error) { json(res, error.status || 503, { error: error.status ? error.message : "No se pudo iniciar sesión. Verificá que la base esté disponible." }); }
    return;
  }
  if (pathname === "/api/logout" && req.method === "POST") {
    const user = await sessionFor(req);
    if (user) { await pool.query("DELETE FROM app_sessions WHERE token_hash=$1", [user.token_hash]).catch(() => {}); await writeAudit(user.id, "logout", "success").catch(() => {}); }
    json(res, 200, { ok: true }, { "Set-Cookie": sessionCookie("", 0) }); return;
  }
  if (pathname === "/api/change-password" && req.method === "POST") {
    const user = await requireSession(req, res); if (!user) return;
    try {
      if (!rateAllowed(`pwd:${user.id}`, 10, 15 * 60 * 1000)) throw fail("Demasiados intentos. Esperá unos minutos y volvé a intentar.", 429);
      const body = await readJson(req, 4000); if (typeof body.currentPassword !== "string" || typeof body.newPassword !== "string" || body.newPassword.length < 12 || body.newPassword.length > 200) throw fail("La contraseña nueva debe tener entre 12 y 200 caracteres.");
      const account = (await pool.query("SELECT password_salt,password_hash FROM professionals WHERE id=$1", [user.id])).rows[0];
      const supplied = await scrypt(body.currentPassword, account.password_salt, 64); const expected = Buffer.from(account.password_hash, "hex");
      if (!timingSafeEqual(expected, supplied)) throw fail("La contraseña actual no coincide.", 401);
      const salt = randomBytes(16).toString("hex"); const hash = (await scrypt(body.newPassword, salt, 64)).toString("hex");
      await pool.query("UPDATE professionals SET password_salt=$2,password_hash=$3,password_changed_at=now() WHERE id=$1", [user.id, salt, hash]);
      await pool.query("DELETE FROM app_sessions WHERE professional_id=$1 AND token_hash<>$2", [user.id, user.token_hash]); await writeAudit(user.id, "password_change", "success");
      json(res, 200, { ok: true });
    } catch (error) { json(res, error.status || 500, { error: error.message || "No se pudo cambiar la contraseña." }); }
    return;
  }
  if (pathname === "/api/data/version" && req.method === "GET") {
    const user = await requireSession(req, res); if (!user) return;
    try {
      const result = await withProfessional(user.id, client => client.query("SELECT version FROM professional_data WHERE professional_id=$1", [user.id]));
      json(res, 200, { version: Number(result.rows[0]?.version || 0) });
    } catch { json(res, 503, { error: "No se pudo comprobar si hay cambios en otros dispositivos." }); }
    return;
  }
  if (pathname === "/api/data" && req.method === "GET") {
    const user = await requireSession(req, res); if (!user) return;
    try {
      const result = await withProfessional(user.id, async client => {
        const stored = await client.query("SELECT document,version,updated_at FROM professional_data WHERE professional_id=$1", [user.id]);
        const submissions = await client.query(`
          SELECT s.id, t.patient_id, s.type, s.data, s.created_at
          FROM patient_submissions s
          JOIN patient_access_tokens t ON s.access_token_id = t.id
          WHERE t.professional_id = $1
          ORDER BY s.created_at DESC
          LIMIT 2000
        `, [user.id]);
        return { data: stored.rows[0], submissions: submissions.rows };
      });
      const row = result.data;
      const document = row?.document || {};
      document.patients = Array.isArray(document.patients) ? document.patients : [];
      document.appointments = Array.isArray(document.appointments) ? document.appointments : [];
      document.templates = Array.isArray(document.templates) ? document.templates : [];
      const byId = new Map(document.patients.map(patient => [patient.id, patient]));
      for (const patient of document.patients) patient.submissions = [];
      for (const submission of result.submissions) {
        const patient = byId.get(submission.patient_id);
        if (patient) patient.submissions.push({ id: submission.id, type: submission.type, data: submission.data, createdAt: submission.created_at });
      }
      json(res, 200, { ...document, version: Number(row?.version || 0), updatedAt: row?.updated_at || null });
    } catch { json(res, 503, { error: "No se pudo cargar la base de datos de tu cuenta." }); }
    return;
  }
  if (pathname === "/api/data" && req.method === "PUT") {
    const user = await requireSession(req, res); if (!user) return;
    try {
      const body = await readJson(req, 20_000_000); const document = validatedDocument(body); const expectedVersion = Number(body.version);
      if (!Number.isInteger(expectedVersion) || expectedVersion < 0) throw fail("La versión de los datos no es válida.");
      const outcome = await withProfessional(user.id, async client => {
        await client.query("INSERT INTO professional_data (professional_id,document,version) VALUES ($1,'{\"patients\":[],\"appointments\":[],\"templates\":[]}'::jsonb,0) ON CONFLICT (professional_id) DO NOTHING", [user.id]);
        const result = await client.query("SELECT version FROM professional_data WHERE professional_id=$1 FOR UPDATE", [user.id]); const current = Number(result.rows[0]?.version || 0);
        if (current !== expectedVersion) return { conflict: true, version: current };
        const next = current + 1;
        await client.query("UPDATE professional_data SET document=$2::jsonb,version=$3,updated_at=now() WHERE professional_id=$1", [user.id, JSON.stringify(document), next]);
        await client.query("INSERT INTO audit_events (professional_id,action,result) VALUES ($1,'data_save','success')", [user.id]);
        return { conflict: false, version: next };
      });
      if (outcome.conflict) { json(res, 409, { error: "Esta ficha cambió desde otro dispositivo. Recargá para ver la versión más reciente; no se sobrescribió.", version: outcome.version }); return; }
      json(res, 200, { ok: true, version: outcome.version });
    } catch (error) { json(res, error.status || 500, { error: error.message || "No se pudieron guardar los datos." }); }
    return;
  }
  if (pathname === "/api/generate-menu" && req.method === "POST") {
    const user = await requireSession(req, res); if (!user) return;
    if (!rateAllowed(`menu:${user.id}`, 20, 60 * 60 * 1000)) { json(res, 429, { error: "Se alcanzó el límite temporal de generaciones. Volvé a intentar más tarde." }); return; }
    try {
      const request = await readJson(req, 20_000); const patient = await loadPatient(user.id, request.patientId); requireAiConsent(patient);
      if (!Number.isFinite(Number(patient.age)) || !patient.condition || !patient.goal) throw fail("Faltan datos necesarios para proponer el menú.");
      const output = await measureAi("ai_weekly_menu", user.id, () => generateWeeklyMenu(patient));
      await writeAudit(user.id, "ai_weekly_menu", "success").catch(() => {}); json(res, 200, output);
    } catch (error) { json(res, error.status || 500, { error: error.message || "No se pudo generar el menú." }); }
    return;
  }
  if (pathname === "/api/feedback" && req.method === "POST") {
    const user = await requireSession(req, res); if (!user) return;
    if (!rateAllowed(`feedback:${user.id}`, 200, 60 * 60 * 1000)) { json(res, 429, { error: "Se alcanzó el límite temporal de opiniones. Volvé a intentar más tarde." }); return; }
    try { await saveFeedback(user.id, validateFeedback(await readJson(req, 4_000))); json(res, 200, { ok: true }); }
    catch (error) { json(res, error.status || 500, { error: error.status ? error.message : "No se pudo guardar tu opinión." }); }
    return;
  }
  if (pathname.startsWith("/api/ai/") && req.method === "POST") {
    const user = await requireSession(req, res); if (!user) return;
    if (!rateAllowed(`ai:${user.id}`, 60, 60 * 60 * 1000)) { json(res, 429, { error: "Se alcanzó el límite temporal de asistencia. Volvé a intentar más tarde." }); return; }
    try {
      const body = await readJson(req, 40_000); const patient = await loadPatient(user.id, body.patientId); requireAiConsent(patient);
      let result; let action;
      if (pathname === "/api/ai/consultation-summary") { action = "ai_consultation_summary"; result = await measureAi(action, user.id, () => summarizeConsultations(patient)); }
      else if (pathname === "/api/ai/regenerate-meal") { action = "ai_meal_replacement"; result = await measureAi(action, user.id, () => regenerateMeal(patient, { dayIndex: Number(body.dayIndex), mealKey: body.mealKey, instruction: typeof body.instruction === "string" ? body.instruction.trim().slice(0, 500) : "" })); }
      else if (pathname === "/api/ai/recipe") { action = "ai_recipe"; result = await measureAi(action, user.id, () => createRecipe(patient, { meal: typeof body.meal === "string" ? body.meal.trim().slice(0, 1000) : "", portions: body.portions })); }
      else if (pathname === "/api/ai/substitutions") { action = "ai_substitution_ideas"; result = await measureAi(action, user.id, () => suggestSubstitutions(patient, { meal: typeof body.meal === "string" ? body.meal.trim().slice(0, 1000) : "", ingredient: typeof body.ingredient === "string" ? body.ingredient.trim().slice(0, 160) : "" })); }
      else if (pathname === "/api/ai/shopping-list") { action = "ai_shopping_list"; result = await measureAi(action, user.id, () => generateShoppingList(patient, body.days)); }
      else throw fail("No encontramos esa función de IA.", 404);
      await writeAudit(user.id, action, "success").catch(() => {});
      json(res, 200, result);
    } catch (error) { json(res, error.status || 500, { error: error.message || "No se pudo completar la propuesta." }); }
    return;
  }

  // ---- Acceso de pacientes (lado profesional) ----
  if (pathname === "/api/patient-access" && req.method === "POST") {
    const user = await requireSession(req, res); if (!user) return;
    try {
      const body = await readJson(req, 4000); const patientId = typeof body.patientId === "string" ? body.patientId : "";
      if (!await loadPatient(user.id, patientId)) throw fail("No encontramos esa ficha. Guardá la ficha antes de generar el acceso.", 404);
      const token = randomBytes(32).toString("base64url"); const tokenHash = digest(token);
      let shortCode = "";
      for (let attempt = 0; attempt < 6; attempt++) {
        shortCode = newShortCode();
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          // Un solo acceso vigente por persona: el anterior deja de funcionar.
          await client.query("UPDATE patient_access_tokens SET active=false, revoked_at=now() WHERE professional_id=$1 AND patient_id=$2 AND active=true", [user.id, patientId]);
          await client.query("INSERT INTO patient_access_tokens (professional_id, patient_id, token_hash, short_code) VALUES ($1, $2, $3, $4)", [user.id, patientId, tokenHash, shortCode]);
          await client.query("COMMIT");
          break;
        } catch (error) {
          try { await client.query("ROLLBACK"); } catch { /* conservar el error original */ }
          if (error.code !== "23505" || attempt === 5) throw error;
        } finally { client.release(); }
      }
      await writeAudit(user.id, "portal_access_create", "success").catch(() => {});
      json(res, 200, { ok: true, token, shortCode });
    } catch (error) { json(res, error.status || 500, { error: error.message || "No se pudo generar el acceso." }); }
    return;
  }
  if (pathname.startsWith("/api/patient-access/") && req.method === "GET") {
    const user = await requireSession(req, res); if (!user) return;
    try {
      const patientId = decodeURIComponent(pathname.split("/").pop());
      const result = await pool.query("SELECT short_code, created_at FROM patient_access_tokens WHERE professional_id=$1 AND patient_id=$2 AND active=true AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1", [user.id, patientId]);
      if (!result.rows.length) json(res, 200, { active: false });
      else json(res, 200, { active: true, shortCode: result.rows[0].short_code, createdAt: result.rows[0].created_at });
    } catch { json(res, 500, { error: "No se pudo obtener el acceso." }); }
    return;
  }
  if (pathname.startsWith("/api/patient-access/") && req.method === "DELETE") {
    const user = await requireSession(req, res); if (!user) return;
    try {
      const patientId = decodeURIComponent(pathname.split("/").pop());
      await pool.query("UPDATE patient_access_tokens SET active=false, revoked_at=now() WHERE professional_id=$1 AND patient_id=$2 AND active=true", [user.id, patientId]);
      await writeAudit(user.id, "portal_access_revoke", "success").catch(() => {});
      json(res, 200, { ok: true });
    } catch { json(res, 500, { error: "No se pudo revocar el acceso." }); }
    return;
  }

  // ---- Portal del paciente (lado paciente) ----
  if (pathname === "/api/portal/auth" && req.method === "POST") {
    try {
      const body = await readJson(req, 2000);
      const linkToken = typeof body.token === "string" ? body.token.trim() : "";
      const code = typeof body.code === "string" ? body.code.toUpperCase().replace(/[^A-Z0-9]/g, "") : "";
      const ipKey = `portal-fail:${portalClientKey(req)}`; const globalKey = "portal-fail:all";
      let access;
      if (linkToken) {
        // El enlace largo no se puede adivinar, así que solo limita por IP.
        if (linkToken.length > 100) throw fail("El enlace no es válido o fue revocado.", 401);
        if (failuresBlocked(ipKey, 20)) throw fail("Demasiados intentos. Esperá 15 minutos y volvé a intentar.", 429);
        access = (await pool.query("SELECT id FROM patient_access_tokens WHERE token_hash=$1 AND active=true", [digest(linkToken)])).rows[0];
        if (!access) { recordFailure(ipKey, PORTAL_WINDOW_MS); throw fail("El enlace no es válido o fue revocado. Pedile uno nuevo a tu profesional.", 401); }
      } else {
        if (failuresBlocked(ipKey, 10) || failuresBlocked(globalKey, 100)) throw fail("Demasiados intentos con códigos incorrectos. Esperá 15 minutos y volvé a intentar.", 429);
        if (!code || code.length > 20) throw fail("Código no válido.", 401);
        access = (await pool.query("SELECT id FROM patient_access_tokens WHERE short_code=$1 AND active=true", [code])).rows[0];
        if (!access) { recordFailure(ipKey, PORTAL_WINDOW_MS); recordFailure(globalKey, PORTAL_WINDOW_MS); throw fail("El código no es válido o fue revocado.", 401); }
      }
      const session = randomBytes(32).toString("base64url");
      await pool.query("DELETE FROM patient_sessions WHERE expires_at<=now()");
      await pool.query(`INSERT INTO patient_sessions (token_hash, access_token_id, expires_at) VALUES ($1,$2,now() + interval '${PORTAL_SESSION_DAYS} days')`, [digest(session), access.id]);
      await pool.query("UPDATE patient_access_tokens SET last_used_at=now() WHERE id=$1", [access.id]);
      json(res, 200, { ok: true, token: session });
    } catch (error) { json(res, error.status || 500, { error: error.status ? error.message : "No se pudo acceder." }); }
    return;
  }
  if (pathname === "/api/portal/logout" && req.method === "POST") {
    try { const access = await portalSessionFor(req); if (access) await pool.query("DELETE FROM patient_sessions WHERE token_hash=$1", [access.tokenHash]); } catch { /* cerrar sesión nunca falla para la persona */ }
    json(res, 200, { ok: true }); return;
  }
  if (pathname === "/api/portal/data" && req.method === "GET") {
    try {
      const access = await requirePortalSession(req);
      const { professionalId, patientId } = access;
      const dataResult = await withProfessional(professionalId, client => client.query("SELECT document FROM professional_data WHERE professional_id=$1", [professionalId]));
      const profResult = await pool.query("SELECT display_name FROM professionals WHERE id=$1", [professionalId]);
      const document = dataResult.rows[0]?.document;
      const patient = document?.patients?.find(item => item.id === patientId);
      if (!patient) throw fail("Paciente no encontrado", 404);
      const now = new Date();
      const nextAppointment = (document.appointments || []).filter(item => item.patientId === patientId && new Date(item.start) >= now && !["cancelled", "noShow", "completed"].includes(item.status)).sort((a, b) => a.start.localeCompare(b.start))[0] || null;
      const handled = new Set(Array.isArray(patient.handledSubmissions) ? patient.handledSubmissions : []);
      const sent = await pool.query("SELECT s.id, s.data FROM patient_submissions s JOIN patient_access_tokens t ON t.id=s.access_token_id WHERE t.professional_id=$1 AND t.patient_id=$2 AND s.type='weight' ORDER BY s.created_at DESC LIMIT 30", [professionalId, patientId]);
      json(res, 200, {
        professionalName: profResult.rows[0]?.display_name,
        patientName: patient.name,
        draft: patient.approvedAt ? patient.draft : null,
        consultations: (patient.consultations || []).map(item => ({ date: item.date })).sort((a, b) => String(b.date).localeCompare(String(a.date))),
        measurements: (patient.measurements || []).map(item => ({ date: item.date, weight: item.weight, height: item.height })).sort((a, b) => String(b.date).localeCompare(String(a.date))),
        pendingWeights: sent.rows.filter(row => !handled.has(row.id) && row.data?.weight).map(row => ({ date: row.data.date, weight: row.data.weight })),
        recipes: patient.approvedAt ? (patient.recipes || []) : [],
        shoppingList: patient.approvedAt ? (patient.shoppingList || null) : null,
        goals: (patient.goals || []).filter(goal => goal.visibleToPatient === true).map(goal => ({ text: goal.text, targetDate: goal.targetDate || "", status: goal.status })),
        nextAppointment: nextAppointment ? nextAppointment.start : null
      });
    } catch (error) { json(res, error.status || 500, { error: error.status ? error.message : "No se pudo cargar los datos." }); }
    return;
  }
  if ((pathname === "/api/portal/weight" || pathname === "/api/portal/note") && req.method === "POST") {
    try {
      const access = await requirePortalSession(req);
      if (!rateAllowed(`portal-submit:${access.accessId}`, 30, 60 * 60 * 1000)) throw fail("Enviaste muchos datos en poco tiempo. Probá de nuevo más tarde.", 429);
      const body = await readJson(req, 6000);
      const isWeight = pathname.endsWith("weight");
      const data = isWeight ? validatePortalWeight(body) : validatePortalNote(body);
      await pool.query("INSERT INTO patient_submissions (access_token_id, type, data) VALUES ($1, $2, $3::jsonb)", [access.accessId, isWeight ? "weight" : "note", JSON.stringify(data)]);
      json(res, 200, { ok: true });
    } catch (error) { json(res, error.status || 500, { error: error.status ? error.message : "No se pudo guardar." }); }
    return;
  }

  // La página del portal se sirve para /portal y /portal/<enlace>.
  if (req.method === "GET" && (pathname === "/portal" || pathname.startsWith("/portal/"))) {
    try {
      const data = await readFile(normalize(join(root, "portal.html")));
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(data);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("No encontramos ese archivo.");
    }
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405); res.end(); return; }
  let staticPath; try { staticPath = decodeURIComponent(pathname); } catch { res.writeHead(400); res.end(); return; }
  if (staticPath === "/") staticPath = "/index.html";
  if (!isPublicPath(staticPath) || !types[extname(staticPath)]) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); res.end("No encontramos ese archivo."); return; }
  const file = normalize(join(root, staticPath));
  if (file !== rootPath && !file.startsWith(rootPath + sep)) { res.writeHead(403); res.end(); return; }
  try { const data = await readFile(file); res.writeHead(200, { "Content-Type": types[extname(file)] || "application/octet-stream" }); res.end(req.method === "HEAD" ? undefined : data); }
  catch { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); res.end("No encontramos ese archivo."); }
}

const server = createServer((req, res) => {
  handle(req, res).catch(error => {
    console.error(`Error no controlado en ${req.method} ${String(req.url).split("?")[0]}: ${error?.message || error}`);
    if (!res.headersSent) json(res, 500, { error: "Ocurrió un error inesperado. Volvé a intentar." }); else res.end();
  });
});

server.listen(port, process.env.HOST || (production ? "0.0.0.0" : "127.0.0.1"), () => {
  console.log(`Nutri Guía está lista en http://localhost:${port}`);
  if (process.env.DATABASE_URL && process.env.BACKUP_ENCRYPTION_KEY) {
    if (production && !process.env.BACKUP_DIR) console.warn("Aviso: BACKUP_DIR no está configurado. Los respaldos se guardan dentro de la aplicación y pueden perderse al reiniciar o actualizar el servicio. Configurá un disco persistente (ver README).");
    const backup = async () => { try { const name = await createEncryptedBackup(); console.log(`Respaldo cifrado completado: ${name}`); } catch (error) { console.error(`No se pudo completar el respaldo cifrado: ${error.message}`); } };
    backup(); setInterval(backup, 24 * 60 * 60 * 1000).unref();
  }
});
