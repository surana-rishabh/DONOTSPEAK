import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSafeRoute, scareTransition } from "../src/render/scenePolicy.js";

test("safe route stays inside the room and uses the clear front corridor", () => {
  const destination = [3.1, 0, -2.35] as const;
  const route = buildSafeRoute([-3.55, 0, -2.95], destination);
  assert.ok(route.length >= 3);
  assert.deepEqual(route.at(-1), destination);
  assert.ok(route.slice(0, -1).every(([x, , z]) => x >= -4.6 && x <= 4.6 && z >= 1.15 && z <= 3.6));
});

test("mimic reveal scare fires only on the hidden to visible edge", () => {
  assert.equal(scareTransition({ phase: "active", mimicVisible: false }, { phase: "active", mimicVisible: true }, false), "mimic");
  assert.equal(scareTransition({ phase: "active", mimicVisible: true }, { phase: "active", mimicVisible: true }, false), null);
});

test("ending scare is distinct and reduced motion suppresses both scares", () => {
  assert.equal(scareTransition({ phase: "active", mimicVisible: true }, { phase: "ended", mimicVisible: true }, false), "caller");
  assert.equal(scareTransition({ phase: "active", mimicVisible: false }, { phase: "ended", mimicVisible: true }, true), null);
});
