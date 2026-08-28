import analyzeLP3D from "./solver.js";
import { LP3DRenderer } from "./renderer.js";

const CONSTRAINT_COLORS = ["#2F6DF6", "#E05F35", "#1B9C85", "#A13CF5", "#C38A06", "#D94173"];
const VALID_RELATIONS = new Set(["<=", ">=", "="]);
const NUMBER_FORMATTER = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 4,
  useGrouping: false,
});

const DEBUG_FIXTURES = deepFreeze({
  unique: {
    objective: { mode: "max", coefficients: [1, 2, 3], level: 9 },
    constraints: simplexConstraints(6),
  },
  edge: {
    objective: { mode: "max", coefficients: [1, 1, 0], level: 3 },
    constraints: simplexConstraints(6),
  },
  face: {
    objective: { mode: "max", coefficients: [1, 1, 1], level: 3 },
    constraints: simplexConstraints(6),
  },
  infeasible: {
    objective: { mode: "max", coefficients: [1, 1, 1], level: 2.5 },
    constraints: [
      ...nonnegativeConstraints(),
      constraint("sum-upper", "Sum at most 2", 1, 1, 1, "<=", 2, 3),
      constraint("sum-lower", "Sum at least 3", 1, 1, 1, ">=", 3, 4),
    ],
  },
  unbounded: {
    objective: { mode: "max", coefficients: [1, 1, 1], level: 3 },
    constraints: nonnegativeConstraints(),
  },
});

const DEFAULT_MODEL = DEBUG_FIXTURES.unique;

const dom = {
  constraintsBody: requireElement("constraints-body"),
  constraintTemplate: requireElement("constraint-template"),
  addConstraint: requireElement("add-constraint"),
  restoreExample: requireElement("restore-example"),
  objectiveMode: requireElement("objective-mode"),
  objectiveX: requireElement("objective-x"),
  objectiveY: requireElement("objective-y"),
  objectiveZ: requireElement("objective-z"),
  objectiveLevel: requireElement("objective-level"),
  snapOptimum: requireElement("snap-optimum"),
  feasibilityBadge: requireElement("feasibility-badge"),
  feasibilityText: requireElement("feasibility-text"),
  regionBadge: requireElement("region-badge"),
  regionText: requireElement("region-text"),
  objectiveBadge: requireElement("objective-badge"),
  objectiveText: requireElement("objective-text"),
  optimumBadge: requireElement("optimum-badge"),
  optimumText: requireElement("optimum-text"),
  viewport: requireElement("viewport"),
  viewportStatus: requireElement("viewport-status"),
  resetCamera: requireElement("reset-camera"),
  viewFront: requireElement("view-front"),
  viewTop: requireElement("view-top"),
  zoomIn: requireElement("zoom-in"),
  zoomOut: requireElement("zoom-out"),
  cameraToolbar: document.querySelector(".camera-toolbar"),
};

const state = {
  model: cloneModel(DEFAULT_MODEL),
  analysis: null,
  valid: false,
  error: null,
  rendererError: null,
  lastAction: "initialize",
};

let renderer = null;
let scheduledUpdate = null;
let nextConstraintSequence = 1;

initialize();

function initialize() {
  initializeRenderer();
  bindModelControls();
  bindCameraControls();
  installDebugSurface();
  loadModel(DEFAULT_MODEL, { resetCamera: true, action: "restore-example" });
}

function initializeRenderer() {
  try {
    renderer = new LP3DRenderer(dom.viewport, dom.viewportStatus);
    const canvas = dom.viewport.querySelector("canvas");
    if (canvas) {
      // The labelled viewport is the single keyboard stop; pointer controls
      // continue to operate on the canvas without adding a duplicate tab stop.
      canvas.tabIndex = -1;
    }
  } catch (error) {
    state.rendererError = friendlyError(error);
    dom.viewport.replaceChildren();
    const fallback = document.createElement("p");
    fallback.textContent = "The 3D view could not start in this browser. The model analysis remains available.";
    dom.viewport.appendChild(fallback);
    dom.viewportStatus.textContent = state.rendererError;
    cameraButtons().forEach((button) => {
      button.disabled = true;
    });
  }
}

