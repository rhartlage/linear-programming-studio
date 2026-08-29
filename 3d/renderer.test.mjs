import test from "node:test";
import assert from "node:assert/strict";

import { mathToScene, planeValueAfterSceneOffset, sceneOffsetAfterScreenDrag } from "./renderer.js";

test("plane displacement scales a raw constraint RHS by the coefficient norm", () => {
  assert.equal(planeValueAfterSceneOffset(3, [2, 0, 0], 1.25), 5.5);
  assert.equal(planeValueAfterSceneOffset(3, [2, 0, 0], -1.25), 0.5);
});

test("the same displacement rule applies to objective levels and every relation", () => {
  assert.equal(planeValueAfterSceneOffset(9, [1, 2, 2], 2), 15);
  assert.equal(planeValueAfterSceneOffset(9, [1, 2, 2], -2), 3);
});

test("the math-to-scene mapping preserves distances used by plane dragging", () => {
  const mathVector = [3, 4, 12];
  const sceneVector = mathToScene(mathVector);
  assert.equal(sceneVector.length(), 13);
});

test("invalid or zero-normal drag inputs do not create nonfinite values", () => {
  assert.equal(planeValueAfterSceneOffset(7, [0, 0, 0], 5), 7);
  assert.equal(planeValueAfterSceneOffset(7, [1, 0, 0], Number.NaN), 7);
});

test("screen drag follows the visible projected plane-normal axis", () => {
  assert.equal(sceneOffsetAfterScreenDrag(30, 40, [0.6, 0.8], 0.1), 5);
  assert.equal(sceneOffsetAfterScreenDrag(-30, -40, [0.6, 0.8], 0.1), -5);
  assert.equal(sceneOffsetAfterScreenDrag(-12, 0, [0, -1], 0.25), 0);
});

test("invalid screen mappings fail closed without moving a plane", () => {
  assert.equal(sceneOffsetAfterScreenDrag(20, 10, [0, 0], 0.5), 0);
  assert.equal(sceneOffsetAfterScreenDrag(Number.NaN, 10, [1, 0], 0.5), 0);
});
