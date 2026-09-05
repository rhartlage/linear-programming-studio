import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const appSource = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const initializeCall = /^initialize\(\);\r?$/m;
assert.match(appSource, initializeCall, "The test harness must remove only the top-level initialization call.");
const inertAppSource = appSource.replace(initializeCall, "");

// Load the real helpers and solver without starting the browser UI. The only DOM
// stand-ins are input-like elements used when the axis readouts synchronize.
function createApp() {
  const elements = new Map();
  const context = vm.createContext({
    document: {
      getElementById(id) {
        if (!elements.has(id)) {
          const attributes = new Map();
          elements.set(id, {
            value: "",
            checked: false,
            textContent: "",
            hidden: false,
            open: false,
            focused: false,
            dataset: {},
            classList: { toggle() {} },
            focus() { this.focused = true; },
            setAttribute(name, value) { attributes.set(name, String(value)); },
            removeAttribute(name) { attributes.delete(name); },
            getAttribute(name) { return attributes.get(name) ?? null; },
          });
        }
        return elements.get(id);
      },
    },
  });
  vm.runInContext(inertAppSource, context, { filename: "app.js" });
  return vm.runInContext(`({
    computeAutomaticView,
    equalizeViewBounds,
    parseAxisRanges,
    getResetView,
    getViewWindow,
    setViewWindow,
    getAnalysis,
    syncViewInputs,
    getAxisRangeInputs,
    applyAxisRanges,
    handleEqualAxisUnitsChange,
    toggleGraphViewLock,
    handlePlotPointerDown,
    handlePlotWheel,
    zoomView,
    PLOT_BOX,
    MIN_VIEW_SPAN,
    MAX_VIEW_COORDINATE,
    state,
    dom,
    get axisRangeDraftDirty() { return axisRangeDraftDirty; },
    set axisRangeDraftDirty(value) { axisRangeDraftDirty = value; },
    get dragState() { return dragState; },
    stubRefreshForHandlers() { refresh = () => syncViewInputs(); },
    invalidateAnalysis() { analysisCache = null; }
  })`, context);
}

function constraint(type, param1, param2 = 0, enabled = true) {
  return { id: `${type}:${param1}:${param2}`, type, param1: String(param1), param2: String(param2), enabled };
}

function rectangleConstraints(xMin, xMax, yMin, yMax) {
  return [
    constraint("x_geq", xMin),
    constraint("x_leq", xMax),
    constraint("y_geq", yMin),
    constraint("y_leq", yMax),
  ];
}

function productionConstraints() {
  return [
    constraint("line_leq", -0.7, 630), // Cutting and dyeing.
    constraint("line_leq", -0.1, 720), // Sewing: its x-intercept is 7,200.
    constraint("line_leq", -1.5, 1062), // Finishing.
    constraint("line_leq", -0.4, 540), // Inspection and packaging.
    constraint("x_geq", 0),
    constraint("y_geq", 0),
  ];
}

const productionVertices = [
  { x: 0, y: 0 },
  { x: 708, y: 0 },
  { x: 540, y: 252 },
  { x: 300, y: 420 },
  { x: 0, y: 540 },
];

function plainView(view) {
  return { xMin: view.xMin, xMax: view.xMax, yMin: view.yMin, yMax: view.yMax };
}

