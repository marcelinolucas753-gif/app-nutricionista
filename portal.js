function escapeHTML(value = "") { return String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]); }
function formatDate(value) { if (!value) return "Sin fecha"; return new Date(`${value}T12:00:00`).toLocaleDateString("es-AR", { day: "numeric", month: "short", year: "numeric" }); }

let portalToken = localStorage.getItem("nutri_portal_token");
let isHash = false;
let toastTimer;
function toast(message) { const el = document.getElementById("toast"); el.textContent = message; el.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove("show"), 3400); }

async function checkTokenInUrl() {
  const pathParts = window.location.pathname.split('/');
  if (pathParts.length >= 3 && pathParts[1] === 'portal') {
    portalToken = pathParts[2];
    isHash = true;
    localStorage.setItem("nutri_portal_token", portalToken);
    localStorage.setItem("nutri_portal_ishash", "true");
    window.history.replaceState({}, document.title, "/portal");
  } else {
    isHash = localStorage.getItem("nutri_portal_ishash") === "true";
  }
}

async function fetchPortalData() {
  if (!portalToken) return showLogin();
  try {
    const res = await fetch("/api/portal/data", {
      headers: { "Authorization": `Bearer ${portalToken}`, "x-is-hash": String(isHash) }
    });
    const body = await res.json();
    if (!res.ok) {
      if (res.status === 401) { logout(); throw new Error(body.error || "Acceso revocado o inválido"); }
      throw new Error(body.error || "Error al cargar datos");
    }
    renderPortal(body);
  } catch (err) {
    document.getElementById("portal-login-error").textContent = err.message;
  }
}

function showLogin() {
  document.getElementById("portal-login-gate").classList.remove("hidden");
  document.getElementById("portal-shell").classList.add("hidden");
}

function logout() {
  localStorage.removeItem("nutri_portal_token");
  localStorage.removeItem("nutri_portal_ishash");
  portalToken = null;
  isHash = false;
  showLogin();
}

function renderPortal(data) {
  document.getElementById("portal-login-gate").classList.add("hidden");
  document.getElementById("portal-shell").classList.remove("hidden");
  
  document.getElementById("portal-prof-name").textContent = `Profesional: ${data.professionalName}`;
  const nameParts = data.patientName.split(" ");
  document.getElementById("portal-welcome-name").textContent = `Hola, ${escapeHTML(nameParts[0])} ✳`;
  
  if (data.nextAppointment) {
    const apptEl = document.getElementById("portal-next-appointment");
    apptEl.textContent = `Próximo turno: ${new Date(data.nextAppointment).toLocaleString("es-AR", { dateStyle: "long", timeStyle: "short" })}`;
    apptEl.classList.remove("hidden");
  }

  // Render Plan
  const planEl = document.getElementById("portal-draft-content");
  if (data.draft) {
    let html = `<div class="draft-intro">${escapeHTML(data.draft.intro)}</div>`;
    const DAYS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
    const MEALS = [["breakfast", "Desayuno"], ["snack1", "Colación mañana"], ["lunch", "Almuerzo"], ["snack2", "Colación tarde"], ["merienda", "Merienda"], ["dinner", "Cena"]];
    
    html += data.draft.days.map((day, idx) => `
      <details class="day-card" ${idx === 0 ? "open" : ""}>
        <summary><h3>${escapeHTML(day.day || DAYS[idx])}</h3></summary>
        <div class="meals-grid">
          ${MEALS.map(([key, title]) => day[key] ? `<div class="meal-edit"><label>${title}</label><div style="font-size:12px;color:var(--ink);padding:8px;background:#fbfcf9;border:1px solid #edf0eb;border-radius:8px;">${escapeHTML(day[key])}</div></div>` : "").join("")}
        </div>
        ${day.extra ? `<div style="margin:13px;padding:10px;background:#f4f2e9;border-radius:8px;font-size:11px;color:#756a53;"><strong>Alternativa:</strong> ${escapeHTML(day.extra)}</div>` : ""}
      </details>
    `).join("");

    if (data.draft.recommendations && data.draft.recommendations.length > 0) {
      html += `<div class="recommendations"><h3>Recomendaciones</h3><ul>${data.draft.recommendations.map(r => `<li>${escapeHTML(r)}</li>`).join("")}</ul></div>`;
    }

    if (data.recipes && data.recipes.length > 0) {
      html += `<div class="recipe-drafts" style="margin-top:20px;"><h3>Recetas de tu plan</h3>${data.recipes.map(recipe => `
        <article class="recipe-draft">
          <strong>${escapeHTML(recipe.name)} · ${escapeHTML(recipe.portions)}</strong>
          <ul>${(recipe.ingredients || []).map(i => `<li>${escapeHTML(i.quantity)} ${escapeHTML(i.measure)} de ${escapeHTML(i.ingredient)}</li>`).join("")}</ul>
          <ol>${(recipe.steps || []).map(step => `<li>${escapeHTML(step)}</li>`).join("")}</ol>
          <small>${Number(recipe.timeMinutes) || ""} min · ${escapeHTML(recipe.difficulty || "")}</small>
        </article>
      `).join("")}</div>`;
    }
    planEl.innerHTML = html;
  }

  // Render Measurements & Chart
  const tableEl = document.getElementById("portal-weight-table");
  const chartEl = document.getElementById("portal-weight-chart");
  if (data.measurements && data.measurements.length > 0) {
    const validWeights = data.measurements.filter(m => m.weight).reverse(); // chronological for chart
    
    tableEl.innerHTML = data.measurements.map(m => `<tr><td>${formatDate(m.date)}</td><td>${m.weight ? m.weight + " kg" : "—"}</td><td>${m.height ? m.height + " cm" : "—"}</td></tr>`).join("");
    
    if (validWeights.length > 1) {
      const minW = Math.min(...validWeights.map(w => w.weight)) - 2;
      const maxW = Math.max(...validWeights.map(w => w.weight)) + 2;
      const rangeW = maxW - minW;
      
      const pts = validWeights.map((w, i) => {
        const x = (i / (validWeights.length - 1)) * 100;
        const y = 100 - (((w.weight - minW) / rangeW) * 100);
        return `${x},${y}`;
      }).join(" ");
      
      chartEl.innerHTML = `<svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" style="overflow:visible;">
        <polyline points="${pts}" fill="none" stroke="var(--green)" stroke-width="2" />
        ${validWeights.map((w, i) => {
          const x = (i / (validWeights.length - 1)) * 100;
          const y = 100 - (((w.weight - minW) / rangeW) * 100);
          return `<circle cx="${x}" cy="${y}" r="2" fill="#fff" stroke="var(--green)" stroke-width="1"><title>${w.weight} kg - ${formatDate(w.date)}</title></circle>`;
        }).join("")}
      </svg>`;
    } else {
      chartEl.innerHTML = `<div class="empty-state">No hay suficientes datos para el gráfico.</div>`;
    }
  } else {
    tableEl.innerHTML = `<tr><td colspan="3">Todavía no hay mediciones.</td></tr>`;
    chartEl.innerHTML = `<div class="empty-state">No hay mediciones registradas.</div>`;
  }

  // Render Consultations
  const consultList = document.getElementById("portal-consultations-list");
  if (data.consultations && data.consultations.length > 0) {
    consultList.innerHTML = data.consultations.map(c => `
      <div class="history-card">
        <strong>${formatDate(c.date)} · Consulta</strong>
      </div>
    `).join("");
  } else {
    consultList.innerHTML = `<div class="empty-state">No hay consultas previas.</div>`;
  }
}

