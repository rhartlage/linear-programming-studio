import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const appSource = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const initializeCall = /^initialize\(\);\r?$/m;
assert.match(appSource, initializeCall, "The test harness must remove only the top-level initialization call.");
const inertAppSource = appSource.replace(initializeCall, "");

function createElement() {
  const attributes = new Map();
  return {
    value: "",
    checked: false,
    disabled: false,
    hidden: false,
    open: false,
    textContent: "",
    innerHTML: "",
    dataset: {},
    style: { setProperty() {} },
    classList: { add() {}, remove() {}, toggle() {} },
    focus() { this.focused = true; },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    removeAttribute(name) { attributes.delete(name); },
    getAttribute(name) { return attributes.get(name) ?? null; },
    appendChild() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
}

function createApp() {
  const elements = new Map();
  const context = vm.createContext({
    clearTimeout() {},
    document: {
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, createElement());
        return elements.get(id);
      },
      createElement,
      createElementNS: createElement,
    },
  });
  vm.runInContext(inertAppSource, context, { filename: "app.js" });
  return vm.runInContext(`({
    PROBLEM_FILE_SCHEMA,
    PROBLEM_FILE_VERSION,
    state,
    dom,
    parseFlexibleNumber,
    canonicalNumberText,
    parseStatementModel,
    parseTableObjective,
    parseConstraintTableRows,
    formatProblemStatement,
    getConstraintStandard,
    createConstraint,
    applyParsedModel,
    buildProblemFileData,
    parseAndValidateProblemDocument,
    applyProblemDocument,
    syncObjectiveLineFromState,
    handleObjectiveLineInput,
    handleSnapOptimum,
    didFindOptimalSolution,
    buildConfettiSpecs,
    computeAutomaticView,
    setViewWindow,
    getAnalysis,
    stubApplySideEffects() {
      renderConstraintList = () => {};
      clampObjectiveToFeasibleRange = () => {};
      syncObjectiveInputs = () => {};
      syncViewInputs = () => {};
      syncLinkedEditors = () => {};
      refresh = () => {};
      clearObjectiveValidation = () => {};
    },
    stubObjectiveEditSideEffects() {
      syncLinkedEditors = () => {};
      refresh = () => {};
    },
    stubSnapSideEffects() {
      syncObjectiveInputs = () => {};
      syncLinkedEditors = () => {};
      refresh = () => { analysisCache = null; };
      startSolutionCelebration = (optimization) => {
        const calls = Number(dom.solutionAnnouncement.dataset.calls || 0) + 1;
        dom.solutionAnnouncement.dataset.calls = String(calls);
        dom.solutionAnnouncement.textContent = optimization.status;
      };
    },
    invalidateAnalysis() { analysisCache = null; },
    resetConstraintIds() { nextConstraintId = 1; }
  })`, context);
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function assertClose(actual, expected, tolerance = 1e-8) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} should be within ${tolerance} of ${expected}`);
}

function tableContext(xLabel = "A", yLabel = "B") {
  return {
    xLabel,
    yLabel,
    xCoeffLabel: `${xLabel} coeff`,
    yCoeffLabel: `${yLabel} coeff`,
    variableLabels: { x: xLabel, y: yLabel },
    warnings: [],
  };
}

function applyPreview(app, preview, origin) {
  app.stubApplySideEffects();
  app.applyParsedModel(preview, { origin, preserveView: true, preserveLevel: false });
}

function standardRows(constraints) {
  return plain(Array.from(constraints, (constraint) => ({
    name: constraint.name,
    enabled: constraint.enabled,
    ...plain(constraint.standard),
  })));
}

const linkedStatement = [
  "Min 1/2A - 7/3B",
  "s.t.",
  "[off] labor: 1/2A + 7/3B <= 19/13",
  "floor: A >= 0",
  "capacity: B <= 11/5",
].join("\n");

test("statement parsing and formatting preserve named disabled fractional semantics", () => {
  const app = createApp();
  const parsed = app.parseStatementModel(linkedStatement);

  assert.deepEqual(plain(parsed.errors), []);
  assert.deepEqual(plain(parsed.variableLabels), { x: "A", y: "B" });
  assert.equal(parsed.objective.mode, "min");
  assertClose(app.parseFlexibleNumber(parsed.objective.xCoeff), 1 / 2);
  assertClose(app.parseFlexibleNumber(parsed.objective.yCoeff), -7 / 3);
  assert.deepEqual(standardRows(parsed.constraints), [
    { name: "labor", enabled: false, xCoeff: "1/2", yCoeff: "7/3", relation: "<=", rhs: "19/13" },
    { name: "floor", enabled: true, xCoeff: "1", yCoeff: "0", relation: ">=", rhs: "0" },
    { name: "capacity", enabled: true, xCoeff: "0", yCoeff: "1", relation: "<=", rhs: "11/5" },
  ]);

  applyPreview(app, parsed, "statement");
  assert.equal(app.formatProblemStatement(), linkedStatement);
});

test("quoted constraint names roundtrip without changing enabled state or punctuation", () => {
  const app = createApp();
  const statement = [
    "Max x + y",
    "s.t.",
    '"[off] capacity: special \\"quoted\\"": x + y <= 7',
    '"cost < revenue": x <= 5',
    '"[off]capacity": y >= 1',
  ].join("\n");
  const parsed = app.parseStatementModel(statement);
  assert.deepEqual(plain(parsed.errors), []);
  assert.equal(parsed.constraints[0].name, '[off] capacity: special "quoted"');
  assert.equal(parsed.constraints[0].enabled, true);
  assert.equal(parsed.constraints[1].name, "cost < revenue");
  assert.equal(parsed.constraints[1].enabled, true);
  assert.equal(parsed.constraints[2].name, "[off]capacity");
  assert.equal(parsed.constraints[2].enabled, true);
  applyPreview(app, parsed, "statement");
  assert.equal(app.formatProblemStatement(), statement);
});

test("statement parsing keeps high-precision tokens and assigns a distinct fallback for a lone y variable", () => {
  const app = createApp();
  const precise = app.parseStatementModel("Max 2A + B\ns.t.\nprecision: 0.123456A + B <= 1");
  assert.deepEqual(plain(precise.errors), []);
  assert.equal(precise.constraints[0].standard.xCoeff, "0.123456");
  assert.equal(precise.constraints[0].param1, "-0.123456");

  const loneY = app.parseStatementModel("Max 2y\ns.t.\ny <= 5");
  assert.deepEqual(plain(loneY.variableLabels), { x: "y", y: "x" });
  assert.notEqual(loneY.variableLabels.x.toLowerCase(), loneY.variableLabels.y.toLowerCase());
});

test("statement parsing rejects incomplete or partially matched expressions", () => {
  const app = createApp();
  for (const statement of [
    "Max 9x +\ns.t.\nx <= 4",
    "Max x\ns.t.\nx + <= 4",
    "Max x\ns.t.\nx ++ y <= 4",
  ]) {
    const parsed = app.parseStatementModel(statement);
    assert.ok(parsed.errors.length > 0, `${statement} should not commit as a complete model`);
  }
});

test("table rows retain raw fractions and format into a statement that parses equivalently", () => {
  const app = createApp();
  const context = tableContext("A", "B");
  app.dom.tableObjectiveMode.value = "max";
  app.dom.tableObjectiveX.value = "5/7";
  app.dom.tableObjectiveY.value = "-9/11";
  const objectiveResult = app.parseTableObjective(context);
  const tableResult = app.parseConstraintTableRows([
    { rowIndex: 0, enabled: "false", name: "labor", xCoeff: "1/2", yCoeff: "7/3", relation: "<=", rhs: "19/13" },
    { rowIndex: 1, enabled: "true", name: "demand", xCoeff: "-3/5", yCoeff: "1", relation: ">=", rhs: "-7/9" },
    { rowIndex: 2, enabled: "true", name: "floor", xCoeff: "1", yCoeff: "0", relation: ">=", rhs: "0" },
  ], context);

  assert.equal(objectiveResult.error, null);
  assert.deepEqual(plain(objectiveResult.objective), {
    mode: "max",
    xCoeff: "5/7",
    yCoeff: "-9/11",
    level: 0,
  });
  assert.deepEqual(plain(tableResult.errors), []);
  assert.deepEqual(standardRows(tableResult.constraints), [
    { name: "labor", enabled: false, xCoeff: "1/2", yCoeff: "7/3", relation: "<=", rhs: "19/13" },
    { name: "demand", enabled: true, xCoeff: "-3/5", yCoeff: "1", relation: ">=", rhs: "-7/9" },
    { name: "floor", enabled: true, xCoeff: "1", yCoeff: "0", relation: ">=", rhs: "0" },
  ]);

  applyPreview(app, {
    objective: objectiveResult.objective,
    constraints: tableResult.constraints,
    variableLabels: context.variableLabels,
  }, "table");
  const statement = app.formatProblemStatement();
  assert.match(statement, /^Max 5\/7A - 9\/11B$/m);
  assert.match(statement, /^\[off\] labor: 1\/2A \+ 7\/3B <= 19\/13$/m);
  assert.match(statement, /^demand: -3\/5A \+ B >= -7\/9$/m);

  const reparsed = app.parseStatementModel(statement);
  assert.deepEqual(plain(reparsed.errors), []);
  assert.deepEqual(standardRows(reparsed.constraints), standardRows(tableResult.constraints));
});

test("signed fraction denominators normalize before linked statement formatting", () => {
  const app = createApp();
  assert.equal(app.canonicalNumberText("1/-2"), "-1/2");
  assert.equal(app.canonicalNumberText("-3/-4"), "3/4");
  assert.equal(app.canonicalNumberText("5/+2"), "5/2");
  assert.equal(app.canonicalNumberText("1e-3"), "0.001");
  assert.equal(app.canonicalNumberText("0x10"), "16");
  app.state.variables = { x: "A", y: "B" };
  app.state.objective = { mode: "max", xCoeff: "1/-2", yCoeff: "-3/-4", level: "0" };
  app.state.constraints = [app.createConstraint({
    name: "ratio",
    type: "line_leq",
    param1: "1/2",
    param2: "5/2",
    standard: { xCoeff: "1/-2", yCoeff: "1", relation: "<=", rhs: "5/+2" },
  })];
  assert.equal(app.formatProblemStatement(), "Max -1/2A + 3/4B\ns.t.\nratio: -1/2A + B <= 5/2");
  const reparsed = app.parseStatementModel(app.formatProblemStatement());
  assert.deepEqual(plain(reparsed.errors), []);
  assertClose(app.parseFlexibleNumber(reparsed.objective.xCoeff), -1 / 2);
  assertClose(app.parseFlexibleNumber(reparsed.objective.yCoeff), 3 / 4);
});

test("objective line derivation covers finite, horizontal, vertical, and flat forms", () => {
  const app = createApp();
  app.state.variables = { x: "A", y: "B" };

  app.state.objective = { mode: "max", xCoeff: "3", yCoeff: "2", level: "12" };
  app.syncObjectiveLineFromState();
  assertClose(app.parseFlexibleNumber(app.dom.objectiveLineSlope.value), -3 / 2);
  assertClose(app.parseFlexibleNumber(app.dom.objectiveLineIntercept.value), 6);
  assert.equal(app.dom.objectiveLineEquation.textContent, "B = -3/2A + 6");
  assert.equal(app.dom.objectiveLineStandardFields.hidden, false);
  assert.equal(app.dom.objectiveLineVerticalField.hidden, true);

  app.state.objective = { mode: "max", xCoeff: "0", yCoeff: "4", level: "8" };
  app.syncObjectiveLineFromState();
  assert.equal(app.dom.objectiveLineSlope.value, "0");
  assert.equal(app.dom.objectiveLineIntercept.value, "2");

  app.state.objective = { mode: "max", xCoeff: "5", yCoeff: "0", level: "20" };
  app.syncObjectiveLineFromState();
  assert.equal(app.dom.objectiveLineEquation.textContent, "A = 4");
  assert.equal(app.dom.objectiveLineVerticalValue.value, "4");
  assert.equal(app.dom.objectiveLineStandardFields.hidden, true);
  assert.equal(app.dom.objectiveLineVerticalField.hidden, false);

  app.state.objective = { mode: "max", xCoeff: "0", yCoeff: "0", level: "0" };
  app.syncObjectiveLineFromState();
  assert.equal(app.dom.objectiveLineEquation.textContent, "No objective line");
});

test("objective line edits preserve the coefficient magnitude and line geometry", () => {
  const app = createApp();
  app.stubObjectiveEditSideEffects();
  app.state.objective = { mode: "max", xCoeff: "3", yCoeff: "2", level: "12" };
  const originalMagnitude = Math.hypot(3, 2);

  app.dom.objectiveLineSlope.value = "2";
  app.dom.objectiveLineIntercept.value = "6";
  app.handleObjectiveLineInput({ target: app.dom.objectiveLineSlope });
  const rotatedX = app.parseFlexibleNumber(app.state.objective.xCoeff);
  const rotatedY = app.parseFlexibleNumber(app.state.objective.yCoeff);
  const rotatedLevel = app.parseFlexibleNumber(app.state.objective.level);
  // Values are serialized for editing, so verify that the represented geometry
  // remains stable within the supported numeric precision.
  assertClose(Math.hypot(rotatedX, rotatedY), originalMagnitude, 5e-4);
  assertClose(-rotatedX / rotatedY, 2, 5e-4);
  assertClose(rotatedLevel / rotatedY, 6, 5e-4);

  app.state.objective = { mode: "max", xCoeff: "3", yCoeff: "2", level: "12" };
  app.syncObjectiveLineFromState();
  app.dom.objectiveLineIntercept.value = "15/2";
  app.handleObjectiveLineInput({ target: app.dom.objectiveLineIntercept });
  assert.deepEqual(plain(app.state.objective), { mode: "max", xCoeff: "3", yCoeff: "2", level: "15" });

  app.state.objective = { mode: "max", xCoeff: "1", yCoeff: "3.141592653589", level: "0" };
  app.syncObjectiveLineFromState();
  app.dom.objectiveLineIntercept.value = "3";
  app.handleObjectiveLineInput({ target: app.dom.objectiveLineIntercept });
  assert.equal(app.state.objective.xCoeff, "1");
  assert.equal(app.state.objective.yCoeff, "3.141592653589");
  assertClose(app.parseFlexibleNumber(app.state.objective.level), 3 * 3.141592653589, 1e-10);

  app.state.objective = { mode: "max", xCoeff: "5", yCoeff: "0", level: "20" };
  app.dom.objectiveLineVerticalValue.value = "9";
  app.handleObjectiveLineInput({ target: app.dom.objectiveLineVerticalValue });
  assert.deepEqual(plain(app.state.objective), { mode: "max", xCoeff: "5", yCoeff: "0", level: "45" });
});

test("objective slope and intercept drafts commit atomically after either field is repaired", () => {
  const app = createApp();
  app.stubObjectiveEditSideEffects();
  app.state.objective = { mode: "max", xCoeff: "3", yCoeff: "2", level: "12" };
  app.syncObjectiveLineFromState();

  app.dom.objectiveLineIntercept.value = "3/";
  app.handleObjectiveLineInput({ target: app.dom.objectiveLineIntercept });
  app.dom.objectiveLineSlope.value = "-2";
  app.handleObjectiveLineInput({ target: app.dom.objectiveLineSlope });
  app.dom.objectiveLineIntercept.value = "3";
  app.handleObjectiveLineInput({ target: app.dom.objectiveLineIntercept });

  const x = app.parseFlexibleNumber(app.state.objective.xCoeff);
  const y = app.parseFlexibleNumber(app.state.objective.yCoeff);
  const level = app.parseFlexibleNumber(app.state.objective.level);
  assertClose(-x / y, -2, 1e-10);
  assertClose(level / y, 3, 1e-10);
  assert.equal(app.dom.exportProblem.disabled, false);
});

function installFractionProblem(app) {
  app.resetConstraintIds();
  app.state.variables = { x: "A", y: "B" };
  app.state.objective = { mode: "min", xCoeff: "5/7", yCoeff: "-9/11", level: "13/17" };
  app.state.constraints = [
    app.createConstraint({
      id: 11,
      name: "labor",
      enabled: false,
      type: "line_leq",
      param1: "-3/14",
      param2: "6/7",
      standard: { xCoeff: "1/2", yCoeff: "7/3", relation: "<=", rhs: "2" },
    }),
    app.createConstraint({
      id: 29,
      name: "floor",
      enabled: true,
      type: "x_geq",
      param1: "0",
      param2: "0",
      standard: { xCoeff: "1", yCoeff: "0", relation: ">=", rhs: "0" },
    }),
  ];
  app.state.viewSettings.equalUnits = false;
  app.setViewWindow({ xMin: -5.25, xMax: 30.5, yMin: -7.75, yMax: 40.125 });
  app.invalidateAnalysis();
}

test("problem JSON build and validation roundtrip preserves fractions, IDs, disabled state, and view", () => {
  const app = createApp();
  installFractionProblem(app);
  const documentData = plain(app.buildProblemFileData());

  assert.equal(documentData.schema, app.PROBLEM_FILE_SCHEMA);
  assert.equal(documentData.version, app.PROBLEM_FILE_VERSION);
  assert.deepEqual(documentData.objective, { mode: "min", xCoeff: "5/7", yCoeff: "-9/11", level: "13/17" });
  assert.deepEqual(documentData.constraints, [
    { id: 11, name: "labor", enabled: false, xCoeff: "1/2", yCoeff: "7/3", relation: "<=", rhs: "2" },
    { id: 29, name: "floor", enabled: true, xCoeff: "1", yCoeff: "0", relation: ">=", rhs: "0" },
  ]);
  assert.deepEqual(documentData.view, {
    xMin: "-5.25",
    xMax: "30.5",
    yMin: "-7.75",
    yMax: "40.125",
    equalAxisUnits: false,
  });

  const validated = plain(app.parseAndValidateProblemDocument(JSON.stringify(documentData)));
  assert.deepEqual(validated, {
    variables: { x: "A", y: "B" },
    objective: { mode: "min", xCoeff: "5/7", yCoeff: "-9/11", level: "13/17" },
    constraints: documentData.constraints,
    view: { xMin: -5.25, xMax: 30.5, yMin: -7.75, yMax: 40.125 },
    equalAxisUnits: false,
  });
});

test("problem JSON validation rejects malformed, unsupported, duplicate-ID, and zero-normal documents", () => {
  const app = createApp();
  installFractionProblem(app);
  const valid = plain(app.buildProblemFileData());

  assert.throws(() => app.parseAndValidateProblemDocument("{"), /valid JSON/i);
  assert.throws(
    () => app.parseAndValidateProblemDocument(JSON.stringify({ ...valid, version: valid.version + 1 })),
    /supports problem-file version/i
  );
  assert.throws(
    () => app.parseAndValidateProblemDocument(JSON.stringify({
      ...valid,
      constraints: [valid.constraints[0], { ...valid.constraints[1], id: valid.constraints[0].id }],
    })),
    /unique positive integer id/i
  );
  assert.throws(
    () => app.parseAndValidateProblemDocument(JSON.stringify({
      ...valid,
      constraints: [{ ...valid.constraints[0], xCoeff: "0", yCoeff: "0" }],
    })),
    /at least one nonzero coefficient/i
  );
  assert.throws(
    () => app.parseAndValidateProblemDocument(JSON.stringify({
      ...valid,
      variables: { x: "Max", y: "B" },
    })),
    /reserved statement words/i
  );
});

test("equality imports allocate expansion IDs beyond every ID reserved by the file", () => {
  const app = createApp();
  installFractionProblem(app);
  const documentData = plain(app.buildProblemFileData());
  documentData.constraints = [
    { ...documentData.constraints[0], id: 1, relation: "=" },
    { ...documentData.constraints[1], id: 2 },
  ];
  const validated = app.parseAndValidateProblemDocument(JSON.stringify(documentData));
  app.stubApplySideEffects();
  app.applyProblemDocument(validated);
  const ids = plain(app.state.constraints.map((constraint) => constraint.id));
  assert.deepEqual(ids, [1, 3, 2]);
  assert.equal(new Set(ids).size, ids.length);
});

test("coefficient-table production fixture retains the 7,668 optimum at (540, 252)", () => {
  const app = createApp();
  const context = tableContext("A", "B");
  const parsed = app.parseConstraintTableRows([
    { name: "Cutting and dyeing", xCoeff: "7/10", yCoeff: "1", relation: "<=", rhs: "630", enabled: "true" },
    { name: "Sewing", xCoeff: "1/10", yCoeff: "1", relation: "<=", rhs: "720", enabled: "true" },
    { name: "Finishing", xCoeff: "3/2", yCoeff: "1", relation: "<=", rhs: "1062", enabled: "true" },
    { name: "Inspection", xCoeff: "2/5", yCoeff: "1", relation: "<=", rhs: "540", enabled: "true" },
    { name: "A nonnegative", xCoeff: "1", yCoeff: "0", relation: ">=", rhs: "0", enabled: "true" },
    { name: "B nonnegative", xCoeff: "0", yCoeff: "1", relation: ">=", rhs: "0", enabled: "true" },
  ], context);
  assert.deepEqual(plain(parsed.errors), []);

  app.resetConstraintIds();
  app.state.variables = { x: "A", y: "B" };
  app.state.constraints = parsed.constraints.map((seed) => app.createConstraint(seed));
  app.state.objective = { mode: "max", xCoeff: "10", yCoeff: "9", level: "0" };
  app.state.viewSettings.equalUnits = true;
  app.setViewWindow(app.computeAutomaticView(app.state.constraints).view);
  app.invalidateAnalysis();
  const analysis = app.getAnalysis();

  assert.equal(analysis.optimization.status, "bounded");
  assertClose(analysis.optimization.bestValue, 7668, 1e-5);
  assert.ok(
    analysis.optimization.bestContacts.some((point) =>
      Math.abs(point.x - 540) < 1e-5 && Math.abs(point.y - 252) < 1e-5
    )
  );
});

test("snap celebrates only after it lands on a finite optimal solution", () => {
  const app = createApp();
  app.stubSnapSideEffects();
  app.state.constraints = [
    app.createConstraint({ type: "x_geq", param1: "0", param2: "0" }),
    app.createConstraint({ type: "x_leq", param1: "4", param2: "0" }),
    app.createConstraint({ type: "y_geq", param1: "0", param2: "0" }),
    app.createConstraint({ type: "y_leq", param1: "3", param2: "0" }),
  ];
  app.state.objective = { mode: "max", xCoeff: "1", yCoeff: "1", level: "0" };
  app.invalidateAnalysis();

  assert.equal(app.handleSnapOptimum(), true);
  assert.equal(app.didFindOptimalSolution(app.getAnalysis()), true);
  assertClose(app.parseFlexibleNumber(app.state.objective.level), 7);
  assert.equal(app.dom.solutionAnnouncement.dataset.calls, "1");

  assert.equal(app.handleSnapOptimum(), true, "Pressing again should replay the celebration.");
  assert.equal(app.dom.solutionAnnouncement.dataset.calls, "2");
});

test("snap does not celebrate infeasible, flat, or objective-unbounded results", () => {
  const scenarios = [
    {
      name: "infeasible",
      constraints: [
        { type: "x_geq", param1: "2", param2: "0" },
        { type: "x_leq", param1: "1", param2: "0" },
      ],
      objective: { mode: "max", xCoeff: "1", yCoeff: "1", level: "0" },
    },
    {
      name: "flat",
      constraints: [
        { type: "x_geq", param1: "0", param2: "0" },
        { type: "x_leq", param1: "4", param2: "0" },
        { type: "y_geq", param1: "0", param2: "0" },
        { type: "y_leq", param1: "3", param2: "0" },
      ],
      objective: { mode: "max", xCoeff: "0", yCoeff: "0", level: "0" },
    },
    {
      name: "unbounded",
      constraints: [
        { type: "x_geq", param1: "0", param2: "0" },
        { type: "y_geq", param1: "0", param2: "0" },
      ],
      objective: { mode: "max", xCoeff: "1", yCoeff: "1", level: "0" },
    },
  ];

  scenarios.forEach((scenario) => {
    const app = createApp();
    app.stubSnapSideEffects();
    app.state.constraints = scenario.constraints.map((constraint) => app.createConstraint(constraint));
    app.state.objective = { ...scenario.objective };
    app.invalidateAnalysis();

    assert.equal(app.handleSnapOptimum(), false, scenario.name);
    assert.equal(app.dom.solutionAnnouncement.dataset.calls, undefined, scenario.name);
  });
});

test("confetti specs are reproducible, side-directed, and finish within two seconds", () => {
  const app = createApp();
  const values = [0, 0.1, 0.25, 0.4, 0.55, 0.7, 0.85, 0.95];
  const makeRandom = () => {
    let index = 0;
    return () => values[index++ % values.length];
  };

  const left = plain(app.buildConfettiSpecs({ side: "left", count: 6, random: makeRandom() }));
  const repeated = plain(app.buildConfettiSpecs({ side: "left", count: 6, random: makeRandom() }));
  const right = plain(app.buildConfettiSpecs({ side: "right", count: 6, random: makeRandom() }));

  assert.deepEqual(left, repeated);
  assert.ok(left.every((spec) => spec.midX > 0 && spec.endX > 0));
  assert.ok(right.every((spec) => spec.midX < 0 && spec.endX < 0));
  assert.ok([...left, ...right].every((spec) => spec.delay + spec.duration < 2000));
});