function bindModelControls() {
  dom.restoreExample.addEventListener("click", () => {
    loadModel(DEFAULT_MODEL, { resetCamera: true, action: "restore-example" });
  });

  dom.addConstraint.addEventListener("click", () => {
    const rowNumber = dom.constraintsBody.querySelectorAll("[data-constraint-row]").length + 1;
    const row = createConstraintRow({
      id: createConstraintId(),
      name: `Constraint ${rowNumber}`,
      enabled: true,
      a: 1,
      b: 0,
      c: 0,
      relation: "<=",
      rhs: 6,
      color: CONSTRAINT_COLORS[(rowNumber - 1) % CONSTRAINT_COLORS.length],
    }, rowNumber - 1);
    dom.constraintsBody.appendChild(row);
    refreshConstraintAccessibility();
    row.querySelector('[data-field="name"]')?.focus();
    scheduleAnalysis("add-constraint");
  });

  dom.constraintsBody.addEventListener("click", (event) => {
    const removeButton = event.target.closest('[data-action="remove"]');
    if (!removeButton) {
      return;
    }
    const row = removeButton.closest("[data-constraint-row]");
    if (!row) {
      return;
    }
    const rows = Array.from(dom.constraintsBody.querySelectorAll("[data-constraint-row]"));
    const removedIndex = rows.indexOf(row);
    row.remove();
    refreshConstraintAccessibility();
    const remainingRows = Array.from(dom.constraintsBody.querySelectorAll("[data-constraint-row]"));
    const focusRow = remainingRows[Math.min(removedIndex, remainingRows.length - 1)];
    (focusRow?.querySelector('[data-field="name"]') ?? dom.addConstraint).focus();
    scheduleAnalysis("remove-constraint");
  });

  const handleConstraintEdit = (event) => {
    const field = event.target.closest("[data-field]");
    if (!field || !dom.constraintsBody.contains(field)) {
      return;
    }
    const row = field.closest("[data-constraint-row]");
    if (row) {
      row.classList.toggle("is-disabled", !row.querySelector('[data-field="enabled"]')?.checked);
      refreshConstraintAccessibility();
    }
    scheduleAnalysis(`constraint-${field.dataset.field}`);
  };
  dom.constraintsBody.addEventListener("input", handleConstraintEdit);
  dom.constraintsBody.addEventListener("change", handleConstraintEdit);

  [dom.objectiveX, dom.objectiveY, dom.objectiveZ, dom.objectiveLevel].forEach((input) => {
    input.addEventListener("input", () => scheduleAnalysis(`objective-${input.id}`));
    input.addEventListener("change", () => scheduleAnalysis(`objective-${input.id}`));
  });
  dom.objectiveMode.addEventListener("change", () => scheduleAnalysis("objective-mode"));
  dom.snapOptimum.addEventListener("click", snapObjectiveToOptimum);
}

function bindCameraControls() {
  dom.resetCamera.addEventListener("click", () => useRenderer((view) => view.resetCamera()));
  dom.viewFront.addEventListener("click", () => useRenderer((view) => view.setViewPreset("front")));
  dom.viewTop.addEventListener("click", () => useRenderer((view) => view.setViewPreset("top")));
  dom.zoomIn.addEventListener("click", () => useRenderer((view) => view.zoom(0.82)));
  dom.zoomOut.addEventListener("click", () => useRenderer((view) => view.zoom(1.22)));

  const buttons = cameraButtons();
  buttons.forEach((button, index) => {
    button.tabIndex = index === 0 ? 0 : -1;
    button.addEventListener("focus", () => setToolbarTabStop(index));
  });

  dom.cameraToolbar?.addEventListener("keydown", (event) => {
    const currentButton = event.target.closest("button");
    const currentIndex = buttons.indexOf(currentButton);
    if (currentIndex < 0) {
      return;
    }
    if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
      event.preventDefault();
      currentButton.click();
      return;
    }
    let nextIndex = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (currentIndex + 1) % buttons.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (currentIndex - 1 + buttons.length) % buttons.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = buttons.length - 1;
    }
    if (nextIndex === null) {
      return;
    }
    event.preventDefault();
    setToolbarTabStop(nextIndex, true);
  });
}

