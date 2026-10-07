/**
 * Gráficos de línea en SVG (sin librerías). Se usa en la ficha del profesional
 * y en el portal del paciente. Los colores salen de variables CSS para que
 * funcionen también en modo oscuro.
 */

function esc(value) { return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]); }

function toTime(date) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(date ?? ""));
  return match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : NaN;
}

export function shortDate(date) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(date ?? ""));
  return match ? `${Number(match[3])}/${Number(match[2])}/${match[1].slice(2)}` : "";
}

function formatNumber(value) {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1).replace(".", ",");
}

/** Elige hasta `count` marcas "redondas" entre min y max. */
export function niceTicks(min, max, count = 4) {
  if (!(Number.isFinite(min) && Number.isFinite(max))) return [];
  if (min === max) { min -= 1; max += 1; }
  const span = max - min;
  const rough = span / Math.max(1, count);
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalized = rough / magnitude;
  const step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude;
  const first = Math.floor(min / step) * step;
  const ticks = [];
  for (let value = first; value <= max + step * 0.0001; value += step) ticks.push(Math.round(value * 1e6) / 1e6);
  return ticks;
}

/**
 * series: [{ name, color, points: [{ date: "YYYY-MM-DD", value: number }] }]
 * Devuelve el SVG como texto, o "" si no hay datos suficientes.
 */
export function lineChartSVG({ title = "", unit = "", series = [], width = 640, height = 240 } = {}) {
  const clean = series.map(item => ({
    name: item.name || "",
    color: item.color || "var(--primary)",
    points: (item.points || []).map(point => ({ date: point.date, value: Number(point.value), time: toTime(point.date) })).filter(point => Number.isFinite(point.value) && Number.isFinite(point.time)).sort((a, b) => a.time - b.time)
  })).filter(item => item.points.length);
  const all = clean.flatMap(item => item.points);
  if (!all.length) return "";

  const margin = { top: 16, right: 20, bottom: 34, left: 48 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const minTime = Math.min(...all.map(point => point.time));
  const maxTime = Math.max(...all.map(point => point.time));
  const rawMin = Math.min(...all.map(point => point.value));
  const rawMax = Math.max(...all.map(point => point.value));
  const pad = (rawMax - rawMin) * 0.12 || 1;
  const ticks = niceTicks(rawMin - pad, rawMax + pad, 4);
  const yMin = Math.min(ticks[0], rawMin - pad / 2);
  const yMax = Math.max(ticks[ticks.length - 1], rawMax + pad / 2);
  const x = time => margin.left + (maxTime === minTime ? innerWidth / 2 : ((time - minTime) / (maxTime - minTime)) * innerWidth);
  const y = value => margin.top + innerHeight - ((value - yMin) / (yMax - yMin)) * innerHeight;

  const grid = ticks.map(tick => `<line x1="${margin.left}" x2="${width - margin.right}" y1="${y(tick).toFixed(1)}" y2="${y(tick).toFixed(1)}" stroke="var(--border)" stroke-width="1"/><text x="${margin.left - 8}" y="${(y(tick) + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="var(--text-secondary)">${formatNumber(tick)}</text>`).join("");

  const dates = [...new Set(all.map(point => point.date))];
  const labelDates = dates.length <= 2 ? dates : [dates[0], dates[Math.floor(dates.length / 2)], dates[dates.length - 1]];
  const xLabels = labelDates.map((date, index) => {
    const anchor = index === 0 && labelDates.length > 1 ? "start" : index === labelDates.length - 1 && labelDates.length > 1 ? "end" : "middle";
    return `<text x="${x(toTime(date)).toFixed(1)}" y="${height - 10}" text-anchor="${anchor}" font-size="11" fill="var(--text-secondary)">${esc(shortDate(date))}</text>`;
  }).join("");

  const lines = clean.map(item => {
    const path = item.points.map(point => `${x(point.time).toFixed(1)},${y(point.value).toFixed(1)}`).join(" ");
    const polyline = item.points.length > 1 ? `<polyline points="${path}" fill="none" stroke="${esc(item.color)}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>` : "";
    const dots = item.points.map(point => `<circle cx="${x(point.time).toFixed(1)}" cy="${y(point.value).toFixed(1)}" r="4" fill="var(--bg-panel)" stroke="${esc(item.color)}" stroke-width="2"><title>${esc(item.name ? `${item.name}: ` : "")}${formatNumber(point.value)}${unit ? ` ${esc(unit)}` : ""} · ${esc(shortDate(point.date))}</title></circle>`).join("");
    return polyline + dots;
  }).join("");

  const legend = clean.length > 1 ? `<g font-size="11" fill="var(--text-secondary)">${clean.map((item, index) => `<rect x="${margin.left + index * 120}" y="2" width="10" height="10" rx="2" fill="${esc(item.color)}"/><text x="${margin.left + index * 120 + 15}" y="11">${esc(item.name)}</text>`).join("")}</g>` : "";
  const label = `${title ? `${title}. ` : ""}${all.length} registro${all.length === 1 ? "" : "s"}, desde ${shortDate(dates[0])} hasta ${shortDate(dates[dates.length - 1])}. Último valor: ${formatNumber(clean[0].points[clean[0].points.length - 1].value)}${unit ? ` ${unit}` : ""}.`;
  return `<svg class="line-chart" viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="${esc(label)}" preserveAspectRatio="xMidYMid meet">${grid}${xLabels}${legend}${lines}</svg>`;
}
