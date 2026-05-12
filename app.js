const SVG_NS = "http://www.w3.org/2000/svg";
const EPSILON = 1e-7;
const PLOT_BOX = { x: 74, y: 26, width: 612, height: 612 };
const MIN_SLOPE_DX_RATIO = 0.015;
const MIN_VIEW_SPAN = 0.5;
const ZOOM_IN_FACTOR = 0.8;
const ZOOM_OUT_FACTOR = 1.25;
const MIN_TABLE_SHEET_ROWS = 6;
const DEFAULT_TABLE_VARIABLES = { x: "A", y: "B" };
const CONSTRAINT_TYPES = [
  { value: "line_leq", label: "y <= mx + b" },
  { value: "line_geq", label: "y >= mx + b" },
  { value: "x_leq", label: "x <= c" },
  { value: "x_geq", label: "x >= c" },
  { value: "y_leq", label: "y <= c" },
  { value: "y_geq", label: "y >= c" },
];
const PALETTE = [
  "#2F6DF6",
  "#E05F35",
  "#1B9C85",
  "#A13CF5",
  "#C38A06",
  "#D94173",
  "#2A7F9E",
  "#5F7B2D",
];
const TABLE_SHEET_COLUMNS = [
  { key: "name", label: "name", placeholder: "" },
  { key: "xCoeff", label: "x coeff", placeholder: "Ex. 1 or 1/2", inputMode: "text" },
  { key: "yCoeff", label: "y coeff", placeholder: "Ex. 1 or 1/2", inputMode: "text" },
  { key: "relation", label: "relation", options: ["", "<=", "<", ">=", ">", "="] },
  { key: "rhs", label: "rhs", placeholder: "8 or 5/2", inputMode: "text" },
];

const dom = {
  plot: document.getElementById("plot"),
  constraintList: document.getElementById("constraint-list"),
  addConstraint: document.getElementById("add-constraint"),
  loadExample: document.getElementById("load-example"),
  modelTabStatement: document.getElementById("model-tab-statement"),
  modelTabTable: document.getElementById("model-tab-table"),
  modelPanelStatement: document.getElementById("model-panel-statement"),
  modelPanelTable: document.getElementById("model-panel-table"),
  statementInput: document.getElementById("statement-input"),
  tableVariableMode: document.getElementById("table-variable-mode"),
  tableVariableOne: document.getElementById("table-variable-one"),
  tableVariableTwo: document.getElementById("table-variable-two"),
  tableObjectiveXLabel: document.getElementById("table-objective-x-label"),
  tableObjectiveYLabel: document.getElementById("table-objective-y-label"),
  tableObjectiveMode: document.getElementById("table-objective-mode"),
  tableObjectiveX: document.getElementById("table-objective-x"),
  tableObjectiveY: document.getElementById("table-objective-y"),
  tableHeaderXLabel: document.getElementById("table-header-x-label"),
  tableHeaderYLabel: document.getElementById("table-header-y-label"),
  tableSheetBody: document.getElementById("table-sheet-body"),
  addTableRow: document.getElementById("add-table-row"),
  removeTableRow: document.getElementById("remove-table-row"),
  tableDefaultNonnegative: document.getElementById("table-default-nonnegative"),
  tableDefaultNonnegativeLabel: document.getElementById("table-default-nonnegative-label"),
  tableLoaderNote: document.getElementById("table-loader-note"),
  previewModel: document.getElementById("preview-model"),
  applyModel: document.getElementById("apply-model"),
  clearModelInput: document.getElementById("clear-model-input"),
  modelPreviewBadge: document.getElementById("model-preview-badge"),
  modelPreviewText: document.getElementById("model-preview-text"),
  modelPreviewDetails: document.getElementById("model-preview-details"),
  clearConstraints: document.getElementById("clear-constraints"),
  objectiveMode: document.getElementById("objective-mode"),
  objectiveX: document.getElementById("objective-x"),
  objectiveY: document.getElementById("objective-y"),
  objectiveLevel: document.getElementById("objective-level"),
  snapOptimum: document.getElementById("snap-optimum"),
  viewXMin: document.getElementById("view-x-min"),
  viewXMax: document.getElementById("view-x-max"),
  viewYMin: document.getElementById("view-y-min"),
  viewYMax: document.getElementById("view-y-max"),
  resetView: document.getElementById("reset-view"),
  resetViewInline: document.getElementById("reset-view-inline"),
  feasibilityBadge: document.getElementById("feasibility-badge"),
  feasibilityText: document.getElementById("feasibility-text"),
  objectiveBadge: document.getElementById("objective-badge"),
  objectiveText: document.getElementById("objective-text"),
  optimumBadge: document.getElementById("optimum-badge"),
  optimumText: document.getElementById("optimum-text"),
};

const EXAMPLE_PROBLEM = {
  constraints: [
    { type: "line_leq", param1: "-1", param2: "7", enabled: true },
    { type: "line_leq", param1: "0.5", param2: "5", enabled: true },
    { type: "x_geq", param1: "0", param2: "0", enabled: true },
    { type: "y_geq", param1: "0", param2: "0", enabled: true },
  ],
  objective: {
    mode: "max",
    xCoeff: "0.75",
    yCoeff: "1",
    level: 2,
  },
  view: {
    xMin: "0",
    xMax: "10",
    yMin: "0",
    yMax: "10",
  },
};

const state = {
  constraints: [],
  objective: {
    mode: "max",
    xCoeff: "0.75",
    yCoeff: "1",
    level: 0,
  },
  view: {
    xMin: "0",
    xMax: "10",
    yMin: "0",
    yMax: "10",
  },
};

let analysisCache = null;
let dragState = null;
let nextConstraintId = 1;
let activeLoaderTab = "statement";
let modelPreview = null;

initialize();

function initialize() {
  bindStaticEvents();
  initializeModelLoader();
  loadExampleProblem();
}

function resetViewToDefault() {
  const nextView = getResetView();
  if (nextView) {
    setViewWindow(nextView);
  } else {
    state.view = { ...EXAMPLE_PROBLEM.view };
  }
  syncViewInputs();
  refresh();
}

function initializeModelLoader() {
  resetTableSheetRows();
  syncTableLoaderUi();
  setActiveLoaderTab(activeLoaderTab);
  renderModelPreview(null);
}

function getTableVariableContext() {
  const mode = dom.tableVariableMode.value === "xy" ? "xy" : "named";
  const firstName = sanitizeTableVariableName(dom.tableVariableOne.value, DEFAULT_TABLE_VARIABLES.x);
  const secondName = sanitizeTableVariableName(dom.tableVariableTwo.value, DEFAULT_TABLE_VARIABLES.y);
  const xLabel = mode === "named" ? firstName : "x";
  const yLabel = mode === "named" ? secondName : "y";
  const warnings = [];

  if (mode === "named" && firstName.toUpperCase() === secondName.toUpperCase()) {
    warnings.push(
      `Both table variables are named ${firstName}, so the first ${firstName} column will map to x and the second ${secondName} column will map to y.`
    );
  }

  const variableSummary = mode === "named"
    ? `${firstName} -> x, ${secondName} -> y`
    : "Table columns map directly to x and y.";

  return {
    mode,
    xLabel,
    yLabel,
    xCoeffLabel: `${xLabel} coeff`,
    yCoeffLabel: `${yLabel} coeff`,
    variableSummary,
    warnings,
    variableLabels: { x: xLabel, y: yLabel },
  };
}

function sanitizeTableVariableName(value, fallback) {
  const trimmed = String(value ?? "").trim();
  return trimmed || fallback;
}

function buildTableLoaderNote(context) {
  const columnText = context.mode === "named"
    ? `\`name\`, \`${context.xCoeffLabel}\`, \`${context.yCoeffLabel}\`, \`relation\`, and \`rhs\``
    : "`name`, `x coeff`, `y coeff`, `relation`, and `rhs`";
  const mappingText = context.mode === "named"
    ? ` ${context.xLabel} maps to x and ${context.yLabel} maps to y in the graph.`
    : "";
  return `Paste spreadsheet rows directly into the grid. A header row is optional, the columns are ${columnText}. Fractions like \`1/2\` are accepted, and strict \`<\` or \`>\` will be treated as \`<=\` or \`>=\` for graphing.${mappingText}`;
}

function buildTableNonnegativeLabel(context) {
  return `Add \`${context.xLabel} >= 0\` and \`${context.yLabel} >= 0\` if they are not already listed`;
}

function syncTableLoaderUi() {
  const context = getTableVariableContext();
  dom.tableObjectiveXLabel.textContent = context.xCoeffLabel;
  dom.tableObjectiveYLabel.textContent = context.yCoeffLabel;
  dom.tableHeaderXLabel.textContent = context.xCoeffLabel;
  dom.tableHeaderYLabel.textContent = context.yCoeffLabel;
  dom.tableDefaultNonnegativeLabel.textContent = buildTableNonnegativeLabel(context);
  dom.tableLoaderNote.textContent = buildTableLoaderNote(context);
  refreshTableSheetFieldLabels(context);
}

function refreshTableSheetFieldLabels(context = getTableVariableContext()) {
  getTableSheetRows().forEach((row, index) => {
    TABLE_SHEET_COLUMNS.forEach((column) => {
      const field = row.querySelector(`[data-col-key="${column.key}"]`);
      if (!field) {
        return;
      }
      field.setAttribute("aria-label", `Constraint table ${getTableSheetColumnLabel(column.key, context)} row ${index + 1}`);
    });
  });
}

function getTableSheetColumnLabel(columnKey, context = getTableVariableContext()) {
  if (columnKey === "xCoeff") {
    return context.xCoeffLabel;
  }
  if (columnKey === "yCoeff") {
    return context.yCoeffLabel;
  }
  return TABLE_SHEET_COLUMNS.find((column) => column.key === columnKey)?.label ?? columnKey;
}

function setActiveLoaderTab(tab) {
  activeLoaderTab = tab === "table" ? "table" : "statement";
  const isStatement = activeLoaderTab === "statement";

  dom.modelTabStatement.classList.toggle("is-active", isStatement);
  dom.modelTabStatement.setAttribute("aria-selected", String(isStatement));
  dom.modelPanelStatement.classList.toggle("is-hidden", !isStatement);
  dom.modelPanelStatement.hidden = !isStatement;

  dom.modelTabTable.classList.toggle("is-active", !isStatement);
  dom.modelTabTable.setAttribute("aria-selected", String(!isStatement));
  dom.modelPanelTable.classList.toggle("is-hidden", isStatement);
  dom.modelPanelTable.hidden = isStatement;

  invalidateModelPreview("The active loader tab changed. Preview it or load it directly.");
}

function invalidateModelPreview(message = "Preview is out of date. Click Preview model or Load into graph to refresh it.") {
  modelPreview = null;
  renderModelPreview(null, message);
}

function bindStaticEvents() {
  [dom.modelTabStatement, dom.modelTabTable].forEach((button) => {
    button.addEventListener("click", () => {
      setActiveLoaderTab(button.dataset.loaderTab);
    });
  });

  [
    dom.statementInput,
    dom.tableVariableMode,
    dom.tableVariableOne,
    dom.tableVariableTwo,
    dom.tableObjectiveMode,
    dom.tableObjectiveX,
    dom.tableObjectiveY,
    dom.tableDefaultNonnegative,
  ].forEach((control) => {
    const eventName = control.tagName === "SELECT" || control.type === "checkbox" ? "change" : "input";
    control.addEventListener(eventName, () => {
      if (
        control === dom.tableVariableMode ||
        control === dom.tableVariableOne ||
        control === dom.tableVariableTwo
      ) {
        syncTableLoaderUi();
      }
      invalidateModelPreview();
    });
  });

  dom.tableSheetBody.addEventListener("input", handleTableSheetEdit);
  dom.tableSheetBody.addEventListener("change", handleTableSheetEdit);
  dom.tableSheetBody.addEventListener("paste", handleTableSheetPaste);

  dom.addTableRow.addEventListener("click", () => {
    const row = appendTableSheetRow();
    focusTableSheetRow(row);
    invalidateModelPreview();
  });

  dom.removeTableRow.addEventListener("click", () => {
    removeLastTableSheetRow();
  });

  dom.previewModel.addEventListener("click", () => {
    previewCurrentModel();
  });

  dom.applyModel.addEventListener("click", () => {
    loadPreviewIntoGraph();
  });

  dom.clearModelInput.addEventListener("click", () => {
    clearModelLoader();
  });

  dom.addConstraint.addEventListener("click", () => {
    state.constraints.push(createConstraint());
    renderConstraintList();
    refresh();
  });

  dom.loadExample.addEventListener("click", () => {
    loadExampleProblem();
  });

  dom.clearConstraints.addEventListener("click", () => {
    state.constraints = [];
    renderConstraintList();
    refresh();
  });

  dom.constraintList.addEventListener("input", handleConstraintInput);
  dom.constraintList.addEventListener("change", handleConstraintInput);
  dom.constraintList.addEventListener("click", handleConstraintClick);

  dom.objectiveMode.addEventListener("change", () => {
    state.objective.mode = dom.objectiveMode.value;
    refresh();
  });

  [dom.objectiveX, dom.objectiveY].forEach((input) => {
    input.addEventListener("input", () => {
      syncObjectiveFromInputs(false);
      refresh();
    });
  });

  dom.objectiveLevel.addEventListener("input", () => {
    syncObjectiveFromInputs(true);
    refresh();
  });

  [dom.viewXMin, dom.viewXMax, dom.viewYMin, dom.viewYMax].forEach((input) => {
    input.addEventListener("input", () => {
      syncViewFromInputs();
      refresh();
    });
  });

  dom.resetView.addEventListener("click", resetViewToDefault);
  dom.resetViewInline.addEventListener("click", resetViewToDefault);

  dom.snapOptimum.addEventListener("click", () => {
    const analysis = getAnalysis();
    if (analysis.optimization.status === "bounded") {
      state.objective.level = formatEditableNumber(analysis.optimization.bestValue);
      syncObjectiveInputs();
      refresh();
    }
  });

  dom.plot.addEventListener("pointerdown", handlePlotPointerDown);
  dom.plot.addEventListener("wheel", handlePlotWheel, { passive: false });
  window.addEventListener("pointermove", handlePlotPointerMove);
  window.addEventListener("pointerup", handlePlotPointerUp);
}

