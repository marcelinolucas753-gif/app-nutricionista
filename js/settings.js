import { $, escapeHTML, toast } from "./util.js";
import { S, queueSave } from "./state.js";
import { FOODS_AVOID_BY_DEFAULT, FOODS_COMMON, MAX_EXTRA_RULES } from "../menu-rules.mjs";

/** Pantalla «Ajustes de la IA»: la profesional corrige las listas que usa la IA, sin tocar código. */
const lines = text => String(text || "").split(/\r?\n/).map(line => line.trim()).filter(Boolean);
const sameList = (a, b) => a.length === b.length && a.every((item, index) => item === b[index]);

export function renderSettings() {
  const root = $("page-settings");
  if (!root) return;
  const settings = S.aiSettings;
  const common = settings.foodsCommon || FOODS_COMMON, avoid = settings.foodsAvoid || FOODS_AVOID_BY_DEFAULT;
  const custom = Boolean(settings.foodsCommon || settings.foodsAvoid || settings.extraRules);
  root.innerHTML = `<div class="page-title-row"><div><div class="eyebrow">PERSONALIZACIÓN</div><h1>Ajustes de la IA</h1><p>Corregí las listas que la IA usa al armar menús. ${custom ? "Estás usando tus propias listas." : "Hoy se usan las listas originales."}</p></div></div>`
    + `<form id="settings-form" class="form-card settings-form">`
    + `<label>Alimentos habituales de la zona<textarea name="foodsCommon" rows="9">${escapeHTML(common.join("\n"))}</textarea><span class="optional">Un grupo por renglón; adentro, separá los alimentos con comas. La IA los prioriza.</span></label>`
    + `<label>Alimentos que la IA no debe usar<textarea name="foodsAvoid" rows="6">${escapeHTML(avoid.join("\n"))}</textarea><span class="optional">Un renglón por regla. Sirve para caros, difíciles de conseguir o que no se consumen en la zona.</span></label>`
    + `<label>Reglas propias (opcional)<textarea name="extraRules" rows="4" maxlength="${MAX_EXTRA_RULES}" placeholder="Ejemplo: Incluir siempre una fruta en la merienda.">${escapeHTML(settings.extraRules || "")}</textarea><span class="optional">Se suman a las reglas de la app. Nunca anulan alergias ni alimentos que la persona evita.</span></label>`
    + `<div class="settings-actions"><button class="button button-primary" type="submit">Guardar ajustes</button><button class="button button-quiet" type="button" id="settings-reset">Volver a las listas originales</button></div>`
    + `<p class="metric-caption">Los cambios se usan en los próximos menús y reemplazos de comida. Lo que la ficha indica (alergias, alimentos evitados) siempre tiene prioridad.</p></form>`;
  $("settings-form").addEventListener("submit", event => {
    event.preventDefault();
    const form = event.currentTarget;
    const nextCommon = lines(form.elements.foodsCommon.value), nextAvoid = lines(form.elements.foodsAvoid.value);
    S.aiSettings = {
      foodsCommon: !nextCommon.length || sameList(nextCommon, FOODS_COMMON) ? null : nextCommon,
      foodsAvoid: !nextAvoid.length || sameList(nextAvoid, FOODS_AVOID_BY_DEFAULT) ? null : nextAvoid,
      extraRules: form.elements.extraRules.value.replace(/\s+/g, " ").trim().slice(0, MAX_EXTRA_RULES)
    };
    queueSave(); renderSettings(); toast("Ajustes guardados. Se usarán en los próximos menús.");
  });
  $("settings-reset").addEventListener("click", () => {
    if (!window.confirm("¿Volver a las listas originales y borrar tus reglas propias?")) return;
    S.aiSettings = { foodsCommon: null, foodsAvoid: null, extraRules: "" };
    queueSave(); renderSettings(); toast("Se restauraron las listas originales.");
  });
}
