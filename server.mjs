import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { pool, withProfessional, writeAudit } from "./db.mjs";
import { calculatePatientRequirements, derivePortionGuidance } from "./nutrition.mjs";
import { createEncryptedBackup, validateBackupKey } from "./backup.mjs";

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
const rateBuckets = new Map();
const mealKeys = ["breakfast", "snack1", "lunch", "snack2", "merienda", "dinner"];

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
function digest(token) { return createHash("sha256").update(token).digest("hex"); }
function sessionCookie(token, maxAge) { return `nutri_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${production ? "; Secure" : ""}`; }
function json(res, status, body, headers = {}) { res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...headers }); res.end(JSON.stringify(body)); }
function fail(message, status = 400) { return Object.assign(new Error(message), { status }); }

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

function validatedDocument(body) {
  if (!body || !Array.isArray(body.patients) || !Array.isArray(body.appointments) || body.patients.length > 10000 || body.appointments.length > 50000) throw fail("El respaldo no tiene un formato válido.");
  const patientIds = new Set();
  for (const patient of body.patients) {
    if (!patient || typeof patient !== "object" || Array.isArray(patient) || typeof patient.id !== "string" || !patient.id || patient.id.length > 120 || typeof patient.name !== "string" || patient.name.length > 80 || !Number.isFinite(Number(patient.age))) throw fail("Una ficha no tiene los campos básicos esperados.");
    if (patientIds.has(patient.id)) throw fail("Hay fichas repetidas en el envío.");
    patientIds.add(patient.id);
  }
  const appointmentIds = new Set();
  for (const item of body.appointments) {
    if (!item || typeof item !== "object" || Array.isArray(item) || typeof item.id !== "string" || !item.id || item.id.length > 120 || typeof item.patientId !== "string" || !patientIds.has(item.patientId) || typeof item.start !== "string" || !Number.isFinite(Date.parse(item.start)) || !Number.isFinite(Number(item.duration)) || Number(item.duration) < 10 || Number(item.duration) > 240) throw fail("Un turno no está vinculado a una ficha válida o tiene datos incorrectos.");
    if (appointmentIds.has(item.id)) throw fail("Hay turnos repetidos en el envío.");
    appointmentIds.add(item.id);
  }
  return { patients: body.patients, appointments: body.appointments };
}

async function loadPatientForAI(professionalId, patientId) {
  if (typeof patientId !== "string" || patientId.length > 120) throw fail("No encontramos esa ficha.", 404);
  return withProfessional(professionalId, async client => {
    const result = await client.query("SELECT document FROM professional_data WHERE professional_id=$1", [professionalId]);
    return result.rows[0]?.document?.patients?.find(patient => patient.id === patientId) || null;
  });
}
function requireAiConsent(patient) {
  if (!patient) throw fail("No encontramos esa ficha.", 404);
  if (!patient.consentedAt || patient.consentVersion !== 3) throw fail("Esta ficha necesita volver a registrar la autorización para usar IA.", 403);
}
function hasExactNutritionAmounts(value) { return /\b(?:\d+[.,]?\d*\s*(?:kcal|calorías?|g|gr|gramos?|mg|ml|mililitros?)|\d+\s*%)\b/i.test(value); }

