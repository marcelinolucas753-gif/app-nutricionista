import { randomBytes, createCipheriv, createDecipheriv, createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { mkdir, readdir, stat, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { pool, withProfessional } from "./db.mjs";

export const BACKUP_FORMAT = "nutri-guia-encrypted-backup";
// 1: cuentas y fichas. 2: suma accesos del portal, envíos de pacientes y opiniones 👍/👎.
export const BACKUP_VERSION = 2;
const FILE_MAGIC = "NGB1";

export function parseBackupKey(value = "") {
  let key;
  if (/^[0-9a-f]{64}$/i.test(value)) key = Buffer.from(value, "hex");
  else { try { key = Buffer.from(value, "base64"); } catch { /* invalid key handled below */ } }
  if (!key || key.length !== 32) throw new Error("BACKUP_ENCRYPTION_KEY debe tener 32 bytes (64 caracteres hex o Base64 equivalente).");
  return key;
}
function keyFromEnvironment() { return parseBackupKey(process.env.BACKUP_ENCRYPTION_KEY || ""); }

export function validateBackupKey() { keyFromEnvironment(); }

/** Cifra el contenido (JSON → gzip → AES-256-GCM) con el formato de archivo de siempre: NGB1 + iv + etiqueta + datos. */
export function encryptSnapshot(snapshot, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(gzipSync(Buffer.from(JSON.stringify(snapshot)))), cipher.final()]);
  return Buffer.concat([Buffer.from(FILE_MAGIC), iv, cipher.getAuthTag(), encrypted]);
}

export function decryptSnapshot(bytes, key) {
  if (bytes.length < 32 || bytes.subarray(0, 4).toString() !== FILE_MAGIC) throw new Error("El archivo no parece un respaldo válido de Nutri Guía.");
  const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(4, 16));
  decipher.setAuthTag(bytes.subarray(16, 32));
  try { return JSON.parse(gunzipSync(Buffer.concat([decipher.update(bytes.subarray(32)), decipher.final()])).toString("utf8")); }
  catch { throw new Error("No se pudo descifrar o validar el respaldo. Revisá la clave y el archivo."); }
}

/**
 * Comprueba la estructura del respaldo antes de tocar la base.
 * Devuelve { hasPortalData } para saber si el respaldo trae accesos, envíos y opiniones (versión 2).
 */
export function validateSnapshot(snapshot) {
  if (snapshot?.format !== BACKUP_FORMAT || ![1, 2].includes(snapshot.version) || !Array.isArray(snapshot.professionals) || !Array.isArray(snapshot.data)) throw new Error("El contenido no tiene la estructura esperada.");
  const accountIds = new Set(snapshot.professionals.map(user => user.id));
  for (const row of snapshot.data) {
    if (!accountIds.has(row.professional_id)) throw new Error("El respaldo tiene datos sin una cuenta asociada.");
    const document = row.document;
    if (!document || !Array.isArray(document.patients) || !Array.isArray(document.appointments)) throw new Error("Una ficha del respaldo no tiene una estructura válida.");
  }
  if (snapshot.version === 1) return { hasPortalData: false };
  const portal = snapshot.portal;
  if (!portal || !Array.isArray(portal.accessTokens) || !Array.isArray(portal.submissions) || !Array.isArray(snapshot.aiFeedback)) throw new Error("El respaldo no incluye los datos del portal y las opiniones que debería tener.");
  const tokenIds = new Set();
  for (const token of portal.accessTokens) {
    if (!accountIds.has(token.professional_id) || typeof token.id !== "string" || typeof token.patient_id !== "string" || typeof token.token_hash !== "string" || typeof token.short_code !== "string") throw new Error("Un acceso del portal del respaldo no es válido.");
    tokenIds.add(token.id);
  }
  for (const submission of portal.submissions) {
    if (!tokenIds.has(submission.access_token_id) || !["weight", "note"].includes(submission.type) || typeof submission.data !== "object" || submission.data === null) throw new Error("Un envío del portal del respaldo no es válido.");
  }
  for (const feedback of snapshot.aiFeedback) {
    if (!accountIds.has(feedback.professional_id) || !["plan", "meal"].includes(feedback.scope) || !["up", "down"].includes(feedback.rating)) throw new Error("Una opinión del respaldo no es válida.");
  }
  return { hasPortalData: true };
}

