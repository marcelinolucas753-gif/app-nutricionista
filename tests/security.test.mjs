import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { clientIp, resolvePublicFile, sameOriginOk } from "../security.mjs";
import { portalDraftView } from "../validation.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("se entregan los archivos públicos y nada más", () => {
  for (const path of ["/", "/index.html", "/js/util.js", "/menu-rules.mjs", "/safety.mjs", "/recetas/budin-banana.jpg"]) assert.ok(resolvePublicFile(path), path);
  for (const path of ["/server.mjs", "/ai.mjs", "/db.mjs", "/.env", "/package.json", "/migrations/001_professional_accounts.sql", "/backups/x.enc", "/learning.mjs", "/evaluacion/evaluar.mjs", "/js/", "/recetas/"]) assert.equal(resolvePublicFile(path), null, path);
});

test("los trucos de ruta (..%2f, barras invertidas, nulos) no sacan archivos privados", () => {
  for (const path of ["/js/..%2fserver.mjs", "/js/..%2fai.mjs", "/recetas/..%2f..%2fdb.mjs", "/js/../server.mjs", "/js/%2e%2e/server.mjs", "/js/..\\server.mjs", "/js/%5c..%5cserver.mjs", "/js/util.js%00.png", "/js//util.js", "/js/./util.js", "/%E0%A4%A"]) assert.equal(resolvePublicFile(path), null, path);
});

test("todo lo que el navegador importa se puede descargar (si falta uno, la app entera no carga)", () => {
  const browserFiles = ["app.js", "portal.js", ...readdirSync(join(root, "js")).map(name => `js/${name}`)];
  const seen = new Set(); const queue = [...browserFiles];
  while (queue.length) {
    const file = queue.shift(); if (seen.has(file)) continue; seen.add(file);
    assert.ok(resolvePublicFile(`/${file}`), `/${file} no está publicado`);
    const source = readFileSync(join(root, file), "utf8");
    for (const match of source.matchAll(/from\s+["']([^"']+)["']/g)) {
      const spec = match[1]; if (!spec.startsWith(".") && !spec.startsWith("/")) continue;
      const target = spec.startsWith("/") ? spec.slice(1) : posix.normalize(posix.join(posix.dirname(file), spec));
      const clean = target.split("?")[0];
      assert.ok(existsSync(join(root, clean)), `${file} importa ${spec}, que no existe`);
      queue.push(clean);
    }
  }
});

test("el service worker solo precarga archivos públicos", () => {
  const source = readFileSync(join(root, "sw.js"), "utf8");
  const list = source.match(/const FILES = \[([\s\S]*?)\];/)[1];
  for (const match of list.matchAll(/"([^"]+)"/g)) assert.ok(resolvePublicFile(match[1].split("?")[0]), match[1]);
});

test("la dirección de quien consulta usa el proxy solo cuando corresponde", () => {
  const req = { headers: { "x-forwarded-for": "190.1.2.3, 10.0.0.1" }, socket: { remoteAddress: "10.0.0.9" } };
  assert.equal(clientIp(req, true), "190.1.2.3");
  assert.equal(clientIp(req, false), "10.0.0.9");
  assert.equal(clientIp({ headers: {}, socket: {} }, true), "unknown");
});

test("los pedidos que cambian datos tienen que venir de esta misma página", () => {
  const post = origin => ({ method: "POST", headers: { host: "app.onrender.com", ...(origin ? { origin } : {}) } });
  assert.equal(sameOriginOk(post("https://app.onrender.com")), true);
  assert.equal(sameOriginOk(post("https://otro-sitio.com")), false);
  assert.equal(sameOriginOk(post("null")), false);
  assert.equal(sameOriginOk(post(undefined)), true);
  assert.equal(sameOriginOk({ method: "GET", headers: { host: "a", origin: "https://b" } }), true);
});

test("el portal no recibe notas internas del borrador", () => {
  const day = { day: "Lunes", breakfast: "Café con leche", snack1: "", lunch: "Porción de carne", snack2: "", merienda: "Yogur con fruta", dinner: "Tarta", extra: "Fruta", reviewNote: "SECRETO", internal: 1 };
  const view = portalDraftView({ intro: "Hola", days: [day], recommendations: ["Tomar agua", 5], reviewNotes: ["Revisar alergia a X"], secret: "x" });
  const text = JSON.stringify(view);
  assert.ok(!text.includes("SECRETO") && !text.includes("Revisar alergia") && !text.includes("secret"));
  assert.equal(view.days[0].merienda, "Yogur con fruta");
  assert.deepEqual(view.recommendations, ["Tomar agua"]);
  assert.equal(portalDraftView(null), null);
  assert.equal(portalDraftView({ days: "x" }), null);
});
