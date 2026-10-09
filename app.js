import { $, todayISO } from "./js/util.js";
import { S, checkForRemoteChanges, hooks } from "./js/state.js";
import { nav, setPage } from "./js/nav.js";
import { initAgenda, renderAgenda } from "./js/agenda.js";
import { initPatients, refreshAll } from "./js/patients.js";
import { initDetail, renderDetail } from "./js/detail.js";
import { initAuth, refreshAuth, renderBackupBanner } from "./js/auth.js";

// Las pantallas se conectan acá. Cada archivo de /js tiene una sola responsabilidad.
initAgenda();
initPatients();
initDetail();
initAuth();

hooks.rerender = () => {
  refreshAll();
  renderBackupBanner();
  if (nav.state.page === "detail") { if (S.patients.some(person => person.id === nav.state.selectedId)) renderDetail(); else setPage("patients"); }
};

document.querySelectorAll(".nav-item, [data-page]").forEach(button => button.addEventListener("click", () => {
  setPage(button.dataset.page);
  if (button.dataset.page === "agenda") renderAgenda();
}));
$("mobile-menu").addEventListener("click", () => $("sidebar").classList.toggle("open"));
$("today").textContent = new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short", year: "numeric" }).format(new Date());

// Aviso si se cierra la pestaña con cambios sin guardar.
window.addEventListener("beforeunload", event => { if (S.dirty || S.saving) { event.preventDefault(); event.returnValue = ""; } });

refreshAuth();
setInterval(checkForRemoteChanges, 30_000);
setInterval(() => { if (S.authenticated && !S.dirty) renderAgenda(); }, 5 * 60_000);
if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js?v=13").catch(() => {}));

export { todayISO };