/**
 * Restaura el respaldo dentro de la transacción abierta en `client`.
 * Reemplaza las fichas de las cuentas incluidas. Con un respaldo de versión 2 también reemplaza sus accesos del portal,
 * los envíos de pacientes y las opiniones; con uno de versión 1 deja esos datos como están, porque el respaldo no los trae.
 */
export async function restoreSnapshot(client, snapshot) {
  const { hasPortalData } = validateSnapshot(snapshot);
  for (const user of snapshot.professionals) await client.query("INSERT INTO professionals (id,email,display_name,password_salt,password_hash,active,created_at,password_changed_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO UPDATE SET email=EXCLUDED.email,display_name=EXCLUDED.display_name,password_salt=EXCLUDED.password_salt,password_hash=EXCLUDED.password_hash,active=EXCLUDED.active,password_changed_at=EXCLUDED.password_changed_at", [user.id, user.email, user.display_name, user.password_salt, user.password_hash, user.active, user.created_at, user.password_changed_at]);
  for (const row of snapshot.data) {
    await client.query("SELECT set_config('app.professional_id',$1,true)", [row.professional_id]);
    await client.query("INSERT INTO professional_data (professional_id,document,version,updated_at) VALUES ($1,$2::jsonb,$3,$4) ON CONFLICT (professional_id) DO UPDATE SET document=EXCLUDED.document,version=EXCLUDED.version,updated_at=EXCLUDED.updated_at", [row.professional_id, JSON.stringify(row.document), row.version, row.updated_at]);
  }
  await client.query("DELETE FROM app_sessions");
  if (!hasPortalData) return { portalRestored: false, accessTokens: 0, submissions: 0, feedback: 0 };

  const accountIds = snapshot.professionals.map(user => user.id);
  // Al borrar los accesos de estas cuentas también se borran sus envíos y sesiones del portal (ON DELETE CASCADE).
  await client.query("DELETE FROM patient_access_tokens WHERE professional_id = ANY($1::text[])", [accountIds]);
  for (const token of snapshot.portal.accessTokens) {
    await client.query("INSERT INTO patient_access_tokens (id,professional_id,patient_id,token_hash,short_code,active,created_at,revoked_at,last_used_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)", [token.id, token.professional_id, token.patient_id, token.token_hash, token.short_code, token.active, token.created_at, token.revoked_at ?? null, token.last_used_at ?? null]);
  }
  for (const submission of snapshot.portal.submissions) {
    await client.query("INSERT INTO patient_submissions (id,access_token_id,type,data,created_at) VALUES ($1,$2,$3,$4::jsonb,$5)", [submission.id, submission.access_token_id, submission.type, JSON.stringify(submission.data), submission.created_at]);
  }
  for (const accountId of accountIds) {
    await client.query("SELECT set_config('app.professional_id',$1,true)", [accountId]);
    await client.query("DELETE FROM ai_feedback WHERE professional_id=$1", [accountId]);
    for (const item of snapshot.aiFeedback.filter(feedback => feedback.professional_id === accountId)) {
      await client.query("INSERT INTO ai_feedback (professional_id,scope,meal_key,rating,reasons,meal_text,rules_version,patient_ref,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)", [item.professional_id, item.scope, item.meal_key ?? null, item.rating, item.reasons ?? [], item.meal_text ?? null, item.rules_version ?? null, item.patient_ref ?? null, item.created_at]);
    }
  }
  return { portalRestored: true, accessTokens: snapshot.portal.accessTokens.length, submissions: snapshot.portal.submissions.length, feedback: snapshot.aiFeedback.length };
}

