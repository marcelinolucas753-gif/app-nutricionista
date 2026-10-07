import { randomBytes, createCipheriv, createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { mkdir, readdir, stat, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { pool, withProfessional } from "./db.mjs";

function keyFromEnvironment() {
  const value = process.env.BACKUP_ENCRYPTION_KEY || "";
  let key;
  if (/^[0-9a-f]{64}$/i.test(value)) key = Buffer.from(value, "hex");
  else { try { key = Buffer.from(value, "base64"); } catch { /* invalid key handled below */ } }
  if (!key || key.length !== 32) throw new Error("BACKUP_ENCRYPTION_KEY debe tener 32 bytes (64 caracteres hex o Base64 equivalente).");
  return key;
}

export function validateBackupKey() { keyFromEnvironment(); }

export async function createEncryptedBackup() {
  if (!process.env.DATABASE_URL) throw new Error("Falta configurar DATABASE_URL.");
  const key = keyFromEnvironment();
  const accounts = await pool.query("SELECT id,email,display_name,password_salt,password_hash,active,created_at,password_changed_at FROM professionals ORDER BY id");
  const records = [];
  for (const account of accounts.rows) {
    const result = await withProfessional(account.id, client => client.query("SELECT professional_id,document,version,updated_at FROM professional_data WHERE professional_id=$1", [account.id]));
    records.push(...result.rows);
  }
  const payload = Buffer.from(JSON.stringify({ format: "nutri-guia-encrypted-backup", version: 1, createdAt: new Date().toISOString(), professionals: accounts.rows, data: records }));
  const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", key, iv); const encrypted = Buffer.concat([cipher.update(gzipSync(payload)), cipher.final()]);
  const filename = `nutri-guia-${new Date().toISOString().replace(/[:.]/g, "-")}.json.gz.enc`;
  const directory = process.env.BACKUP_DIR || "./backups"; await mkdir(directory, { recursive: true });
  await writeFile(join(directory, filename), Buffer.concat([Buffer.from("NGB1"), iv, cipher.getAuthTag(), encrypted]), { mode: 0o600 });
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