function handleConstraintInput(event) {
  const row = event.target.closest(".constraint-row");
  if (!row) {
    return;
  }

  const constraint = state.constraints.find((item) => item.id === Number(row.dataset.id));
  if (!constraint) {
    return;
  }

  if (event.target.matches("[data-field='type']")) {
    constraint.type = event.target.value;
    if (constraint.type.startsWith("line_")) {
      if (constraint.param1 === "") {
        constraint.param1 = "1";
      }
      if (constraint.param2 === "") {
        constraint.param2 = "0";
      }
    }
    renderConstraintList();
    refresh();
    return;
  }

  if (event.target.matches("[data-field='enabled']")) {
    constraint.enabled = event.target.checked;
    refresh();
    return;
  }

  if (event.target.matches("[data-field='name']")) {
    constraint.name = event.target.value;
    updateConstraintHeading(constraint.id);
    refresh();
    return;
  }

  if (event.target.matches("[data-field='param1']")) {
    constraint.param1 = event.target.value;
    updateConstraintEquation(constraint.id);
    refresh();
    return;
  }

  if (event.target.matches("[data-field='param2']")) {
    constraint.param2 = event.target.value;
    updateConstraintEquation(constraint.id);
    refresh();
  }
}

function handleConstraintClick(event) {
  const removeButton = event.target.closest("[data-action='remove']");
  if (!removeButton) {
    return;
  }

  const row = event.target.closest(".constraint-row");
  if (!row) {
    return;
  }

  state.constraints = state.constraints.filter((item) => item.id !== Number(row.dataset.id));
  renderConstraintList();
  refresh();
}

function handlePlotPointerDown(event) {
  const dragTarget = event.target.closest("[data-drag-kind]");
  if (!dragTarget) {
    return;
  }

  const analysis = getAnalysis();
  const point = clientToSvgPoint(event);
  const worldPoint = svgToWorld(point.x, point.y, analysis.view);
  const dragKind = dragTarget.dataset.dragKind;

  if (dragKind === "objective") {
    if (!analysis.currentLineSegment) {
      return;
    }
    dragState = {
      kind: "objective",
      pointerId: event.pointerId,
      startWorld: worldPoint,
      startLevel: toNumber(state.objective.level, 0),
    };
  } else if (dragKind === "objective-slope") {
    if (!analysis.currentLineSegment) {
      return;
    }
    const anchorWorld = dragTarget.dataset.handle === "start"
      ? analysis.currentLineSegment.worldEnd
      : analysis.currentLineSegment.worldStart;
    dragState = {
      kind: "objective-slope",
      pointerId: event.pointerId,
      anchorWorld,
      startMagnitude: getObjectiveMagnitude(),
    };
  } else if (dragKind === "view-pan") {
    dragState = {
      kind: "view-pan",
      pointerId: event.pointerId,
      startWorld: worldPoint,
      startView: { ...analysis.view },
    };
  } else if (dragKind === "constraint-translate") {
    const constraint = findConstraintById(dragTarget.dataset.constraintId);
    const halfPlane = constraint ? convertConstraintToHalfPlane(constraint) : null;
    if (!constraint || !halfPlane) {
      return;
    }
    dragState = {
      kind: "constraint-translate",
      pointerId: event.pointerId,
      constraintId: constraint.id,
      startWorld: worldPoint,
      startLine: { ...halfPlane.line },
    };
  } else if (dragKind === "constraint-slope") {
    const constraint = findConstraintById(dragTarget.dataset.constraintId);
    const entry = constraint
      ? analysis.constraintEntries.find((item) => item.id === constraint.id)
      : null;
    if (!constraint || !entry || !entry.segment || !constraint.type.startsWith("line_")) {
      return;
    }
    const anchorWorld = dragTarget.dataset.handle === "start"
      ? entry.segment.worldEnd
      : entry.segment.worldStart;
    dragState = {
      kind: "constraint-slope",
      pointerId: event.pointerId,
      constraintId: constraint.id,
      anchorWorld,
      minDx: (analysis.view.xMax - analysis.view.xMin) * MIN_SLOPE_DX_RATIO,
    };
  } else {
    return;
  }

  if (typeof dom.plot.setPointerCapture === "function") {
    try {
      dom.plot.setPointerCapture(event.pointerId);
    } catch {}
  }

  dom.plot.style.cursor = dragState.kind.includes("slope") ? "crosshair" : "grabbing";
  event.preventDefault();
}

function handlePlotPointerMove(event) {
  if (!dragState) {
    const dragTarget = event.target.closest?.("[data-drag-kind]");
    dom.plot.style.cursor = dragTarget?.dataset.cursor ?? "default";
    return;
  }

  if (event.pointerId !== dragState.pointerId) {
    return;
  }

  const analysis = getAnalysis();
  const point = clientToSvgPoint(event);
  const worldPoint = svgToWorld(point.x, point.y, analysis.view);

  if (dragState.kind === "view-pan") {
    const pointInStartView = svgToWorld(point.x, point.y, dragState.startView);
    const dx = pointInStartView.x - dragState.startWorld.x;
    const dy = pointInStartView.y - dragState.startWorld.y;
    setViewWindow({
      xMin: dragState.startView.xMin - dx,
      xMax: dragState.startView.xMax - dx,
      yMin: dragState.startView.yMin - dy,
      yMax: dragState.startView.yMax - dy,
    });
    syncViewInputs();
    refresh(false);
    return;
  }

  if (dragState.kind === "objective") {
    const dx = worldPoint.x - dragState.startWorld.x;
    const dy = worldPoint.y - dragState.startWorld.y;
    const objective = getObjectiveCoefficients();
    const delta = objective.x * dx + objective.y * dy;
    const unclampedLevel = dragState.startLevel + delta;
    state.objective.level = formatEditableNumber(clampObjectiveLevel(unclampedLevel, analysis.objectiveRange));
    syncObjectiveInputs();
    refresh(false);
    return;
  }

  if (dragState.kind === "objective-slope") {
    rotateObjectiveThroughAnchor(dragState.anchorWorld, worldPoint, dragState.startMagnitude);
    clampObjectiveToFeasibleRange();
    syncObjectiveInputs();
    refresh(false);
    return;
  }

  const constraint = findConstraintById(dragState.constraintId);
  if (!constraint) {
    return;
  }

  if (dragState.kind === "constraint-translate") {
    const dx = worldPoint.x - dragState.startWorld.x;
    const dy = worldPoint.y - dragState.startWorld.y;
    translateConstraintByDelta(constraint, dragState.startLine, dx, dy);
  } else if (dragState.kind === "constraint-slope") {
    rotateConstraintThroughAnchor(constraint, dragState.anchorWorld, worldPoint, dragState.minDx);
  }

  clampObjectiveToFeasibleRange();
  syncConstraintRow(constraint.id);
  refresh(false);
}

function handlePlotWheel(event) {
  if (dragState || event.deltaY === 0) {
    return;
  }

  event.preventDefault();

  const point = clientToSvgPoint(event);
  const clampedPoint = {
    x: clamp(PLOT_BOX.x, point.x, PLOT_BOX.x + PLOT_BOX.width),
    y: clamp(PLOT_BOX.y, point.y, PLOT_BOX.y + PLOT_BOX.height),
  };
  const anchorWorld = svgToWorld(clampedPoint.x, clampedPoint.y, getViewWindow());
  const factor = event.deltaY < 0 ? ZOOM_IN_FACTOR : ZOOM_OUT_FACTOR;

  zoomView(factor, anchorWorld);
}

function handlePlotPointerUp(event) {
  if (!dragState) {
    dom.plot.style.cursor = "default";
    return;
  }

  if (event.pointerId !== undefined && event.pointerId !== dragState.pointerId) {
    return;
  }

  if (typeof dom.plot.releasePointerCapture === "function") {
    try {
      dom.plot.releasePointerCapture(dragState.pointerId);
    } catch {}
  }

  dragState = null;
  dom.plot.style.cursor = "default";
  refresh();
}

function findConstraintById(constraintId) {
  return state.constraints.find((item) => item.id === Number(constraintId)) ?? null;
}

function syncConstraintRow(constraintId) {
  const row = dom.constraintList.querySelector(`.constraint-row[data-id="${constraintId}"]`);
  const constraint = findConstraintById(constraintId);
  if (!row || !constraint) {
    return;
  }

  const param1Input = row.querySelector("[data-field='param1']");
  const param2Input = row.querySelector("[data-field='param2']");
  const nameInput = row.querySelector("[data-field='name']");
  if (nameInput) {
    nameInput.value = constraint.name;
    nameInput.placeholder = getDefaultConstraintName(constraintId);
  }
  if (param1Input) {
    param1Input.value = constraint.param1;
  }
  if (param2Input) {
    param2Input.value = constraint.param2;
  }

  updateConstraintEquation(constraintId);
  updateConstraintHeading(constraintId);
}

function translateConstraintByDelta(constraint, startLine, dx, dy) {
  const shiftedC = startLine.c + startLine.a * dx + startLine.b * dy;

  switch (constraint.type) {
    case "line_leq":
      constraint.param2 = formatEditableNumber(shiftedC);
      break;
    case "line_geq":
      constraint.param2 = formatEditableNumber(-shiftedC);
      break;
    case "x_leq":
    case "y_leq":
      constraint.param1 = formatEditableNumber(shiftedC);
      break;
    case "x_geq":
    case "y_geq":
      constraint.param1 = formatEditableNumber(-shiftedC);
      break;
    default:
      break;
  }
}

function rotateConstraintThroughAnchor(constraint, anchorWorld, worldPoint, minDx) {
  if (!constraint.type.startsWith("line_")) {
    return;
  }

  let dx = worldPoint.x - anchorWorld.x;
  if (Math.abs(dx) < minDx) {
    dx = dx >= 0 ? minDx : -minDx;
  }

  const slope = (worldPoint.y - anchorWorld.y) / dx;
  const intercept = anchorWorld.y - slope * anchorWorld.x;
  constraint.param1 = formatEditableNumber(slope);
  constraint.param2 = formatEditableNumber(intercept);
}

function clampObjectiveToFeasibleRange() {
  analysisCache = null;
  const analysis = getAnalysis();
  state.objective.level = formatEditableNumber(
    clampObjectiveLevel(toNumber(state.objective.level, 0), analysis.objectiveRange)
  );
  syncObjectiveInputs();
}

function zoomView(factor, anchorWorld = null) {
  const view = getViewWindow();
  const spanX = Math.max(view.xMax - view.xMin, MIN_VIEW_SPAN);
  const spanY = Math.max(view.yMax - view.yMin, MIN_VIEW_SPAN);
  const nextSpanX = Math.max(spanX * factor, MIN_VIEW_SPAN);
  const nextSpanY = Math.max(spanY * factor, MIN_VIEW_SPAN);
  const focusX = anchorWorld?.x ?? (view.xMin + view.xMax) / 2;
  const focusY = anchorWorld?.y ?? (view.yMin + view.yMax) / 2;
  const focusRatioX = spanX <= EPSILON ? 0.5 : (focusX - view.xMin) / spanX;
  const focusRatioY = spanY <= EPSILON ? 0.5 : (focusY - view.yMin) / spanY;

  setViewWindow({
    xMin: focusX - focusRatioX * nextSpanX,
    xMax: focusX + (1 - focusRatioX) * nextSpanX,
    yMin: focusY - focusRatioY * nextSpanY,
    yMax: focusY + (1 - focusRatioY) * nextSpanY,
  });
  syncViewInputs();
  refresh(false);
}

function rotateObjectiveThroughAnchor(anchorWorld, worldPoint, magnitude) {
  const dx = worldPoint.x - anchorWorld.x;
  const dy = worldPoint.y - anchorWorld.y;
  const directionLength = Math.hypot(dx, dy);
  if (directionLength <= EPSILON) {
    return;
  }

  let normal = {
    x: dy / directionLength,
    y: -dx / directionLength,
  };

  const currentObjective = getObjectiveCoefficients();
  if (normal.x * currentObjective.x + normal.y * currentObjective.y < 0) {
    normal = {
      x: -normal.x,
      y: -normal.y,
    };
  }

  const scale = magnitude > EPSILON ? magnitude : 1;
  const nextX = normal.x * scale;
  const nextY = normal.y * scale;
  const nextLevel = nextX * anchorWorld.x + nextY * anchorWorld.y;

  state.objective.xCoeff = formatEditableNumber(nextX);
  state.objective.yCoeff = formatEditableNumber(nextY);
  state.objective.level = formatEditableNumber(nextLevel);
}

function midpointWorld(start, end) {
  return {
    x: (start.x + end.x) / 2,
    y: (start.y + end.y) / 2,
  };
}

function previewCurrentModel() {
  const preview = activeLoaderTab === "statement"
    ? parseStatementModel(dom.statementInput.value)
    : parseTableModel();

  modelPreview = preview;
  renderModelPreview(preview);
  return preview;
}

function loadPreviewIntoGraph() {
  const preview = modelPreview ?? previewCurrentModel();
  if (!preview || (!preview.constraints.length && !preview.objective)) {
    return;
  }

  applyParsedModel(preview);
  modelPreview = {
    ...preview,
    wasLoaded: true,
  };
  renderModelPreview(modelPreview);
}

function clearModelLoader() {
  dom.statementInput.value = "";
  dom.tableVariableMode.value = "named";
  dom.tableVariableOne.value = DEFAULT_TABLE_VARIABLES.x;
  dom.tableVariableTwo.value = DEFAULT_TABLE_VARIABLES.y;
  dom.tableObjectiveMode.value = "max";
  dom.tableObjectiveX.value = "";
  dom.tableObjectiveY.value = "";
  resetTableSheetRows();
  dom.tableDefaultNonnegative.checked = true;
  syncTableLoaderUi();
  modelPreview = null;
  renderModelPreview(null);
}

function applyParsedModel(preview) {
  const nextConstraints = preview.constraints.map((constraint) => createConstraint(constraint));
  state.constraints = nextConstraints;

  if (preview.objective) {
    state.objective.mode = preview.objective.mode;
    state.objective.xCoeff = formatEditableNumber(preview.objective.xCoeff);
    state.objective.yCoeff = formatEditableNumber(preview.objective.yCoeff);
    state.objective.level = formatEditableNumber(preview.objective.level ?? 0);
  }

  if (state.constraints.length) {
    autoFitViewToConstraints(state.constraints);
  }

  renderConstraintList();
  clampObjectiveToFeasibleRange();
  syncObjectiveInputs();
  syncViewInputs();
  refresh();
}

