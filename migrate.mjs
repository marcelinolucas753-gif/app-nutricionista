import { readFile } from "node:fs/promises";
import { pool } from "./db.mjs";

try {
  const sql = await readFile(new URL("./migrations/001_professional_accounts.sql", import.meta.url), "utf8");
  await pool.query(sql);
  console.log("Base de datos actualizada.");
} catch (error) {
  console.error("No se pudo actualizar la base. Verificá DATABASE_URL y la conexión.");
  process.exitCode = 1;
} finally { await pool.end(); }