function setToolbarTabStop(index, focus = false) {
  const buttons = cameraButtons();
  buttons.forEach((button, buttonIndex) => {
    button.tabIndex = buttonIndex === index ? 0 : -1;
  });
  if (focus) {
    buttons[index]?.focus();
  }
}

function cameraButtons() {
  return [dom.resetCamera, dom.viewFront, dom.viewTop, dom.zoomOut, dom.zoomIn];
}

function useRenderer(action) {
  if (!renderer) {
    dom.viewportStatus.textContent = state.rendererError ?? "The 3D view is unavailable.";
    return;
  }
  action(renderer);
}

function loadModel(model, { resetCamera = false, action = "load-model" } = {}) {
  cancelScheduledAnalysis();
  state.lastAction = action;
  state.model = cloneModel(model);
  renderModelControls(state.model);
  const analysis = updateAnalysis({ resetCamera });
  if (action === "restore-example" && renderer) {
    renderer.setStatus("Default simplex example restored. 3D view ready.");
  }
  return analysis;
}

function renderModelControls(model) {
  dom.objectiveMode.value = model.objective.mode === "min" ? "min" : "max";
  setInputValue(dom.objectiveX, model.objective.coefficients[0]);
  setInputValue(dom.objectiveY, model.objective.coefficients[1]);
  setInputValue(dom.objectiveZ, model.objective.coefficients[2]);
  setInputValue(dom.objectiveLevel, model.objective.level);

  const fragment = document.createDocumentFragment();
  model.constraints.forEach((entry, index) => fragment.appendChild(createConstraintRow(entry, index)));
  dom.constraintsBody.replaceChildren(fragment);
  refreshConstraintAccessibility();
}

function createConstraintRow(entry, index) {
  const row = dom.constraintTemplate.content.firstElementChild.cloneNode(true);
  const coefficients = Array.isArray(entry.coefficients)
    ? entry.coefficients
    : [entry.a, entry.b, entry.c];
  const color = entry.color ?? CONSTRAINT_COLORS[index % CONSTRAINT_COLORS.length];
  row.dataset.constraintId = String(entry.id ?? createConstraintId());
  row.dataset.color = color;
  row.style.setProperty("--constraint-color", color);
  row.querySelector('[data-field="enabled"]').checked = entry.enabled !== false;
  setInputValue(row.querySelector('[data-field="name"]'), entry.name ?? `Constraint ${index + 1}`);
  setInputValue(row.querySelector('[data-field="a"]'), coefficients[0] ?? 0);
  setInputValue(row.querySelector('[data-field="b"]'), coefficients[1] ?? 0);
  setInputValue(row.querySelector('[data-field="c"]'), coefficients[2] ?? 0);
  row.querySelector('[data-field="relation"]').value = normalizeRelation(entry.relation);
  setInputValue(row.querySelector('[data-field="rhs"]'), entry.rhs ?? 0);
  row.classList.toggle("is-disabled", entry.enabled === false);
  return row;
}

