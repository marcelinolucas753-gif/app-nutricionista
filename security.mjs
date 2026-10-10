/**
 * Piezas de seguridad del servidor, separadas para poder probarlas sin base de datos.
 */
import { extname } from "node:path";

// Solo estos archivos se publican. Todo lo demás (server.mjs, .env, migraciones,
// respaldos, package.json…) nunca se entrega, aunque esté en la misma carpeta.
export const PUBLIC_FILES = new Set(["/index.html", "/portal.html", "/app.js", "/portal.js", "/styles.css", "/sw.js", "/manifest.webmanifest", "/icon.svg", "/icon-192.png", "/icon-512.png", "/nutrition.mjs", "/safety.mjs", "/menu-rules.mjs", "/contact.mjs", "/charts.mjs", "/features.css"]);
export const PUBLIC_PREFIXES = ["/js/", "/recetas/"];
export const CONTENT_TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg" };

/**
 * Devuelve la ruta pública ya validada (por ejemplo "/js/util.js") o null si no se debe entregar.
 * Se decodifica UNA vez y después se revisa el resultado: "/js/..%2fserver.mjs" se convierte en
 * "/js/../server.mjs" y se rechaza, en vez de dejar que el sistema de archivos lo resuelva.
 */
export function resolvePublicFile(pathname) {
  let path;
  try { path = decodeURIComponent(String(pathname)); } catch { return null; }
  if (path === "/") path = "/index.html";
  if (!path.startsWith("/") || path.includes("\0") || path.includes("\\") || path.includes("//")) return null;
  if (path.split("/").some(part => part === ".." || part === ".")) return null;
  const allowed = PUBLIC_FILES.has(path) || PUBLIC_PREFIXES.some(prefix => path.startsWith(prefix) && path.length > prefix.length);
  if (!allowed || !CONTENT_TYPES[extname(path)]) return null;
  return path;
}

/**
 * Dirección de la persona que consulta. Detrás del proxy de Render todas las conexiones llegan
 * desde la misma dirección interna, así que se usa la primera de X-Forwarded-For (la de la persona).
 * Ese encabezado se puede falsear, por eso el ingreso también se limita por cuenta (ver server.mjs)
 * y el portal tiene además un tope global de intentos fallidos.
 */
export function clientIp(req, trustProxy) {
  if (trustProxy) {
    const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
    if (forwarded) return forwarded.slice(0, 64);
  }
  return req.socket?.remoteAddress || "unknown";
}

/** Pedidos que cambian datos: si el navegador informa el origen, tiene que ser esta misma página. */
export function sameOriginOk(req) {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return true;
  const origin = req.headers.origin;
  if (!origin) return true; // llamadas que no vienen de un navegador (o navegadores viejos): sigue protegiendo SameSite=Strict
  try { return new URL(origin).host === String(req.headers.host || ""); } catch { return false; }
}