const weeklySchema = {
  type: "object", additionalProperties: false, required: ["intro", "days", "recommendations", "reviewNotes"],
  properties: {
    intro: { type: "string" },
    days: { type: "array", minItems: 7, maxItems: 7, items: { type: "object", additionalProperties: false, required: ["day", "breakfast", "snack1", "lunch", "snack2", "merienda", "dinner", "extra"], properties: { day: { type: "string" }, breakfast: { type: "string" }, snack1: { type: "string" }, lunch: { type: "string" }, snack2: { type: "string" }, merienda: { type: "string" }, dinner: { type: "string" }, extra: { type: "string" } } } },
    recommendations: { type: "array", minItems: 3, maxItems: 6, items: { type: "string" } },
    reviewNotes: { type: "array", minItems: 1, maxItems: 5, items: { type: "string" } }
  }
};
const consultationSchema = { type: "object", additionalProperties: false, required: ["summary", "questions"], properties: { summary: { type: "string" }, questions: { type: "array", minItems: 3, maxItems: 6, items: { type: "string" } } } };
const mealSchema = { type: "object", additionalProperties: false, required: ["meal", "reviewNote"], properties: { meal: { type: "string" }, reviewNote: { type: "string" } } };
const recipeSchema = {
  type: "object", additionalProperties: false, required: ["name", "portions", "ingredients", "steps", "timeMinutes", "difficulty", "reviewNote"],
  properties: {
    name: { type: "string" }, portions: { type: "string" },
    ingredients: { type: "array", minItems: 2, maxItems: 14, items: { type: "object", additionalProperties: false, required: ["quantity", "measure", "ingredient"], properties: { quantity: { type: "string" }, measure: { type: "string" }, ingredient: { type: "string" } } } },
    steps: { type: "array", minItems: 2, maxItems: 10, items: { type: "string" } }, timeMinutes: { type: "integer", minimum: 5, maximum: 240 }, difficulty: { type: "string", enum: ["Fácil", "Media", "Avanzada"] }, reviewNote: { type: "string" }
  }
};
const substitutesSchema = { type: "object", additionalProperties: false, required: ["options", "reviewNote"], properties: { options: { type: "array", minItems: 3, maxItems: 5, items: { type: "object", additionalProperties: false, required: ["name", "idea"], properties: { name: { type: "string" }, idea: { type: "string" } } } }, reviewNote: { type: "string" } } };

async function callOpenAI({ name, schema, instructions, input }) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw fail("Falta configurar la clave de OpenAI en el servidor.", 503);
  let response;
  try {
    response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST", headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" }, signal: AbortSignal.timeout(60_000),
      body: JSON.stringify({ model: process.env.OPENAI_MODEL || "gpt-6-luna", instructions, input: JSON.stringify(input), text: { format: { type: "json_schema", name, strict: true, schema } } })
    });
  } catch (error) { throw fail(error?.name === "TimeoutError" ? "La solicitud de IA tardó demasiado. Volvé a intentar." : "No se pudo conectar con la IA. Revisá la conexión y volvé a intentar.", 502); }
  let payload; try { payload = await response.json(); } catch { throw fail("La IA devolvió una respuesta que no se pudo leer.", 502); }
  if (!response.ok) {
    const code = payload?.error?.code || payload?.error?.type || "";
    if (response.status === 401 || code === "invalid_api_key") throw fail("La clave de IA configurada no fue aceptada.", 502);
    if (response.status === 429) throw fail("La IA aplicó un límite temporal o de uso. Volvé a intentar más tarde.", 502);
    if (code === "insufficient_quota" || code === "billing_hard_limit_reached") throw fail("La cuenta de IA alcanzó su límite de facturación.", 502);
    throw fail(`El servicio de IA respondió con un error (${response.status}).`, 502);
  }
  const outputText = Array.isArray(payload?.output) ? payload.output.flatMap(item => Array.isArray(item?.content) ? item.content : []).filter(item => item?.type === "output_text" && typeof item.text === "string").map(item => item.text).join("") : "";
  if (payload?.status !== "completed" || !outputText) throw fail("La IA no completó una respuesta con el formato esperado. Volvé a intentar.", 502);
  let value; try { value = JSON.parse(outputText); } catch { throw fail("La IA devolvió un formato incorrecto. No se guardó nada; volvé a intentar.", 502); }
  return value;
}

