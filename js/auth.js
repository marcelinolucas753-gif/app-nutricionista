import { $, api, escapeHTML, initials, toast } from "./util.js";
import { S, flushSave, hooks, loadCloudData } from "./state.js";
import { backupAdvice } from "./logic.js";

let installPrompt = null;
let bannerDismissed = false;

export function renderBackupBanner() {
  const advice = backupAdvice(S.backup);
  const banner = $("backup-banner");
  banner.classList.toggle("hidden", advice.level === "ok" || bannerDismissed || !S.authenticated);
  banner.querySelector("span").textContent = advice.text;
  const line = $("backup-status");
  if (line) { line.textContent = advice.text; line.className = `backup-note backup-${advice.level}`; }
}

function showSignedOut(message = "") {
  S.authenticated = false; S.professional = null;
  S.patients = []; S.appointments = []; S.templates = []; S.aiSettings = { foodsCommon: null, foodsAvoid: null, extraRules: "" }; S.dirty = false;
  $("login-gate").classList.remove("hidden");
  document.querySelector(".app-shell").classList.add("hidden");
  for (const id of ["signout", "change-password"]) $(id).classList.add("hidden");
  $("login-error").textContent = message;
  hooks.rerender();
}

export async function refreshAuth() {
  try {
    const status = await api("/api/status");
    if (!status.authenticated) { showSignedOut(); return; }
    S.authenticated = true; S.professional = status.professional || null; S.backup = status.backup || null;
    $("login-gate").classList.add("hidden");
    document.querySelector(".app-shell").classList.remove("hidden");
    for (const id of ["signout", "change-password"]) $(id).classList.remove("hidden");
    const name = S.professional?.name || "Profesional";
    $("profile-name").textContent = name;
    $("profile-avatar").textContent = initials(name);
    $("welcome-title").innerHTML = `Hola, ${escapeHTML(name)} <span class="wave">✳</span>`;
    renderBackupBanner();
    await loadCloudData();
  } catch {
    showSignedOut("No se pudo conectar con la app. Verificá que el servidor y la base estén disponibles.");
  }
}

/** Se usa cuando otro dispositivo guardó antes: se descarta lo local y se carga lo más reciente. */
hooks.reauth = async () => { S.authenticated = false; await refreshAuth(); };

function openPasswordDialog() {
  const dialog = $("password-dialog");
  $("password-form").reset();
  $("password-error").textContent = "";
  if (typeof dialog.showModal === "function") dialog.showModal(); else dialog.setAttribute("open", "");
}
function closePasswordDialog() { const dialog = $("password-dialog"); if (typeof dialog.close === "function") dialog.close(); else dialog.removeAttribute("open"); }

export function initAuth() {
  const form = $("login-form");
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const button = form.querySelector("button[type=submit]"), error = $("login-error");
    button.disabled = true; error.textContent = "";
    try {
      await api("/api/login", { method: "POST", body: { email: form.elements.email.value, password: form.elements.password.value } });
      form.reset(); await refreshAuth();
    } catch (err) { error.textContent = err.message || "No se pudo iniciar sesión."; }
    finally { button.disabled = false; }
  });

  $("signout").addEventListener("click", async () => {
    const saved = await flushSave();
    if (!saved && !window.confirm("Hay cambios que todavía no se guardaron en la cuenta. Si salís ahora se pierden. ¿Salir igual?")) return;
    try { await api("/api/logout", { method: "POST" }); } catch { /* la sesión vence sola */ }
    showSignedOut();
  });

  $("change-password").addEventListener("click", openPasswordDialog);
  $("password-cancel").addEventListener("click", closePasswordDialog);
  $("password-form").addEventListener("submit", async event => {
    event.preventDefault();
    const f = event.currentTarget, error = $("password-error");
    error.textContent = "";
    if (f.elements.newPassword.value.length < 12) { error.textContent = "La contraseña nueva debe tener al menos 12 caracteres."; return; }
    if (f.elements.newPassword.value !== f.elements.confirmPassword.value) { error.textContent = "Las dos contraseñas nuevas no coinciden."; return; }
    const button = f.querySelector("button[type=submit]"); button.disabled = true;
    try {
      await api("/api/change-password", { method: "POST", body: { currentPassword: f.elements.currentPassword.value, newPassword: f.elements.newPassword.value } });
      closePasswordDialog(); toast("Contraseña actualizada.");
    } catch (err) { error.textContent = err.message || "No se pudo cambiar la contraseña."; }
    finally { button.disabled = false; f.elements.currentPassword.value = ""; f.elements.newPassword.value = ""; f.elements.confirmPassword.value = ""; }
  });

  $("backup-dismiss").addEventListener("click", () => { bannerDismissed = true; renderBackupBanner(); });

  // Instalar como app
  const button = $("install-app");
  const standalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  if (!standalone && (location.protocol === "https:" || ["localhost", "127.0.0.1"].includes(location.hostname))) button.classList.remove("hidden");
  window.addEventListener("beforeinstallprompt", event => { event.preventDefault(); installPrompt = event; button.classList.remove("hidden"); });
  button.addEventListener("click", async () => {
    if (installPrompt) {
      installPrompt.prompt();
      const result = await installPrompt.userChoice;
      if (result.outcome === "accepted") button.classList.add("hidden");
      installPrompt = null; return;
    }
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    toast(ios ? "En Safari, tocá Compartir y elegí Agregar a pantalla de inicio." : "Abrí el menú del navegador ⋮ y elegí Instalar app o Añadir a pantalla de inicio.");
  });
  window.addEventListener("appinstalled", () => { button.classList.add("hidden"); toast("¡Nutri Guía quedó instalada en tu celular!"); });
}
