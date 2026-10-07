import test from "node:test";
import assert from "node:assert/strict";
import { lineChartSVG, niceTicks, shortDate } from "../charts.mjs";

test("sin datos no dibuja nada", () => {
  assert.equal(lineChartSVG({ series: [] }), "");
  assert.equal(lineChartSVG({ series: [{ points: [{ date: "mala", value: 5 }] }] }), "");
});

test("dibuja línea, puntos y descripción accesible", () => {
  const svg = lineChartSVG({ title: "Peso", unit: "kg", series: [{ name: "Peso", points: [{ date: "2026-03-01", value: 68.2 }, { date: "2026-01-02", value: 70.5 }, { date: "2026-02-10", value: 69 }] }] });
  assert.match(svg, /^<svg /);
  assert.equal((svg.match(/<circle /g) || []).length, 3);
  assert.equal((svg.match(/<polyline /g) || []).length, 1);
  assert.match(svg, /aria-label="Peso\. 3 registros, desde 2\/1\/26 hasta 1\/3\/26\. Último valor: 68,2 kg\./);
});

test("un solo punto no dibuja línea", () => {
  const svg = lineChartSVG({ series: [{ points: [{ date: "2026-01-02", value: 70 }] }] });
  assert.ok(svg.includes("<circle"));
  assert.ok(!svg.includes("<polyline"));
});

test("escapa el texto que viene de los datos", () => {
  const svg = lineChartSVG({ title: '<img src=x onerror=alert(1)>', series: [{ name: '"><script>', points: [{ date: "2026-01-02", value: 70 }] }] });
  assert.ok(!svg.includes("<img"));
  assert.ok(!svg.includes("<script>"));
});

test("marcas redondas y fechas cortas", () => {
  assert.deepEqual(niceTicks(0, 10, 5), [0, 2, 4, 6, 8, 10]);
  assert.equal(shortDate("2026-12-31"), "31/12/26");
  assert.equal(shortDate("x"), "");
});
