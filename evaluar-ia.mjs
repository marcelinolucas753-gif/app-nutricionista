// Uso: npm run evaluar        (o doble clic en evaluar-ia.bat en Windows)
//      npm run evaluar -- --veces 3 --menus
// Necesita OPENAI_API_KEY en el archivo .env (el mismo de la app). Cada menú es una llamada real a OpenAI y tiene costo.
import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { formatReport, runEvaluation } from "./evaluacion/evaluar.mjs";

if (existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match && !line.trim().startsWith("#") && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}
if (!process.env.OPENAI_API_KEY) { console.error("Falta OPENAI_API_KEY en el archivo .env. Sin la clave no se puede evaluar con la IA real."); process.exit(1); }

const args = process.argv.slice(2);
const repetitions = Math.min(Math.max(Number(args[args.indexOf("--veces") + 1]) || 1, 1), 5);
const withMenus = args.includes("--menus");
console.log(`Generando menús de ejemplo (${repetitions} por ficha)… puede tardar unos minutos.\n`);
const evaluation = await runEvaluation({ repetitions, onProgress: item => console.log(`  ${item.error ? "✗" : "✓"} ${item.ficha} (intento ${item.run})`) });
const report = formatReport(evaluation, { withMenus: true });
console.log(`\n${formatReport(evaluation, { withMenus })}`);
mkdirSync("evaluacion/resultados", { recursive: true });
const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 16);
writeFileSync(`evaluacion/resultados/evaluacion-${stamp}.txt`, report);
writeFileSync(`evaluacion/resultados/evaluacion-${stamp}.json`, JSON.stringify(evaluation, null, 2));
console.log(`\nSe guardó el detalle con los menús completos en evaluacion/resultados/evaluacion-${stamp}.txt`);
