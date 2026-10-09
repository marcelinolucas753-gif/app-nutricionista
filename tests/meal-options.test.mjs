import test from "node:test";
import assert from "node:assert/strict";
import { QUICK_OPTIONS, buildReplaceInstruction } from "../js/meal-options.js";

test("sin opciones ni texto, la instrucción queda vacía", () => {
  assert.equal(buildReplaceInstruction([], ""), "");
  assert.equal(buildReplaceInstruction(), "");
  assert.equal(buildReplaceInstruction([], "   "), "");
});

test("une las opciones tocadas y el texto libre, en el orden de los botones", () => {
  const text = buildReplaceInstruction(["sin_horno", "barata"], "  sin pollo ");
  assert.equal(text, "Que la nueva comida sea más económica, que no necesite horno. sin pollo");
  assert.equal(buildReplaceInstruction(["simple"]), "Que la nueva comida sea más simple y rápida de preparar.");
});

test("ignora opciones desconocidas y no pasa de 500 caracteres", () => {
  assert.equal(buildReplaceInstruction(["inventada"], ""), "");
  assert.equal(buildReplaceInstruction(QUICK_OPTIONS.map(([key]) => key), "x".repeat(900)).length, 500);
});
