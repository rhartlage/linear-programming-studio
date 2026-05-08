const SVG_NS = "http://www.w3.org/2000/svg";
const EPSILON = 1e-7;
const PLOT_BOX = { x: 74, y: 26, width: 612, height: 612 };
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

const dom = {
  plot: document.getElementById("plot"),
  constraintList: document.getElementById("constraint-list"),
  addConstraint: document.getElementById("add-constraint"),
  loadExample: document.getElementById("load-example"),
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
    xCoeff: "3",
    yCoeff: "2",
    level: 6,
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
    xCoeff: "3",
    yCoeff: "2",
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

initialize();

function initialize() {
  bindStaticEvents();
  loadExampleProblem();
}

function bindStaticEvents() {
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

  dom.resetView.addEventListener("click", () => {
    state.view = { ...EXAMPLE_PROBLEM.view };
    syncViewInputs();
    refresh();
  });

  dom.snapOptimum.addEventListener("click", () => {
    const analysis = getAnalysis();
    if (analysis.optimization.status === "bounded") {
      state.objective.level = analysis.optimization.bestValue;
      syncObjectiveInputs();
      refresh();
    }
  });

  dom.plot.addEventListener("pointerdown", handlePlotPointerDown);
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
  const analysis = getAnalysis();
  if (!analysis.currentLineSegment) {
    return;
  }

  const point = clientToSvgPoint(event);
  const distance = pointToSegmentDistance(point, analysis.currentLineSegment.start, analysis.currentLineSegment.end);
  if (distance > 18) {
    return;
  }

  const startWorld = svgToWorld(point.x, point.y, analysis.view);
  dragState = {
    startWorld,
    startLevel: state.objective.level,
  };
  dom.plot.style.cursor = "grabbing";
  event.preventDefault();
}

function handlePlotPointerMove(event) {
  if (!dragState) {
    const analysis = getAnalysis();
    if (!analysis.currentLineSegment) {
      dom.plot.style.cursor = "default";
      return;
    }
    const point = clientToSvgPoint(event);
    const distance = pointToSegmentDistance(point, analysis.currentLineSegment.start, analysis.currentLineSegment.end);
    dom.plot.style.cursor = distance <= 18 ? "grab" : "default";
    return;
  }

  const analysis = getAnalysis();
  const point = clientToSvgPoint(event);
  const worldPoint = svgToWorld(point.x, point.y, analysis.view);
  const dx = worldPoint.x - dragState.startWorld.x;
  const dy = worldPoint.y - dragState.startWorld.y;
  const objective = getObjectiveCoefficients();
  const delta = objective.x * dx + objective.y * dy;
  state.objective.level = dragState.startLevel + delta;
  syncObjectiveInputs();
  refresh(false);
}

function handlePlotPointerUp() {
  if (!dragState) {
    return;
  }

  dragState = null;
  dom.plot.style.cursor = "default";
  refresh();
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
    const labels = getConstraintFieldLabels(constraint.type);

    row.innerHTML = `
      <div class="constraint-top">
        <div class="constraint-title">
          <span class="constraint-swatch" style="background:${color}"></span>
          <span>C${index + 1}</span>
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
          <input data-field="param1" type="text" inputmode="decimal" value="${escapeHtml(constraint.param1)}" />
        </label>
        <label class="${labels.hideParam2 ? "is-hidden" : ""}">
          <span>${labels.param2}</span>
          <input
            data-field="param2"
            type="text"
            inputmode="decimal"
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

function syncObjectiveFromInputs(includeLevel) {
  state.objective.mode = dom.objectiveMode.value;
  state.objective.xCoeff = dom.objectiveX.value;
  state.objective.yCoeff = dom.objectiveY.value;
  if (includeLevel) {
    state.objective.level = toNumber(dom.objectiveLevel.value, state.objective.level);
  }
}

function syncObjectiveInputs() {
  dom.objectiveMode.value = state.objective.mode;
  dom.objectiveX.value = state.objective.xCoeff;
  dom.objectiveY.value = state.objective.yCoeff;
  dom.objectiveLevel.value = formatNumber(state.objective.level);
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
  const halfPlanes = state.constraints
    .filter((constraint) => constraint.enabled)
    .map(convertConstraintToHalfPlane)
    .filter(Boolean);
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

  analysisCache = {
    view,
    halfPlanes,
    visiblePolygon,
    worldPolygon,
    feasibility,
    objective,
    currentLevel,
    objectiveLine,
    currentLineSegment,
    currentContacts,
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
      ? `Optimal value ${formatNumber(bestValue)} occurs along an edge.`
      : `Optimal value ${formatNumber(bestValue)} occurs at a vertex.`,
  };
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
    dom.objectiveText.textContent = `Current level z = ${formatNumber(analysis.currentLevel)} touches the visible feasible region.`;
  } else if (analysis.currentLineSegment) {
    setStatus(dom.objectiveBadge, "Draggable", "warning");
    dom.objectiveText.textContent = `Current level z = ${formatNumber(analysis.currentLevel)} is visible but not touching the feasible region.`;
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
      if (analysis.optimization.bestContacts.length > 1) {
        setStatus(dom.optimumBadge, "Edge optimum", "success");
        dom.optimumText.textContent = `${analysis.optimization.message} Drag the line until it first lands on that edge.`;
      } else {
        const point = analysis.optimization.bestContacts[0];
        setStatus(dom.optimumBadge, "Vertex optimum", "success");
        dom.optimumText.textContent = `${analysis.optimization.message} Best point: (${formatNumber(point.x)}, ${formatNumber(point.y)}).`;
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

function renderPlot(analysis) {
  dom.plot.innerHTML = "";

  const layers = {
    background: svgGroup(),
    grid: svgGroup(),
    region: svgGroup(),
    constraints: svgGroup(),
    overlay: svgGroup(),
    axes: svgGroup(),
    labels: svgGroup(),
  };

  drawPlotBackdrop(layers.background);
  drawGrid(layers.grid, analysis.view);

  if (analysis.visiblePolygon.length) {
    drawVisibleRegion(layers.region, analysis.visiblePolygon, analysis.view);
  }

  drawConstraints(layers.constraints, analysis.view);
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

function drawConstraints(group, view) {
  state.constraints.forEach((constraint, index) => {
    if (!constraint.enabled) {
      return;
    }

    const halfPlane = convertConstraintToHalfPlane(constraint);
    if (!halfPlane) {
      return;
    }

    const segment = lineSegmentInView(halfPlane.line, view);
    if (!segment) {
      return;
    }

    const color = getConstraintColor(index);
    group.appendChild(
      svgElement("line", {
        x1: segment.start.x,
        y1: segment.start.y,
        x2: segment.end.x,
        y2: segment.end.y,
        stroke: color,
        "stroke-width": 3,
        "stroke-linecap": "round",
      })
    );

    const labelPoint = {
      x: (segment.start.x + segment.end.x) / 2,
      y: (segment.start.y + segment.end.y) / 2,
    };

    group.appendChild(
      svgElement("text", {
        x: labelPoint.x + 8,
        y: labelPoint.y - 8,
        fill: color,
        "font-size": 14,
        "font-weight": 700,
      }, `C${index + 1}`)
    );
  });
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

  const hitLine = svgElement("line", {
    x1: analysis.currentLineSegment.start.x,
    y1: analysis.currentLineSegment.start.y,
    x2: analysis.currentLineSegment.end.x,
    y2: analysis.currentLineSegment.end.y,
    stroke: "transparent",
    "stroke-width": 24,
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
  });

  const handle = svgElement("circle", {
    cx: (analysis.currentLineSegment.start.x + analysis.currentLineSegment.end.x) / 2,
    cy: (analysis.currentLineSegment.start.y + analysis.currentLineSegment.end.y) / 2,
    r: 8,
    fill: "#F5A623",
    stroke: "#FFF9E9",
    "stroke-width": 3,
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
    },
    `z = ${formatNumber(analysis.currentLevel)}`
  );

  group.appendChild(hitLine);
  group.appendChild(visibleLine);
  group.appendChild(handle);
  group.appendChild(label);
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

function getObjectiveCoefficients() {
  return {
    x: toNumber(state.objective.xCoeff, 0),
    y: toNumber(state.objective.yCoeff, 0),
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

  const [a, b] = unique.slice(0, 2).map((point) => worldToSvg(point.x, point.y, view));
  return { start: a, end: b };
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
      return `x <= ${formatNumber(p1)}`;
    case "x_geq":
      return `x >= ${formatNumber(p1)}`;
    case "y_leq":
      return `y <= ${formatNumber(p1)}`;
    case "y_geq":
      return `y >= ${formatNumber(p1)}`;
    default:
      return "";
  }
}

function formatSlopeIntercept(slope, intercept) {
  const slopePart = `${formatNumber(slope)}x`;
  if (Math.abs(intercept) <= EPSILON) {
    return slopePart;
  }
  const sign = intercept >= 0 ? "+" : "-";
  return `${slopePart} ${sign} ${formatNumber(Math.abs(intercept))}`;
}

function getConstraintFieldLabels(type) {
  if (type.startsWith("line_")) {
    return { param1: "Slope m", param2: "Intercept b", hideParam2: false };
  }
  return { param1: "Value c", param2: "Unused", hideParam2: true };
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
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatNumber(value) {
  if (!Number.isFinite(value)) {
    return "0";
  }
  const rounded = Math.abs(value) < 1e-9 ? 0 : roundTo(value, 4);
  return Number(rounded).toString();
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
