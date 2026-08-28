import test from "node:test";
import assert from "node:assert/strict";

import analyzeLP3D, {
  buildDisplayPolyhedron,
  normalizeConstraints,
} from "./solver.js";

const tetrahedron = (rhs = 1) => [
  { id: "x-nonnegative", coefficients: [1, 0, 0], relation: ">=", rhs: 0, enabled: true },
  { id: "y-nonnegative", coefficients: [0, 1, 0], relation: ">=", rhs: 0, enabled: true },
  { id: "z-nonnegative", coefficients: [0, 0, 1], relation: ">=", rhs: 0, enabled: true },
  { id: "capacity", coefficients: [1, 1, 1], relation: "<=", rhs, enabled: true },
];

const orthant = [
  { id: "x-nonnegative", coefficients: [1, 0, 0], relation: ">=", rhs: 0 },
  { id: "y-nonnegative", coefficients: [0, 1, 0], relation: ">=", rhs: 0 },
  { id: "z-nonnegative", coefficients: [0, 0, 1], relation: ">=", rhs: 0 },
];

const cube = [
  { coefficients: [1, 0, 0], relation: "<=", rhs: 1 },
  { coefficients: [1, 0, 0], relation: ">=", rhs: -1 },
  { coefficients: [0, 1, 0], relation: "<=", rhs: 1 },
  { coefficients: [0, 1, 0], relation: ">=", rhs: -1 },
  { coefficients: [0, 0, 1], relation: "<=", rhs: 1 },
  { coefficients: [0, 0, 1], relation: ">=", rhs: -1 },
];

