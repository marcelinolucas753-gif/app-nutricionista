import { Pool } from "pg";

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.DATABASE_POOL_SIZE || 10),
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30_000,
  statement_timeout: 30_000,
  application_name: "nutri-guia-clinica"
});

// Sin este aviso, un corte de la conexión con la base (reinicio, mantenimiento) tira abajo todo el servidor.
pool.on("error", error => console.error(`Conexión inactiva con la base falló: ${error.message}`));

export async function withProfessional(professionalId, callback) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.professional_id', $1, true)", [professionalId]);
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* preserve the original failure */ }
    throw error;
  } finally { client.release(); }
}

export async function writeAudit(professionalId, action, result = "success") {
  if (!professionalId) return;
  await withProfessional(professionalId, client => client.query(
    "INSERT INTO audit_events (professional_id, action, result) VALUES ($1, $2, $3)",
    [professionalId, action, result]
  ));
}