function refreshConstraintAccessibility() {
  const rows = Array.from(dom.constraintsBody.querySelectorAll("[data-constraint-row]"));
  rows.forEach((row, index) => {
    const nameInput = row.querySelector('[data-field="name"]');
    const displayName = nameInput.value.trim() || `Constraint ${index + 1}`;
    row.setAttribute("aria-label", `${displayName}, constraint ${index + 1}`);
    row.querySelector('[data-field="enabled"]').setAttribute("aria-label", `Enable ${displayName}`);
    nameInput.setAttribute("aria-label", `Constraint ${index + 1} name`);
    row.querySelector('[data-field="a"]').setAttribute("aria-label", `${displayName} x coefficient`);
    row.querySelector('[data-field="b"]').setAttribute("aria-label", `${displayName} y coefficient`);
    row.querySelector('[data-field="c"]').setAttribute("aria-label", `${displayName} z coefficient`);
    row.querySelector('[data-field="relation"]').setAttribute("aria-label", `${displayName} relation`);
    row.querySelector('[data-field="rhs"]').setAttribute("aria-label", `${displayName} right side`);
    row.querySelector('[data-action="remove"]').setAttribute("aria-label", `Remove ${displayName}`);
  });
}

function scheduleAnalysis(action) {
  state.lastAction = action;
  cancelScheduledAnalysis();
  scheduledUpdate = window.requestAnimationFrame(() => {
    scheduledUpdate = null;
    updateAnalysis();
  });
}

function cancelScheduledAnalysis() {
  if (scheduledUpdate !== null) {
    window.cancelAnimationFrame(scheduledUpdate);
    scheduledUpdate = null;
  }
}

function updateAnalysis({ resetCamera = false, focusOptimum = false } = {}) {
  const { model, errors } = readModelFromControls();
  state.model = model;

  if (errors.length) {
    state.valid = false;
    state.error = errors[0].message;
    updateInvalidStatuses(errors[0].message);
    return null;
  }

  try {
    const analysis = analyzeLP3D(model);
    state.analysis = analysis;
    state.valid = true;
    state.error = null;
    updateAnalysisStatuses(analysis);

    if (renderer) {
      try {
        renderer.render(analysis, model);
        state.rendererError = null;
        if (focusOptimum) {
          const focusPoints = analysis.optimum?.points?.length
            ? analysis.optimum.points
            : analysis.optimum?.point
              ? [analysis.optimum.point]
              : [];
          if (focusPoints.length) {
            renderer.focusPoints(focusPoints);
          }
        } else if (resetCamera) {
          renderer.resetCamera();
        }
      } catch (error) {
        state.rendererError = friendlyError(error);
        dom.viewportStatus.textContent = `The analysis is current, but the 3D view could not update: ${state.rendererError}`;
        console.error("Unable to update the 3D view.", error);
      }
    }
    return analysis;
  } catch (error) {
    state.valid = false;
    state.error = friendlyError(error);
    updateInvalidStatuses(`The model could not be analyzed: ${state.error}`);
    console.error("Unable to analyze the 3D linear program.", error);
    return null;
  }
}

function readModelFromControls() {
  const errors = [];
  clearInputValidation();

  const objective = {
    mode: dom.objectiveMode.value === "min" ? "min" : "max",
    coefficients: [
      readRequiredNumber(dom.objectiveX, "Objective x coefficient", errors),
      readRequiredNumber(dom.objectiveY, "Objective y coefficient", errors),
      readRequiredNumber(dom.objectiveZ, "Objective z coefficient", errors),
    ],
    level: readRequiredNumber(dom.objectiveLevel, "Objective level", errors),
  };

  const constraints = Array.from(dom.constraintsBody.querySelectorAll("[data-constraint-row]")).map((row, index) => {
    const enabled = row.querySelector('[data-field="enabled"]').checked;
    const name = row.querySelector('[data-field="name"]').value.trim() || `Constraint ${index + 1}`;
    const relationControl = row.querySelector('[data-field="relation"]');
    const relation = normalizeRelation(relationControl.value);
    if (!VALID_RELATIONS.has(relation)) {
      addInputError(relationControl, `${name} needs a supported relation.`, errors);
    }
    const readCoefficient = (field, label) => enabled
      ? readRequiredNumber(row.querySelector(`[data-field="${field}"]`), `${name} ${label}`, errors)
      : readLooseNumber(row.querySelector(`[data-field="${field}"]`));
    return {
      id: row.dataset.constraintId || `constraint-${index + 1}`,
      name,
      enabled,
      a: readCoefficient("a", "x coefficient"),
      b: readCoefficient("b", "y coefficient"),
      c: readCoefficient("c", "z coefficient"),
      relation,
      rhs: readCoefficient("rhs", "right side"),
      color: row.dataset.color || CONSTRAINT_COLORS[index % CONSTRAINT_COLORS.length],
    };
  });

  return { model: { objective, constraints }, errors };
}

