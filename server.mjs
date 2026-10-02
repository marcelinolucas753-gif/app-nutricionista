import { createServer } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const rootPath = root.endsWith(sep) ? root.slice(0, -1) : root;
const port = Number(process.env.PORT || 4173);
const production = process.env.NODE_ENV === "production";
if (production && (!process.env.OPENAI_API_KEY || !process.env.APP_PASSWORD || process.env.APP_PASSWORD.length < 16)) throw new Error("En producción configurá OPENAI_API_KEY y una APP_PASSWORD de al menos 16 caracteres como secretos del servidor.");
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg" };
const rateBuckets = new Map();
function allowedRequest(req, name, limit, windowMs) {
  const key = `${name}:${req.socket.remoteAddress || "unknown"}`; const now = Date.now(); const bucket = rateBuckets.get(key);
  if (rateBuckets.size > 1000) for (const [entryKey, entry] of rateBuckets) if (entry.expiresAt <= now) rateBuckets.delete(entryKey);
  if (!bucket || now - bucket.startedAt >= windowMs) { rateBuckets.set(key, { startedAt: now, expiresAt: now + windowMs, count: 1 }); return true; }
  if (bucket.count >= limit) return false;
  bucket.count += 1; return true;
}

function sessionSignature(expires) { return createHmac("sha256", process.env.APP_PASSWORD || "local-only").update(expires).digest("hex"); }
function authenticated(req) {
  if (!production) return true;
  const raw = (req.headers.cookie || "").split(";").map(part => part.trim()).find(part => part.startsWith("nutri_session="))?.slice("nutri_session=".length);
  if (!raw) return false;
  const [expires, signature] = raw.split(".");
  if (!expires || !signature || Number(expires) < Date.now()) return false;
  const expected = Buffer.from(sessionSignature(expires)); const actual = Buffer.from(signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

const schema = {
  type: "object", additionalProperties: false, required: ["intro", "days", "recommendations", "reviewNotes"],
  properties: {
    intro: { type: "string" },
    days: { type: "array", minItems: 7, maxItems: 7, items: { type: "object", additionalProperties: false, required: ["day", "breakfast", "snack1", "lunch", "snack2", "merienda", "dinner", "extra"], properties: { day: { type: "string" }, breakfast: { type: "string" }, snack1: { type: "string" }, lunch: { type: "string" }, snack2: { type: "string" }, merienda: { type: "string" }, dinner: { type: "string" }, extra: { type: "string" } } } },
    recommendations: { type: "array", minItems: 3, maxItems: 6, items: { type: "string" } },
    reviewNotes: { type: "array", minItems: 1, maxItems: 5, items: { type: "string" } }
  }
};

async function generateMenu(profile) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw Object.assign(new Error("Falta configurar la clave de OpenAI. Cerrá e iniciá la app con el archivo iniciar-app.bat."), { status: 503 });
  const safeProfile = {
    age: profile.age, condition: profile.condition, goal: profile.goal, budget: profile.budget,
    likes: profile.likes, avoids: `${profile.avoids || ""}\nExclusiones fijas de esta app: evitar maní, lactosa y gluten. Si la persona sigue una alimentación vegetariana, proponer solo opciones vegetarianas. No afirmar que un alimento está libre de contaminación cruzada; indicar que se revisen etiquetas y manipulación.`, schedule: profile.schedule, context: profile.context,
    requirements: profile.requirements ? { dailyEnergyKcal: profile.requirements.dailyEnergyKcal, macroDistribution: profile.requirements.macroDistribution } : null
  };
  let response;
  try { response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST", headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(60_000),
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-6-luna",
      instructions: "Sos un asistente para un estudiante avanzado de nutrición en prácticas clínicas en Resistencia, Chaco, Argentina. Redactás únicamente borradores educativos para revisión de un profesional; no diagnostiques, no sustituyas indicaciones del equipo tratante, no inventes datos clínicos, fármacos ni necesidades de nutrientes. Usa alimentos y preparaciones cotidianas y accesibles de la región, opciones económicas según presupuesto, variedad real entre días y porciones caseras fáciles de entender (taza, rodaja, unidad, cucharada, plato o tamaño de la palma). No indiques gramos por alimento ni escribas calorías o porcentajes de macros en el menú. Si input contiene requirements, usá dailyEnergyKcal como referencia interna aproximada para distribuir porciones en el día, con macroDistribution como orientación general; no prometas precisión calórica, no lo conviertas en prescripción y no cambies el objetivo de mantenimiento por un déficit/superávit aunque goal lo sugiera. Si no hay requirements, no simules haber calculado necesidades: propone porciones generales para revisión profesional. Respeta estrictamente alergias, alimentos evitados, gustos y horarios. Para diabetes tipo 2 e hipertensión, da recomendaciones generales prudentes, sin ajustar medicación ni indicar restricciones terapéuticas específicas. Si el caso parece requerir valoración especializada o faltan datos esenciales, dilo en reviewNotes y ofrece solo ideas generales prudentes. En español rioplatense claro. Cada día debe incluir los seis tiempos en este orden: desayuno (breakfast), colación matutina (snack1), almuerzo (lunch), colación vespertina (snack2), merienda (merienda) y cena (dinner). extra contiene una sugerencia opcional de reemplazo. Las notas de revisión deben recordar validar alergias, medicación, evolución y adecuación individual.",
      input: JSON.stringify(safeProfile),
      text: { format: { type: "json_schema", name: "weekly_meal_draft", strict: true, schema } }
    })
  }); } catch (error) { throw Object.assign(new Error(error?.name === "TimeoutError" ? "La generación tardó demasiado. Esperá un momento y volvé a intentarlo." : "No se pudo conectar con OpenAI. Revisá la conexión y volvé a intentar."), { status: 502 }); }
  let payload;
  try { payload = await response.json(); }
  catch { throw Object.assign(new Error("OpenAI devolvió una respuesta que no se pudo leer. Esperá un momento y volvé a intentarlo."), { status: 502 }); }
  if (!response.ok) {
    const apiError = payload?.error || {};
    const code = apiError.code || apiError.type || "";
    let message = apiError.message || "No se pudo generar el menú.";
    if (code === "insufficient_quota" || code === "billing_hard_limit_reached") message = "OpenAI rechazó la solicitud por saldo o límite de facturación. Verificá en la plataforma de API que los créditos estén en la misma cuenta y proyecto que esta clave, y que no haya un límite de gasto alcanzado.";
    else if (code === "invalid_api_key" || response.status === 401) message = "OpenAI no aceptó la clave configurada. Cerrá la app, volvé a iniciarla y pegá una clave API válida.";
    else if (code === "model_not_found" || code === "unsupported_model") message = "La clave o el proyecto no tiene acceso a GPT-6 Luna. Revisá el acceso del proyecto en OpenAI; la app mantiene GPT-6 Luna.";
    else if (response.status === 429) message = "OpenAI aplicó un límite temporal o de uso a esta cuenta/proyecto. Revisá los límites de la API y volvé a intentar más tarde.";
    else if (!message.includes("OpenAI")) message = `OpenAI no pudo generar el menú (${response.status}): ${message}`;
    throw Object.assign(new Error(message), { status: 502 });
  }
  const outputText = Array.isArray(payload?.output)
    ? payload.output.flatMap(item => Array.isArray(item?.content) ? item.content : [])
      .filter(item => item?.type === "output_text" && typeof item.text === "string")
      .map(item => item.text).join("")
    : "";
  if (payload?.status !== "completed" || !outputText) {
    const refusal = Array.isArray(payload?.output)
      ? payload.output.flatMap(item => Array.isArray(item?.content) ? item.content : []).find(item => item?.type === "refusal")
      : null;
    const reason = payload?.incomplete_details?.reason;
    const message = refusal?.refusal || (reason === "max_output_tokens"
      ? "La respuesta quedó incompleta antes de terminar el menú. Volvé a intentarlo; si se repite, avisame para ajustar el tamaño de la respuesta."
      : reason === "content_filter"
        ? "OpenAI no pudo completar esta solicitud. Revisá que la ficha contenga solo información necesaria para proponer el menú y volvé a intentar."
        : payload?.status === "failed"
          ? `OpenAI no pudo completar la generación${payload?.error?.message ? `: ${payload.error.message}` : ". Revisá la conexión o el estado del servicio."}`
          : "OpenAI respondió, pero no envió el contenido del menú esperado. Volvé a intentarlo.");
    throw Object.assign(new Error(message), { status: 502 });
  }
  try { return JSON.parse(outputText); }
  catch { throw Object.assign(new Error("La respuesta de la IA no tuvo el formato esperado. Volvé a intentarlo."), { status: 502 }); }
}

