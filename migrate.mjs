import { readdir, readFile } from "node:fs/promises";
import { pool } from "./db.mjs";

try {
  const dir = new URL("./migrations/", import.meta.url);
  const files = (await readdir(dir)).filter(name => name.endsWith(".sql")).sort();
  for (const name of files) {
    const sql = await readFile(new URL(name, dir), "utf8");
    await pool.query(sql);
  }
  console.log("Base de datos actualizada.");
} catch (error) {
  console.error(`No se pudo actualizar la base. Verificá DATABASE_URL y la conexión. Detalle: ${error?.message || error}`);
  process.exitCode = 1;
} finally { await pool.end(); }