async function generateMenu(profile) {
  const portionGuidance = profile.requirements ? derivePortionGuidance(profile.requirements) : null;
  const safeProfile = {
    age: Number(profile.age), condition: profile.condition, goal: profile.goal, budget: profile.budget,
    likes: profile.likes, avoids: profile.avoids, schedule: profile.schedule, context: profile.context,
    requirements: profile.requirements ? { dailyEnergyKcal: profile.requirements.dailyEnergyKcal, macroDistribution: profile.requirements.macroDistribution } : null,
    portionGuidance
  };
  return callOpenAI({ name: "weekly_meal_draft", schema: weeklySchema,
    instructions: "Sos un asistente para un estudiante avanzado de nutrición. Redactás borradores educativos para revisión profesional; no diagnostiques ni inventes información clínica. Usa alimentos cotidianos, económicos según presupuesto, y medidas caseras fáciles de entender (taza, rodaja, unidad, cucharada, plato o tamaño de la palma). No indiques gramos por alimento ni calorías o porcentajes de macros en el menú. Si input contiene portionGuidance, usá el campo perSlot (una entrada por breakfast, snack1, lunch, snack2, merienda, dinner) como regla OBLIGATORIA de tamaño de porción para esa comida: el campo hint de cada entrada ya describe, en medidas caseras, qué tan grande debe ser esa comida; elegí alimentos reales que encajen en ese tamaño, sin repetir los números de approxShareKcal ni mencionar la palabra kcal o calorías en el texto. Si portionGuidance incluye proteinEmphasis, aplicá esa indicación en las comidas principales. Si no hay requirements ni portionGuidance, usá porciones moderadas estándar y decilo en reviewNotes. No prometas precisión ni cambies mantenimiento por déficit/superávit. Respetá las alergias, alimentos evitados, preferencias y horarios que efectivamente se indiquen en la ficha. No agregues exclusiones alimentarias que no estén indicadas. Para una alimentación vegetariana, respetá la preferencia si está expresada. No afirmes que un producto está libre de contaminación cruzada; recordá revisar etiqueta y manipulación cuando corresponda. Para diabetes tipo 2 e hipertensión, da recomendaciones generales prudentes sin ajustar medicamentos. Si falta información necesaria, dilo en reviewNotes. En español rioplatense. Cada día incluye desayuno (breakfast), colación matutina (snack1), almuerzo (lunch), colación vespertina (snack2), merienda (merienda), cena (dinner) y extra con una alternativa opcional. Las notas de revisión recuerdan validar alergias, medicación y adecuación individual.", input: safeProfile });
}