document.querySelectorAll("[data-ptab]").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("[data-ptab]").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    document.querySelectorAll(".detail-panel").forEach(p => p.classList.add("hidden"));
    document.getElementById(`ptab-${btn.dataset.ptab}`).classList.remove("hidden");
  });
});

document.getElementById("portal-login-form").addEventListener("submit", async e => {
  e.preventDefault();
  const code = document.getElementById("portal-code").value.trim();
  const btn = e.target.querySelector("button");
  const errEl = document.getElementById("portal-login-error");
  btn.disabled = true; errEl.textContent = "";
  try {
    const res = await fetch("/api/portal/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    portalToken = data.token;
    isHash = true; // Auth by code returns token_hash
    localStorage.setItem("nutri_portal_token", portalToken);
    localStorage.setItem("nutri_portal_ishash", "true");
    fetchPortalData();
  } catch (err) {
    errEl.textContent = err.message;
  } finally {
    btn.disabled = false;
  }
});

document.getElementById("portal-logout").addEventListener("click", logout);

document.getElementById("portal-weight-form").addEventListener("submit", async e => {
  e.preventDefault();
  const form = e.target;
  const weight = Number(form.weight.value);
  const date = form.date.value;
  const btn = form.querySelector("button");
  btn.disabled = true;
  try {
    const res = await fetch("/api/portal/weight", {
      method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${portalToken}`, "x-is-hash": String(isHash) },
      body: JSON.stringify({ weight, date })
    });
    if (!res.ok) throw new Error("Error al guardar");
    toast("Peso guardado. Lo verá tu profesional en la próxima consulta.");
    form.reset();
    form.date.value = new Date().toISOString().split('T')[0];
    fetchPortalData();
  } catch (err) { toast(err.message); }
  finally { btn.disabled = false; }
});

document.getElementById("portal-note-form").addEventListener("submit", async e => {
  e.preventDefault();
  const form = e.target;
  const note = form.note.value;
  const date = new Date().toISOString().split('T')[0];
  const btn = form.querySelector("button");
  btn.disabled = true;
  try {
    const res = await fetch("/api/portal/note", {
      method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${portalToken}`, "x-is-hash": String(isHash) },
      body: JSON.stringify({ note, date })
    });
    if (!res.ok) throw new Error("Error al guardar");
    toast("Nota enviada a tu ficha.");
    form.reset();
  } catch (err) { toast(err.message); }
  finally { btn.disabled = false; }
});

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("portal-weight-date").value = new Date().toISOString().split('T')[0];
  checkTokenInUrl().then(fetchPortalData);
});
