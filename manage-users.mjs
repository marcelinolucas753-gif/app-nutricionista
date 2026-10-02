import { randomBytes, randomUUID, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import { pool, withProfessional } from "./db.mjs";

const scrypt = promisify(scryptCallback);
const action = process.argv[2];
const email = process.argv[3]?.trim().toLowerCase();
if (!["create", "reset-password"].includes(action) || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error("Uso: node manage-users.mjs create correo@dominio.com [Nombre Profesional]\n     node manage-users.mjs reset-password correo@dominio.com");
  process.exit(2);
}

const temporaryPassword = randomBytes(24).toString("base64url");
const salt = randomBytes(16).toString("hex");
const passwordHash = (await scrypt(temporaryPassword, salt, 64)).toString("hex");
try {
  if (action === "create") {
    const displayName = process.argv.slice(4).join(" ").trim();
    if (!displayName || displayName.length > 100) throw new Error("Indicá el nombre profesional (máximo 100 caracteres).");
    await pool.query("INSERT INTO professionals (id,email,display_name,password_salt,password_hash) VALUES ($1,$2,$3,$4,$5)", [randomUUID(), email, displayName, salt, passwordHash]);
    console.log(`Cuenta profesional creada para ${email}. Contraseña temporal (se muestra una sola vez):\n${temporaryPassword}\nIniciá sesión y cambiala desde la app.`);
  } else {
    const result = await pool.query("UPDATE professionals SET password_salt=$2,password_hash=$3,password_changed_at=now() WHERE email=$1 AND active=true RETURNING id", [email, salt, passwordHash]);
    if (!result.rowCount) throw new Error("No encontramos una cuenta activa con ese correo.");
    await pool.query("DELETE FROM app_sessions WHERE professional_id=$1", [result.rows[0].id]);
    await withProfessional(result.rows[0].id, client => client.query("INSERT INTO audit_events (professional_id,action,result) VALUES ($1,'password_reset','success')", [result.rows[0].id]));
    console.log(`Contraseña nueva de ${email} (se muestra una sola vez):\n${temporaryPassword}`);
  }
} catch (error) {
  console.error(error.code === "23505" ? "Ya existe una cuenta con ese correo." : error.message || "No se pudo completar la operación.");
  process.exitCode = 1;
} finally { await pool.end(); }