function renderModelPreview(preview, idleMessage = "Paste a model, then click Preview model or Load into graph.") {
  dom.modelPreviewDetails.innerHTML = "";

  if (!preview) {
    dom.modelPreviewBadge.textContent = "Waiting";
    dom.modelPreviewBadge.className = "status-badge neutral";
    dom.modelPreviewText.textContent = idleMessage;
    return;
  }

  const loadable = Boolean(preview.constraints.length || preview.objective);
  const tone = !loadable && !preview.errors.length && !preview.warnings.length
    ? "neutral"
    : (!loadable && preview.errors.length
      ? "danger"
      : (preview.errors.length || preview.warnings.length ? "warning" : "success"));
  const badgeText = tone === "neutral"
    ? "Waiting"
    : (preview.wasLoaded
    ? "Loaded"
    : (tone === "success" ? "Ready" : tone === "warning" ? "Check" : "Fix input"));

  dom.modelPreviewBadge.textContent = badgeText;
  dom.modelPreviewBadge.className = `status-badge ${tone}`;
  dom.modelPreviewText.textContent = tone === "neutral"
    ? "Add a statement or some table rows, then click Preview model or Load into graph."
    : buildModelPreviewMessage(preview);

  const sections = [];

  if (preview.variableSummary && (loadable || preview.errors.length || preview.warnings.length)) {
    sections.push(`
      <section class="model-preview-section">
        <h4>Variable mapping</h4>
        <p class="model-preview-message">${escapeHtml(preview.variableSummary)}</p>
      </section>
    `);
  }

  if (preview.objective) {
    sections.push(`
      <section class="model-preview-section">
        <h4>Objective</h4>
        <p class="model-preview-message">${escapeHtml(formatObjectiveSummary(preview.objective, preview.variableLabels))}</p>
      </section>
    `);
  }

  if (preview.constraints.length) {
    const constraintMarkup = preview.constraints
      .map((constraint) => {
        const label = constraint.name.trim() ? `${constraint.name.trim()}: ` : "";
        return `<li>${escapeHtml(label + describeConstraint(constraint))}</li>`;
      })
      .join("");
    sections.push(`
      <section class="model-preview-section">
        <h4>Parsed constraints</h4>
        <ol class="model-preview-list">${constraintMarkup}</ol>
      </section>
    `);
  }

  if (preview.warnings.length) {
    sections.push(`
      <section class="model-preview-section">
        <h4>Warnings</h4>
        <ul class="model-preview-list">${preview.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}</ul>
      </section>
    `);
  }

  if (preview.errors.length) {
    sections.push(`
      <section class="model-preview-section">
        <h4>Could not parse</h4>
        <ul class="model-preview-list">${preview.errors.map((error) => `<li>${escapeHtml(error)}</li>`).join("")}</ul>
      </section>
    `);
  }

  dom.modelPreviewDetails.innerHTML = sections.join("");
}

function buildModelPreviewMessage(preview) {
  const action = preview.wasLoaded ? "Loaded" : "Ready to load";
  const constraintCount = preview.constraints.length;
  let base = "I could not build a graph-ready model from this input yet.";

  if (constraintCount && preview.objective) {
    base = `${action} ${constraintCount} constraint${constraintCount === 1 ? "" : "s"} and update the objective.`;
  } else if (constraintCount) {
    base = `${action} ${constraintCount} constraint${constraintCount === 1 ? "" : "s"} while keeping the current objective.`;
  } else if (preview.objective) {
    base = `${action} the objective without changing the current constraints.`;
  }

  if (preview.errors.length) {
    return `${base} ${preview.errors.length} item${preview.errors.length === 1 ? "" : "s"} still need attention.`;
  }

  if (preview.warnings.length) {
    return `${base} ${preview.warnings.length} note${preview.warnings.length === 1 ? "" : "s"} may need review.`;
  }

  return base;
}

function parseStatementModel(text) {
  const normalizedText = normalizeStatementText(text);
  const lines = normalizedText
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const {
    variableMap,
    variableSummary,
    warnings: variableWarnings,
    variableLabels,
  } = inferVariableMap(lines);
  const warnings = [...variableWarnings];
  const errors = [];
  const constraints = [];
  let objective = null;

  lines.forEach((line) => {
    if (isIgnorableStatementLine(line)) {
      return;
    }

    if (!objective) {
      const parsedObjective = parseStatementObjectiveLine(line, variableMap);
      if (parsedObjective) {
        objective = parsedObjective;
        return;
      }
    }

    const parsedConstraint = parseStatementConstraintLine(line, variableMap);
    if (parsedConstraint.constraints.length) {
      constraints.push(...parsedConstraint.constraints);
      warnings.push(...parsedConstraint.warnings);
      return;
    }

    errors.push(line);
  });

  if (!objective) {
    warnings.push("No objective was detected. Loading this preview will keep the current objective.");
  }

  if (!constraints.length && !objective && !normalizedText.trim()) {
    warnings.length = 0;
  }

  return {
    source: "statement",
    objective,
    constraints,
    warnings,
    errors,
    variableSummary,
    variableLabels,
  };
}

function parseTableModel() {
  const tableContext = getTableVariableContext();
  const warnings = [...tableContext.warnings];
  const errors = [];
  const constraints = [];
  const parsedObjective = parseTableObjective(tableContext);
  const tableRows = readTableSheetRows();

  if (parsedObjective.error) {
    errors.push(parsedObjective.error);
  }

  const objective = parsedObjective.objective;
  const tableResult = parseConstraintTableRows(tableRows, tableContext);
  constraints.push(...tableResult.constraints);
  warnings.push(...tableResult.warnings);
  errors.push(...tableResult.errors);

  if (dom.tableDefaultNonnegative.checked && tableResult.constraints.length) {
    if (!hasAxisNonnegativeConstraint(constraints, "x")) {
      constraints.push({
        name: "",
        type: "x_geq",
        param1: "0",
        param2: "0",
        enabled: true,
      });
      warnings.push(`Added ${tableContext.xLabel} >= 0 because it was not listed in the table.`);
    }
    if (!hasAxisNonnegativeConstraint(constraints, "y")) {
      constraints.push({
        name: "",
        type: "y_geq",
        param1: "0",
        param2: "0",
        enabled: true,
      });
      warnings.push(`Added ${tableContext.yLabel} >= 0 because it was not listed in the table.`);
    }
  }

  if (!objective) {
    warnings.push("No table objective was provided. Loading this preview will keep the current objective.");
  }

  if (!objective && !tableResult.rowCount) {
    warnings.length = 0;
  }

  return {
    source: "table",
    objective,
    constraints,
    warnings,
    errors,
    variableSummary: tableContext.variableSummary,
    variableLabels: tableContext.variableLabels,
  };
}

function resetTableSheetRows() {
  dom.tableSheetBody.innerHTML = "";
  ensureTableSheetMinimumRows();
}

function ensureTableSheetMinimumRows(minimumRows = MIN_TABLE_SHEET_ROWS) {
  while (dom.tableSheetBody.children.length < minimumRows) {
    appendTableSheetRow();
  }
}

function appendTableSheetRow(values = {}) {
  const rowIndex = dom.tableSheetBody.children.length;
  const tableContext = getTableVariableContext();
  const row = document.createElement("div");
  row.className = "table-sheet-row";
  row.dataset.rowIndex = String(rowIndex);
  row.setAttribute("role", "row");

  const indexCell = document.createElement("div");
  indexCell.className = "table-sheet-index";
  indexCell.textContent = String(rowIndex + 1);
  row.appendChild(indexCell);

  TABLE_SHEET_COLUMNS.forEach((column) => {
    const cell = document.createElement("div");
    cell.className = "table-sheet-cell";
    cell.setAttribute("role", "cell");

    let field;
    if (column.options) {
      field = document.createElement("select");
      column.options.forEach((optionValue) => {
        const option = document.createElement("option");
        option.value = optionValue;
        option.textContent = optionValue;
        field.appendChild(option);
      });
      field.value = normalizeRelationOperator(String(values[column.key] ?? "").trim());
    } else {
      field = document.createElement("input");
      field.type = "text";
      field.inputMode = column.inputMode ?? "text";
      field.placeholder = column.placeholder ?? "";
      const nextValue = column.key === "name"
        ? (Object.hasOwn(values, column.key) ? values[column.key] : getDefaultTableRowName(rowIndex))
        : (values[column.key] ?? "");
      field.value = String(nextValue);
    }

    field.className = "table-sheet-field";
    field.dataset.colKey = column.key;
    field.setAttribute("aria-label", `Constraint table ${getTableSheetColumnLabel(column.key, tableContext)} row ${rowIndex + 1}`);
    cell.appendChild(field);
    row.appendChild(cell);
  });

  dom.tableSheetBody.appendChild(row);
  return row;
}

function focusTableSheetRow(row, columnKey = "name") {
  row?.querySelector(`[data-col-key="${columnKey}"]`)?.focus();
}

function getTableSheetRows() {
  return Array.from(dom.tableSheetBody.querySelectorAll(".table-sheet-row"));
}

function readTableSheetRows() {
  return getTableSheetRows().map((row, index) => {
    const record = {};
    TABLE_SHEET_COLUMNS.forEach((column) => {
      record[column.key] = getTableSheetFieldValue(row, column.key);
    });
    record.rowIndex = index;
    return record;
  });
}

function getTableSheetFieldValue(row, columnKey) {
  return String(row.querySelector(`[data-col-key="${columnKey}"]`)?.value ?? "").trim();
}

function rowHasTableValues(row) {
  const rowIndex = Number(row.dataset.rowIndex ?? "0");
  const nameValue = getTableSheetFieldValue(row, "name");
  const hasCustomName = nameValue && nameValue !== getDefaultTableRowName(rowIndex);
  const hasOtherValues = TABLE_SHEET_COLUMNS
    .filter((column) => column.key !== "name")
    .some((column) => getTableSheetFieldValue(row, column.key));
  return hasCustomName || hasOtherValues;
}

function ensureTrailingBlankTableRow() {
  ensureTableSheetMinimumRows();
  const rows = getTableSheetRows();
  const lastRow = rows[rows.length - 1];
  if (lastRow && rowHasTableValues(lastRow)) {
    appendTableSheetRow();
  }
}

function handleTableSheetEdit(event) {
  if (!event.target.closest(".table-sheet-row")) {
    return;
  }

  ensureTrailingBlankTableRow();
  invalidateModelPreview();
}

function removeLastTableSheetRow() {
  const rows = getTableSheetRows();
  if (!rows.length) {
    return;
  }

  if (rows.length > MIN_TABLE_SHEET_ROWS) {
    rows[rows.length - 1].remove();
    invalidateModelPreview();
    return;
  }

  const targetRow = [...rows].reverse().find((row) => rowHasTableValues(row));
  if (!targetRow) {
    return;
  }

  resetTableSheetRow(targetRow);
  invalidateModelPreview();
}

function resetTableSheetRow(row) {
  const rowIndex = Number(row.dataset.rowIndex ?? "0");
  TABLE_SHEET_COLUMNS.forEach((column) => {
    const field = row.querySelector(`[data-col-key="${column.key}"]`);
    if (!field) {
      return;
    }

    if (column.key === "name") {
      field.value = getDefaultTableRowName(rowIndex);
    } else {
      field.value = "";
    }
  });
}

function handleTableSheetPaste(event) {
  const field = event.target.closest(".table-sheet-field");
  const text = event.clipboardData?.getData("text/plain") ?? "";
  if (!field || (!text.includes("\t") && !text.includes("\n"))) {
    return;
  }

  event.preventDefault();
  pasteIntoTableSheet(field, text);
  ensureTrailingBlankTableRow();
  invalidateModelPreview();
}

function pasteIntoTableSheet(startField, pastedText) {
  const normalizedText = String(pastedText).replace(/\r/g, "").trimEnd();
  if (!normalizedText.trim()) {
    return;
  }

  const rawLines = normalizedText
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .filter((line) => line.trim());
  if (!rawLines.length) {
    return;
  }

  const delimiter = detectTableDelimiter(rawLines[0]);
  const rawRows = rawLines.map((line) => splitDelimitedRow(line, delimiter));
  const normalizedRows = normalizePastedTableRows(rawRows);
  if (!normalizedRows.rows.length) {
    return;
  }

  const startRowIndex = Number(startField.closest(".table-sheet-row")?.dataset.rowIndex ?? "0");
  const startColumnIndex = Math.max(
    0,
    TABLE_SHEET_COLUMNS.findIndex((column) => column.key === startField.dataset.colKey)
  );
  const fillFromFirstColumn = normalizedRows.usesColumnMap;
  const targetColumnIndex = fillFromFirstColumn ? 0 : startColumnIndex;
  const finalRows = normalizedRows.rows;

  ensureTableSheetMinimumRows(Math.max(MIN_TABLE_SHEET_ROWS, startRowIndex + finalRows.length));

  finalRows.forEach((rowValues, rowOffset) => {
    const row = getTableSheetRows()[startRowIndex + rowOffset];
    if (!row) {
      return;
    }

    rowValues.forEach((value, columnOffset) => {
      if (value === undefined) {
        return;
      }
      const column = TABLE_SHEET_COLUMNS[targetColumnIndex + columnOffset];
      if (!column) {
        return;
      }

      const field = row.querySelector(`[data-col-key="${column.key}"]`);
      if (!field) {
        return;
      }

      const normalizedValue = String(value ?? "").trim();
      if (column.key === "relation") {
        field.value = ["<=", ">=", "="].includes(normalizeRelationOperator(normalizedValue))
          ? normalizeRelationOperator(normalizedValue)
          : "";
      } else {
        field.value = normalizedValue;
      }
    });
  });
}

function normalizePastedTableRows(rawRows) {
  if (!rawRows.length) {
    return { rows: [], usesColumnMap: false };
  }

  const headerMap = buildTableColumnMap(rawRows[0], getTableVariableContext());
  if (headerMap) {
    return {
      rows: rawRows.slice(1).map((row) => mapPastedTableRow(row, headerMap)),
      usesColumnMap: true,
    };
  }

  if (rawRows[0].length >= 4) {
    const fallbackMap = rawRows[0].length >= 5
      ? { name: 0, xCoeff: 1, yCoeff: 2, relation: 3, rhs: 4 }
      : { name: -1, xCoeff: 0, yCoeff: 1, relation: 2, rhs: 3 };
    return {
      rows: rawRows.map((row) => mapPastedTableRow(row, fallbackMap)),
      usesColumnMap: true,
    };
  }

  return { rows: rawRows, usesColumnMap: false };
}