const server = createServer(async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cache-Control", "no-store");
  if (production) res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  if (req.url === "/api/health" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ ok: true })); return;
  }
  if (req.url === "/api/status" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ configured: Boolean(process.env.OPENAI_API_KEY), passwordRequired: production, authenticated: authenticated(req) })); return;
  }
  if (req.url === "/api/login" && req.method === "POST") {
    try {
      if (!allowedRequest(req, "login", 10, 15 * 60 * 1000)) throw Object.assign(new Error("Demasiados intentos. Esperá 15 minutos y volvé a intentar."), { status: 429 });
      let raw = ""; for await (const chunk of req) { raw += chunk; if (raw.length > 2000) throw new Error("Solicitud demasiado extensa."); }
      const body = JSON.parse(raw);
      if (!production || typeof body.password !== "string") throw Object.assign(new Error("No se pudo iniciar sesión."), { status: 400 });
      const supplied = Buffer.from(body.password); const expected = Buffer.from(process.env.APP_PASSWORD);
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw Object.assign(new Error("La contraseña no coincide."), { status: 401 });
      const expires = String(Date.now() + 12 * 60 * 60 * 1000); const secure = production ? "; Secure" : "";
      res.writeHead(200, { "Content-Type": "application/json", "Set-Cookie": `nutri_session=${expires}.${sessionSignature(expires)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200${secure}` }); res.end(JSON.stringify({ ok: true }));
    } catch (error) { res.writeHead(error.status || 400, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: error.message || "No se pudo iniciar sesión." })); }
    return;
  }
  if (req.url === "/api/logout" && req.method === "POST") {
    res.writeHead(200, { "Content-Type": "application/json", "Set-Cookie": "nutri_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0; Secure" }); res.end(JSON.stringify({ ok: true })); return;
  }
  if (req.url === "/api/generate-menu" && req.method === "POST") {
    if (!authenticated(req)) { res.writeHead(401, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Iniciá sesión para generar menús." })); return; }
    if (!allowedRequest(req, "generate-menu", 20, 60 * 60 * 1000)) { res.writeHead(429, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Se alcanzó el límite temporal de generaciones. Esperá antes de volver a intentarlo." })); return; }
    try {
      let raw = "";
      for await (const chunk of req) { raw += chunk; if (raw.length > 20000) throw Object.assign(new Error("La ficha es demasiado extensa."), { status: 413 }); }
      const profile = JSON.parse(raw);
      if (!profile || typeof profile !== "object" || !profile.age || !profile.condition || !profile.goal) throw Object.assign(new Error("Faltan datos necesarios para proponer el menú."), { status: 400 });
      if (profile.requirements && (typeof profile.requirements.dailyEnergyKcal !== "number" || !Number.isFinite(profile.requirements.dailyEnergyKcal) || profile.requirements.dailyEnergyKcal < 500 || profile.requirements.dailyEnergyKcal > 8000 || profile.requirements.macroDistribution?.carbohydratePercent !== 60 || profile.requirements.macroDistribution?.fatPercent !== 25 || profile.requirements.macroDistribution?.proteinPercent !== 15)) throw Object.assign(new Error("Los requerimientos enviados no tienen un formato válido."), { status: 400 });
      const result = await generateMenu(profile);
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(result));
    } catch (error) {
      const code = error.status || 400;
      res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: error instanceof SyntaxError ? "No se pudo leer la ficha." : error.message || "Ocurrió un error." }));
    }
    return;
  }
  if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405); res.end(); return; }
  let pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  if (pathname === "/") pathname = "/index.html";
  const file = normalize(join(root, pathname));
  if (file !== rootPath && !file.startsWith(rootPath + sep)) { res.writeHead(403); res.end(); return; }
  try {
    const data = await readFile(file);
    res.writeHead(200, { "Content-Type": types[extname(file)] || "application/octet-stream" });
    res.end(req.method === "HEAD" ? undefined : data);
  } catch { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); res.end("No encontramos ese archivo."); }
});

server.listen(port, process.env.HOST || (production ? "0.0.0.0" : "127.0.0.1"), () => console.log(`Nutri Guía está lista en http://localhost:${port}`));