function readRequiredNumber(input, label, errors) {
  const raw = input.value.trim();
  const numeric = Number(raw);
  if (!raw || !Number.isFinite(numeric)) {
    addInputError(input, `${label} needs a finite number.`, errors);
    return raw;
  }
  return normalizeNegativeZero(numeric);
}

function readLooseNumber(input) {
  const raw = input.value.trim();
  const numeric = Number(raw);
  return raw && Number.isFinite(numeric) ? normalizeNegativeZero(numeric) : raw;
}

function addInputError(input, message, errors) {
  input.setAttribute("aria-invalid", "true");
  input.setCustomValidity?.(message);
  input.title = message;
  errors.push({ input, message });
}

function clearInputValidation() {
  document.querySelectorAll('#model-panel input[aria-invalid="true"], #model-panel select[aria-invalid="true"]').forEach((input) => {
    input.removeAttribute("aria-invalid");
    input.setCustomValidity?.("");
    input.removeAttribute("title");
  });
}

function updateInvalidStatuses(message) {
  setBadge(dom.feasibilityBadge, "Input needed", "danger");
  dom.feasibilityText.textContent = message;
  setBadge(dom.regionBadge, "Paused", "neutral");
  dom.regionText.textContent = "Fix the highlighted field to recompute the feasible region.";
  setBadge(dom.objectiveBadge, "Paused", "neutral");
  dom.objectiveText.textContent = "The last valid objective plane remains in the 3D view.";
  setBadge(dom.optimumBadge, "Paused", "neutral");
  dom.optimumText.textContent = "Optimization will resume when every enabled row is valid.";
  setSnapAvailability(false, "Fix the model inputs before snapping the objective plane.");
  if (renderer) {
    renderer.setStatus("Fix the highlighted model input. The last valid 3D view remains visible.");
  }
}

function updateAnalysisStatuses(analysis) {
  const enabledCount = state.model.constraints.filter((entry) => entry.enabled !== false).length;
  if (!analysis.feasible) {
    setBadge(dom.feasibilityBadge, "Infeasible", "danger");
    dom.feasibilityText.textContent = `${enabledCount} enabled ${plural(enabledCount, "constraint has", "constraints have")} no common point.`;
    setBadge(dom.regionBadge, "Empty", "danger");
    dom.regionText.textContent = "No feasible solid exists for the current constraints.";
    setBadge(dom.objectiveBadge, "Unavailable", "neutral");
    dom.objectiveText.textContent = "The objective direction is defined, but there is no feasible region to optimize.";
    setBadge(dom.optimumBadge, "No optimum", "danger");
    dom.optimumText.textContent = "Revise or disable a conflicting constraint before snapping the plane.";
    setSnapAvailability(false, "An infeasible model has no optimum to snap to.");
    return;
  }

  setBadge(dom.feasibilityBadge, "Feasible", "success");
  dom.feasibilityText.textContent = `${enabledCount} enabled ${plural(enabledCount, "constraint shares", "constraints share")} at least one feasible point.`;

  if (analysis.regionBounded) {
    setBadge(dom.regionBadge, "Bounded solid", "success");
    dom.regionText.textContent = `${analysis.vertices.length} ${plural(analysis.vertices.length, "vertex", "vertices")}, ${analysis.edges.length} ${plural(analysis.edges.length, "edge", "edges")}, and ${analysis.faces.length} ${plural(analysis.faces.length, "face", "faces")} define the feasible region.`;
  } else {
    setBadge(dom.regionBadge, "Unbounded region", "warning");
    const objectiveNote = analysis.boundedObjectiveOnUnboundedRegion
      ? " The current objective still has a finite optimum."
      : "";
    dom.regionText.textContent = `The region extends without bound. Faint dashed surfaces mark display clipping, not true constraint faces.${objectiveNote}`;
  }

  updateObjectiveStatus(analysis);
  updateOptimumStatus(analysis);
}