function mapPastedTableRow(row, columnMap) {
  return TABLE_SHEET_COLUMNS.map((column) => {
    const mappedIndex = columnMap[column.key];
    if (mappedIndex === undefined || mappedIndex === -1) {
      return undefined;
    }
    return row[mappedIndex] ?? "";
  });
}

function parseTableObjective(tableContext = getTableVariableContext()) {
  const xText = dom.tableObjectiveX.value.trim();
  const yText = dom.tableObjectiveY.value.trim();
  if (!xText && !yText) {
    return { objective: null, error: null };
  }

  const xCoeff = parseFlexibleNumber(xText || "0");
  const yCoeff = parseFlexibleNumber(yText || "0");
  if (!Number.isFinite(xCoeff) || !Number.isFinite(yCoeff)) {
    return {
      objective: null,
      error: `The table objective row needs valid numeric ${tableContext.xLabel} and ${tableContext.yLabel} coefficients.`,
    };
  }

  return {
    objective: {
      mode: dom.tableObjectiveMode.value,
      xCoeff,
      yCoeff,
      level: 0,
    },
    error: null,
  };
}

function parseConstraintTableRows(rows, tableContext = getTableVariableContext()) {
  const warnings = [];
  const errors = [];
  const constraints = [];
  let rowCount = 0;

  rows.forEach((row, index) => {
    const name = String(row.name ?? "").trim();
    const relationText = String(row.relation ?? "").trim();
    const xText = String(row.xCoeff ?? "").trim();
    const yText = String(row.yCoeff ?? "").trim();
    const rhsText = String(row.rhs ?? "").trim();
    const hasOtherValues = [relationText, xText, yText, rhsText].some(Boolean);
    const isGeneratedDefaultName = name === getDefaultTableRowName(row.rowIndex ?? index);
    if (!hasOtherValues && (!name || isGeneratedDefaultName)) {
      return;
    }

    rowCount += 1;
    const relation = normalizeRelationOperator(relationText);
    const xCoeff = parseFlexibleNumber(xText);
    const yCoeff = parseFlexibleNumber(yText);
    const rhs = parseFlexibleNumber(rhsText);

    if (!relation || !["<=", ">=", "="].includes(relation)) {
      errors.push(`Row ${index + 1}: relation must be <=, <, >=, >, or =.`);
      return;
    }
    if (!Number.isFinite(xCoeff) || !Number.isFinite(yCoeff) || !Number.isFinite(rhs)) {
      errors.push(`Row ${index + 1}: ${tableContext.xCoeffLabel}, ${tableContext.yCoeffLabel}, and rhs must all be numeric.`);
      return;
    }

    const converted = convertRelationToConstraintSeeds({
      name,
      xCoeff,
      yCoeff,
      relation,
      rhs,
    });

    if (!converted.length) {
      errors.push(`Row ${index + 1}: the coefficients do not define a usable 2D constraint.`);
      return;
    }

    constraints.push(...converted);
  });

  return { constraints, warnings, errors, rowCount };
}

function getDefaultTableRowName(rowIndex) {
  return `c${Number(rowIndex) + 1}`;
}

function detectTableDelimiter(line) {
  if (line.includes("\t")) {
    return "\t";
  }
  if (line.includes(",")) {
    return ",";
  }
  return /\s{2,}/;
}

function splitDelimitedRow(line, delimiter) {
  if (delimiter instanceof RegExp) {
    return line.split(delimiter).map((part) => part.trim());
  }
  return line.split(delimiter).map((part) => part.trim());
}

function buildTableColumnMap(headerRow, tableContext = getTableVariableContext()) {
  const normalizedHeaders = headerRow.map((header) => normalizeTableHeader(header));
  const findIndex = (aliases) => normalizedHeaders.findIndex((header) => aliases.includes(header));
  const xAliases = tableContext.mode === "named"
    ? buildTableHeaderAliases("x", tableContext.xLabel)
    : buildTableHeaderAliases("x");
  const yAliases = tableContext.mode === "named"
    ? buildTableHeaderAliases("y", tableContext.yLabel)
    : buildTableHeaderAliases("y");
  const columnMap = {
    name: findIndex(["name", "constraint", "label"]),
    xCoeff: findIndex(xAliases),
    yCoeff: findIndex(yAliases),
    relation: findIndex(["relation", "operator", "sign", "op"]),
    rhs: findIndex(["rhs", "bound", "value", "constant"]),
  };

  if (columnMap.xCoeff === -1 || columnMap.yCoeff === -1 || columnMap.relation === -1 || columnMap.rhs === -1) {
    return null;
  }

  return columnMap;
}

function buildTableHeaderAliases(axisName, customName = "") {
  const aliasSet = new Set([
    `${axisName}coeff`,
    `${axisName}coefficient`,
    axisName,
    axisName === "x" ? "ax" : "by",
    `coeff${axisName}`,
  ]);

  const normalizedCustom = normalizeTableHeader(customName);
  if (normalizedCustom) {
    aliasSet.add(normalizedCustom);
    aliasSet.add(`${normalizedCustom}coeff`);
    aliasSet.add(`${normalizedCustom}coefficient`);
    aliasSet.add(`coeff${normalizedCustom}`);
  }

  return Array.from(aliasSet);
}