export async function createEncryptedBackup() {
  if (!process.env.DATABASE_URL) throw new Error("Falta configurar DATABASE_URL.");
  const key = keyFromEnvironment();
  const accounts = await pool.query("SELECT id,email,display_name,password_salt,password_hash,active,created_at,password_changed_at FROM professionals ORDER BY id");
  const records = [];
  const aiFeedback = [];
  for (const account of accounts.rows) {
    const result = await withProfessional(account.id, client => client.query("SELECT professional_id,document,version,updated_at FROM professional_data WHERE professional_id=$1", [account.id]));
    records.push(...result.rows);
    const opinions = await withProfessional(account.id, client => client.query("SELECT professional_id,scope,meal_key,rating,reasons,meal_text,rules_version,patient_ref,created_at FROM ai_feedback WHERE professional_id=$1 ORDER BY id", [account.id]));
    aiFeedback.push(...opinions.rows);
  }
  // Los accesos y envíos del portal no tienen aislamiento por cuenta en la base: se leen completos y se relacionan por professional_id.
  const accessTokens = (await pool.query("SELECT id,professional_id,patient_id,token_hash,short_code,active,created_at,revoked_at,last_used_at FROM patient_access_tokens ORDER BY created_at,id")).rows;
  const submissions = (await pool.query("SELECT id,access_token_id,type,data,created_at FROM patient_submissions ORDER BY created_at,id")).rows;
  const snapshot = { format: BACKUP_FORMAT, version: BACKUP_VERSION, createdAt: new Date().toISOString(), professionals: accounts.rows, data: records, portal: { accessTokens, submissions }, aiFeedback };
  const filename = `nutri-guia-${new Date().toISOString().replace(/[:.]/g, "-")}.json.gz.enc`;
  const directory = process.env.BACKUP_DIR || "./backups"; await mkdir(directory, { recursive: true });
  await writeFile(join(directory, filename), encryptSnapshot(snapshot, key), { mode: 0o600 });
  await pruneOldBackups(directory);
  return filename;
}

async function pruneOldBackups(directory) {
  const names = (await readdir(directory)).filter(name => /^nutri-guia-.*\.json\.gz\.enc$/.test(name));
  const entries = await Promise.all(names.map(async name => ({ name, modified: (await stat(join(directory, name))).mtimeMs })));
  entries.sort((a,b) => b.modified-a.modified);
  const keep = new Set(); const weekly = new Set(); const now = Date.now();
  for (const entry of entries) {
    const ageDays = (now-entry.modified)/86_400_000;
    if (ageDays <= 14) { keep.add(entry.name); continue; }
    if (ageDays <= 70) { const week=Math.floor(ageDays/7); if(!weekly.has(week)){weekly.add(week);keep.add(entry.name);} }
  }
  await Promise.all(entries.filter(item => !keep.has(item.name)).map(item => unlink(join(directory,item.name))));
}

export function backupKeyFingerprint() { return createHash("sha256").update(keyFromEnvironment()).digest("hex").slice(0, 12); }

/** Estado de los respaldos para mostrarlo en la app, sin exponer nombres ni contenido. */
export async function backupStatus() {
  if (!process.env.DATABASE_URL || !process.env.BACKUP_ENCRYPTION_KEY) return { configured: false, count: 0, lastAt: null };
  const directory = process.env.BACKUP_DIR || "./backups";
  try {
    const names = (await readdir(directory)).filter(name => /^nutri-guia-.*\.json\.gz\.enc$/.test(name));
    let lastAt = 0;
    for (const name of names) lastAt = Math.max(lastAt, (await stat(join(directory, name))).mtimeMs);
    return { configured: true, count: names.length, lastAt: lastAt || null };
  } catch { return { configured: true, count: 0, lastAt: null }; }
}