function updateObjectiveStatus(analysis) {
  const objective = analysis.objective;
  const modeDirection = objective.mode === "min" ? "decreasing" : "increasing";
  const level = formatNumber(objective.level);
  if (analysis.objectiveStatus === "flat") {
    setBadge(dom.objectiveBadge, "No direction", "warning");
    dom.objectiveText.textContent = "All three objective coefficients are zero, so every feasible point has the same objective value.";
    return;
  }

  if (analysis.objectiveIntersects && analysis.objectiveVisibleInDisplay !== false) {
    const intersectionKind = analysis.objectiveLevelIntersection?.kind ?? "region";
    setBadge(dom.objectiveBadge, "Plane intersects", "success");
    dom.objectiveText.textContent = `At level ${level}, the plane meets the displayed feasible region in a ${intersectionKind}. ${objective.mode === "min" ? "Minimize" : "Maximize"} points toward ${modeDirection} objective values.`;
  } else if (analysis.objectiveIntersects) {
    setBadge(dom.objectiveBadge, "Outside display", "neutral");
    dom.objectiveText.textContent = `The level-${level} plane reaches the mathematical feasible region outside the clipped 3D display. The arrow points toward ${modeDirection} objective values.`;
  } else {
    setBadge(dom.objectiveBadge, "No intersection", "warning");
    dom.objectiveText.textContent = `The level-${level} plane is separate from the feasible region. The arrow still points toward ${modeDirection} objective values.`;
  }
}

function updateOptimumStatus(analysis) {
  const optimum = analysis.optimum;
  const objectiveNoun = analysis.objective.mode === "min" ? "minimum" : "maximum";
  if (!optimum || optimum.kind === "unbounded" || analysis.objectiveStatus === "unbounded") {
    setBadge(dom.optimumBadge, "Unbounded objective", "warning");
    dom.optimumText.textContent = `The ${objectiveNoun} can improve indefinitely along the highlighted ray, so there is no finite plane to snap to.`;
    setSnapAvailability(false, "An unbounded objective has no finite optimum to snap to.");
    return;
  }

  const value = formatNumber(optimum.value);
  if (optimum.kind === "vertex") {
    const point = optimum.points?.[0] ?? optimum.point;
    setBadge(dom.optimumBadge, "Unique vertex", "success");
    dom.optimumText.textContent = `The ${objectiveNoun} is ${value} at ${formatPoint(point)}.`;
  } else if (optimum.kind === "edge") {
    setBadge(dom.optimumBadge, "Optimal edge", "success");
    const endpoints = farthestPair(optimum.points ?? []);
    dom.optimumText.textContent = `The ${objectiveNoun} is ${value} along the edge from ${formatPoint(endpoints[0])} to ${formatPoint(endpoints[1])}.`;
  } else if (optimum.kind === "face") {
    setBadge(dom.optimumBadge, "Optimal face", "success");
    const clippingNote = optimum.displayClipped ? " in the display clipping window" : "";
    dom.optimumText.textContent = `The ${objectiveNoun} is ${value} across a face shown with ${optimum.points.length} vertices${clippingNote}.`;
  } else if (optimum.kind === "flat") {
    setBadge(dom.optimumBadge, "Every point optimal", "neutral");
    dom.optimumText.textContent = `Every feasible point has objective value ${value}.`;
  } else {
    setBadge(dom.optimumBadge, "Finite optimum", "success");
    dom.optimumText.textContent = `The ${objectiveNoun} is ${value}${optimum.point ? ` at ${formatPoint(optimum.point)}` : ""}.`;
  }
  setSnapAvailability(Number.isFinite(optimum.value), `Move the objective plane to the ${objectiveNoun} value ${value}.`);
}