function normalizeTableHeader(header) {
  return String(header).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function hasAxisNonnegativeConstraint(constraints, axis) {
  return constraints.some((constraint) => {
    if (axis === "x" && constraint.type === "x_geq") {
      return Math.abs(toNumber(constraint.param1, 0)) <= EPSILON;
    }
    if (axis === "y" && constraint.type === "y_geq") {
      return Math.abs(toNumber(constraint.param1, 0)) <= EPSILON;
    }
    return false;
  });
}

function normalizeStatementText(text) {
  return String(text)
    .replace(/\r/g, "\n")
    .replace(/[≤⩽]/g, "<=")
    .replace(/[≥⩾]/g, ">=")
    .replace(/[−–—]/g, "-")
    .replace(/[×]/g, "*")
    .replace(/\u00bc/g, "1/4")
    .replace(/\u00bd/g, "1/2")
    .replace(/\u00be/g, "3/4")
    .replace(/\u2150/g, "1/7")
    .replace(/\u2151/g, "1/9")
    .replace(/\u2152/g, "1/10")
    .replace(/\u2153/g, "1/3")
    .replace(/\u2154/g, "2/3")
    .replace(/\u2155/g, "1/5")
    .replace(/\u2156/g, "2/5")
    .replace(/\u2157/g, "3/5")
    .replace(/\u2158/g, "4/5")
    .replace(/\u2159/g, "1/6")
    .replace(/\u215a/g, "5/6")
    .replace(/(?:\bsubject to\b|\bs\.?\s*t\b\.?)/gi, "\nsubject to\n")
    .replace(/;/g, "\n");
}

function inferVariableMap(lines) {
  const tokens = [];
  const ignored = new Set([
    "MAX",
    "MAXIMIZE",
    "MIN",
    "MINIMIZE",
    "SUBJECT",
    "TO",
    "ST",
    "SUCH",
    "THAT",
    "CONSTRAINT",
    "CONSTRAINTS",
    "OBJ",
    "OBJECTIVE",
    "FUNCTION",
    "STATEMENT",
    "Z",
  ]);

  lines.forEach((line) => {
    const matches = line.match(/[A-Za-z][A-Za-z0-9_]*/g) ?? [];
    matches.forEach((token) => {
      const upperToken = token.toUpperCase();
      if (!ignored.has(upperToken)) {
        tokens.push(token);
      }
    });
  });

  const uniqueTokens = [];
  tokens.forEach((token) => {
    if (!uniqueTokens.some((candidate) => candidate.toUpperCase() === token.toUpperCase())) {
      uniqueTokens.push(token);
    }
  });

  const warnings = [];
  if (uniqueTokens.length > 2) {
    warnings.push(`Only two decision variables can be graphed here, so I mapped ${uniqueTokens[0]} to x and ${uniqueTokens[1]} to y.`);
  }

  const firstVariable = uniqueTokens[0] ?? "x";
  const secondVariable = uniqueTokens[1] ?? "y";
  const variableMap = {
    [firstVariable]: "x",
    [secondVariable]: "y",
  };

  return {
    variableMap,
    variableSummary: `${firstVariable} -> x, ${secondVariable} -> y`,
    variableLabels: { x: firstVariable, y: secondVariable },
    warnings,
  };
}

function isIgnorableStatementLine(line) {
  return /^(subject to|constraints?|such that|[.:]+)$/i.test(line.trim());
}

function parseStatementObjectiveLine(line, variableMap) {
  const match = line.match(/^(?:.*?[-:]\s*)?(max(?:imize)?|min(?:imize)?)\s*:?\s*(.+)$/i);
  if (!match) {
    return null;
  }

  const mode = /^min/i.test(match[1]) ? "min" : "max";
  const expression = match[2].replace(/^(?:z|obj(?:ective)?)\s*=\s*/i, "").trim();
  const parsed = parseLinearExpression(expression, variableMap);
  if (!parsed) {
    return null;
  }

  return {
    mode,
    xCoeff: parsed.x,
    yCoeff: parsed.y,
    level: 0,
  };
}

function parseStatementConstraintLine(line, variableMap) {
  const warnings = [];
  const pairMatch = line.match(/^([A-Za-z][A-Za-z0-9_]*(?:\s*,\s*[A-Za-z][A-Za-z0-9_]*)+)\s*(<=|>=|=|<|>)\s*(.+)$/i);
  if (pairMatch) {
    const variableList = pairMatch[1].split(",").map((item) => item.trim()).filter(Boolean);
    const expandedConstraints = variableList.flatMap((variableName) =>
      parseStatementConstraintLine(`${variableName} ${pairMatch[2]} ${pairMatch[3]}`, variableMap).constraints
    );
    return { constraints: expandedConstraints, warnings };
  }

  const operatorMatch = line.match(/(<=|>=|=|<|>)/);
  if (!operatorMatch) {
    return { constraints: [], warnings };
  }

  const operator = normalizeRelationOperator(operatorMatch[1]);
  const operatorIndex = line.indexOf(operatorMatch[1]);
  const leftExpression = parseLinearExpression(line.slice(0, operatorIndex), variableMap);
  const rightExpression = parseLinearExpression(line.slice(operatorIndex + operatorMatch[1].length), variableMap);
  if (!leftExpression || !rightExpression) {
    return { constraints: [], warnings };
  }

  const normalizedRelation = {
    name: "",
    xCoeff: leftExpression.x - rightExpression.x,
    yCoeff: leftExpression.y - rightExpression.y,
    relation: operator,
    rhs: rightExpression.constant - leftExpression.constant,
  };

  return {
    constraints: convertRelationToConstraintSeeds(normalizedRelation),
    warnings,
  };
}

function convertRelationToConstraintSeeds({ name, xCoeff, yCoeff, relation, rhs }) {
  if (Math.abs(xCoeff) <= EPSILON && Math.abs(yCoeff) <= EPSILON) {
    return [];
  }

  if (relation === "=") {
    const names = buildConstraintNameVariants(name, 2);
    return [
      ...convertRelationToConstraintSeeds({ name: names[0], xCoeff, yCoeff, relation: "<=", rhs }),
      ...convertRelationToConstraintSeeds({ name: names[1], xCoeff, yCoeff, relation: ">=", rhs }),
    ];
  }

  if (Math.abs(yCoeff) <= EPSILON) {
    const bound = rhs / xCoeff;
    return [{
      name: name.trim(),
      type: relation === "<="
        ? (xCoeff > 0 ? "x_leq" : "x_geq")
        : (xCoeff > 0 ? "x_geq" : "x_leq"),
      param1: formatEditableNumber(bound),
      param2: "0",
      enabled: true,
    }];
  }

  if (Math.abs(xCoeff) <= EPSILON) {
    const bound = rhs / yCoeff;
    return [{
      name: name.trim(),
      type: relation === "<="
        ? (yCoeff > 0 ? "y_leq" : "y_geq")
        : (yCoeff > 0 ? "y_geq" : "y_leq"),
      param1: formatEditableNumber(bound),
      param2: "0",
      enabled: true,
    }];
  }

  const slope = -xCoeff / yCoeff;
  const intercept = rhs / yCoeff;
  return [{
    name: name.trim(),
    type: relation === "<="
      ? (yCoeff > 0 ? "line_leq" : "line_geq")
      : (yCoeff > 0 ? "line_geq" : "line_leq"),
    param1: formatEditableNumber(slope),
    param2: formatEditableNumber(intercept),
    enabled: true,
  }];
}

function buildConstraintNameVariants(baseName, count) {
  if (!baseName.trim()) {
    return new Array(count).fill("");
  }
  return Array.from({ length: count }, (_, index) => `${baseName.trim()}${String.fromCharCode(97 + index)}`);
}

function parseLinearExpression(expression, variableMap) {
  const compact = String(expression)
    .replace(/\s+/g, "")
    .replace(/[−–—]/g, "-")
    .replace(/\*/g, "")
    .replace(/,/g, "");

  if (!compact) {
    return null;
  }

  const normalized = /^[+-]/.test(compact) ? compact : `+${compact}`;
  const terms = normalized.match(/[+-][^+-]+/g);
  if (!terms) {
    return null;
  }

  const parsed = { x: 0, y: 0, constant: 0 };
  const orderedEntries = Object.entries(variableMap).sort((first, second) => second[0].length - first[0].length);

  for (const term of terms) {
    const variableEntry = orderedEntries.find(([sourceVariable]) => new RegExp(escapeRegex(sourceVariable), "i").test(term));
    if (!variableEntry) {
      const constant = parseFlexibleNumber(term);
      if (!Number.isFinite(constant)) {
        return null;
      }
      parsed.constant += constant;
      continue;
    }

    const [sourceVariable, targetVariable] = variableEntry;
    const coefficientText = term.replace(new RegExp(escapeRegex(sourceVariable), "ig"), "");
    let coefficient = 1;

    if (coefficientText && coefficientText !== "+") {
      coefficient = coefficientText === "-" ? -1 : parseFlexibleNumber(coefficientText);
    }

    if (!Number.isFinite(coefficient)) {
      return null;
    }

    parsed[targetVariable] += coefficient;
  }

  return parsed;
}

function parseFlexibleNumber(value) {
  const normalized = String(value)
    .trim()
    .replace(/[−–—]/g, "-")
    .replace(/\s*\/\s*/g, "/");
  if (!normalized) {
    return Number.NaN;
  }

  const fractionMatch = normalized.match(
    /^([+-]?(?:\d+(?:\.\d+)?|\.\d+))\/([+-]?(?:\d+(?:\.\d+)?|\.\d+))$/
  );
  if (fractionMatch) {
    const numerator = Number(fractionMatch[1]);
    const denominator = Number(fractionMatch[2]);
    if (Math.abs(denominator) <= EPSILON) {
      return Number.NaN;
    }
    return numerator / denominator;
  }

  return Number(normalized);
}

function normalizeRelationOperator(operator) {
  if (operator === "≤") {
    return "<=";
  }
  if (operator === "≥") {
    return ">=";
  }
  if (operator === "<") {
    return "<=";
  }
  if (operator === ">") {
    return ">=";
  }
  return operator;
}

function formatObjectiveSummary(objective, variableLabels = { x: "x", y: "y" }) {
  const modeLabel = objective.mode === "min" ? "Min" : "Max";
  return `${modeLabel} ${formatLinearObjective(objective.xCoeff, objective.yCoeff, variableLabels)}`;
}

function formatLinearObjective(xCoeff, yCoeff, variableLabels = { x: "x", y: "y" }) {
  const terms = [
    formatVariableTerm(xCoeff, variableLabels.x ?? "x"),
    formatVariableTerm(yCoeff, variableLabels.y ?? "y"),
  ].filter(Boolean);

  if (!terms.length) {
    return "0";
  }

  return terms
    .map((term, index) => {
      const sign = term[0];
      const body = term.slice(1);
      if (index === 0) {
        return sign === "+" ? body : `-${body}`;
      }
      return sign === "+" ? `+ ${body}` : `- ${body}`;
    })
    .join(" ");
}

function formatVariableTerm(coefficient, variableName) {
  const numericValue = toNumber(coefficient, Number.NaN);
  if (!Number.isFinite(numericValue) || Math.abs(numericValue) <= EPSILON) {
    return "";
  }

  const magnitude = Math.abs(numericValue);
  const coefficientLabel = Math.abs(magnitude - 1) <= EPSILON ? "" : formatAnswerNumber(magnitude);
  const signPrefix = numericValue < 0 ? "-" : "+";
  return `${signPrefix}${coefficientLabel}${variableName}`;
}

function loadExampleProblem() {
  state.constraints = EXAMPLE_PROBLEM.constraints.map((constraint) => createConstraint(constraint));
  state.objective = { ...EXAMPLE_PROBLEM.objective };
  state.view = { ...EXAMPLE_PROBLEM.view };
  syncObjectiveInputs();
  syncViewInputs();
  renderConstraintList();
  refresh();
}

function createConstraint(seed = {}) {
  return {
    id: nextConstraintId++,
    name: seed.name ?? "",
    type: seed.type ?? "line_leq",
    param1: seed.param1 ?? "1",
    param2: seed.param2 ?? "0",
    enabled: seed.enabled ?? true,
  };
}

function renderConstraintList() {
  dom.constraintList.innerHTML = "";

  if (!state.constraints.length) {
    const empty = document.createElement("div");
    empty.className = "constraint-row";
    empty.innerHTML =
      '<p class="constraint-equation">No constraints yet. Add one to start building a feasible region.</p>';
    dom.constraintList.appendChild(empty);
    return;
  }

  state.constraints.forEach((constraint, index) => {
    const row = document.createElement("div");
    row.className = "constraint-row";
    row.dataset.id = String(constraint.id);

    const color = getConstraintColor(index);
    const fillColor = hexToRgba(color, 0.24);
    const lineColor = hexToRgba(color, 0.44);
    row.style.setProperty("--constraint-fill", fillColor);
    row.style.setProperty("--constraint-line", lineColor);
    const labels = getConstraintFieldLabels(constraint.type);
    const displayName = getConstraintDisplayName(constraint, index);
    const defaultName = getDefaultConstraintName(constraint.id);

    row.innerHTML = `
      <div class="constraint-top">
        <div class="constraint-title">
          <span class="constraint-swatch" style="background:${color}"></span>
          <span class="constraint-label" data-role="constraint-label">${escapeHtml(displayName)}</span>
          <input
            class="constraint-name-input"
            data-field="name"
            type="text"
            value="${escapeHtml(constraint.name)}"
            placeholder="${escapeHtml(defaultName)}"
            aria-label="Constraint name"
          />
        </div>
        <div class="constraint-tools">
          <label class="toggle">
            <input data-field="enabled" type="checkbox" ${constraint.enabled ? "checked" : ""} />
            <span>On</span>
          </label>
          <button class="icon-button" type="button" data-action="remove" aria-label="Remove constraint">
            x
          </button>
        </div>
      </div>
      <div class="form-grid constraint-grid">
        <label>
          <span>Form</span>
          <select data-field="type">
            ${CONSTRAINT_TYPES.map(
              (type) =>
                `<option value="${type.value}" ${type.value === constraint.type ? "selected" : ""}>${type.label}</option>`
            ).join("")}
          </select>
        </label>
        <label>
          <span>${labels.param1}</span>
          <input data-field="param1" type="text" inputmode="text" value="${escapeHtml(constraint.param1)}" />
        </label>
        <label class="${labels.hideParam2 ? "is-hidden" : ""}">
          <span>${labels.param2}</span>
          <input
            data-field="param2"
            type="text"
            inputmode="text"
            value="${escapeHtml(constraint.param2)}"
            ${labels.hideParam2 ? 'style="opacity:0.55"' : ""}
          />
        </label>
      </div>
      <p class="constraint-equation" data-role="equation">${describeConstraint(constraint)}</p>
    `;

    const param2Input = row.querySelector("[data-field='param2']");
    if (labels.hideParam2 && param2Input) {
      param2Input.disabled = true;
    }

    dom.constraintList.appendChild(row);
  });
}

function updateConstraintEquation(constraintId) {
  const row = dom.constraintList.querySelector(`.constraint-row[data-id="${constraintId}"]`);
  const constraint = state.constraints.find((item) => item.id === constraintId);
  if (!row || !constraint) {
    return;
  }

  const equation = row.querySelector("[data-role='equation']");
  if (equation) {
    equation.textContent = describeConstraint(constraint);
  }
}

function updateConstraintHeading(constraintId) {
  const row = dom.constraintList.querySelector(`.constraint-row[data-id="${constraintId}"]`);
  const constraint = findConstraintById(constraintId);
  if (!row || !constraint) {
    return;
  }

  const index = state.constraints.findIndex((item) => item.id === constraintId);
  const label = row.querySelector("[data-role='constraint-label']");
  if (label) {
    label.textContent = getConstraintDisplayName(constraint, index);
  }
}

function syncObjectiveFromInputs(includeLevel) {
  state.objective.mode = dom.objectiveMode.value;
  state.objective.xCoeff = dom.objectiveX.value;
  state.objective.yCoeff = dom.objectiveY.value;
  if (includeLevel) {
    state.objective.level = dom.objectiveLevel.value;
  }
}

function syncObjectiveInputs() {
  dom.objectiveMode.value = state.objective.mode;
  dom.objectiveX.value = state.objective.xCoeff;
  dom.objectiveY.value = state.objective.yCoeff;
  dom.objectiveLevel.value = formatInputValue(state.objective.level);
}

function syncViewFromInputs() {
  state.view.xMin = dom.viewXMin.value;
  state.view.xMax = dom.viewXMax.value;
  state.view.yMin = dom.viewYMin.value;
  state.view.yMax = dom.viewYMax.value;
}

function syncViewInputs() {
  dom.viewXMin.value = state.view.xMin;
  dom.viewXMax.value = state.view.xMax;
  dom.viewYMin.value = state.view.yMin;
  dom.viewYMax.value = state.view.yMax;
}

function refresh(syncInputs = true) {
  analysisCache = null;
  if (syncInputs) {
    syncObjectiveInputs();
    syncViewInputs();
  }
  const analysis = getAnalysis();
  renderStatuses(analysis);
  renderPlot(analysis);
}

function getAnalysis() {
  if (analysisCache) {
    return analysisCache;
  }

  const view = getViewWindow();
  const constraintEntries = state.constraints
    .map((constraint, index) => {
      if (!constraint.enabled) {
        return null;
      }
      const halfPlane = convertConstraintToHalfPlane(constraint);
      if (!halfPlane) {
        return null;
      }
      return {
        id: constraint.id,
        index,
        constraint,
        halfPlane,
        segment: lineSegmentInView(halfPlane.line, view),
      };
    })
    .filter(Boolean);
  const halfPlanes = constraintEntries.map((entry) => entry.halfPlane);
  const objective = getObjectiveCoefficients();
  const currentLevel = toNumber(state.objective.level, 0);
  const visiblePolygon = clipPolygon(makeRectangle(view.xMin, view.xMax, view.yMin, view.yMax), halfPlanes);
  const worldRadius = computeWorldRadius(view, halfPlanes);
  const worldPolygon = clipPolygon(makeRectangle(-worldRadius, worldRadius, -worldRadius, worldRadius), halfPlanes);

  const feasibility = {
    feasible: worldPolygon.length > 0,
    visible: visiblePolygon.length > 0,
  };

  const objectiveMagnitude = Math.hypot(objective.x, objective.y);
  const objectiveLine = objectiveMagnitude > EPSILON ? lineThroughObjectiveLevel(objective, currentLevel) : null;
  const currentLineSegment = objectiveLine ? lineSegmentInView(objectiveLine, view) : null;
  const currentContacts = objectiveLine && visiblePolygon.length
    ? linePolygonContacts(objectiveLine, visiblePolygon)
    : [];

  const optimization = analyzeOptimization({
    halfPlanes,
    worldPolygon,
    visiblePolygon,
    view,
    objective,
  });
  const objectiveRange = getObjectiveLevelRange({
    halfPlanes,
    worldPolygon,
    objective,
  });

  analysisCache = {
    view,
    halfPlanes,
    constraintEntries,
    visiblePolygon,
    worldPolygon,
    feasibility,
    objective,
    currentLevel,
    objectiveLine,
    currentLineSegment,
    currentContacts,
    objectiveRange,
    optimization,
  };

  return analysisCache;
}

function analyzeOptimization({ halfPlanes, worldPolygon, visiblePolygon, view, objective }) {
  if (!worldPolygon.length) {
    return {
      status: "infeasible",
      bestValue: null,
      bestContacts: [],
      visibleContacts: [],
      boundedRegion: false,
      message: "No common overlap exists across the active constraints.",
    };
  }

  if (Math.hypot(objective.x, objective.y) <= EPSILON) {
    return {
      status: "flat",
      bestValue: 0,
      bestContacts: [],
      visibleContacts: [],
      boundedRegion: isRegionBounded(halfPlanes),
      message: "The objective coefficients are both zero, so every feasible point has the same value.",
    };
  }

  const maximizeDirection = state.objective.mode === "max"
    ? objective
    : { x: -objective.x, y: -objective.y };

  if (isObjectiveUnbounded(halfPlanes, maximizeDirection)) {
    return {
      status: "unbounded",
      bestValue: null,
      bestContacts: [],
      visibleContacts: [],
      boundedRegion: false,
      message: "The objective can improve without bound in the chosen direction.",
    };
  }

  const values = worldPolygon.map((point) => evaluateObjective(point, objective));
  const bestValue = state.objective.mode === "max"
    ? Math.max(...values)
    : Math.min(...values);
  const bestLine = lineThroughObjectiveLevel(objective, bestValue);
  const bestContacts = linePolygonContacts(bestLine, worldPolygon);
  const visibleContacts = linePolygonContacts(bestLine, visiblePolygon);
  const boundedRegion = isRegionBounded(halfPlanes);

  return {
    status: "bounded",
    bestValue,
    bestContacts,
    visibleContacts,
    boundedRegion,
    message: bestContacts.length > 1
      ? `Optimal value ${formatAnswerNumber(bestValue)} occurs along an edge.`
      : `Optimal value ${formatAnswerNumber(bestValue)} occurs at a vertex.`,
  };
}

function getObjectiveLevelRange({ halfPlanes, worldPolygon, objective }) {
  if (!worldPolygon.length || Math.hypot(objective.x, objective.y) <= EPSILON) {
    return {
      minLevel: -Infinity,
      maxLevel: Infinity,
      lowerBounded: false,
      upperBounded: false,
    };
  }

  const values = worldPolygon.map((point) => evaluateObjective(point, objective));
  const lowerUnbounded = isObjectiveUnbounded(halfPlanes, { x: -objective.x, y: -objective.y });
  const upperUnbounded = isObjectiveUnbounded(halfPlanes, objective);

  return {
    minLevel: lowerUnbounded ? -Infinity : Math.min(...values),
    maxLevel: upperUnbounded ? Infinity : Math.max(...values),
    lowerBounded: !lowerUnbounded,
    upperBounded: !upperUnbounded,
  };
}

function clampObjectiveLevel(level, objectiveRange) {
  if (!objectiveRange) {
    return level;
  }

  return Math.min(Math.max(level, objectiveRange.minLevel), objectiveRange.maxLevel);
}

function renderStatuses(analysis) {
  if (!analysis.feasibility.feasible) {
    setStatus(dom.feasibilityBadge, "Infeasible", "danger");
    dom.feasibilityText.textContent = "These half-planes do not overlap, so no feasible point exists.";
  } else if (!analysis.feasibility.visible) {
    setStatus(dom.feasibilityBadge, "Off screen", "warning");
    dom.feasibilityText.textContent = "A feasible region exists, but it sits outside the current graph window.";
  } else {
    const regionLabel = analysis.optimization.boundedRegion ? "Bounded" : "Visible";
    setStatus(dom.feasibilityBadge, regionLabel, analysis.optimization.boundedRegion ? "success" : "warning");
    dom.feasibilityText.textContent = analysis.optimization.boundedRegion
      ? "The feasible polygon is visible in the current window."
      : "A feasible set exists. The window shows the portion that falls inside the graph.";
  }

  if (Math.hypot(analysis.objective.x, analysis.objective.y) <= EPSILON) {
    setStatus(dom.objectiveBadge, "No line", "neutral");
    dom.objectiveText.textContent = "Set at least one nonzero objective coefficient to draw and drag the line.";
  } else if (analysis.currentContacts.length) {
    setStatus(dom.objectiveBadge, "Intersecting", "success");
    dom.objectiveText.textContent = `Current level z = ${formatAnswerNumber(analysis.currentLevel)} touches the visible feasible region.`;
  } else if (analysis.currentLineSegment) {
    setStatus(dom.objectiveBadge, "Draggable", "warning");
    dom.objectiveText.textContent = `Current level z = ${formatAnswerNumber(analysis.currentLevel)} is visible but not touching the feasible region.`;
  } else {
    setStatus(dom.objectiveBadge, "Out of frame", "warning");
    dom.objectiveText.textContent = "The objective line is parallel to itself as expected, but its current level is outside the graph window.";
  }

  switch (analysis.optimization.status) {
    case "infeasible":
      setStatus(dom.optimumBadge, "No optimum", "danger");
      dom.optimumText.textContent = analysis.optimization.message;
      break;
    case "flat":
      setStatus(dom.optimumBadge, "Constant", "neutral");
      dom.optimumText.textContent = analysis.optimization.message;
      break;
    case "unbounded":
      setStatus(dom.optimumBadge, "Unbounded", "warning");
      dom.optimumText.textContent = analysis.optimization.message;
      break;
    case "bounded":
      if (!isObjectiveAtOptimum(analysis)) {
        setStatus(dom.optimumBadge, "Keep exploring", "neutral");
        dom.optimumText.textContent = buildHiddenOptimumText();
      } else if (analysis.optimization.bestContacts.length > 1) {
        setStatus(dom.optimumBadge, "Edge optimum", "success");
        dom.optimumText.textContent = buildEdgeOptimumText(analysis.optimization);
      } else {
        const point = analysis.optimization.bestContacts[0];
        setStatus(dom.optimumBadge, "Vertex optimum", "success");
        dom.optimumText.textContent = buildVertexOptimumText(analysis.optimization.bestValue, point);
      }
      break;
    default:
      setStatus(dom.optimumBadge, "Not solved", "neutral");
      dom.optimumText.textContent = "Change the model to compute the next optimum.";
  }
}

function setStatus(node, text, tone) {
  node.textContent = text;
  node.className = `status-badge ${tone}`;
}

function isObjectiveAtOptimum(analysis) {
  if (analysis.optimization.status !== "bounded") {
    return false;
  }

  return Math.abs(analysis.currentLevel - analysis.optimization.bestValue) <= 5e-4;
}

function buildHiddenOptimumText() {
  return [
    "Optimal Value: Hidden until the objective reaches the optimum",
    "Optimal Point: Hidden until the objective reaches the optimum",
    "Drag the objective or use Snap objective to optimum to reveal the solution.",
  ].join("\n");
}

function buildVertexOptimumText(bestValue, point) {
  return [
    `Optimal Value: ${formatResultValue(bestValue)}`,
    `Optimal Point: ${formatResultPoint(point)}`,
  ].join("\n");
}

function buildEdgeOptimumText(optimization) {
  const contacts = sortOptimumPoints(optimization.bestContacts);
  const [startPoint, endPoint] = contacts;
  const xRangeText = formatResultRange(startPoint.x, endPoint.x);

  const lines = [
    `Optimal Value: ${formatResultValue(optimization.bestValue)}`,
    'Optimal Point: N/A, there are multiple optimal solutions',
    `Optimal x-range: ${xRangeText}`,
  ];

  if (Math.abs(startPoint.x - endPoint.x) <= EPSILON) {
    lines.push(
      `Optimal edge: x = ${formatResultPrimary(startPoint.x)}, with y ranging from ${formatResultRange(startPoint.y, endPoint.y)}`
    );
    return lines.join("\n");
  }

  lines.push(`Optimal edge: ${formatEdgeEquation(startPoint, endPoint)}`);
  return lines.join("\n");
}

function sortOptimumPoints(points) {
  return [...points].sort((left, right) => {
    if (Math.abs(left.x - right.x) > EPSILON) {
      return left.x - right.x;
    }
    return left.y - right.y;
  });
}

function formatResultValue(value) {
  return formatResultDualValue(value);
}

function formatResultPoint(point) {
  const primaryText = `[${formatResultPrimary(point.x)}, ${formatResultPrimary(point.y)}]`;
  const decimalText = `[${formatNumber(point.x)}, ${formatNumber(point.y)}]`;
  return primaryText === decimalText
    ? decimalText
    : `${primaryText} or in decimal format ${decimalText}`;
}

function formatResultRange(a, b) {
  const minimum = Math.min(a, b);
  const maximum = Math.max(a, b);
  const primaryText = `[${formatResultPrimary(minimum)}, ${formatResultPrimary(maximum)}]`;
  const decimalText = `[${formatNumber(minimum)}, ${formatNumber(maximum)}]`;
  return primaryText === decimalText
    ? decimalText
    : `${primaryText} or in decimal format ${decimalText}`;
}

function formatResultDualValue(value) {
  const primaryText = formatResultPrimary(value);
  const decimalText = formatNumber(value);
  return primaryText === decimalText
    ? decimalText
    : `${primaryText} or in decimal format ${decimalText}`;
}

function formatResultPrimary(value) {
  return formatFractionOnly(value) ?? formatNumber(value);
}

function formatEdgeEquation(startPoint, endPoint) {
  const dx = endPoint.x - startPoint.x;
  if (Math.abs(dx) <= EPSILON) {
    return `x = ${formatResultPrimary(startPoint.x)}`;
  }

  const slope = (endPoint.y - startPoint.y) / dx;
  const intercept = startPoint.y - slope * startPoint.x;
  return `y = ${formatSlopeInterceptCompact(slope, intercept)}`;
}

function formatSlopeInterceptCompact(slope, intercept) {
  if (Math.abs(slope) <= EPSILON) {
    return formatResultPrimary(intercept);
  }

  const magnitude = Math.abs(slope);
  const slopeLabel = Math.abs(magnitude - 1) <= EPSILON
    ? "x"
    : `${formatResultPrimary(magnitude)}x`;
  const signedSlope = slope < 0 ? `-${slopeLabel}` : slopeLabel;

  if (Math.abs(intercept) <= EPSILON) {
    return signedSlope;
  }

  const sign = intercept >= 0 ? "+" : "-";
  return `${signedSlope} ${sign} ${formatResultPrimary(Math.abs(intercept))}`;
}

function renderPlot(analysis) {
  dom.plot.innerHTML = "";

  const layers = {
    background: svgGroup(),
    grid: svgGroup(),
    region: svgGroup(),
    interaction: svgGroup(),
    constraints: svgGroup(),
    overlay: svgGroup(),
    axes: svgGroup(),
    labels: svgGroup(),
  };
  ["background", "grid", "region", "axes", "labels"].forEach((key) => {
    layers[key].setAttribute("pointer-events", "none");
  });

  drawPlotBackdrop(layers.background);
  drawGrid(layers.grid, analysis.view);

  if (analysis.visiblePolygon.length) {
    drawVisibleRegion(layers.region, analysis.visiblePolygon, analysis.view);
  }

  drawPanSurface(layers.interaction);
  drawConstraints(layers.constraints, analysis);
  drawAxes(layers.axes, analysis.view);
  drawObjectiveLine(layers.overlay, analysis);
  drawOptimizationOverlay(layers.overlay, analysis);
  drawAxisLabels(layers.labels, analysis.view);

  Object.values(layers).forEach((group) => dom.plot.appendChild(group));
}

function drawPlotBackdrop(group) {
  const surface = svgElement("rect", {
    x: PLOT_BOX.x,
    y: PLOT_BOX.y,
    width: PLOT_BOX.width,
    height: PLOT_BOX.height,
    rx: 18,
    fill: "rgba(255,255,255,0.76)",
    stroke: "rgba(22,33,51,0.08)",
  });
  group.appendChild(surface);
}

function drawPanSurface(group) {
  group.appendChild(
    svgElement("rect", {
      x: PLOT_BOX.x,
      y: PLOT_BOX.y,
      width: PLOT_BOX.width,
      height: PLOT_BOX.height,
      rx: 18,
      fill: "rgba(255,255,255,0.001)",
      "data-drag-kind": "view-pan",
      "data-cursor": "grab",
      style: "cursor:grab",
    })
  );
}

function drawGrid(group, view) {
  const xTicks = niceTicks(view.xMin, view.xMax, 8);
  const yTicks = niceTicks(view.yMin, view.yMax, 8);

  xTicks.forEach((tick) => {
    const point = worldToSvg(tick, view.yMin, view);
    group.appendChild(
      svgElement("line", {
        x1: point.x,
        y1: PLOT_BOX.y,
        x2: point.x,
        y2: PLOT_BOX.y + PLOT_BOX.height,
        stroke: "rgba(22,33,51,0.08)",
        "stroke-width": 1,
      })
    );
  });

  yTicks.forEach((tick) => {
    const point = worldToSvg(view.xMin, tick, view);
    group.appendChild(
      svgElement("line", {
        x1: PLOT_BOX.x,
        y1: point.y,
        x2: PLOT_BOX.x + PLOT_BOX.width,
        y2: point.y,
        stroke: "rgba(22,33,51,0.08)",
        "stroke-width": 1,
      })
    );
  });
}

function drawVisibleRegion(group, polygon, view) {
  group.appendChild(
    svgElement("polygon", {
      points: polygon.map((point) => {
        const svgPoint = worldToSvg(point.x, point.y, view);
        return `${svgPoint.x},${svgPoint.y}`;
      }).join(" "),
      fill: "rgba(31, 122, 140, 0.18)",
      stroke: "rgba(31, 122, 140, 0.8)",
      "stroke-width": 2,
      "stroke-linejoin": "round",
    })
  );
}

function drawConstraints(group, analysis) {
  const lineLayer = svgGroup();
  const midpointLayer = svgGroup();
  const slopeLayer = svgGroup();
  const labelLayer = svgGroup();

  analysis.constraintEntries.forEach((entry) => {
    const { constraint, index, segment, id } = entry;
    if (!segment) {
      return;
    }

    const color = getConstraintColor(index);
    const midpoint = segment.midpoint;
    const translateSegment = constraint.type.startsWith("line_")
      ? insetSvgSegment(segment.start, segment.end, 18)
      : { start: segment.start, end: segment.end };
    const hitAttributes = {
      x1: translateSegment.start.x,
      y1: translateSegment.start.y,
      x2: translateSegment.end.x,
      y2: translateSegment.end.y,
      stroke: "transparent",
      "stroke-width": 22,
      "data-drag-kind": "constraint-translate",
      "data-constraint-id": id,
      "data-cursor": "grab",
      style: "cursor:grab",
    };

    lineLayer.appendChild(
      svgElement("line", {
        ...hitAttributes,
      })
    );

    lineLayer.appendChild(
      svgElement("line", {
        x1: segment.start.x,
        y1: segment.start.y,
        x2: segment.end.x,
        y2: segment.end.y,
        stroke: color,
        "stroke-width": 3,
        "stroke-linecap": "round",
        "pointer-events": "none",
      })
    );

    midpointLayer.appendChild(
      svgElement("circle", {
        cx: midpoint.x,
        cy: midpoint.y,
        r: 6.5,
        fill: color,
        stroke: "rgba(255,255,255,0.95)",
        "stroke-width": 3,
        "data-drag-kind": "constraint-translate",
        "data-constraint-id": id,
        "data-cursor": "grab",
        style: "cursor:grab",
      })
    );

    if (constraint.type.startsWith("line_")) {
      ["start", "end"].forEach((handleKey) => {
        const point = handleKey === "start" ? segment.start : segment.end;
        slopeLayer.appendChild(
          svgElement("circle", {
            cx: point.x,
            cy: point.y,
            r: 6,
            fill: "#fffdf8",
            stroke: color,
            "stroke-width": 3,
            "data-drag-kind": "constraint-slope",
            "data-constraint-id": id,
            "data-handle": handleKey,
            "data-cursor": "crosshair",
            style: "cursor:crosshair",
          })
        );
      });
    }

    labelLayer.appendChild(
      svgElement("text", {
        x: midpoint.x + 10,
        y: midpoint.y - 10,
        fill: color,
        "font-size": 14,
        "font-weight": 700,
        "pointer-events": "none",
      }, getConstraintDisplayName(constraint, index))
    );
  });

  group.appendChild(lineLayer);
  group.appendChild(midpointLayer);
  group.appendChild(slopeLayer);
  group.appendChild(labelLayer);
}

function drawAxes(group, view) {
  const zeroX = clamp(PLOT_BOX.x, worldToSvg(0, view.yMin, view).x, PLOT_BOX.x + PLOT_BOX.width);
  const zeroY = clamp(PLOT_BOX.y, worldToSvg(view.xMin, 0, view).y, PLOT_BOX.y + PLOT_BOX.height);

  group.appendChild(
    svgElement("line", {
      x1: zeroX,
      y1: PLOT_BOX.y,
      x2: zeroX,
      y2: PLOT_BOX.y + PLOT_BOX.height,
      stroke: "rgba(22,33,51,0.56)",
      "stroke-width": 2,
    })
  );

  group.appendChild(
    svgElement("line", {
      x1: PLOT_BOX.x,
      y1: zeroY,
      x2: PLOT_BOX.x + PLOT_BOX.width,
      y2: zeroY,
      stroke: "rgba(22,33,51,0.56)",
      "stroke-width": 2,
    })
  );
}

function drawObjectiveLine(group, analysis) {
  if (!analysis.currentLineSegment) {
    return;
  }

  const lineLayer = svgGroup();
  const handleLayer = svgGroup();
  const labelLayer = svgGroup();
  const translateSegment = insetSvgSegment(analysis.currentLineSegment.start, analysis.currentLineSegment.end, 18);

  const hitLine = svgElement("line", {
    x1: translateSegment.start.x,
    y1: translateSegment.start.y,
    x2: translateSegment.end.x,
    y2: translateSegment.end.y,
    stroke: "transparent",
    "stroke-width": 24,
    "data-drag-kind": "objective",
    "data-cursor": "grab",
    style: "cursor:grab",
  });

  const visibleLine = svgElement("line", {
    x1: analysis.currentLineSegment.start.x,
    y1: analysis.currentLineSegment.start.y,
    x2: analysis.currentLineSegment.end.x,
    y2: analysis.currentLineSegment.end.y,
    stroke: "#F5A623",
    "stroke-width": 4,
    "stroke-dasharray": "14 10",
    "stroke-linecap": "round",
    "pointer-events": "none",
  });

  const handle = svgElement("circle", {
    cx: analysis.currentLineSegment.midpoint.x,
    cy: analysis.currentLineSegment.midpoint.y,
    r: 8,
    fill: "#F5A623",
    stroke: "#FFF9E9",
    "stroke-width": 3,
    "data-drag-kind": "objective",
    "data-cursor": "grab",
    style: "cursor:grab",
  });

  ["start", "end"].forEach((handleKey) => {
    const point = handleKey === "start"
      ? analysis.currentLineSegment.start
      : analysis.currentLineSegment.end;
    handleLayer.appendChild(
      svgElement("circle", {
        cx: point.x,
        cy: point.y,
        r: 6.5,
        fill: "#fff8e7",
        stroke: "#F5A623",
        "stroke-width": 3,
        "data-drag-kind": "objective-slope",
        "data-handle": handleKey,
        "data-cursor": "crosshair",
        style: "cursor:crosshair",
      })
    );
  });

  const label = svgElement(
    "text",
    {
      x: handle.getAttribute("cx"),
      y: Number(handle.getAttribute("cy")) - 16,
      fill: "#8F5F00",
      "font-size": 15,
      "font-weight": 700,
      "text-anchor": "middle",
      "pointer-events": "none",
    },
    `z = ${formatNumber(analysis.currentLevel)}`
  );

  lineLayer.appendChild(hitLine);
  lineLayer.appendChild(visibleLine);
  handleLayer.appendChild(handle);
  labelLayer.appendChild(label);

  group.appendChild(lineLayer);
  group.appendChild(handleLayer);
  group.appendChild(labelLayer);
}

function drawOptimizationOverlay(group, analysis) {
  if (!analysis.visiblePolygon.length) {
    return;
  }

  if (analysis.currentContacts.length) {
    analysis.currentContacts.forEach((point) => {
      const svgPoint = worldToSvg(point.x, point.y, analysis.view);
      group.appendChild(
        svgElement("circle", {
          cx: svgPoint.x,
          cy: svgPoint.y,
          r: 6,
          fill: "#F5A623",
          stroke: "#FFF9E9",
          "stroke-width": 2,
          "pointer-events": "none",
        })
      );
    });
  }

  if (analysis.optimization.status !== "bounded" || !analysis.optimization.visibleContacts.length) {
    return;
  }

  if (analysis.optimization.visibleContacts.length > 1) {
    const [first, second] = analysis.optimization.visibleContacts;
    const a = worldToSvg(first.x, first.y, analysis.view);
    const b = worldToSvg(second.x, second.y, analysis.view);
    group.appendChild(
      svgElement("line", {
        x1: a.x,
        y1: a.y,
        x2: b.x,
        y2: b.y,
        stroke: "#0E5C51",
        "stroke-width": 6,
        "stroke-linecap": "round",
        "pointer-events": "none",
      })
    );
  }

  analysis.optimization.visibleContacts.forEach((point) => {
    const svgPoint = worldToSvg(point.x, point.y, analysis.view);
    group.appendChild(
      svgElement("circle", {
        cx: svgPoint.x,
        cy: svgPoint.y,
        r: 7,
        fill: "#0E5C51",
        stroke: "#E7FFF8",
        "stroke-width": 2,
        "pointer-events": "none",
      })
    );
  });
}

function drawAxisLabels(group, view) {
  const xTicks = niceTicks(view.xMin, view.xMax, 8);
  const yTicks = niceTicks(view.yMin, view.yMax, 8);

  xTicks.forEach((tick) => {
    const point = worldToSvg(tick, view.yMin, view);
    group.appendChild(
      svgElement("text", {
        x: point.x,
        y: PLOT_BOX.y + PLOT_BOX.height + 28,
        fill: "rgba(22,33,51,0.72)",
        "font-size": 13,
        "text-anchor": "middle",
      }, formatNumber(tick))
    );
  });

  yTicks.forEach((tick) => {
    const point = worldToSvg(view.xMin, tick, view);
    group.appendChild(
      svgElement("text", {
        x: PLOT_BOX.x - 16,
        y: point.y + 4,
        fill: "rgba(22,33,51,0.72)",
        "font-size": 13,
        "text-anchor": "end",
      }, formatNumber(tick))
    );
  });

  group.appendChild(
    svgElement("text", {
      x: PLOT_BOX.x + PLOT_BOX.width + 18,
      y: worldToSvg(view.xMax, 0, view).y + 4,
      fill: "rgba(22,33,51,0.82)",
      "font-size": 16,
      "font-weight": 700,
    }, "x")
  );

  group.appendChild(
    svgElement("text", {
      x: worldToSvg(0, view.yMax, view).x - 4,
      y: PLOT_BOX.y - 8,
      fill: "rgba(22,33,51,0.82)",
      "font-size": 16,
      "font-weight": 700,
    }, "y")
  );
}

function getViewWindow() {
  let xMin = toNumber(state.view.xMin, 0);
  let xMax = toNumber(state.view.xMax, 10);
  let yMin = toNumber(state.view.yMin, 0);
  let yMax = toNumber(state.view.yMax, 10);

  if (xMin === xMax) {
    xMax = xMin + 1;
  }
  if (yMin === yMax) {
    yMax = yMin + 1;
  }
  if (xMin > xMax) {
    [xMin, xMax] = [xMax, xMin];
  }
  if (yMin > yMax) {
    [yMin, yMax] = [yMax, yMin];
  }

  return { xMin, xMax, yMin, yMax };
}

function setViewWindow(view) {
  state.view.xMin = formatNumber(view.xMin);
  state.view.xMax = formatNumber(view.xMax);
  state.view.yMin = formatNumber(view.yMin);
  state.view.yMax = formatNumber(view.yMax);
}

function getObjectiveCoefficients() {
  return {
    x: toNumber(state.objective.xCoeff, 0),
    y: toNumber(state.objective.yCoeff, 0),
  };
}

function getObjectiveMagnitude() {
  const objective = getObjectiveCoefficients();
  return Math.hypot(objective.x, objective.y);
}

function autoFitViewToConstraints(constraints) {
  const nextView = computeConstraintFitBounds(constraints);
  if (!nextView) {
    return;
  }

  setViewWindow(nextView);
}

function getResetView() {
  const baseView = computeConstraintFitBounds(state.constraints) ?? getExampleViewWindow();
  if (!state.constraints.length) {
    return baseView;
  }

  const halfPlanes = state.constraints
    .map(convertConstraintToHalfPlane)
    .filter(Boolean);
  if (!halfPlanes.length) {
    return baseView;
  }

  const objective = getObjectiveCoefficients();
  if (Math.hypot(objective.x, objective.y) <= EPSILON) {
    return baseView;
  }

  const visiblePolygon = clipPolygon(makeRectangle(baseView.xMin, baseView.xMax, baseView.yMin, baseView.yMax), halfPlanes);
  const worldRadius = computeWorldRadius(baseView, halfPlanes);
  const worldPolygon = clipPolygon(makeRectangle(-worldRadius, worldRadius, -worldRadius, worldRadius), halfPlanes);
  const optimization = analyzeOptimization({
    halfPlanes,
    worldPolygon,
    visiblePolygon,
    view: baseView,
    objective,
  });

  if (optimization.status !== "bounded" || !optimization.bestContacts.length) {
    return baseView;
  }

  const currentLevel = toNumber(state.objective.level, 0);
  const pointsToInclude = [...optimization.bestContacts];

  if (Math.abs(currentLevel - optimization.bestValue) > 5e-4) {
    optimization.bestContacts.forEach((point) => {
      const projectedPoint = projectPointToObjectiveLevel(point, objective, currentLevel);
      if (projectedPoint) {
        pointsToInclude.push(projectedPoint);
      }
    });
  }

  return expandViewBoundsToIncludePoints(baseView, pointsToInclude);
}

function computeConstraintFitBounds(constraints) {
  const lines = constraints
    .map(convertConstraintToHalfPlane)
    .filter(Boolean)
    .map((halfPlane) => halfPlane.line);
  const points = [{ x: 0, y: 0 }];

  lines.forEach((line) => {
    if (Math.abs(line.a) > EPSILON) {
      points.push({ x: line.c / line.a, y: 0 });
    }
    if (Math.abs(line.b) > EPSILON) {
      points.push({ x: 0, y: line.c / line.b });
    }
  });

  for (let index = 0; index < lines.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < lines.length; otherIndex += 1) {
      const intersection = lineLineIntersection(lines[index], lines[otherIndex]);
      if (intersection) {
        points.push(intersection);
      }
    }
  }

  const finitePoints = points.filter((point) =>
    Number.isFinite(point.x) &&
    Number.isFinite(point.y) &&
    Math.abs(point.x) <= 1e6 &&
    Math.abs(point.y) <= 1e6
  );
  if (!finitePoints.length) {
    return null;
  }

  let minX = Math.min(...finitePoints.map((point) => point.x));
  let maxX = Math.max(...finitePoints.map((point) => point.x));
  let minY = Math.min(...finitePoints.map((point) => point.y));
  let maxY = Math.max(...finitePoints.map((point) => point.y));

  return padViewBounds({ xMin: minX, xMax: maxX, yMin: minY, yMax: maxY }, 0.18, 1);
}