function assertClose(actual, expected, tolerance = 1e-7) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} should be within ${tolerance} of ${expected}`);
}

function assertValidView(view) {
  for (const value of Object.values(plainView(view))) assert.ok(Number.isFinite(value), "Every bound must be finite.");
  assert.ok(view.xMax > view.xMin, "The x span must be positive.");
  assert.ok(view.yMax > view.yMin, "The y span must be positive.");
}

function assertContains(view, point) {
  assert.ok(point.x >= view.xMin - 1e-7 && point.x <= view.xMax + 1e-7, `x=${point.x} must be in the view.`);
  assert.ok(point.y >= view.yMin - 1e-7 && point.y <= view.yMax + 1e-7, `y=${point.y} must be in the view.`);
}

function assertEqualUnits(view, plotBox) {
  const xPixelsPerUnit = plotBox.width / (view.xMax - view.xMin);
  const yPixelsPerUnit = plotBox.height / (view.yMax - view.yMin);
  assertClose(xPixelsPerUnit, yPixelsPerUnit, 1e-8 * Math.max(1, xPixelsPerUnit, yPixelsPerUnit));
}

function stageAxisRanges(app, values) {
  for (const [key, input] of Object.entries(app.getAxisRangeInputs())) input.value = values[key];
  app.axisRangeDraftDirty = true;
}

function readAxisRanges(app) {
  return Object.fromEntries(Object.entries(app.getAxisRangeInputs()).map(([key, input]) => [key, input.value]));
}

function numericAxisRanges(app) {
  return Object.fromEntries(Object.entries(readAxisRanges(app)).map(([key, value]) => [key, Number(value)]));
}

function setProductionModel(app) {
  app.state.constraints = productionConstraints();
  app.state.objective = { mode: "max", xCoeff: "10", yCoeff: "9", level: 0 };
  app.invalidateAnalysis();
}

test("equal axis units are enabled by default", () => {
  const app = createApp();
  assert.equal(app.state.viewSettings.equalUnits, true);
  assert.equal(app.state.viewSettings.locked, false);
  assert.equal(app.MIN_VIEW_SPAN, 0.0001);
  assert.equal(app.MAX_VIEW_COORDINATE, 1e9);
});

test("locking fits the feasible region and unlocking preserves that view", () => {
  const app = createApp();
  app.stubRefreshForHandlers();
  setProductionModel(app);
  app.setViewWindow({ xMin: -100, xMax: -50, yMin: -80, yMax: -30 });

  app.toggleGraphViewLock();
  assert.equal(app.state.viewSettings.locked, true);
  assert.deepEqual(plainView(app.getViewWindow()), plainView(app.getResetView()));
  assert.equal(app.dom.lockViewInline.getAttribute("aria-pressed"), "true");
  assert.match(app.dom.viewStatus.textContent, /fitted and locked/i);

  const lockedView = plainView(app.getViewWindow());
  app.toggleGraphViewLock();
  assert.equal(app.state.viewSettings.locked, false);
  assert.deepEqual(plainView(app.getViewWindow()), lockedView);
  assert.equal(app.dom.lockViewInline.getAttribute("aria-pressed"), "false");
});

test("background pointer input cannot start a pan while the graph view is locked", () => {
  const app = createApp();
  app.state.viewSettings.locked = true;

  app.handlePlotPointerDown({
    target: {
      closest() { return { dataset: { dragKind: "view-pan" } }; },
    },
  });

  assert.equal(app.dragState, null);
});

test("wheel input cannot zoom a locked graph view", () => {
  const app = createApp();
  app.stubRefreshForHandlers();
  const original = { xMin: -4, xMax: 12, yMin: -1, yMax: 5 };
  app.setViewWindow(original);
  app.state.viewSettings.locked = true;
  let prevented = false;

  app.handlePlotWheel({ deltaY: -100, preventDefault() { prevented = true; } });

  assert.deepEqual(plainView(app.getViewWindow()), original);
  assert.equal(prevented, false, "Locked graphs should let the page handle wheel scrolling.");
});

test("automatic fit frames the production feasible polygon, not the distant sewing intercept", () => {
  const app = createApp();
  const constraints = productionConstraints();
  const original = structuredClone(constraints);
  const result = app.computeAutomaticView(constraints);

  assert.equal(result.kind, "feasible");
  assertValidView(result.view);
  productionVertices.forEach((point) => assertContains(result.view, point));
  assertEqualUnits(result.view, app.PLOT_BOX);
  assert.ok(result.view.xMax - result.view.xMin < 2000, "The 7,200 intercept must not dominate the x range.");
  assert.ok(result.view.yMax - result.view.yMin < 2000);
  assert.deepEqual(constraints, original, "Fitting must not edit the model.");
});

test("independent-axis fit includes all feasible vertices without forcing equal spans", () => {
  const app = createApp();
  const result = app.computeAutomaticView(productionConstraints(), false);

  assert.equal(result.kind, "feasible");
  assertValidView(result.view);
  productionVertices.forEach((point) => assertContains(result.view, point));
  const xSpan = result.view.xMax - result.view.xMin;
  const ySpan = result.view.yMax - result.view.yMin;
  assert.ok(xSpan > ySpan, "Independent fitting must retain this polygon's wider x extent.");
  assert.ok(xSpan < 2000 && ySpan < 2000);
});

test("inactive constraints do not alter automatic bounds or feasibility classification", () => {
  const app = createApp();
  const active = rectangleConstraints(2, 12, 3, 9);
  const withInactive = [
    ...active,
    constraint("x_leq", -10, 0, false),
    constraint("y_geq", 1e8, 0, false),
  ];
  for (const equalUnits of [true, false]) {
    const expected = app.computeAutomaticView(active, equalUnits);
    const actual = app.computeAutomaticView(withInactive, equalUnits);
    assert.equal(actual.kind, expected.kind);
    assert.deepEqual(plainView(actual.view), plainView(expected.view));
  }
});

test("a translated narrow region is framed locally instead of forcing the origin into view", () => {
  const app = createApp();
  for (const equalUnits of [true, false]) {
    const result = app.computeAutomaticView(rectangleConstraints(10000, 10002, 20000, 20001), equalUnits);
    assert.equal(result.kind, "feasible");
    assertValidView(result.view);
    assertContains(result.view, { x: 10000, y: 20000 });
    assertContains(result.view, { x: 10002, y: 20001 });
    assert.ok(result.view.xMin > 9990 && result.view.xMax < 10012);
    assert.ok(result.view.yMin > 19990 && result.view.yMax < 20011);
    if (equalUnits) assertEqualUnits(result.view, app.PLOT_BOX);
  }
});

for (const fixture of [
  { name: "single-point", constraints: rectangleConstraints(4, 4, -3, -3), points: [{ x: 4, y: -3 }] },
  { name: "horizontal segment", constraints: rectangleConstraints(2, 8, 3, 3), points: [{ x: 2, y: 3 }, { x: 8, y: 3 }] },
  { name: "vertical segment", constraints: rectangleConstraints(-2, -2, 4, 10), points: [{ x: -2, y: 4 }, { x: -2, y: 10 }] },
  {
    name: "diagonal segment",
    constraints: [constraint("x_geq", 1), constraint("x_leq", 3), constraint("line_geq", -2, 10), constraint("line_leq", -2, 10)],
    points: [{ x: 1, y: 8 }, { x: 3, y: 4 }],
  },
]) {
  test(`automatic fit safely frames a ${fixture.name} feasible region`, () => {
    const app = createApp();
    for (const equalUnits of [true, false]) {
      const result = app.computeAutomaticView(fixture.constraints, equalUnits);
      assert.equal(result.kind, "feasible");
      assertValidView(result.view);
      fixture.points.forEach((point) => assertContains(result.view, point));
      assert.ok(result.view.xMax - result.view.xMin >= app.MIN_VIEW_SPAN);
      assert.ok(result.view.yMax - result.view.yMin >= app.MIN_VIEW_SPAN);
      if (equalUnits) assertEqualUnits(result.view, app.PLOT_BOX);
    }
  });
}

test("an unbounded region uses a fallback even when its objective has a finite optimum", () => {
  const app = createApp();
  app.state.constraints = [constraint("x_geq", 0), constraint("y_geq", 0)];
  app.state.objective = { mode: "min", xCoeff: "1", yCoeff: "1", level: 0 };

  const result = app.computeAutomaticView(app.state.constraints);
  assert.equal(result.kind, "fallback");
  assertValidView(result.view);
  assertEqualUnits(result.view, app.PLOT_BOX);
  app.setViewWindow(result.view);
  const analysis = app.getAnalysis();
  assert.equal(analysis.optimization.status, "bounded");
  assert.equal(analysis.optimization.boundedRegion, false);
  assertClose(analysis.optimization.bestValue, 0);
});

test("infeasible constraints return a safe fallback and retain infeasible solver feedback", () => {
  const app = createApp();
  app.state.constraints = [constraint("x_geq", 2), constraint("x_leq", 1)];
  const result = app.computeAutomaticView(app.state.constraints);
  assert.equal(result.kind, "fallback");
  assertValidView(result.view);
  assertEqualUnits(result.view, app.PLOT_BOX);
  app.setViewWindow(result.view);
  assert.equal(app.getAnalysis().optimization.status, "infeasible");
});

test("no active constraints produce a finite empty-model view", () => {
  const app = createApp();
  for (const constraints of [[], [constraint("x_geq", 1e8, 0, false)]]) {
    const result = app.computeAutomaticView(constraints);
    assert.equal(result.kind, "empty");
    assertValidView(result.view);
    assertEqualUnits(result.view, app.PLOT_BOX);
  }
});

for (const view of [
  { xMin: -6, xMax: 14, yMin: 10, yMax: 14 },
  { xMin: -2, xMax: 2, yMin: -20, yMax: 10 },
  { xMin: 6, xMax: 16, yMin: -9, yMax: 1 },
]) {
  test(`equalization centers and never crops ${JSON.stringify(view)}`, () => {
    for (const plotSize of [{ width: 612, height: 612 }, { width: 900, height: 600 }]) {
      const app = createApp();
      Object.assign(app.PLOT_BOX, plotSize);
      const original = structuredClone(view);
      const result = app.equalizeViewBounds(view);

      assertValidView(result);
      assertContains(result, { x: view.xMin, y: view.yMin });
      assertContains(result, { x: view.xMax, y: view.yMax });
      assertClose((result.xMin + result.xMax) / 2, (view.xMin + view.xMax) / 2);
      assertClose((result.yMin + result.yMax) / 2, (view.yMin + view.yMax) / 2);
      assertEqualUnits(result, app.PLOT_BOX);
      assert.deepEqual(view, original, "Equalization must not mutate the supplied range.");
    }
  });
}

test("manual axis bounds parse exactly without changing their input object", () => {
  const app = createApp();
  const values = { xMin: "-50", xMax: "800", yMin: "-25.125", yMax: "600.875" };
  const original = structuredClone(values);
  const result = app.parseAxisRanges(values);

  assert.equal(result.error, null);
  assert.equal(result.invalidFields.length, 0);
  assert.deepEqual(plainView(result.view), { xMin: -50, xMax: 800, yMin: -25.125, yMax: 600.875 });
  assert.deepEqual(values, original);
});

test("manual axis bounds accept the documented coordinate and minimum-span boundaries", () => {
  const app = createApp();
  for (const values of [
    { xMin: "-1000000000", xMax: "1000000000", yMin: "-1000000000", yMax: "1000000000" },
    { xMin: "0", xMax: "0.0001", yMin: "0", yMax: "0.0001" },
  ]) {
    const result = app.parseAxisRanges(values);
    assert.equal(result.error, null);
    assert.equal(result.invalidFields.length, 0);
    assertValidView(result.view);
  }
});

for (const fixture of [
  { name: "empty", field: "xMin", value: "" },
  { name: "whitespace-only", field: "yMax", value: " \t\n " },
  { name: "nonnumeric", field: "xMin", value: "not a number" },
  { name: "NaN", field: "yMin", value: "NaN" },
  { name: "positive infinity", field: "xMax", value: "Infinity" },
  { name: "negative infinity", field: "yMin", value: "-Infinity" },
  { name: "overflow", field: "xMax", value: "1e999" },
  { name: "too large", field: "xMax", value: "1000000001" },
  { name: "too negative", field: "yMin", value: "-1000000001" },
  { name: "reversed x", field: "xMin", value: "20" },
  { name: "reversed y", field: "yMax", value: "-20" },
  { name: "equal x", field: "xMin", value: "10" },
  { name: "equal y", field: "yMax", value: "0" },
  { name: "too-small x span", field: "xMax", value: "0.00001" },
  { name: "too-small y span", field: "yMax", value: "0.00001" },
]) {
  test(`manual axis bounds reject ${fixture.name} values with field feedback`, () => {
    const app = createApp();
    const values = { xMin: "0", xMax: "10", yMin: "0", yMax: "10", [fixture.field]: fixture.value };
    const original = structuredClone(values);
    const result = app.parseAxisRanges(values);

    assert.equal(result.view, null);
    assert.equal(typeof result.error, "string");
    assert.ok(result.error.length > 0);
    assert.ok(result.invalidFields.includes(fixture.field), `Feedback must identify ${fixture.field}.`);
    assert.deepEqual(values, original);
  });
}

test("explicit bounds are retained exactly, with no automatic equalization or precision loss", () => {
  const app = createApp();
  setProductionModel(app);
  const manual = { xMin: 0.123456789123, xMax: 0.923456789123, yMin: -2.876543210987, yMax: 17.654321098765 };
  const original = structuredClone(manual);
  app.state.viewSettings.equalUnits = true;
  app.setViewWindow(manual);

  assert.deepEqual(plainView(app.getViewWindow()), original);
  assert.deepEqual(manual, original);
});

test("small ranges near mixed-magnitude centers retain full round-trip precision", () => {
  const app = createApp();
  const manual = {
    xMin: 999999990.1233943,
    xMax: 999999990.1235178,
    yMin: 0.12339503871107113,
    yMax: 0.12351853953504574,
  };
  assert.equal(app.parseAxisRanges(manual).error, null);

  for (let roundTrip = 0; roundTrip < 20; roundTrip += 1) {
    app.setViewWindow(roundTrip === 0 ? manual : app.getViewWindow());
    app.syncViewInputs();
    assert.deepEqual(plainView(app.getViewWindow()), manual);
    assert.deepEqual(numericAxisRanges(app), manual);
    for (const [key, expected] of Object.entries(manual)) assert.equal(Number(app.state.view[key]), expected);
  }
});

for (const draft of [
  { name: "complete", values: { xMin: "-12", xMax: "24", yMin: "-2", yMax: "14" } },
  { name: "partially typed", values: { xMin: "", xMax: "24", yMin: "-", yMax: "14" } },
]) {
  test(`equal-unit toggles preserve ${draft.name} staged axis ranges`, () => {
    const app = createApp();
    app.stubRefreshForHandlers();
    app.state.viewSettings.equalUnits = false;
    app.setViewWindow({ xMin: -4, xMax: 12, yMin: -1, yMax: 5 });
    app.syncViewInputs();
    stageAxisRanges(app, draft.values);

    for (const equalUnits of [true, false, true]) {
      app.dom.equalAxisUnits.checked = equalUnits;
      app.handleEqualAxisUnitsChange();
      assert.equal(app.state.viewSettings.equalUnits, equalUnits);
      assert.equal(app.axisRangeDraftDirty, true);
      assert.deepEqual(readAxisRanges(app), draft.values);
      assert.match(app.dom.viewStatus.textContent, /apply ranges/i);
      if (equalUnits) assertEqualUnits(app.getViewWindow(), app.PLOT_BOX);
    }
  });
}

for (const fixture of [
  { name: "far positive unbounded half-plane", constraints: [constraint("x_geq", 1e16)] },
  { name: "far upper-bound half-plane", constraints: [constraint("x_leq", 1e16)] },
  { name: "far translated segment", constraints: rectangleConstraints(1e16, 1e16, 0, 10) },
  { name: "near-overflow point", constraints: rectangleConstraints(1e308, 1e308, 0, 0) },
  { name: "coordinate-limit point requiring padding", constraints: rectangleConstraints(1e9, 1e9, 1e9, 1e9) },
  { name: "overflowing span", constraints: rectangleConstraints(-1e308, 1e308, -1e308, 1e308) },
]) {
  test(`automatic fitting uses a supported fallback for a ${fixture.name}`, () => {
    const app = createApp();
    const original = structuredClone(fixture.constraints);
    for (const equalUnits of [true, false]) {
      const result = app.computeAutomaticView(fixture.constraints, equalUnits);
      assert.equal(result.kind, "fallback");
      assertValidView(result.view);
      assert.equal(app.parseAxisRanges(result.view).error, null);
      for (const value of Object.values(plainView(result.view))) assert.ok(Math.abs(value) <= app.MAX_VIEW_COORDINATE);
      if (equalUnits) assertEqualUnits(result.view, app.PLOT_BOX);
    }
    assert.deepEqual(fixture.constraints, original);
  });
}

for (const fixture of [
  { name: "x", view: { xMin: 0, xMax: 0.001, yMin: -1, yMax: 1 }, anchor: { x: 0.00075, y: -0.5 } },
  { name: "y", view: { xMin: -1, xMax: 1, yMin: 0, yMax: 0.001 }, anchor: { x: -0.5, y: 0.00075 } },
]) {
  test(`zoom preserves the axis ratio and pointer anchor when ${fixture.name} reaches minimum span`, () => {
    const app = createApp();
    app.stubRefreshForHandlers();
    app.state.viewSettings.equalUnits = false;
    app.setViewWindow(fixture.view);
    const originalXSpan = fixture.view.xMax - fixture.view.xMin;
    const originalYSpan = fixture.view.yMax - fixture.view.yMin;
    const originalRatio = originalXSpan / originalYSpan;
    const anchorRatioX = (fixture.anchor.x - fixture.view.xMin) / originalXSpan;
    const anchorRatioY = (fixture.anchor.y - fixture.view.yMin) / originalYSpan;

    for (let attempt = 0; attempt < 20; attempt += 1) {
      app.zoomView(0.001, fixture.anchor);
      const view = app.getViewWindow();
      const spanX = view.xMax - view.xMin;
      const spanY = view.yMax - view.yMin;
      assertValidView(view);
      assert.ok(spanX >= app.MIN_VIEW_SPAN * (1 - 1e-8));
      assert.ok(spanY >= app.MIN_VIEW_SPAN * (1 - 1e-8));
      assertClose(spanX / spanY, originalRatio, Math.max(1e-12, originalRatio * 1e-8));
      assertClose((fixture.anchor.x - view.xMin) / spanX, anchorRatioX, 1e-8);
      assertClose((fixture.anchor.y - view.yMin) / spanY, anchorRatioY, 1e-8);
      assert.deepEqual(numericAxisRanges(app), plainView(view));
    }

    const minimumView = app.getViewWindow();
    app.zoomView(2, fixture.anchor);
    const expandedView = app.getViewWindow();
    assertClose(expandedView.xMax - expandedView.xMin, 2 * (minimumView.xMax - minimumView.xMin));
    assertClose(expandedView.yMax - expandedView.yMin, 2 * (minimumView.yMax - minimumView.yMin));
  });
}

test("equal-unit zoom retains equal units and the center at the minimum span", () => {
  const app = createApp();
  app.stubRefreshForHandlers();
  Object.assign(app.PLOT_BOX, { width: 900, height: 600 });
  const view = { xMin: -0.00075, xMax: 0.00075, yMin: -0.0005, yMax: 0.0005 };
  app.setViewWindow(view);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    app.zoomView(0.01);
    const next = app.getViewWindow();
    assertEqualUnits(next, app.PLOT_BOX);
    assertClose((next.xMin + next.xMax) / 2, 0);
    assertClose((next.yMin + next.yMax) / 2, 0);
    assert.ok(next.xMax - next.xMin >= app.MIN_VIEW_SPAN * (1 - 1e-8));
    assert.ok(next.yMax - next.yMin >= app.MIN_VIEW_SPAN * (1 - 1e-8));
  }
});

for (const fixture of [
  { name: "blank", values: { xMin: "", xMax: "40", yMin: "-2", yMax: "8" }, field: "xMin" },
  { name: "reversed", values: { xMin: "50", xMax: "40", yMin: "-2", yMax: "8" }, field: "xMin" },
  { name: "too-small", values: { xMin: "0", xMax: "0.00001", yMin: "-2", yMax: "8" }, field: "xMin" },
  { name: "unsupported", values: { xMin: "0", xMax: "1e16", yMin: "-2", yMax: "8" }, field: "xMax" },
  { name: "equal-unit expansion beyond the coordinate limit", values: { xMin: "999999990", xMax: "999999995", yMin: "-500", yMax: "500" }, field: null },
]) {
  test(`applying ${fixture.name} ranges leaves the view and draft unchanged`, () => {
    const app = createApp();
    app.stubRefreshForHandlers();
    const initial = { xMin: -3, xMax: 20, yMin: -4, yMax: 15 };
    app.setViewWindow(initial);
    app.syncViewInputs();
    stageAxisRanges(app, fixture.values);
    app.applyAxisRanges();

    assert.deepEqual(plainView(app.getViewWindow()), initial);
    assert.deepEqual(readAxisRanges(app), fixture.values);
    assert.equal(app.axisRangeDraftDirty, true);
    assert.equal(app.dom.axisRangeError.hidden, false);
    assert.ok(app.dom.axisRangeError.textContent.length > 0);
    assert.equal(app.dom.axisSettings.open, true);
    if (fixture.field) {
      const input = app.getAxisRangeInputs()[fixture.field];
      assert.equal(input.getAttribute("aria-invalid"), "true");
      assert.equal(input.focused, true);
    }
  });
}

test("applying independent ranges preserves exact bounds and clears stale field errors", () => {
  const app = createApp();
  app.stubRefreshForHandlers();
  app.state.viewSettings.equalUnits = false;
  const values = { xMin: "-12.123456789123", xMax: "24.987654321987", yMin: "-2.987654321123", yMax: "8.123456789987" };
  stageAxisRanges(app, values);
  app.dom.axisXMin.setAttribute("aria-invalid", "true");
  app.dom.axisRangeError.textContent = "Previous invalid range";
  app.applyAxisRanges();

  const expected = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, Number(value)]));
  assert.deepEqual(plainView(app.getViewWindow()), expected);
  assert.deepEqual(numericAxisRanges(app), expected);
  assert.equal(app.axisRangeDraftDirty, false);
  assert.equal(app.dom.axisRangeError.hidden, true);
  assert.equal(app.dom.axisRangeError.textContent, "");
  for (const input of Object.values(app.getAxisRangeInputs())) assert.equal(input.getAttribute("aria-invalid"), null);
});

test("applying equal-unit ranges expands the shorter range and reflects it in the fields", () => {
  const app = createApp();
  app.stubRefreshForHandlers();
  const values = { xMin: "-10", xMax: "30", yMin: "-2", yMax: "8" };
  stageAxisRanges(app, values);
  app.applyAxisRanges();

  const view = app.getViewWindow();
  assertEqualUnits(view, app.PLOT_BOX);
  assertContains(view, { x: -10, y: -2 });
  assertContains(view, { x: 30, y: 8 });
  assert.equal(view.xMin, -10);
  assert.equal(view.xMax, 30);
  assert.ok(view.yMin < -2 && view.yMax > 8);
  assertClose((view.yMin + view.yMax) / 2, 3);
  assert.deepEqual(numericAxisRanges(app), plainView(view));
  assert.equal(app.axisRangeDraftDirty, false);
  assert.equal(app.dom.axisRangeError.hidden, true);
  assert.match(app.dom.viewStatus.textContent, /expanded/i);
});

test("reset fits the current active constraints regardless of objective level, mode, or current view", () => {
  const app = createApp();
  setProductionModel(app);
  const manual = { xMin: 12000, xMax: 13000, yMin: -5000, yMax: -3000 };
  app.setViewWindow(manual);

  for (const equalUnits of [true, false]) {
    app.state.viewSettings.equalUnits = equalUnits;
    const expected = app.computeAutomaticView(app.state.constraints, equalUnits).view;
    for (const mode of ["min", "max"]) {
      app.state.objective.mode = mode;
      for (const level of [-1e12, 0, 7668, 1e12]) {
        app.state.objective.level = level;
        assert.deepEqual(plainView(app.getResetView()), plainView(expected));
        assert.deepEqual(plainView(app.getViewWindow()), manual, "Computing a reset must not apply it implicitly.");
      }
    }
  }
});

test("objective and constraint sensitivity edits do not silently reframe the current view", () => {
  const app = createApp();
  setProductionModel(app);
  const manual = { xMin: 400, xMax: 620, yMin: 200, yMax: 380 };
  app.setViewWindow(manual);
  app.getAnalysis();

  const edits = [
    () => { app.state.objective.level = 1e9; },
    () => { app.state.objective.xCoeff = "1"; },
    () => { app.state.objective.yCoeff = "-3"; },
    () => { app.state.objective.mode = "min"; },
    () => { app.state.constraints[0].param2 = "650"; },
    () => { app.state.constraints[1].enabled = false; },
  ];
  for (const edit of edits) {
    edit();
    app.invalidateAnalysis();
    const analysis = app.getAnalysis();
    assert.deepEqual(plainView(analysis.view), manual);
    assert.deepEqual(plainView(app.getViewWindow()), manual);
  }
});

for (const viewMode of ["equal-units fit", "independent fit", "manually panned away"]) {
  test(`the production optimum remains 7,668 at (540, 252) with ${viewMode}`, () => {
    const app = createApp();
    setProductionModel(app);
    const view = viewMode === "manually panned away"
      ? { xMin: 2000, xMax: 3000, yMin: -700, yMax: -200 }
      : app.computeAutomaticView(app.state.constraints, viewMode === "equal-units fit").view;
    app.setViewWindow(view);
    const storedView = plainView(app.getViewWindow());
    const analysis = app.getAnalysis();

    assert.equal(analysis.feasibility.feasible, true);
    assert.equal(analysis.optimization.status, "bounded");
    assert.equal(analysis.optimization.boundedRegion, true);
    assertClose(analysis.optimization.bestValue, 7668, 1e-5);
    assert.ok(analysis.optimization.bestContacts.some((point) => Math.abs(point.x - 540) < 1e-5 && Math.abs(point.y - 252) < 1e-5));
    if (viewMode === "manually panned away") assert.equal(analysis.feasibility.visible, false);

    app.state.objective.mode = "min";
    app.invalidateAnalysis();
    assertClose(app.getAnalysis().optimization.bestValue, 0, 1e-5);
    assert.deepEqual(plainView(app.getViewWindow()), storedView);
  });
}