function setBadge(element, text, tone) {
  element.className = `status-badge ${tone}`;
  element.textContent = text;
}

function setSnapAvailability(enabled, description) {
  dom.snapOptimum.disabled = !enabled;
  dom.snapOptimum.title = description;
}

function snapObjectiveToOptimum() {
  if (!state.valid || !state.analysis?.optimum || !Number.isFinite(state.analysis.optimum.value)) {
    return;
  }
  const value = normalizeNegativeZero(state.analysis.optimum.value);
  setInputValue(dom.objectiveLevel, value);
  state.lastAction = "snap-optimum";
  const analysis = updateAnalysis({ focusOptimum: true });
  if (analysis && renderer) {
    renderer.setStatus(`Objective plane snapped to ${formatNumber(value)} and the optimum is centered.`);
  }
}

function setInputValue(input, value) {
  input.value = value === null || value === undefined ? "" : formatInputNumber(value);
}

function formatInputNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? String(normalizeNegativeZero(numeric)) : String(value ?? "");
}

function formatNumber(value) {
  if (value === Infinity) {
    return "∞";
  }
  if (value === -Infinity) {
    return "−∞";
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? NUMBER_FORMATTER.format(normalizeNegativeZero(numeric)) : "unknown";
}

function formatPoint(point) {
  if (!Array.isArray(point) || point.length < 3) {
    return "an undetermined point";
  }
  return `(${point.slice(0, 3).map(formatNumber).join(", ")})`;
}

function farthestPair(points) {
  if (!Array.isArray(points) || points.length < 2) {
    return [points?.[0], points?.[0]];
  }
  let pair = [points[0], points[1]];
  let bestDistance = -1;
  for (let first = 0; first < points.length; first += 1) {
    for (let second = first + 1; second < points.length; second += 1) {
      const distance = points[first].reduce((sum, value, axis) => sum + (value - points[second][axis]) ** 2, 0);
      if (distance > bestDistance) {
        bestDistance = distance;
        pair = [points[first], points[second]];
      }
    }
  }
  return pair;
}

function plural(count, singular, pluralForm) {
  return count === 1 ? singular : pluralForm;
}

function normalizeNegativeZero(value) {
  return Object.is(value, -0) ? 0 : value;
}

function normalizeRelation(value) {
  const relation = String(value ?? "<=").trim().replace("≤", "<=").replace("≥", ">=");
  return relation === "<" ? "<=" : relation === ">" ? ">=" : relation;
}

function createConstraintId() {
  const existingIds = new Set(
    Array.from(dom.constraintsBody.querySelectorAll("[data-constraint-row]"), (row) => row.dataset.constraintId),
  );
  let id;
  do {
    id = `constraint-${nextConstraintSequence}`;
    nextConstraintSequence += 1;
  } while (existingIds.has(id));
  return id;
}

function cloneModel(model) {
  return {
    objective: {
      mode: model.objective?.mode === "min" ? "min" : "max",
      coefficients: [0, 1, 2].map((index) => model.objective?.coefficients?.[index] ?? 0),
      level: model.objective?.level ?? 0,
    },
    constraints: (model.constraints ?? []).map((entry, index) => ({
      id: String(entry.id ?? `constraint-${index + 1}`),
      name: String(entry.name ?? `Constraint ${index + 1}`),
      enabled: entry.enabled !== false,
      a: entry.a ?? entry.coefficients?.[0] ?? 0,
      b: entry.b ?? entry.coefficients?.[1] ?? 0,
      c: entry.c ?? entry.coefficients?.[2] ?? 0,
      relation: normalizeRelation(entry.relation),
      rhs: entry.rhs ?? 0,
      color: entry.color ?? CONSTRAINT_COLORS[index % CONSTRAINT_COLORS.length],
    })),
  };
}

function installDebugSurface() {
  window.__LP3D_DEBUG__ = Object.freeze({
    fixtures: DEBUG_FIXTURES,
    loadFixture(name) {
      const fixtureName = String(name ?? "").toLowerCase();
      if (!Object.hasOwn(DEBUG_FIXTURES, fixtureName)) {
        throw new RangeError(`Unknown 3D LP fixture: ${fixtureName}`);
      }
      loadModel(DEBUG_FIXTURES[fixtureName], { resetCamera: true, action: `debug-fixture-${fixtureName}` });
      return getDebugState();
    },
    getState: getDebugState,
  });
}

function getDebugState() {
  const analysis = state.analysis;
  return {
    ready: state.valid && Boolean(analysis),
    valid: state.valid,
    error: state.error,
    rendererError: state.rendererError,
    lastAction: state.lastAction,
    model: cloneModel(state.model),
    analysis: analysis ? {
      status: analysis.status,
      feasible: analysis.feasible,
      regionBounded: analysis.regionBounded,
      boundedObjectiveOnUnboundedRegion: analysis.boundedObjectiveOnUnboundedRegion,
      objectiveStatus: analysis.objectiveStatus,
      objectiveIntersects: analysis.objectiveIntersects,
      objectiveVisibleInDisplay: analysis.objectiveVisibleInDisplay,
      objectiveLevelIntersection: {
        kind: analysis.objectiveLevelIntersection?.kind ?? "none",
        points: (analysis.objectiveLevelIntersection?.points ?? []).map((point) => point.slice()),
      },
      objectiveRange: analysis.objectiveRange ? { ...analysis.objectiveRange } : null,
      optimum: analysis.optimum ? {
        kind: analysis.optimum.kind,
        type: analysis.optimum.type,
        value: analysis.optimum.value,
        point: analysis.optimum.point?.slice?.() ?? null,
        points: (analysis.optimum.points ?? []).map((point) => point.slice()),
        ray: analysis.optimum.ray?.slice?.() ?? null,
        displayClipped: Boolean(analysis.optimum.displayClipped),
      } : null,
      vertices: (analysis.vertices ?? []).map((point) => point.slice()),
      vertexCount: analysis.vertices?.length ?? 0,
      edgeCount: analysis.edges?.length ?? 0,
      faceCount: analysis.faces?.length ?? 0,
      displayVertexCount: analysis.displayPolyhedron?.vertices?.length ?? 0,
      viewLimit: analysis.viewLimit,
    } : null,
    badges: {
      feasibility: dom.feasibilityBadge.textContent,
      region: dom.regionBadge.textContent,
      objective: dom.objectiveBadge.textContent,
      optimum: dom.optimumBadge.textContent,
    },
    renderer: renderer?.getDebugState?.() ?? null,
  };
}

function simplexConstraints(rhs) {
  return [
    ...nonnegativeConstraints(),
    constraint("capacity", "Capacity", 1, 1, 1, "<=", rhs, 3),
  ];
}

function nonnegativeConstraints() {
  return [
    constraint("x-nonnegative", "x nonnegative", 1, 0, 0, ">=", 0, 0),
    constraint("y-nonnegative", "y nonnegative", 0, 1, 0, ">=", 0, 1),
    constraint("z-nonnegative", "z nonnegative", 0, 0, 1, ">=", 0, 2),
  ];
}

function constraint(id, name, a, b, c, relation, rhs, colorIndex) {
  return {
    id,
    name,
    enabled: true,
    a,
    b,
    c,
    relation,
    rhs,
    color: CONSTRAINT_COLORS[colorIndex % CONSTRAINT_COLORS.length],
  };
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function friendlyError(error) {
  return error instanceof Error ? error.message : String(error ?? "Unknown error");
}

function requireElement(id) {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`The 3D explorer is missing #${id}.`);
  }
  return element;
}