const server = createServer(async (req, res) => {
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
    json(res, 200, { passwordRequired: true, authenticated: Boolean(user), professional: user ? { id: user.id, name: user.display_name } : null, storageReady, aiConfigured: Boolean(process.env.OPENAI_API_KEY) }); return;
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
         const r1 = await client.query("SELECT document,version,updated_at FROM professional_data WHERE professional_id=$1", [user.id]);
         const r2 = await client.query(`
           SELECT t.patient_id, s.type, s.data, s.created_at
           FROM patient_submissions s
           JOIN patient_access_tokens t ON s.access_token_id = t.id
           WHERE t.professional_id = $1
           ORDER BY s.created_at DESC
         `, [user.id]);
         return { data: r1.rows[0], submissions: r2.rows };
      });
      const row = result.data;
      const document = row?.document || { patients: [], appointments: [] };
      for (const sub of result.submissions) {
        const patient = document.patients.find(p => p.id === sub.patient_id);
        if (patient) {
          patient.submissions = patient.submissions || [];
          patient.submissions.push({
            type: sub.type,
            data: sub.data,
            createdAt: sub.created_at
          });
        }
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
        await client.query("INSERT INTO professional_data (professional_id,document,version) VALUES ($1,'{\"patients\":[],\"appointments\":[]}'::jsonb,0) ON CONFLICT (professional_id) DO NOTHING", [user.id]);
        const result = await client.query("SELECT version FROM professional_data WHERE professional_id=$1 FOR UPDATE", [user.id]); const current = Number(result.rows[0]?.version || 0);
        if (current !== expectedVersion) return { conflict: true, version: current };
        const next = current + 1;
        await client.query("UPDATE professional_data SET document=$2::jsonb,version=$3,updated_at=now() WHERE professional_id=$1", [user.id, JSON.stringify(document), next]);
        await client.query("INSERT INTO audit_events (professional_id,action,result) VALUES ($1,'data_save','success')", [user.id]);
        return { conflict: false, version: next };
      });
      if (outcome.conflict) { json(res, 409, { error: "Esta ficha cambió desde otro dispositivo. Recargá para ver la versión más reciente; no se sobrescribió." , version: outcome.version }); return; }
      json(res, 200, { ok: true, version: outcome.version });
    } catch (error) { json(res, error.status || 500, { error: error.message || "No se pudieron guardar los datos." }); }
    return;
  }
  if (pathname === "/api/generate-menu" && req.method === "POST") {
    const user = await requireSession(req, res); if (!user) return;
    if (!rateAllowed(`menu:${user.id}`, 20, 60 * 60 * 1000)) { json(res, 429, { error: "Se alcanzó el límite temporal de generaciones. Volvé a intentar más tarde." }); return; }
    try {
      const request = await readJson(req, 20_000); const patient = await loadPatientForAI(user.id, request.patientId); requireAiConsent(patient);
      if (!Number.isFinite(Number(patient.age)) || !patient.condition || !patient.goal) throw fail("Faltan datos necesarios para proponer el menú.");
      const requirements = calculatePatientRequirements(patient);
      const profile = { ...patient, condition: ({general:"Objetivo general",diabetes2:"Diabetes tipo 2",hipertension:"Hipertensión",ambas:"Diabetes tipo 2 · Hipertensión"})[patient.condition] || "Ficha", budget: ({economico:"Económico",medio:"Medio",flexible:"Flexible"})[patient.budget] || "Medio", requirements: requirements ? { dailyEnergyKcal: requirements.dailyEnergyKcal, macroDistribution: requirements.macroDistribution } : null };
      const output = await generateMenu(profile);
      if (!Array.isArray(output.days) || output.days.length !== 7 || output.days.some(day => mealKeys.some(key => typeof day[key] !== "string" || !day[key].trim())) || hasExactNutritionAmounts(JSON.stringify(output))) throw fail("La IA no devolvió siete días completos en porciones caseras; no se guardó el resultado. Volvé a intentar.", 502);
      await writeAudit(user.id, "ai_weekly_menu", "success").catch(() => {}); json(res, 200, output);
    } catch (error) { json(res, error.status || 500, { error: error.message || "No se pudo generar el menú." }); }
    return;
  }
  if (pathname.startsWith("/api/ai/") && req.method === "POST") {
    const user = await requireSession(req, res); if (!user) return;
    if (!rateAllowed(`ai:${user.id}`, 60, 60 * 60 * 1000)) { json(res, 429, { error: "Se alcanzó el límite temporal de asistencia. Volvé a intentar más tarde." }); return; }
    try {
      const body = await readJson(req, 30_000); const patient = await loadPatientForAI(user.id, body.patientId); requireAiConsent(patient);
      let result; let action;
      if (pathname === "/api/ai/consultation-summary") {
        const consultations = [...(patient.consultations || [])].sort((a,b) => String(a.date || "").localeCompare(String(b.date || ""))).slice(-12).map(item => ({ date: item.date, reason: item.reason, notes: item.notes, adherence: item.adherence, recommendations: item.recommendations }));
        if (!consultations.length) throw fail("Esta ficha todavía no tiene consultas registradas.");
        result = await callOpenAI({ name: "consultation_summary", schema: consultationSchema, instructions: "Resumí las notas de consulta para que un profesional las revise y sugerí preguntas neutrales para el próximo encuentro. No diagnostiques ni infieras hechos que no estén escritos. Si algo no consta, no lo inventes. En español claro y conciso. La respuesta es un borrador interno para revisión.", input: { consultations } }); action = "ai_consultation_summary";
      } else if (pathname === "/api/ai/regenerate-meal") {
        const dayIndex = Number(body.dayIndex); const key = body.mealKey; const instruction = typeof body.instruction === "string" ? body.instruction.trim().slice(0, 500) : "";
        if (!Number.isInteger(dayIndex) || dayIndex < 0 || dayIndex > 6 || !mealKeys.includes(key) || !patient.draft?.days?.[dayIndex]) throw fail("No encontramos esa comida del plan.");
        const day = patient.draft.days[dayIndex]; const requirements = calculatePatientRequirements(patient);
        const slotGuidance = requirements ? derivePortionGuidance(requirements)?.perSlot?.[key] : null;
        result = await callOpenAI({ name: "replacement_meal", schema: mealSchema, instructions: "Proponé una sola comida en español rioplatense y medidas caseras. Si input contiene portionGuidance, su campo hint describe, en medidas caseras, el tamaño OBLIGATORIO de esta comida: elegí alimentos reales que encajen en ese tamaño, sin repetir números de kcal ni mencionar calorías. Respetá la comida, las preferencias y restricciones que aparecen en el contexto. No agregues exclusiones no indicadas. No des gramos, calorías ni porcentajes. Es un borrador que revisará un profesional. No afirmes equivalencia clínica.", input: { age: patient.age, condition: patient.condition, goal: patient.goal, likes: patient.likes, avoids: patient.avoids, schedule: patient.schedule, requirements: requirements ? { dailyEnergyKcal: requirements.dailyEnergyKcal, macroDistribution: requirements.macroDistribution } : null, portionGuidance: slotGuidance, day: day.day, currentMeal: day[key], otherMealsThatDay: mealKeys.filter(other => other !== key).map(other => day[other]), instruction } });
        if (!result.meal?.trim() || hasExactNutritionAmounts(result.meal)) throw fail("La sugerencia no vino en medidas caseras. No se aplicó; volvé a intentar.", 502); action = "ai_meal_replacement";
      } else if (pathname === "/api/ai/recipe") {
        const meal = typeof body.meal === "string" ? body.meal.trim().slice(0, 1000) : ""; if (!meal) throw fail("Elegí una comida para preparar la receta.");
        result = await callOpenAI({ name: "household_recipe", schema: recipeSchema, instructions: "Convertí la comida en una receta sencilla para pacientes, con cantidades expresadas solo en medidas caseras (taza, unidad, cucharada, rodaja, plato, etc.), sin gramos ni mililitros. Incluí pasos claros, porciones, tiempo y dificultad. Respeta únicamente las restricciones efectivamente indicadas. No afirmes equivalencias clínicas ni seguridad ante contaminación cruzada; el profesional revisa el borrador.", input: { meal, preferences: patient.likes || "", avoid: patient.avoids || "", goal: patient.goal || "", requestedPortions: Math.min(12, Math.max(1, Number(body.portions) || 2)) } });
        if (hasExactNutritionAmounts(JSON.stringify(result))) throw fail("La receta incluyó cantidades que no son medidas caseras. No se guardó; volvé a intentar.", 502); action = "ai_recipe";
      } else if (pathname === "/api/ai/substitutions") {
        const meal = typeof body.meal === "string" ? body.meal.trim().slice(0, 1000) : ""; const ingredient = typeof body.ingredient === "string" ? body.ingredient.trim().slice(0, 160) : ""; if (!meal || !ingredient) throw fail("Indicá la comida y el alimento que querés reemplazar.");
        result = await callOpenAI({ name: "meal_substitution_ideas", schema: substitutesSchema, instructions: "Sugiere tres a cinco ideas para reemplazar un ingrediente dentro de una comida. No afirmes que sean nutricional o clínicamente equivalentes; explica en una nota qué debe comprobar el profesional. Usa medidas caseras, respeta preferencias y restricciones registradas, y no agregues exclusiones que no estén indicadas. Respuesta en español rioplatense.", input: { meal, ingredient, preferences: patient.likes || "", avoid: patient.avoids || "", goal: patient.goal || "" } }); if(hasExactNutritionAmounts(JSON.stringify(result))) throw fail("La respuesta incluyó cantidades que no son medidas caseras. Volvé a intentarlo.",502); action = "ai_substitution_ideas";
      } else { throw fail("No encontramos esa función de IA.", 404); }
      await writeAudit(user.id, action, "success").catch(() => {});
      json(res, 200, result);
    } catch (error) { json(res, error.status || 500, { error: error.message || "No se pudo completar la propuesta." }); }
    return;
  }
  if (pathname === "/api/patient-access" && req.method === "POST") {
    const user = await requireSession(req, res); if (!user) return;
    try {
      const body = await readJson(req, 4000); const patientId = typeof body.patientId === "string" ? body.patientId : "";
      if (!patientId) throw fail("Falta el ID del paciente.");
      const token = randomBytes(32).toString("base64url"); const tokenHash = digest(token);
      let shortCode = "";
      for (let i = 0; i < 5; i++) {
        shortCode = randomBytes(4).toString("hex").slice(0, 6).toUpperCase();
        try {
          await pool.query("INSERT INTO patient_access_tokens (professional_id, patient_id, token_hash, short_code) VALUES ($1, $2, $3, $4)", [user.id, patientId, tokenHash, shortCode]);
          break;
        } catch (err) { if (err.code !== '23505' || i === 4) throw err; }
      }
      json(res, 200, { ok: true, token, shortCode });
    } catch (error) { json(res, error.status || 500, { error: error.message || "No se pudo generar el acceso." }); }
    return;
  }
  if (pathname.startsWith("/api/patient-access/") && req.method === "GET") {
    const user = await requireSession(req, res); if (!user) return;
    try {
      const patientId = pathname.split("/").pop();
      const result = await pool.query("SELECT short_code FROM patient_access_tokens WHERE professional_id=$1 AND patient_id=$2 AND active=true AND (revoked_at IS NULL)", [user.id, patientId]);
      if (result.rows.length === 0) json(res, 200, { active: false });
      else json(res, 200, { active: true, shortCode: result.rows[0].short_code });
    } catch (error) { json(res, 500, { error: "No se pudo obtener el acceso." }); }
    return;
  }
  if (pathname.startsWith("/api/patient-access/") && req.method === "DELETE") {
    const user = await requireSession(req, res); if (!user) return;
    try {
      const patientId = pathname.split("/").pop();
      await pool.query("UPDATE patient_access_tokens SET active=false, revoked_at=now() WHERE professional_id=$1 AND patient_id=$2 AND active=true", [user.id, patientId]);
      json(res, 200, { ok: true });
    } catch (error) { json(res, 500, { error: "No se pudo revocar el acceso." }); }
    return;
  }
  if (pathname === "/api/portal/auth" && req.method === "POST") {
    try {
      const body = await readJson(req, 1000);
      const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
      const ipKey = `portal-fail:${portalClientKey(req)}`; const globalKey = "portal-fail:all";
      if (failuresBlocked(ipKey, 10) || failuresBlocked(globalKey, 100)) throw fail("Demasiados intentos con códigos incorrectos. Esperá 15 minutos y volvé a intentar.", 429);
      if (!code) throw fail("Código no válido.", 401);
      const result = await pool.query("SELECT token_hash FROM patient_access_tokens WHERE short_code=$1 AND active=true", [code]);
      if (result.rows.length === 0) { recordFailure(ipKey, PORTAL_WINDOW_MS); recordFailure(globalKey, PORTAL_WINDOW_MS); throw fail("El código no es válido o fue revocado.", 401); }
      json(res, 200, { ok: true, token: result.rows[0].token_hash }); // In a real app we'd sign a JWT or set a cookie. We'll use localstorage in the client.
    } catch (error) { json(res, error.status || 500, { error: error.message || "No se pudo acceder." }); }
    return;
  }
  if (pathname === "/api/portal/data" && req.method === "GET") {
    try {
      const raw = req.headers.authorization?.replace("Bearer ", "");
      const isHash = req.headers["x-is-hash"] === "true";
      const tokenHash = isHash ? raw : (raw ? digest(raw) : null);
      if (!tokenHash) throw fail("No autorizado", 401);
      const accessResult = await pool.query("SELECT id, professional_id, patient_id FROM patient_access_tokens WHERE token_hash=$1 AND active=true", [tokenHash]);
      if (accessResult.rows.length === 0) throw fail("Enlace no válido o revocado.", 401);
      const { id: tokenId, professional_id: profId, patient_id: patientId } = accessResult.rows[0];
      const dataResult = await withProfessional(profId, client => client.query("SELECT document FROM professional_data WHERE professional_id=$1", [profId]));
      const profResult = await pool.query("SELECT display_name FROM professionals WHERE id=$1", [profId]);
      const patient = dataResult.rows[0]?.document?.patients?.find(p => p.id === patientId);
      if (!patient) throw fail("Paciente no encontrado", 404);
      const appointments = dataResult.rows[0]?.document?.appointments?.filter(a => a.patientId === patientId && new Date(a.start) >= new Date() && !["cancelled", "noShow"].includes(a.status)) || [];
      const nextAppointment = appointments.sort((a, b) => a.start.localeCompare(b.start))[0] || null;
      
      const portalData = {
        professionalName: profResult.rows[0]?.display_name,
        patientName: patient.name,
        draft: patient.approvedAt ? patient.draft : null,
        consultations: (patient.consultations || []).map(c => ({ date: c.date })).sort((a,b) => String(b.date).localeCompare(String(a.date))),
        measurements: (patient.measurements || []).map(m => ({ date: m.date, weight: m.weight, height: m.height })).sort((a,b) => String(b.date).localeCompare(String(a.date))),
        recipes: patient.approvedAt ? (patient.recipes || []) : [],
        nextAppointment: nextAppointment ? nextAppointment.start : null
      };
      json(res, 200, portalData);
    } catch (error) { json(res, error.status || 500, { error: error.message || "No se pudo cargar los datos." }); }
    return;
  }
  if ((pathname === "/api/portal/weight" || pathname === "/api/portal/note") && req.method === "POST") {
    try {
      const raw = req.headers.authorization?.replace("Bearer ", "");
      const isHash = req.headers["x-is-hash"] === "true";
      const tokenHash = isHash ? raw : (raw ? digest(raw) : null);
      if (!tokenHash) throw fail("No autorizado", 401);
      const accessResult = await pool.query("SELECT id FROM patient_access_tokens WHERE token_hash=$1 AND active=true", [tokenHash]);
      if (accessResult.rows.length === 0) throw fail("No autorizado", 401);
      
      const body = await readJson(req, 2000);
      const type = pathname.endsWith("weight") ? "weight" : "note";
      await pool.query("INSERT INTO patient_submissions (access_token_id, type, data) VALUES ($1, $2, $3::jsonb)", [accessResult.rows[0].id, type, JSON.stringify(body)]);
      json(res, 200, { ok: true });
    } catch (error) { json(res, error.status || 500, { error: error.message || "No se pudo guardar." }); }
    return;
  }

  // To allow serving index.html for /portal paths to support client-side routing
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
  const file = normalize(join(root, staticPath));
  if (file !== rootPath && !file.startsWith(rootPath + sep)) { res.writeHead(403); res.end(); return; }
  try { const data = await readFile(file); res.writeHead(200, { "Content-Type": types[extname(file)] || "application/octet-stream" }); res.end(req.method === "HEAD" ? undefined : data); }
  catch { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); res.end("No encontramos ese archivo."); }
});

server.listen(port, process.env.HOST || (production ? "0.0.0.0" : "127.0.0.1"), () => {
  console.log(`Nutri Guía está lista en http://localhost:${port}`);
  if (process.env.DATABASE_URL && process.env.BACKUP_ENCRYPTION_KEY) {
    const backup = async () => { try { const name = await createEncryptedBackup(); console.log(`Respaldo cifrado completado: ${name}`); } catch (error) { console.error(`No se pudo completar el respaldo cifrado: ${error.message}`); } };
    backup(); setInterval(backup, 24 * 60 * 60 * 1000).unref();
  }
});