function expandViewBoundsToIncludePoints(view, points) {
  const finitePoints = points.filter((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y));
  if (!finitePoints.length) {
    return view;
  }

  const nextBounds = {
    xMin: view.xMin,
    xMax: view.xMax,
    yMin: view.yMin,
    yMax: view.yMax,
  };

  finitePoints.forEach((point) => {
    nextBounds.xMin = Math.min(nextBounds.xMin, point.x);
    nextBounds.xMax = Math.max(nextBounds.xMax, point.x);
    nextBounds.yMin = Math.min(nextBounds.yMin, point.y);
    nextBounds.yMax = Math.max(nextBounds.yMax, point.y);
  });

  return padViewBounds(nextBounds, 0.08, 0.6);
}

function padViewBounds(bounds, paddingRatio = 0.18, minimumPadding = 1) {
  let { xMin, xMax, yMin, yMax } = bounds;
  const spanX = Math.max(xMax - xMin, 6);
  const spanY = Math.max(yMax - yMin, 6);
  const paddingX = Math.max(spanX * paddingRatio, minimumPadding);
  const paddingY = Math.max(spanY * paddingRatio, minimumPadding);

  xMin -= paddingX;
  xMax += paddingX;
  yMin -= paddingY;
  yMax += paddingY;

  if (xMin >= -EPSILON) {
    xMin = Math.min(0, xMin);
  }
  if (yMin >= -EPSILON) {
    yMin = Math.min(0, yMin);
  }

  return { xMin, xMax, yMin, yMax };
}

