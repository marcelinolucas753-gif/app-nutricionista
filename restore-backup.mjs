import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { pool } from "./db.mjs";
import { createEncryptedBackup, decryptSnapshot, parseBackupKey, restoreSnapshot, validateSnapshot } from "./backup.mjs";

const filename = process.argv[2];
if (!filename) { console.error("Uso: node --env-file=.env restore-backup.mjs ruta/al/respaldo.enc"); process.exit(2); }
let key;
try { key = parseBackupKey(process.env.BACKUP_ENCRYPTION_KEY || ""); } catch { throw new Error("La clave de respaldo no tiene el formato esperado."); }
const snapshot = decryptSnapshot(await readFile(filename), key);
const { hasPortalData } = validateSnapshot(snapshot);
const portalNote = hasPortalData
  ? `También se reemplazarán sus accesos del portal (${snapshot.portal.accessTokens.length}), lo que enviaron los pacientes (${snapshot.portal.submissions.length}) y las opiniones 👍/👎 (${snapshot.aiFeedback.length}).`
  : "Este respaldo es anterior y no incluye accesos del portal, envíos de pacientes ni opiniones: esos datos se dejan como están.";
const prompt = createInterface({ input: stdin, output: stdout });
const answer = await prompt.question(`Se reemplazarán las fichas y turnos de ${snapshot.data.length} cuenta(s) incluidas en el respaldo del ${snapshot.createdAt}. ${portalNote} Las cuentas creadas después se conservarán. Escribí RESTAURAR para continuar: `); prompt.close();
if (answer !== "RESTAURAR") { console.log("No se realizaron cambios."); await pool.end(); process.exit(0); }
const safetyBackup = await createEncryptedBackup();
const client = await pool.connect();
try {
  await client.query("BEGIN");
  const result = await restoreSnapshot(client, snapshot);
  await client.query("COMMIT");
  console.log(`Restauración completada. Copia previa de seguridad: ${safetyBackup}. Las personas deberán volver a iniciar sesión.`);
  if (result.portalRestored) console.log(`Portal restaurado: ${result.accessTokens} acceso(s), ${result.submissions} envío(s) y ${result.feedback} opinión(es). Los pacientes que ya habían entrado tendrán que ingresar de nuevo con su código o enlace.`);
} catch (error) { try { await client.query("ROLLBACK"); } catch { /* se conserva el error original */ } throw error; }
finally { client.release(); await pool.end(); }
