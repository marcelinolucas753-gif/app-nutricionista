import { DAY_NAMES as DAYS, MEAL_SLOTS as MEALS } from "/safety.mjs";
import { lineChartSVG } from "/charts.mjs";

const SESSION_KEY = "nutri_portal_session";
const $ = id => document.getElementById(id);
let session = null;
try { session = localStorage.getItem(SESSION_KEY); } catch { /* sin almacenamiento */ }
let toastTimer;

const escapeHTML = (value = "") => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const formatDate = value => value ? new Date(`${String(value).slice(0, 10)}T12:00:00`).toLocaleDateString("es-AR", { day: "numeric", month: "short", year: "numeric" }) : "Sin fecha";
/** Fecha de hoy en la zona horaria de la persona (no en UTC, que a la noche ya es "mañana"). */
function todayLocal() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function toast(message) { const el = $("toast"); el.textContent = message; el.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove("show"), 4200); }
function saveSession(value) { session = value; try { value ? localStorage.setItem(SESSION_KEY, value) : localStorage.removeItem(SESSION_KEY); } catch { /* sin almacenamiento */ } }

async function call(path, { method = "GET", body, auth = true } = {}) {
  const headers = {};
  if (body) headers["Content-Type"] = "application/json";
  if (auth && session) headers.Authorization = `Bearer ${session}`;
  const response = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined, cache: "no-store" });
  let payload = {};
  try { payload = await response.json(); } catch { /* sin cuerpo */ }
  if (!response.ok) throw Object.assign(new Error(payload.error || "No se pudo completar la solicitud."), { status: response.status });
  return payload;
}

function showLogin(message = "") {
  $("portal-login-gate").classList.remove("hidden");
  $("portal-shell").classList.add("hidden");
  $("portal-login-error").textContent = message;
}

async function loadPortal() {
  if (!session) { showLogin(); return; }
  try { render(await call("/api/portal/data")); }
  catch (error) {
    if (error.status === 401) { saveSession(null); showLogin("Tu acceso venció o fue quitado. Ingresá con el código nuevo que te dé tu profesional."); }
    else { showLogin(error.message); }
  }
}

/** Si la dirección trae el enlace personal, se canjea por una sesión y se limpia la barra de direcciones. */
async function consumeLink() {
  const parts = location.pathname.split("/").filter(Boolean);
  if (parts[0] !== "portal" || !parts[1]) return;
  try {
    const result = await call("/api/portal/auth", { method: "POST", body: { token: decodeURIComponent(parts[1]) }, auth: false });
    saveSession(result.token);
  } catch (error) { saveSession(null); showLogin(error.message); }
  history.replaceState({}, document.title, "/portal");
}

function mealBlocks(day) {
  return MEALS.map(([key, title]) => day[key] ? `<div class="meal-edit"><label>${escapeHTML(title)}</label><div class="portal-meal">${escapeHTML(day[key])}</div></div>` : "").join("");
}

