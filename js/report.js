import { escapeHTML, formatDate, patientName, toast, todayISO } from "./util.js";
import { S } from "./state.js";
import { buildProgressReport } from "./logic.js";
import { lineChartSVG } from "../charts.mjs";

/** Informe de evolución: una hoja para la persona, lista para guardar como PDF desde el diálogo de impresión. */
const num = value => value == null ? "—" : String(Math.round(value * 10) / 10).replace(".", ",");
const signed = value => `${value > 0 ? "+" : value < 0 ? "−" : ""}${num(Math.abs(value))}`;

export function progressReportHTML(report) {
  const { series } = report;
  const charts = [];
  if (series.weight.length > 1) charts.push(`<figure class="report-chart"><figcaption>Peso (kg)</figcaption>${lineChartSVG({ title: "Peso", unit: "kg", series: [{ name: "Peso", color: "#14694f", points: series.weight }], height: 220 })}</figure>`);
  if (series.waist.length > 1 || series.hip.length > 1) charts.push(`<figure class="report-chart"><figcaption>Cintura y cadera (cm)</figcaption>${lineChartSVG({ title: "Cintura y cadera", unit: "cm", series: [{ name: "Cintura", color: "#14694f", points: series.waist }, { name: "Cadera", color: "#c26a2c", points: series.hip }], height: 220 })}</figure>`);
  const change = report.change
    ? `<p class="report-summary">Entre el ${escapeHTML(formatDate(report.change.since))} y el último registro, tu peso pasó de <strong>${num(report.change.from)} kg</strong> a <strong>${num(report.change.to)} kg</strong> (${signed(report.change.delta)} kg).</p>` : "";
  const table = report.rows.length
    ? `<table class="report-table"><thead><tr><th>Fecha</th><th>Peso (kg)</th><th>Talla (cm)</th><th>Cintura (cm)</th><th>Cadera (cm)</th></tr></thead><tbody>${[...report.rows].reverse().map(row => `<tr><td>${escapeHTML(formatDate(row.date))}</td><td>${num(row.weight)}</td><td>${num(row.height)}</td><td>${num(row.waist)}</td><td>${num(row.hip)}</td></tr>`).join("")}</tbody></table>` : "";
  const goal = list => `<ul>${list.map(item => `<li>${escapeHTML(item.text)}${item.targetDate ? ` <small>(para el ${escapeHTML(formatDate(item.targetDate))})</small>` : ""}</li>`).join("")}</ul>`;
  const goals = report.goals.active.length || report.goals.achieved.length
    ? `<section><h2>Mis metas</h2>${report.goals.active.length ? `<h3>En curso</h3>${goal(report.goals.active)}` : ""}${report.goals.achieved.length ? `<h3>Logradas ✓</h3>${goal(report.goals.achieved)}` : ""}</section>` : "";
  const recommendations = report.recommendations.length ? `<section><h2>Para seguir trabajando</h2><ul>${report.recommendations.map(item => `<li>${escapeHTML(item)}</li>`).join("")}</ul></section>` : "";
  return `<article class="report-document"><header><h1>Informe de evolución</h1><p><strong>${escapeHTML(report.name || "Paciente")}</strong> · ${escapeHTML(formatDate(report.generatedOn))}${report.professionalName ? ` · ${escapeHTML(report.professionalName)}` : ""}</p></header>`
    + (report.rows.length ? `<section><h2>Mediciones</h2>${change}${charts.join("")}${table}</section>` : "")
    + goals + recommendations
    + `<footer><p>Este informe resume los registros de tu seguimiento. Cada cambio es parte de un proceso y las decisiones sobre tu alimentación se conversan en consulta.</p></footer></article>`;
}

/** Arma el informe de una ficha y abre el diálogo de impresión («Guardar como PDF»). */
export async function printProgressReport(person) {
  const report = buildProgressReport(person, { name: patientName(person), professionalName: S.professional?.name || "", today: todayISO() });
  if (!report.hasContent) { toast("Todavía no hay mediciones, metas visibles ni plan aprobado para armar el informe."); return; }
  document.getElementById("print-report-area")?.remove();
  const area = document.createElement("div");
  area.id = "print-report-area"; area.className = "print-report"; area.innerHTML = progressReportHTML(report);
  document.body.append(area);
  document.body.classList.add("printing-report");
  window.addEventListener("afterprint", () => { document.body.classList.remove("printing-report"); area.remove(); }, { once: true });
  window.print();
}