function projectPointToObjectiveLevel(point, objective, targetLevel) {
  const denominator = objective.x * objective.x + objective.y * objective.y;
  if (denominator <= EPSILON) {
    return null;
  }

  const currentLevel = evaluateObjective(point, objective);
  const step = (targetLevel - currentLevel) / denominator;
  return {
    x: point.x + objective.x * step,
    y: point.y + objective.y * step,
  };
}

function getExampleViewWindow() {
  return {
    xMin: toNumber(EXAMPLE_PROBLEM.view.xMin, 0),
    xMax: toNumber(EXAMPLE_PROBLEM.view.xMax, 10),
    yMin: toNumber(EXAMPLE_PROBLEM.view.yMin, 0),
    yMax: toNumber(EXAMPLE_PROBLEM.view.yMax, 10),
  };
}

function convertConstraintToHalfPlane(constraint) {
  const p1 = toNumber(constraint.param1, 0);
  const p2 = toNumber(constraint.param2, 0);

  switch (constraint.type) {
    case "line_leq":
      return {
        a: -p1,
        b: 1,
        c: p2,
        line: { a: -p1, b: 1, c: p2 },
      };
    case "line_geq":
      return {
        a: p1,
        b: -1,
        c: -p2,
        line: { a: p1, b: -1, c: -p2 },
      };
    case "x_leq":
      return {
        a: 1,
        b: 0,
        c: p1,
        line: { a: 1, b: 0, c: p1 },
      };
    case "x_geq":
      return {
        a: -1,
        b: 0,
        c: -p1,
        line: { a: -1, b: 0, c: -p1 },
      };
    case "y_leq":
      return {
        a: 0,
        b: 1,
        c: p1,
        line: { a: 0, b: 1, c: p1 },
      };
    case "y_geq":
      return {
        a: 0,
        b: -1,
        c: -p1,
        line: { a: 0, b: -1, c: -p1 },
      };
    default:
      return null;
  }
}

function clipPolygon(polygon, halfPlanes) {
  let output = polygon.slice();

  halfPlanes.forEach((halfPlane) => {
    if (!output.length) {
      return;
    }

    const input = output.slice();
    output = [];

    for (let index = 0; index < input.length; index += 1) {
      const current = input[index];
      const next = input[(index + 1) % input.length];
      const currentInside = satisfiesHalfPlane(current, halfPlane);
      const nextInside = satisfiesHalfPlane(next, halfPlane);

      if (currentInside && nextInside) {
        output.push(next);
      } else if (currentInside && !nextInside) {
        const intersection = segmentHalfPlaneIntersection(current, next, halfPlane);
        if (intersection) {
          output.push(intersection);
        }
      } else if (!currentInside && nextInside) {
        const intersection = segmentHalfPlaneIntersection(current, next, halfPlane);
        if (intersection) {
          output.push(intersection);
        }
        output.push(next);
      }
    }

    output = dedupePoints(output);
  });

  return output;
}

function satisfiesHalfPlane(point, halfPlane) {
  return halfPlane.a * point.x + halfPlane.b * point.y - halfPlane.c <= EPSILON;
}

function segmentHalfPlaneIntersection(start, end, halfPlane) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const denominator = halfPlane.a * dx + halfPlane.b * dy;
  if (Math.abs(denominator) <= EPSILON) {
    return null;
  }
  const t = (halfPlane.c - halfPlane.a * start.x - halfPlane.b * start.y) / denominator;
  return {
    x: start.x + dx * t,
    y: start.y + dy * t,
  };
}