function render(data) {
  $("portal-login-gate").classList.add("hidden");
  $("portal-shell").classList.remove("hidden");
  $("portal-prof-name").textContent = data.professionalName ? `Profesional: ${data.professionalName}` : "";
  const first = String(data.patientName || "").trim().split(/\s+/)[0];
  $("portal-welcome-name").textContent = first && !/^paciente$/i.test(first) ? `Hola, ${first} ✳` : "Hola ✳";

  const appt = $("portal-next-appointment");
  if (data.nextAppointment) { appt.textContent = `Próximo turno: ${new Date(data.nextAppointment).toLocaleString("es-AR", { dateStyle: "long", timeStyle: "short" })}`; appt.classList.remove("hidden"); }
  else appt.classList.add("hidden");

  // Metas
  const goals = $("portal-goals");
  if (data.goals?.length) {
    goals.innerHTML = `<h2>Mis metas</h2>${data.goals.map(goal => `<div class="portal-goal ${goal.status === "achieved" ? "achieved" : ""}"><span>${goal.status === "achieved" ? "✓" : goal.status === "dropped" ? "–" : "○"}</span><span>${escapeHTML(goal.text)}${goal.targetDate ? ` <small class="qty">· para el ${formatDate(goal.targetDate)}</small>` : ""}</span></div>`).join("")}`;
    goals.classList.remove("hidden");
  } else goals.classList.add("hidden");

  // Plan
  const plan = $("portal-draft-content");
  if (data.draft?.days) {
    let html = `<div class="draft-intro">${escapeHTML(data.draft.intro || "")}</div>`;
    html += data.draft.days.map((day, index) => `<details class="day-card" ${index === 0 ? "open" : ""}><summary><h3>${escapeHTML(day.day || DAYS[index])}</h3></summary><div class="meals-grid">${mealBlocks(day)}</div>${day.extra ? `<div class="portal-alt"><strong>Alternativa:</strong> ${escapeHTML(day.extra)}</div>` : ""}</details>`).join("");
    if (data.draft.recommendations?.length) html += `<div class="recommendations"><h3>Recomendaciones</h3><ul>${data.draft.recommendations.map(item => `<li>${escapeHTML(item)}</li>`).join("")}</ul></div>`;
    if (data.recipes?.length) html += `<div class="recipe-drafts" style="margin-top:20px;"><h3>Recetas de tu plan</h3>${data.recipes.map(recipe => `<article class="recipe-draft"><strong>${escapeHTML(recipe.name)} · ${escapeHTML(recipe.portions)}</strong><ul>${(recipe.ingredients || []).map(item => `<li>${escapeHTML(item.quantity)} ${escapeHTML(item.measure)} de ${escapeHTML(item.ingredient)}</li>`).join("")}</ul><ol>${(recipe.steps || []).map(step => `<li>${escapeHTML(step)}</li>`).join("")}</ol><small>${Number(recipe.timeMinutes) || ""} min · ${escapeHTML(recipe.difficulty || "")}</small></article>`).join("")}</div>`;
    plan.innerHTML = html;
  } else plan.innerHTML = `<div class="empty-state">Tu profesional todavía no aprobó un plan. Cuando lo haga, lo vas a ver acá.</div>`;

  // Compras
  const shopping = $("portal-shopping");
  shopping.innerHTML = data.shoppingList?.categories?.length
    ? `<h2>Lista de compras de la semana</h2><div class="shopping-grid">${data.shoppingList.categories.map(category => `<section class="shopping-category"><h4>${escapeHTML(category.name)}</h4><ul>${(category.items || []).map(item => `<li>${escapeHTML(item.item)}${item.quantity ? ` <span class="qty">— ${escapeHTML(item.quantity)}</span>` : ""}</li>`).join("")}</ul></section>`).join("")}</div><small class="metric-caption">Las cantidades son orientativas.</small>`
    : `<div class="empty-state">Todavía no hay una lista de compras.</div>`;

  // Pesos
  const pending = $("portal-pending");
  if (data.pendingWeights?.length) { pending.innerHTML = `Enviaste ${data.pendingWeights.length} peso(s) que tu profesional todavía no revisó: ${data.pendingWeights.map(item => `${escapeHTML(item.weight)} kg (${formatDate(item.date)})`).join(", ")}.`; pending.classList.remove("hidden"); }
  else pending.classList.add("hidden");
  const measures = data.measurements || [];
  $("portal-weight-table").innerHTML = measures.length ? measures.map(item => `<tr><td>${formatDate(item.date)}</td><td>${item.weight ? `${escapeHTML(item.weight)} kg` : "—"}</td><td>${item.height ? `${escapeHTML(item.height)} cm` : "—"}</td></tr>`).join("") : `<tr><td colspan="3">Todavía no hay mediciones.</td></tr>`;
  const points = measures.filter(item => item.weight).map(item => ({ date: item.date, value: item.weight }));
  $("portal-weight-chart").innerHTML = points.length > 1 ? lineChartSVG({ title: "Mi peso", unit: "kg", series: [{ name: "Peso", color: "var(--primary)", points }] }) : `<div class="empty-state">Con dos o más pesos registrados vas a ver tu gráfico.</div>`;

  $("portal-consultations-list").innerHTML = data.consultations?.length ? data.consultations.map(item => `<div class="history-card"><strong>${formatDate(item.date)} · Consulta</strong></div>`).join("") : `<div class="empty-state">No hay consultas previas.</div>`;
}

document.querySelectorAll("[data-ptab]").forEach(button => button.addEventListener("click", () => {
  document.querySelectorAll("[data-ptab]").forEach(other => other.classList.toggle("active", other === button));
  document.querySelectorAll(".portal-wrap .detail-panel").forEach(panel => panel.classList.add("hidden"));
  $(`ptab-${button.dataset.ptab}`).classList.remove("hidden");
}));

$("portal-login-form").addEventListener("submit", async event => {
  event.preventDefault();
  const button = event.currentTarget.querySelector("button");
  button.disabled = true; $("portal-login-error").textContent = "";
  try {
    const result = await call("/api/portal/auth", { method: "POST", body: { code: $("portal-code").value.trim() }, auth: false });
    saveSession(result.token); await loadPortal();
  } catch (error) { $("portal-login-error").textContent = error.message; }
  finally { button.disabled = false; }
});

$("portal-logout").addEventListener("click", async () => {
  try { await call("/api/portal/logout", { method: "POST" }); } catch { /* igual se cierra en este dispositivo */ }
  saveSession(null); showLogin();
});

function submitter(form, path, buildBody, okMessage, after) {
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const button = form.querySelector("button"); button.disabled = true;
    try { await call(path, { method: "POST", body: buildBody(form) }); toast(okMessage); form.reset(); after?.(form); }
    catch (error) {
      if (error.status === 401) { saveSession(null); showLogin("Tu acceso venció. Ingresá de nuevo."); }
      else toast(error.message);
    } finally { button.disabled = false; }
  });
}
submitter($("portal-weight-form"), "/api/portal/weight", form => ({ weight: Number(form.weight.value), date: form.date.value }), "Peso enviado. Tu profesional lo va a revisar.", form => { form.date.value = todayLocal(); loadPortal(); });
submitter($("portal-note-form"), "/api/portal/note", form => ({ note: form.note.value, date: todayLocal() }), "Nota enviada a tu profesional.");

$("portal-weight-date").value = todayLocal();
$("portal-weight-date").max = todayLocal();
consumeLink().then(loadPortal);
if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js?v=12").catch(() => {}));