function almostEqual(actual, expected, tolerance = 1e-7) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${actual} to be near ${expected}`);
}

test("tetrahedron reports a unique vertex optimum and exact real/display geometry", () => {
  const analysis = analyzeLP3D({
    constraints: tetrahedron(),
    objective: { mode: "max", coefficients: [3, 2, 1], level: 0.5 },
    viewLimit: 2,
  });

  assert.equal(analysis.status, "optimal");
  assert.equal(analysis.feasible, true);
  assert.equal(analysis.regionBounded, true);
  assert.equal(analysis.optimum.kind, "vertex");
  almostEqual(analysis.optimum.value, 3);
  assert.deepEqual(analysis.optimum.vertexIds.length, 1);
  assert.equal(analysis.vertices.length, 4);
  assert.equal(analysis.faces.length, 4);
  assert.equal(analysis.edges.length, 6);
  assert.equal(analysis.display.vertices.length, 4);
  assert.equal(analysis.display.faces.length, 4);
  assert.equal(analysis.display.edges.length, 6);
  assert.equal(analysis.display.faces.some((face) => face.artificial), false);
  assert.equal(analysis.objectiveLevelIntersection.kind, "polygon");
  assert.equal(analysis.objectiveStatus, "bounded");
  assert.deepEqual(analysis.feasiblePoint, analysis.feasibleWitness);
  assert.deepEqual(analysis.constraints[0].coefficients, analysis.constraints[0].normal);
  assert.equal(analysis.displayPolyhedron.vertices.every(Array.isArray), true);
  assert.equal(analysis.displayPolyhedron.faces.every((face) => Array.isArray(face.indices)), true);
  assert.equal(analysis.optimum.type, "vertex");
  assert.equal(analysis.optimum.points.length, 1);
});

test("minimize reverses the objective direction on the tetrahedron", () => {
  const analysis = analyzeLP3D({
    constraints: tetrahedron(6),
    objective: { mode: "min", coefficients: [1, 2, 3], level: 9 },
  });

  assert.equal(analysis.objective.mode, "min");
  assert.equal(analysis.optimum.kind, "vertex");
  almostEqual(analysis.optimum.value, 0);
  assert.deepEqual(analysis.optimum.points, [[0, 0, 0]]);
});

test("tetrahedron classifies an optimal edge", () => {
  const analysis = analyzeLP3D({
    constraints: tetrahedron(),
    objective: { mode: "max", coefficients: [1, 1, 0] },
  });

  assert.equal(analysis.status, "optimal");
  assert.equal(analysis.optimum.kind, "edge");
  assert.equal(analysis.optimum.vertices.length, 2);
  almostEqual(analysis.optimum.value, 1);
});

test("tetrahedron classifies an optimal face", () => {
  const analysis = analyzeLP3D({
    constraints: tetrahedron(),
    objective: { mode: "max", coefficients: [1, 1, 1] },
  });

  assert.equal(analysis.status, "optimal");
  assert.equal(analysis.optimum.kind, "face");
  assert.equal(analysis.optimum.vertices.length, 3);
  almostEqual(analysis.optimum.value, 1);
});

test("a four-vertex optimal face is returned in cyclic order", () => {
  const analysis = analyzeLP3D({
    constraints: cube,
    objective: { mode: "max", coefficients: [1, 0, 0] },
  });

  assert.equal(analysis.optimum.kind, "face");
  assert.equal(analysis.optimum.points.length, 4);
  const projected = analysis.optimum.points.map((point) => [point[1], point[2]]);
  const twiceArea = projected.reduce((sum, point, index) => {
    const next = projected[(index + 1) % projected.length];
    return sum + point[0] * next[1] - next[0] * point[1];
  }, 0);
  almostEqual(Math.abs(twiceArea), 8);
});

test("contradictory planes are infeasible", () => {
  const analysis = analyzeLP3D({
    constraints: [
      { coefficients: [1, 0, 0], relation: "<=", rhs: 0 },
      { coefficients: [1, 0, 0], relation: ">=", rhs: 1 },
    ],
    objective: { mode: "max", coefficients: [1, 0, 0] },
  });

  assert.equal(analysis.status, "infeasible");
  assert.equal(analysis.feasible, false);
  assert.equal(analysis.feasibleWitness, null);
});

test("nonnegative orthant is objective-unbounded when maximizing a positive objective", () => {
  const analysis = analyzeLP3D({
    constraints: orthant,
    objective: { mode: "max", coefficients: [1, 1, 1] },
    viewLimit: 2,
  });

  assert.equal(analysis.status, "objective-unbounded");
  assert.equal(analysis.regionBounded, false);
  assert.equal(analysis.objectiveRange.max, Infinity);
  assert.ok(Array.isArray(analysis.optimum.ray));
  assert.ok(analysis.optimum.ray.reduce((sum, value) => sum + value, 0) > 0);
});

test("nonnegative orthant has a bounded minimum on an unbounded region", () => {
  const analysis = analyzeLP3D({
    constraints: orthant,
    objective: { mode: "min", coefficients: [1, 1, 1] },
    viewLimit: 2,
  });

  assert.equal(analysis.status, "optimal");
  assert.equal(analysis.regionBounded, false);
  assert.equal(analysis.boundedObjectiveOnUnboundedRegion, true);
  assert.equal(analysis.optimum.kind, "vertex");
  almostEqual(analysis.optimum.value, 0);
  assert.deepEqual(analysis.feasibleWitness.length, 3);
  assert.equal(analysis.objectiveRange.min, 0);
  assert.equal(analysis.objectiveRange.max, Infinity);
});

test("a bounded objective on a vertex-free halfspace exposes a clipped optimal face", () => {
  const analysis = analyzeLP3D({
    constraints: [{ coefficients: [1, 0, 0], relation: "<=", rhs: 0 }],
    objective: { mode: "max", coefficients: [1, 0, 0], level: 0 },
    viewLimit: 2,
  });

  assert.equal(analysis.status, "optimal");
  assert.equal(analysis.regionBounded, false);
  assert.equal(analysis.boundedObjectiveOnUnboundedRegion, true);
  assert.equal(analysis.optimum.kind, "face");
  assert.equal(analysis.optimum.displayClipped, true);
  assert.equal(analysis.optimum.points.length, 4);
});

test("an RHS edit moves the optimum and reconstructed geometry", () => {
  const first = analyzeLP3D({
    constraints: tetrahedron(1),
    objective: { mode: "max", coefficients: [3, 2, 1] },
  });
  const edited = analyzeLP3D({
    constraints: tetrahedron(2),
    objective: { mode: "max", coefficients: [3, 2, 1] },
  });

  almostEqual(first.optimum.value, 3);
  almostEqual(edited.optimum.value, 6);
  assert.ok(Math.max(...edited.vertices.map((vertex) => vertex[0])) >
    Math.max(...first.vertices.map((vertex) => vertex[0])));
});

test("an objective level outside a bounded feasible region does not intersect", () => {
  const analysis = analyzeLP3D({
    constraints: tetrahedron(),
    objective: { mode: "max", coefficients: [1, 1, 1], level: 5 },
    viewLimit: 2,
  });

  assert.equal(analysis.objectiveLevelIntersection.intersects, false);
  assert.equal(analysis.objectiveLevelIntersection.kind, "none");
  assert.deepEqual(analysis.objectiveLevelIntersection.points, []);
});

test("mathematical and display objective intersections are reported separately", () => {
  const analysis = analyzeLP3D({
    constraints: [],
    objective: { mode: "max", coefficients: [1, 0, 0], level: 100 },
    viewLimit: 2,
  });

  assert.equal(analysis.objectiveIntersects, true);
  assert.equal(analysis.objectiveVisibleInDisplay, false);
  assert.equal(analysis.objectiveLevelIntersection.intersects, false);
});

test("display clipping marks only box-derived orthant faces as artificial", () => {
  const display = buildDisplayPolyhedron(normalizeConstraints(orthant), 2);

  assert.equal(display.vertices.length, 8);
  assert.equal(display.faces.length, 6);
  assert.equal(display.edges.length, 12);
  assert.equal(display.faces.filter((face) => face.artificial).length, 3);
  assert.equal(display.faces.filter((face) => !face.artificial).length, 3);
});

test("zero objective is flat across the feasible region", () => {
  const analysis = analyzeLP3D({
    constraints: tetrahedron(),
    objective: { mode: "max", coefficients: [0, 0, 0], level: 0 },
  });

  assert.equal(analysis.status, "flat");
  assert.equal(analysis.optimum.kind, "flat");
  assert.equal(analysis.optimum.vertices.length, 4);
  assert.deepEqual(analysis.objectiveRange, {
    min: 0,
    max: 0,
    lowerBounded: true,
    upperBounded: true,
  });
});

test("an equality constraint produces a lower-dimensional feasible face", () => {
  const analysis = analyzeLP3D({
    constraints: [
      ...orthant,
      { coefficients: [1, 1, 1], relation: "=", rhs: 6 },
    ],
    objective: { mode: "max", coefficients: [1, 2, 3], level: 9 },
  });

  assert.equal(analysis.feasible, true);
  assert.equal(analysis.regionBounded, true);
  assert.equal(analysis.vertices.length, 3);
  assert.equal(analysis.faces.length, 1);
  assert.equal(analysis.optimum.kind, "vertex");
  almostEqual(analysis.optimum.value, 18);
});
