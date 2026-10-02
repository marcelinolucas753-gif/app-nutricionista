import { createDecipheriv } from "node:crypto";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { pool } from "./db.mjs";
import { createEncryptedBackup } from "./backup.mjs";

const filename = process.argv[2];
if (!filename) { console.error("Uso: node --env-file=.env restore-backup.mjs ruta/al/respaldo.enc"); process.exit(2); }
const keyText = process.env.BACKUP_ENCRYPTION_KEY || "";
const key = /^[0-9a-f]{64}$/i.test(keyText) ? Buffer.from(keyText,"hex") : Buffer.from(keyText,"base64");
if (key.length !== 32) throw new Error("La clave de respaldo no tiene el formato esperado.");
const bytes = await readFile(filename);
if (bytes.length < 32 || bytes.subarray(0,4).toString() !== "NGB1") throw new Error("El archivo no parece un respaldo válido de Nutri Guía.");
const decipher = createDecipheriv("aes-256-gcm",key,bytes.subarray(4,16)); decipher.setAuthTag(bytes.subarray(16,32));
let snapshot;
try { snapshot=JSON.parse(gunzipSync(Buffer.concat([decipher.update(bytes.subarray(32)),decipher.final()])).toString("utf8")); }
catch { throw new Error("No se pudo descifrar o validar el respaldo. Revisá la clave y el archivo."); }
if(snapshot?.format!=="nutri-guia-encrypted-backup"||snapshot.version!==1||!Array.isArray(snapshot.professionals)||!Array.isArray(snapshot.data)) throw new Error("El contenido no tiene la estructura esperada.");
const prompt=createInterface({input:stdin,output:stdout});
const answer=await prompt.question(`Se reemplazarán las fichas y turnos de ${snapshot.data.length} cuenta(s) incluidas en el respaldo del ${snapshot.createdAt}. Las cuentas creadas después se conservarán. Escribí RESTAURAR para continuar: `); prompt.close();
if(answer!=="RESTAURAR"){console.log("No se realizaron cambios.");await pool.end();process.exit(0);}
const safetyBackup=await createEncryptedBackup();
const client=await pool.connect();
try {
  await client.query("BEGIN");
  for(const user of snapshot.professionals) await client.query("INSERT INTO professionals (id,email,display_name,password_salt,password_hash,active,created_at,password_changed_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO UPDATE SET email=EXCLUDED.email,display_name=EXCLUDED.display_name,password_salt=EXCLUDED.password_salt,password_hash=EXCLUDED.password_hash,active=EXCLUDED.active,password_changed_at=EXCLUDED.password_changed_at",[user.id,user.email,user.display_name,user.password_salt,user.password_hash,user.active,user.created_at,user.password_changed_at]);
  for(const row of snapshot.data){
    if(!snapshot.professionals.some(user=>user.id===row.professional_id)) throw new Error("El respaldo tiene datos sin una cuenta asociada.");
    const document=row.document;
    if(!document||!Array.isArray(document.patients)||!Array.isArray(document.appointments)) throw new Error("Una ficha del respaldo no tiene una estructura válida.");
    await client.query("SELECT set_config('app.professional_id',$1,true)",[row.professional_id]);
    await client.query("INSERT INTO professional_data (professional_id,document,version,updated_at) VALUES ($1,$2::jsonb,$3,$4) ON CONFLICT (professional_id) DO UPDATE SET document=EXCLUDED.document,version=EXCLUDED.version,updated_at=EXCLUDED.updated_at",[row.professional_id,JSON.stringify(document),row.version,row.updated_at]);
  }
  await client.query("DELETE FROM app_sessions"); await client.query("COMMIT");
  console.log(`Restauración completada. Copia previa de seguridad: ${safetyBackup}. Las personas deberán volver a iniciar sesión.`);
} catch(error){try{await client.query("ROLLBACK");}catch{} throw error;}
finally{client.release();await pool.end();}