function lineLineIntersection(firstLine, secondLine) {
  const determinant = firstLine.a * secondLine.b - secondLine.a * firstLine.b;
  if (Math.abs(determinant) <= EPSILON) {
    return null;
  }

  return {
    x: (firstLine.c * secondLine.b - secondLine.c * firstLine.b) / determinant,
    y: (firstLine.a * secondLine.c - secondLine.a * firstLine.c) / determinant,
  };
}

function lineThroughObjectiveLevel(objective, level) {
  return {
    a: objective.x,
    b: objective.y,
    c: level,
  };
}

function lineSegmentInView(line, view) {
  const candidates = [];
  const edges = [
    [{ x: view.xMin, y: view.yMin }, { x: view.xMax, y: view.yMin }],
    [{ x: view.xMax, y: view.yMin }, { x: view.xMax, y: view.yMax }],
    [{ x: view.xMax, y: view.yMax }, { x: view.xMin, y: view.yMax }],
    [{ x: view.xMin, y: view.yMax }, { x: view.xMin, y: view.yMin }],
  ];

  edges.forEach(([start, end]) => {
    const intersection = segmentLineIntersection(start, end, line);
    if (intersection) {
      candidates.push(intersection);
    }
  });

  const unique = dedupePoints(candidates);
  if (unique.length < 2) {
    return null;
  }

  const [worldStart, worldEnd] = unique
    .slice(0, 2)
    .sort((first, second) => (Math.abs(first.x - second.x) > 1e-5 ? first.x - second.x : first.y - second.y));
  const start = worldToSvg(worldStart.x, worldStart.y, view);
  const end = worldToSvg(worldEnd.x, worldEnd.y, view);
  const worldMidpoint = midpointWorld(worldStart, worldEnd);

  return {
    worldStart,
    worldEnd,
    worldMidpoint,
    start,
    end,
    midpoint: worldToSvg(worldMidpoint.x, worldMidpoint.y, view),
  };
}

function segmentLineIntersection(start, end, line) {
  const valueStart = line.a * start.x + line.b * start.y - line.c;
  const valueEnd = line.a * end.x + line.b * end.y - line.c;

  if (Math.abs(valueStart) <= EPSILON && Math.abs(valueEnd) <= EPSILON) {
    return start;
  }

  if ((valueStart < -EPSILON && valueEnd < -EPSILON) || (valueStart > EPSILON && valueEnd > EPSILON)) {
    return null;
  }

  const denominator = valueStart - valueEnd;
  if (Math.abs(denominator) <= EPSILON) {
    return null;
  }

  const t = valueStart / denominator;
  return {
    x: start.x + (end.x - start.x) * t,
    y: start.y + (end.y - start.y) * t,
  };
}

function linePolygonContacts(line, polygon) {
  if (!polygon.length) {
    return [];
  }

  const contacts = [];
  polygon.forEach((point) => {
    if (Math.abs(line.a * point.x + line.b * point.y - line.c) <= 1e-5) {
      contacts.push(point);
    }
  });

  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index];
    const end = polygon[(index + 1) % polygon.length];
    const intersection = segmentLineIntersection(start, end, line);
    if (intersection) {
      contacts.push(intersection);
    }
  }

  return dedupePoints(contacts).slice(0, 2);
}

function evaluateObjective(point, objective) {
  return objective.x * point.x + objective.y * point.y;
}

function isObjectiveUnbounded(halfPlanes, direction) {
  if (Math.hypot(direction.x, direction.y) <= EPSILON) {
    return false;
  }

  const candidates = [
    normalizeDirection(direction),
    normalizeDirection({ x: -direction.x, y: -direction.y }),
  ];

  halfPlanes.forEach((halfPlane) => {
    candidates.push(normalizeDirection({ x: -halfPlane.b, y: halfPlane.a }));
    candidates.push(normalizeDirection({ x: halfPlane.b, y: -halfPlane.a }));
  });

  return candidates.some((candidate) => {
    if (!candidate) {
      return false;
    }
    const feasible = halfPlanes.every((halfPlane) => halfPlane.a * candidate.x + halfPlane.b * candidate.y <= EPSILON);
    return feasible && direction.x * candidate.x + direction.y * candidate.y > EPSILON;
  });
}

function isRegionBounded(halfPlanes) {
  const candidates = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
  ];

  halfPlanes.forEach((halfPlane) => {
    candidates.push(normalizeDirection({ x: -halfPlane.b, y: halfPlane.a }));
    candidates.push(normalizeDirection({ x: halfPlane.b, y: -halfPlane.a }));
  });

  return !candidates.some((candidate) => {
    if (!candidate) {
      return false;
    }
    return halfPlanes.every((halfPlane) => halfPlane.a * candidate.x + halfPlane.b * candidate.y <= EPSILON);
  });
}

function computeWorldRadius(view, halfPlanes) {
  const viewScale = Math.max(
    Math.abs(view.xMin),
    Math.abs(view.xMax),
    Math.abs(view.yMin),
    Math.abs(view.yMax),
    view.xMax - view.xMin,
    view.yMax - view.yMin,
    10
  );

  const constraintScale = halfPlanes.reduce((maxValue, halfPlane) => {
    return Math.max(maxValue, Math.abs(halfPlane.c), Math.abs(halfPlane.a), Math.abs(halfPlane.b));
  }, 10);

  return Math.max(30, viewScale * 6, constraintScale * 14);
}

function makeRectangle(xMin, xMax, yMin, yMax) {
  return [
    { x: xMin, y: yMin },
    { x: xMax, y: yMin },
    { x: xMax, y: yMax },
    { x: xMin, y: yMax },
  ];
}

function worldToSvg(x, y, view) {
  const svgX = PLOT_BOX.x + ((x - view.xMin) / (view.xMax - view.xMin)) * PLOT_BOX.width;
  const svgY = PLOT_BOX.y + PLOT_BOX.height - ((y - view.yMin) / (view.yMax - view.yMin)) * PLOT_BOX.height;
  return { x: svgX, y: svgY };
}

function svgToWorld(svgX, svgY, view) {
  const x = view.xMin + ((svgX - PLOT_BOX.x) / PLOT_BOX.width) * (view.xMax - view.xMin);
  const y = view.yMin + ((PLOT_BOX.y + PLOT_BOX.height - svgY) / PLOT_BOX.height) * (view.yMax - view.yMin);
  return { x, y };
}

function clientToSvgPoint(event) {
  const rect = dom.plot.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * 720,
    y: ((event.clientY - rect.top) / rect.height) * 720,
  };
}

function niceTicks(min, max, targetTickCount) {
  const span = max - min;
  if (span <= EPSILON) {
    return [min];
  }

  const step = niceStep(span / targetTickCount);
  const start = Math.ceil(min / step) * step;
  const ticks = [];

  for (let value = start; value <= max + EPSILON; value += step) {
    ticks.push(roundTo(value, 8));
  }

  return ticks;
}

function niceStep(rawStep) {
  const power = 10 ** Math.floor(Math.log10(rawStep));
  const scaled = rawStep / power;
  if (scaled <= 1) {
    return power;
  }
  if (scaled <= 2) {
    return 2 * power;
  }
  if (scaled <= 5) {
    return 5 * power;
  }
  return 10 * power;
}

function describeConstraint(constraint) {
  const p1 = toNumber(constraint.param1, 0);
  const p2 = toNumber(constraint.param2, 0);

  switch (constraint.type) {
    case "line_leq":
      return `y <= ${formatSlopeIntercept(p1, p2)}`;
    case "line_geq":
      return `y >= ${formatSlopeIntercept(p1, p2)}`;
    case "x_leq":
      return `x <= ${formatAnswerNumber(p1)}`;
    case "x_geq":
      return `x >= ${formatAnswerNumber(p1)}`;
    case "y_leq":
      return `y <= ${formatAnswerNumber(p1)}`;
    case "y_geq":
      return `y >= ${formatAnswerNumber(p1)}`;
    default:
      return "";
  }
}

function formatSlopeIntercept(slope, intercept) {
  const slopePart = `${formatAnswerNumber(slope)}x`;
  if (Math.abs(intercept) <= EPSILON) {
    return slopePart;
  }
  const sign = intercept >= 0 ? "+" : "-";
  return `${slopePart} ${sign} ${formatAnswerNumber(Math.abs(intercept))}`;
}

function getConstraintFieldLabels(type) {
  if (type.startsWith("line_")) {
    return { param1: "Slope m", param2: "Intercept b", hideParam2: false };
  }
  return { param1: "Value c", param2: "Unused", hideParam2: true };
}

function getDefaultConstraintName(constraintId) {
  const index = state.constraints.findIndex((item) => item.id === Number(constraintId));
  return `c${index + 1}`;
}

function getConstraintDisplayName(constraint, index) {
  const fallback = `c${index + 1}`;
  return constraint.name.trim() || fallback;
}

function getConstraintColor(index) {
  return PALETTE[index % PALETTE.length];
}

function pointToSegmentDistance(point, segmentStart, segmentEnd) {
  const dx = segmentEnd.x - segmentStart.x;
  const dy = segmentEnd.y - segmentStart.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= EPSILON) {
    return Math.hypot(point.x - segmentStart.x, point.y - segmentStart.y);
  }

  const t = clamp(0, ((point.x - segmentStart.x) * dx + (point.y - segmentStart.y) * dy) / lengthSquared, 1);
  const projection = {
    x: segmentStart.x + t * dx,
    y: segmentStart.y + t * dy,
  };

  return Math.hypot(point.x - projection.x, point.y - projection.y);
}

function insetSvgSegment(start, end, inset) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length <= inset * 2 + EPSILON) {
    return { start, end };
  }

  const ux = dx / length;
  const uy = dy / length;
  return {
    start: {
      x: start.x + ux * inset,
      y: start.y + uy * inset,
    },
    end: {
      x: end.x - ux * inset,
      y: end.y - uy * inset,
    },
  };
}

function dedupePoints(points) {
  const unique = [];
  points.forEach((point) => {
    const alreadyExists = unique.some(
      (candidate) => Math.abs(candidate.x - point.x) <= 1e-5 && Math.abs(candidate.y - point.y) <= 1e-5
    );
    if (!alreadyExists) {
      unique.push(point);
    }
  });
  return unique;
}

function normalizeDirection(direction) {
  const magnitude = Math.hypot(direction.x, direction.y);
  if (magnitude <= EPSILON) {
    return null;
  }
  return { x: direction.x / magnitude, y: direction.y / magnitude };
}

function toNumber(value, fallback = 0) {
  const parsed = typeof value === "number" ? value : parseFlexibleNumber(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatNumber(value) {
  if (!Number.isFinite(value)) {
    return "0";
  }
  const rounded = Math.abs(value) < 1e-9 ? 0 : roundTo(value, 4);
  return Number(rounded).toString();
}

function formatEditableNumber(value) {
  const numericValue = toNumber(value, Number.NaN);
  if (!Number.isFinite(numericValue)) {
    return "0";
  }

  const fractionText = formatFractionOnly(numericValue);
  return fractionText && fractionText !== "0"
    ? fractionText
    : formatNumber(numericValue);
}

function formatAnswerNumber(value) {
  const numericValue = toNumber(value, Number.NaN);
  if (!Number.isFinite(numericValue)) {
    return "0";
  }

  const decimalText = formatNumber(numericValue);
  const fractionText = formatFractionOnly(numericValue);
  if (!fractionText || fractionText === decimalText) {
    return decimalText;
  }

  return `${fractionText} (${decimalText})`;
}

function formatInputValue(value) {
  if (typeof value === "string") {
    return value;
  }
  return formatEditableNumber(value);
}

function formatFractionOnly(value, maxDenominator = 64, tolerance = 1e-8) {
  const fraction = approximateFraction(value, maxDenominator, tolerance);
  if (!fraction) {
    return null;
  }
  if (fraction.denominator === 1) {
    return String(fraction.numerator);
  }
  return `${fraction.numerator}/${fraction.denominator}`;
}

function approximateFraction(value, maxDenominator = 64, tolerance = 1e-8) {
  const numericValue = toNumber(value, Number.NaN);
  if (!Number.isFinite(numericValue)) {
    return null;
  }
  if (Math.abs(numericValue) <= EPSILON) {
    return { numerator: 0, denominator: 1 };
  }

  const sign = numericValue < 0 ? -1 : 1;
  const absoluteValue = Math.abs(numericValue);
  let bestNumerator = 0;
  let bestDenominator = 1;
  let bestError = Number.POSITIVE_INFINITY;

  for (let denominator = 1; denominator <= maxDenominator; denominator += 1) {
    const numerator = Math.round(absoluteValue * denominator);
    const error = Math.abs(absoluteValue - numerator / denominator);
    if (error < bestError - 1e-12 || (Math.abs(error - bestError) <= 1e-12 && denominator < bestDenominator)) {
      bestNumerator = numerator;
      bestDenominator = denominator;
      bestError = error;
    }
  }

  if (bestError > tolerance) {
    return null;
  }

  const divisor = greatestCommonDivisor(bestNumerator, bestDenominator);
  return {
    numerator: sign * (bestNumerator / divisor),
    denominator: bestDenominator / divisor,
  };
}

function greatestCommonDivisor(a, b) {
  let x = Math.abs(Math.trunc(a));
  let y = Math.abs(Math.trunc(b));
  while (y) {
    const remainder = x % y;
    x = y;
    y = remainder;
  }
  return x || 1;
}

function roundTo(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(min, value, max) {
  return Math.min(Math.max(value, min), max);
}

function svgGroup() {
  return svgElement("g", {});
}

function svgElement(tagName, attributes, textContent = "") {
  const node = document.createElementNS(SVG_NS, tagName);
  Object.entries(attributes).forEach(([key, value]) => {
    node.setAttribute(key, String(value));
  });
  if (textContent) {
    node.textContent = textContent;
  }
  return node;
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hexToRgba(hex, alpha) {
  const normalized = hex.replace("#", "");
  const isShort = normalized.length === 3;
  const expanded = isShort
    ? normalized.split("").map((part) => `${part}${part}`).join("")
    : normalized;

  const red = Number.parseInt(expanded.slice(0, 2), 16);
  const green = Number.parseInt(expanded.slice(2, 4), 16);
  const blue = Number.parseInt(expanded.slice(4, 6), 16);

  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}
