import { $ } from "./util.js";

/** Las pantallas se registran acá al arrancar (nav.openPatient = …) y se llaman entre sí sin importarse. */
export const nav = {
  state: { page: "home", selectedId: null, detailTab: "summary", editingId: null },
  openPatient: () => {}, openForm: () => {}, openAppointmentForm: () => {}, refreshDetail: () => {}
};

const TITLES = { home: "Inicio", patients: "Mis pacientes", form: "Ficha individual", detail: "Ficha", agenda: "Agenda", settings: "Ajustes de la IA" };

export function setPage(page) {
  nav.state.page = page;
  for (const id of ["home", "patients", "form", "detail", "agenda", "settings"]) $(`page-${id}`).classList.toggle("hidden", id !== page);
  $("crumb").textContent = TITLES[page];
  const highlighted = page === "detail" || page === "form" ? "patients" : page;
  document.querySelectorAll(".nav-item").forEach(button => button.classList.toggle("active", button.dataset.page === highlighted));
  $("sidebar").classList.remove("open");
  document.querySelector(".mobile-bottom-nav").classList.toggle("hidden", page === "form");
  window.scrollTo({ top: 0, behavior: "smooth" });
}
