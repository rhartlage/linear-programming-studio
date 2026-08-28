import jsLPSolver from "./vendor/javascript-lp-solver.mjs";

export const DIMENSIONS = ["x", "y", "z"];
export const DEFAULT_VIEW_LIMIT = 10;

const EPSILON = 1e-9;
const FEASIBILITY_TOLERANCE = 1e-7;
const GEOMETRY_TOLERANCE = 1e-6;
const PIVOT_TOLERANCE = 1e-10;

/**
 * Convert enabled UI rows to canonical unit-normal halfspaces n dot x <= rhs.
 * Supported row coefficient shapes are coefficients:[a,b,c] or a/b/c fields.
 */
export function normalizeConstraints(rows = []) {
  const normalized = [];

  rows.forEach((row, sourceIndex) => {
    if (row?.enabled === false) {
      return;
    }

    const coefficients = readCoefficientVector(row);
    const rhs = parseFiniteNumber(row?.rhs ?? row?.bound ?? 0);
    const relation = normalizeRelation(row?.relation ?? row?.operator ?? "<=");
    if (!coefficients.every(Number.isFinite) || !Number.isFinite(rhs)) {
      throw new TypeError(`Constraint ${sourceIndex + 1} needs finite x, y, z, and rhs values.`);
    }
    if (!relation) {
      throw new TypeError(`Constraint ${sourceIndex + 1} has an unsupported relation.`);
    }

    const sourceId = String(row?.id ?? `c${sourceIndex + 1}`);
    const variants = relation === "="
      ? [
          { relation: "<=", suffix: ":le" },
          { relation: ">=", suffix: ":ge" },
        ]
      : [{ relation, suffix: "" }];

    variants.forEach((variant) => {
      const direction = variant.relation === ">=" ? -1 : 1;
      const normal = coefficients.map((value) => value * direction);
      const directedRhs = rhs * direction;
      const magnitude = vectorLength(normal);

      if (magnitude <= EPSILON) {
        if (directedRhs < -FEASIBILITY_TOLERANCE) {
          const canonicalNormal = [0, 0, 0];
          normalized.push({
            id: `${sourceId}${variant.suffix}`,
            sourceId,
            sourceIndex,
            name: row?.name ?? "",
            color: row?.color,
            normal: canonicalNormal,
            coefficients: canonicalNormal,
            rhs: directedRhs,
            contradiction: true,
            original: row,
          });
        }
        return;
      }

      const canonicalNormal = normal.map((value) => value / magnitude);
      normalized.push({
        id: `${sourceId}${variant.suffix}`,
        sourceId,
        sourceIndex,
        name: row?.name ?? "",
        color: row?.color,
        normal: canonicalNormal,
        coefficients: canonicalNormal,
        rhs: directedRhs / magnitude,
        contradiction: false,
        original: row,
      });
    });
  });

  return normalized;
}

export function normalizeObjective(objective = {}) {
  const coefficients = readCoefficientVector(objective, ["xCoeff", "yCoeff", "zCoeff"]);
  if (!coefficients.every(Number.isFinite)) {
    throw new TypeError("The objective needs finite x, y, and z coefficients.");
  }
  return {
    mode: String(objective.mode ?? "max").toLowerCase().startsWith("min") ? "min" : "max",
    coefficients,
    level: parseFiniteNumber(objective.level ?? 0, 0),
  };
}

/** Solve max objective dot x over canonical halfspaces. */
export function solveLinearProgram(constraints, objective = [0, 0, 0]) {
  const direction = objective.map((value) => Number(value) || 0);
  if (constraints.some((constraint) => constraint.contradiction)) {
    return { status: "infeasible", point: null, value: null, raw: null };
  }

  if (!constraints.length) {
    if (vectorLength(direction) > EPSILON) {
      return {
        status: "unbounded",
        point: [0, 0, 0],
        value: Infinity,
        raw: null,
      };
    }
    return { status: "optimal", point: [0, 0, 0], value: 0, raw: null };
  }

  const solve = jsLPSolver?.Solve;
  if (typeof solve !== "function") {
    throw new TypeError("javascript-lp-solver default export must expose Solve(model).");
  }

  const model = buildSolverModel(constraints, direction);
  const raw = solve.call(jsLPSolver, model);
  if (!raw || raw.feasible === false) {
    return { status: "infeasible", point: null, value: null, raw };
  }

  const point = DIMENSIONS.map((name) => {
    const value = finiteOrZero(raw[`${name}_positive`]) - finiteOrZero(raw[`${name}_negative`]);
    return Math.abs(value) <= EPSILON ? 0 : value;
  });
  if (raw.bounded === false) {
    return { status: "unbounded", point, value: Infinity, raw };
  }

  return {
    status: "optimal",
    point,
    value: dot(direction, point),
    certified: satisfiesAll(point, constraints),
    raw,
  };
}

export function enumerateFeasibleVertices(constraints) {
  const planes = constraints.filter((constraint) => !constraint.contradiction && vectorLength(constraint.normal) > EPSILON);
  const points = [];

  for (let first = 0; first < planes.length; first += 1) {
    for (let second = first + 1; second < planes.length; second += 1) {
      for (let third = second + 1; third < planes.length; third += 1) {
        const triple = [planes[first], planes[second], planes[third]];
        const point = solveThreeByThree(
          triple.map((constraint) => constraint.normal),
          triple.map((constraint) => constraint.rhs)
        );
        if (!point || !satisfiesAll(point, constraints)) {
          continue;
        }
        if (!points.some((candidate) => pointsNear(candidate, point))) {
          points.push(point);
        }
      }
    }
  }

  points.sort(comparePoints);
  return points.map((point, index) => ({
    id: `v${index}`,
    point,
    activeConstraintIds: planes
      .filter((constraint) => planeDistance(point, constraint) <= geometryTolerance(point, constraint.rhs))
      .map((constraint) => constraint.id),
  }));
}

export function buildRealGeometry(vertices, constraints) {
  const faces = [];
  const faceKeys = new Map();

  constraints.forEach((constraint) => {
    if (constraint.contradiction || vectorLength(constraint.normal) <= EPSILON) {
      return;
    }
    const active = vertices.filter((vertex) =>
      planeDistance(vertex.point, constraint) <= geometryTolerance(vertex.point, constraint.rhs)
    );
    if (active.length < 3) {
      return;
    }

    const ordered = orderVerticesOnPlane(active, constraint.normal);
    if (ordered.length < 3) {
      return;
    }
    const key = ordered.map((vertex) => vertex.id).sort().join("|");
    const duplicate = faceKeys.get(key);
    if (duplicate) {
      duplicate.constraintIds.push(constraint.id);
      return;
    }

    const face = {
      id: `f${faces.length}`,
      constraintId: constraint.id,
      constraintIds: [constraint.id],
      vertexIds: ordered.map((vertex) => vertex.id),
      vertices: ordered.map((vertex) => vertex.point),
      normal: constraint.normal.slice(),
      rhs: constraint.rhs,
      artificial: false,
    };
    faceKeys.set(key, face);
    faces.push(face);
  });

  const vertexById = new Map(vertices.map((vertex) => [vertex.id, vertex]));
  const edgeMap = new Map();
  faces.forEach((face) => {
    face.vertexIds.forEach((vertexId, index) => {
      const nextId = face.vertexIds[(index + 1) % face.vertexIds.length];
      const key = edgeKey(vertexId, nextId);
      if (!edgeMap.has(key)) {
        edgeMap.set(key, {
          id: `e${edgeMap.size}`,
          vertexIds: key.split("|"),
          start: vertexById.get(vertexId).point,
          end: vertexById.get(nextId).point,
          faceIds: [],
          artificial: false,
        });
      }
      edgeMap.get(key).faceIds.push(face.id);
    });
  });

  return { vertices, faces, edges: Array.from(edgeMap.values()) };
}

export function buildDisplayPolyhedron(constraints, viewLimit = DEFAULT_VIEW_LIMIT) {
  const limit = Math.max(1, Math.abs(Number(viewLimit) || DEFAULT_VIEW_LIMIT));
  let faces = createBoxFaces(limit);

  for (const constraint of constraints) {
    if (constraint.contradiction) {
      return { vertices: [], faces: [], edges: [], viewLimit: limit };
    }
    if (vectorLength(constraint.normal) <= EPSILON) {
      continue;
    }

    const clippedFaces = [];
    const capPoints = [];
    faces.forEach((face) => {
      const clipped = clipFaceByHalfspace(face.vertices, constraint);
      if (clipped.vertices.length >= 3) {
        clippedFaces.push({ ...face, vertices: clipped.vertices });
      }
      capPoints.push(...clipped.intersections);
    });

    const uniqueCapPoints = dedupePointArray(capPoints);
    if (uniqueCapPoints.length >= 3) {
      clippedFaces.push({
        id: `constraint:${constraint.id}`,
        constraintId: constraint.id,
        vertices: orderPointsOnPlane(uniqueCapPoints, constraint.normal),
        normal: constraint.normal.slice(),
        artificial: false,
        source: "constraint",
      });
    }
    faces = clippedFaces;
    if (!faces.length) {
      break;
    }
  }

  return indexDisplayGeometry(faces, limit);
}

export function intersectObjectiveLevel(displayGeometry, objective, level = objective?.level ?? 0) {
  const normalizedObjective = Array.isArray(objective)
    ? { coefficients: objective, level }
    : normalizeObjective(objective);
  const coefficients = normalizedObjective.coefficients;
  const targetLevel = parseFiniteNumber(level, normalizedObjective.level);

  if (vectorLength(coefficients) <= EPSILON) {
    return Math.abs(targetLevel) <= FEASIBILITY_TOLERANCE
      ? { intersects: true, kind: "all", points: displayGeometry.vertices.map((vertex) => vertex.point) }
      : { intersects: false, kind: "none", points: [] };
  }

  const contacts = [];
  displayGeometry.edges.forEach((edge) => {
    const startValue = dot(coefficients, edge.start) - targetLevel;
    const endValue = dot(coefficients, edge.end) - targetLevel;
    const startOn = Math.abs(startValue) <= GEOMETRY_TOLERANCE;
    const endOn = Math.abs(endValue) <= GEOMETRY_TOLERANCE;

    if (startOn) {
      contacts.push(edge.start);
    }
    if (endOn) {
      contacts.push(edge.end);
    }
    if ((startValue < -GEOMETRY_TOLERANCE && endValue > GEOMETRY_TOLERANCE) ||
        (startValue > GEOMETRY_TOLERANCE && endValue < -GEOMETRY_TOLERANCE)) {
      const ratio = startValue / (startValue - endValue);
      contacts.push(add(edge.start, scale(subtract(edge.end, edge.start), ratio)));
    }
  });

  const points = dedupePointArray(contacts);
  if (!points.length) {
    return { intersects: false, kind: "none", points: [] };
  }
  const ordered = points.length >= 3 ? orderPointsOnPlane(points, coefficients) : points.sort(comparePoints);
  return {
    intersects: true,
    kind: ordered.length >= 3 ? "polygon" : ordered.length === 2 ? "segment" : "point",
    points: ordered,
  };
}

export function analyzeLP3D({ constraints: rows = [], objective: rawObjective = {}, viewLimit: requestedViewLimit } = {}) {
  const constraints = normalizeConstraints(rows);
  const objective = normalizeObjective(rawObjective);
  const feasibility = solveLinearProgram(constraints, [0, 0, 0]);

  if (feasibility.status === "infeasible") {
    const viewLimit = normalizeRequestedViewLimit(requestedViewLimit) ?? DEFAULT_VIEW_LIMIT;
    return {
      status: "infeasible",
      feasible: false,
      constraints,
      feasibleWitness: null,
      feasiblePoint: null,
      regionBounded: false,
      regionBounds: null,
      boundedObjectiveOnUnboundedRegion: false,
      objective,
      objectiveStatus: "infeasible",
      objectiveRange: null,
      optimum: null,
      vertices: [],
      faces: [],
      edges: [],
      display: { vertices: [], faces: [], edges: [], viewLimit },
      displayPolyhedron: { vertices: [], faces: [], edges: [], viewLimit },
      objectiveLevelIntersection: { intersects: false, kind: "none", points: [] },
      objectiveIntersects: false,
      objectiveVisibleInDisplay: false,
      improvingRay: null,
      viewLimit,
    };
  }

  const coordinateAnalysis = analyzeCoordinateBounds(constraints);
  const regionBounded = coordinateAnalysis.bounded;
  const objectiveMagnitude = vectorLength(objective.coefficients);
  const optimizationDirection = objective.mode === "max"
    ? objective.coefficients
    : scale(objective.coefficients, -1);
  const optimization = objectiveMagnitude <= EPSILON
    ? { status: "optimal", point: feasibility.point, value: 0 }
    : solveLinearProgram(constraints, optimizationDirection);
  const objectiveRange = analyzeObjectiveRange(constraints, objective.coefficients);
  const vertices = enumerateFeasibleVertices(constraints);
  const realGeometry = buildRealGeometry(vertices, constraints);
  const viewLimit = normalizeRequestedViewLimit(requestedViewLimit) ?? computeViewLimit({
    constraints,
    witness: feasibility.point,
    vertices,
    coordinateBounds: coordinateAnalysis.bounds,
  });
  const display = buildDisplayPolyhedron(constraints, viewLimit);
  const displayPolyhedron = serializeDisplayPolyhedron(display);
  const objectiveLevelIntersection = intersectObjectiveLevel(display, objective, objective.level);
  const objectiveIntersects = objectiveLevelIsAttainable(objectiveRange, objective, objective.level);
  const publicGeometry = serializeRealGeometry(realGeometry);

  if (optimization.status === "unbounded") {
    const ray = findImprovingRay(constraints, optimizationDirection);
    return {
      status: "objective-unbounded",
      feasible: true,
      constraints,
      feasibleWitness: feasibility.point,
      feasiblePoint: feasibility.point,
      regionBounded,
      regionBounds: coordinateAnalysis.bounds,
      boundedObjectiveOnUnboundedRegion: false,
      objective,
      objectiveStatus: "unbounded",
      objectiveRange,
      optimum: {
        kind: "unbounded",
        type: "unbounded",
        value: null,
        point: null,
        points: [],
        vertices: [],
        vertexIds: [],
        ray,
      },
      ...publicGeometry,
      display,
      displayPolyhedron,
      objectiveLevelIntersection,
      objectiveIntersects,
      objectiveVisibleInDisplay: objectiveLevelIntersection.intersects,
      improvingRay: ray,
      viewLimit,
    };
  }

  const bestPoint = optimization.point ?? feasibility.point;
  const bestValue = objectiveMagnitude <= EPSILON ? 0 : dot(objective.coefficients, bestPoint);
  const optimum = classifyOptimalVertices(vertices, objective, bestValue);
  optimum.value = bestValue;
  optimum.point = bestPoint;
  if (!optimum.vertices.length) {
    const displayOptimum = intersectObjectiveLevel(display, objective, bestValue);
    if (displayOptimum.points.length) {
      optimum.kind = optimumKindForPoints(displayOptimum.points);
      optimum.displayClipped = true;
      optimum.displayPoints = displayOptimum.points;
    }
  }
  optimum.type = optimum.kind;
  optimum.points = optimum.displayPoints ?? optimum.vertices.map((vertex) => vertex.point);

  return {
    status: objectiveMagnitude <= EPSILON ? "flat" : "optimal",
    feasible: true,
    constraints,
    feasibleWitness: feasibility.point,
    feasiblePoint: feasibility.point,
    regionBounded,
    regionBounds: coordinateAnalysis.bounds,
    boundedObjectiveOnUnboundedRegion: !regionBounded,
    objective,
    objectiveStatus: objectiveMagnitude <= EPSILON ? "flat" : "bounded",
    objectiveRange,
    optimum,
    ...publicGeometry,
    display,
    displayPolyhedron,
    objectiveLevelIntersection,
    objectiveIntersects,
    objectiveVisibleInDisplay: objectiveLevelIntersection.intersects,
    improvingRay: null,
    viewLimit,
  };
}

export function classifyOptimalVertices(vertices, objective, bestValue) {
  const normalizedObjective = Array.isArray(objective)
    ? { coefficients: objective, mode: "max" }
    : normalizeObjective(objective);
  const coefficients = normalizedObjective.coefficients;
  if (vectorLength(coefficients) <= EPSILON) {
    return { kind: "flat", vertices: vertices.slice(), vertexIds: vertices.map((vertex) => vertex.id) };
  }

  const tolerance = GEOMETRY_TOLERANCE * (1 + Math.abs(bestValue));
  const optimalVertices = vertices.filter((vertex) =>
    Math.abs(dot(coefficients, vertex.point) - bestValue) <= tolerance
  );
  const rank = affineRank(optimalVertices.map((vertex) => vertex.point));
  const kind = optimalVertices.length === 0
    ? "undetermined"
    : rank === 0
      ? "vertex"
      : rank === 1
        ? "edge"
        : "face";
  const orderedVertices = kind === "face"
    ? orderVerticesOnPlane(optimalVertices, coefficients)
    : optimalVertices;
  return {
    kind,
    vertices: orderedVertices,
    vertexIds: orderedVertices.map((vertex) => vertex.id),
  };
}

function objectiveLevelIsAttainable(range, objective, level) {
  const coefficients = objective.coefficients;
  const target = Number(level);
  if (!Number.isFinite(target) || !range) {
    return false;
  }
  if (vectorLength(coefficients) <= EPSILON) {
    return Math.abs(target) <= FEASIBILITY_TOLERANCE;
  }
  const tolerance = GEOMETRY_TOLERANCE * (1 + Math.abs(target));
  return target >= range.min - tolerance && target <= range.max + tolerance;
}

function optimumKindForPoints(points) {
  const rank = affineRank(points);
  return rank === 0 ? "vertex" : rank === 1 ? "edge" : "face";
}

function analyzeCoordinateBounds(constraints) {
  const minimum = [];
  const maximum = [];
  let bounded = true;

  for (let axis = 0; axis < 3; axis += 1) {
    const direction = [0, 0, 0];
    direction[axis] = 1;
    const upper = solveLinearProgram(constraints, direction);
    const lower = solveLinearProgram(constraints, scale(direction, -1));
    const upperValue = upper.status === "unbounded" ? Infinity : upper.point[axis];
    const lowerValue = lower.status === "unbounded" ? -Infinity : lower.point[axis];
    maximum.push(upperValue);
    minimum.push(lowerValue);
    bounded = bounded && Number.isFinite(upperValue) && Number.isFinite(lowerValue);
  }

  return { bounded, bounds: { min: minimum, max: maximum } };
}

function analyzeObjectiveRange(constraints, coefficients) {
  if (vectorLength(coefficients) <= EPSILON) {
    return { min: 0, max: 0, lowerBounded: true, upperBounded: true };
  }
  const upper = solveLinearProgram(constraints, coefficients);
  const lower = solveLinearProgram(constraints, scale(coefficients, -1));
  return {
    min: lower.status === "unbounded" ? -Infinity : dot(coefficients, lower.point),
    max: upper.status === "unbounded" ? Infinity : dot(coefficients, upper.point),
    lowerBounded: lower.status !== "unbounded",
    upperBounded: upper.status !== "unbounded",
  };
}

function findImprovingRay(constraints, direction) {
  if (vectorLength(direction) <= EPSILON) {
    return null;
  }
  const recessionConstraints = constraints
    .filter((constraint) => !constraint.contradiction)
    .map((constraint) => ({ ...constraint, rhs: 0 }));
  recessionConstraints.push({
    id: "objective-improvement",
    sourceId: "objective-improvement",
    normal: scale(direction, -1),
    rhs: -1,
    contradiction: false,
  });
  const witness = solveLinearProgram(recessionConstraints, [0, 0, 0]);
  if (witness.status !== "optimal" || !witness.point) {
    return null;
  }
  return normalizeVector(witness.point);
}

function buildSolverModel(constraints, objective) {
  const model = {
    optimize: "__objective",
    opType: "max",
    constraints: {},
    variables: {},
  };

  constraints.forEach((constraint, index) => {
    model.constraints[`h${index}`] = { max: constraint.rhs };
  });
  DIMENSIONS.forEach((name, axis) => {
    const positive = { __objective: objective[axis] };
    const negative = { __objective: -objective[axis] };
    constraints.forEach((constraint, index) => {
      positive[`h${index}`] = constraint.normal[axis];
      negative[`h${index}`] = -constraint.normal[axis];
    });
    // javascript-lp-solver's native unrestricted-variable pivoting can
    // misclassify bounded models. The standard x = x+ - x- transformation
    // keeps each public coordinate mathematically unrestricted while using
    // the solver's well-tested nonnegative-variable path.
    model.variables[`${name}_positive`] = positive;
    model.variables[`${name}_negative`] = negative;
  });
  return model;
}

function createBoxFaces(limit) {
  const low = -limit;
  const high = limit;
  const makeFace = (id, normal, vertices) => ({
    id,
    constraintId: null,
    normal,
    vertices,
    artificial: true,
    source: "box",
  });
  return [
    makeFace("box:x-min", [-1, 0, 0], [[low, low, low], [low, low, high], [low, high, high], [low, high, low]]),
    makeFace("box:x-max", [1, 0, 0], [[high, low, low], [high, high, low], [high, high, high], [high, low, high]]),
    makeFace("box:y-min", [0, -1, 0], [[low, low, low], [high, low, low], [high, low, high], [low, low, high]]),
    makeFace("box:y-max", [0, 1, 0], [[low, high, low], [low, high, high], [high, high, high], [high, high, low]]),
    makeFace("box:z-min", [0, 0, -1], [[low, low, low], [low, high, low], [high, high, low], [high, low, low]]),
    makeFace("box:z-max", [0, 0, 1], [[low, low, high], [high, low, high], [high, high, high], [low, high, high]]),
  ];
}

function clipFaceByHalfspace(vertices, constraint) {
  const output = [];
  const intersections = [];
  for (let index = 0; index < vertices.length; index += 1) {
    const current = vertices[index];
    const next = vertices[(index + 1) % vertices.length];
    const currentValue = dot(constraint.normal, current) - constraint.rhs;
    const nextValue = dot(constraint.normal, next) - constraint.rhs;
    const currentInside = currentValue <= FEASIBILITY_TOLERANCE;
    const nextInside = nextValue <= FEASIBILITY_TOLERANCE;

    if (currentInside && nextInside) {
      output.push(next);
    } else if (currentInside !== nextInside) {
      const denominator = currentValue - nextValue;
      if (Math.abs(denominator) > EPSILON) {
        const ratio = currentValue / denominator;
        const intersection = add(current, scale(subtract(next, current), ratio));
        output.push(intersection);
        intersections.push(intersection);
      }
      if (!currentInside && nextInside) {
        output.push(next);
      }
    }
  }
  return { vertices: dedupeAdjacentPoints(output), intersections };
}

function indexDisplayGeometry(rawFaces, viewLimit) {
  const vertices = [];
  const faces = rawFaces
    .map((rawFace) => {
      const vertexIds = rawFace.vertices.map((point) => {
        let index = vertices.findIndex((vertex) => pointsNear(vertex.point, point));
        if (index === -1) {
          index = vertices.length;
          vertices.push({ id: `dv${index}`, point: point.slice() });
        }
        return vertices[index].id;
      });
      const uniqueIds = vertexIds.filter((id, index) => index === 0 || id !== vertexIds[index - 1]);
      return {
        ...rawFace,
        id: rawFace.id ?? `df${rawFaces.indexOf(rawFace)}`,
        vertexIds: uniqueIds,
        vertices: uniqueIds.map((id) => vertices.find((vertex) => vertex.id === id).point),
      };
    })
    .filter((face) => face.vertexIds.length >= 3);

  const edgeMap = new Map();
  faces.forEach((face) => {
    face.vertexIds.forEach((vertexId, index) => {
      const nextId = face.vertexIds[(index + 1) % face.vertexIds.length];
      const key = edgeKey(vertexId, nextId);
      if (!edgeMap.has(key)) {
        const ids = key.split("|");
        edgeMap.set(key, {
          id: `de${edgeMap.size}`,
          vertexIds: ids,
          start: vertices.find((vertex) => vertex.id === ids[0]).point,
          end: vertices.find((vertex) => vertex.id === ids[1]).point,
          faceIds: [],
          artificial: false,
        });
      }
      const edge = edgeMap.get(key);
      edge.faceIds.push(face.id);
      edge.artificial = edge.artificial || face.artificial;
    });
  });
  return { vertices, faces, edges: Array.from(edgeMap.values()), viewLimit };
}

function serializeRealGeometry(geometry) {
  const indexById = new Map(geometry.vertices.map((vertex, index) => [vertex.id, index]));
  return {
    vertices: geometry.vertices.map((vertex) => vertex.point.slice()),
    faces: geometry.faces.map((face) => ({
      ...face,
      indices: face.vertexIds.map((id) => indexById.get(id)),
    })),
    edges: geometry.edges.map((edge) => ({
      ...edge,
      a: indexById.get(edge.vertexIds[0]),
      b: indexById.get(edge.vertexIds[1]),
    })),
    vertexRecords: geometry.vertices,
    faceRecords: geometry.faces,
    edgeRecords: geometry.edges,
  };
}

function serializeDisplayPolyhedron(display) {
  const indexById = new Map(display.vertices.map((vertex, index) => [vertex.id, index]));
  return {
    vertices: display.vertices.map((vertex) => vertex.point.slice()),
    faces: display.faces.map((face) => ({
      ...face,
      indices: face.vertexIds.map((id) => indexById.get(id)),
    })),
    edges: display.edges.map((edge) => ({
      ...edge,
      a: indexById.get(edge.vertexIds[0]),
      b: indexById.get(edge.vertexIds[1]),
    })),
    viewLimit: display.viewLimit,
  };
}

function orderVerticesOnPlane(vertices, normal) {
  const basis = planeBasis(normal);
  const centroid = averagePoint(vertices.map((vertex) => vertex.point));
  const projected = vertices.map((vertex) => ({
    vertex,
    x: dot(subtract(vertex.point, centroid), basis.u),
    y: dot(subtract(vertex.point, centroid), basis.v),
  }));
  return convexHull2D(projected).map((entry) => entry.vertex);
}

function orderPointsOnPlane(points, normal) {
  const basis = planeBasis(normal);
  const centroid = averagePoint(points);
  return points.slice().sort((first, second) => {
    const firstOffset = subtract(first, centroid);
    const secondOffset = subtract(second, centroid);
    return Math.atan2(dot(firstOffset, basis.v), dot(firstOffset, basis.u)) -
      Math.atan2(dot(secondOffset, basis.v), dot(secondOffset, basis.u));
  });
}

function convexHull2D(points) {
  const sorted = points.slice().sort((first, second) =>
    Math.abs(first.x - second.x) > GEOMETRY_TOLERANCE ? first.x - second.x : first.y - second.y
  );
  const cross2D = (origin, first, second) =>
    (first.x - origin.x) * (second.y - origin.y) - (first.y - origin.y) * (second.x - origin.x);
  const buildHalf = (entries) => {
    const half = [];
    entries.forEach((entry) => {
      while (half.length >= 2 && cross2D(half[half.length - 2], half[half.length - 1], entry) <= GEOMETRY_TOLERANCE) {
        half.pop();
      }
      half.push(entry);
    });
    return half;
  };
  const lower = buildHalf(sorted);
  const upper = buildHalf(sorted.slice().reverse());
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

function planeBasis(normal) {
  const n = normalizeVector(normal) ?? [0, 0, 1];
  const helper = Math.abs(n[0]) <= Math.abs(n[1]) && Math.abs(n[0]) <= Math.abs(n[2])
    ? [1, 0, 0]
    : Math.abs(n[1]) <= Math.abs(n[2])
      ? [0, 1, 0]
      : [0, 0, 1];
  const u = normalizeVector(cross(helper, n)) ?? [1, 0, 0];
  return { u, v: cross(n, u) };
}

function solveThreeByThree(matrix, rightHandSide) {
  const augmented = matrix.map((row, index) => [...row, rightHandSide[index]]);
  for (let column = 0; column < 3; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < 3; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) {
        pivot = row;
      }
    }
    if (Math.abs(augmented[pivot][column]) <= PIVOT_TOLERANCE) {
      return null;
    }
    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
    const divisor = augmented[column][column];
    for (let entry = column; entry < 4; entry += 1) {
      augmented[column][entry] /= divisor;
    }
    for (let row = 0; row < 3; row += 1) {
      if (row === column) {
        continue;
      }
      const factor = augmented[row][column];
      for (let entry = column; entry < 4; entry += 1) {
        augmented[row][entry] -= factor * augmented[column][entry];
      }
    }
  }
  const solution = augmented.map((row) => Math.abs(row[3]) <= EPSILON ? 0 : row[3]);
  return solution.every(Number.isFinite) ? solution : null;
}

function affineRank(points) {
  if (points.length <= 1) {
    return 0;
  }
  const origin = points[0];
  const basis = [];
  points.slice(1).forEach((point) => {
    let residual = subtract(point, origin);
    basis.forEach((direction) => {
      residual = subtract(residual, scale(direction, dot(residual, direction)));
    });
    const magnitude = vectorLength(residual);
    if (magnitude > GEOMETRY_TOLERANCE * (1 + vectorLength(point))) {
      basis.push(scale(residual, 1 / magnitude));
    }
  });
  return basis.length;
}

function computeViewLimit({ constraints, witness, vertices, coordinateBounds }) {
  const samples = [DEFAULT_VIEW_LIMIT];
  if (witness) {
    samples.push(...witness.map(Math.abs));
  }
  vertices.forEach((vertex) => samples.push(...vertex.point.map(Math.abs)));
  coordinateBounds.min.concat(coordinateBounds.max).forEach((value) => {
    if (Number.isFinite(value)) {
      samples.push(Math.abs(value));
    }
  });
  constraints.forEach((constraint) => {
    if (vectorLength(constraint.normal) > EPSILON) {
      samples.push(Math.abs(constraint.rhs));
    }
  });
  return niceCeiling(Math.max(...samples) * 1.25 + 1);
}

function niceCeiling(value) {
  const exponent = 10 ** Math.floor(Math.log10(Math.max(1, value)));
  const scaled = value / exponent;
  const step = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
  return step * exponent;
}

function normalizeRequestedViewLimit(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function readCoefficientVector(source, aliases = ["a", "b", "c"]) {
  if (Array.isArray(source?.coefficients)) {
    return [0, 1, 2].map((index) => parseFiniteNumber(source.coefficients[index] ?? 0));
  }
  return aliases.map((alias, index) => {
    const axis = DIMENSIONS[index];
    return parseFiniteNumber(source?.[alias] ?? source?.[axis] ?? 0);
  });
}

function normalizeRelation(relation) {
  const value = String(relation).trim().replace("≤", "<=").replace("≥", ">=");
  if (value === "<") return "<=";
  if (value === ">") return ">=";
  return ["<=", ">=", "="].includes(value) ? value : null;
}

function parseFiniteNumber(value, fallback = Number.NaN) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : fallback;
  }
  const text = String(value ?? "").trim().replace(/[−–—]/g, "-");
  const fraction = text.match(/^([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*\/\s*([+-]?(?:\d+(?:\.\d+)?|\.\d+))$/);
  if (fraction) {
    const denominator = Number(fraction[2]);
    return Math.abs(denominator) <= EPSILON ? fallback : Number(fraction[1]) / denominator;
  }
  const number = Number(text);
  return Number.isFinite(number) ? number : fallback;
}

function satisfiesAll(point, constraints) {
  return constraints.every((constraint) => {
    if (constraint.contradiction) {
      return false;
    }
    return dot(constraint.normal, point) - constraint.rhs <= geometryTolerance(point, constraint.rhs);
  });
}

function planeDistance(point, constraint) {
  return Math.abs(dot(constraint.normal, point) - constraint.rhs);
}

function geometryTolerance(point, rhs = 0) {
  return FEASIBILITY_TOLERANCE * (1 + vectorLength(point) + Math.abs(rhs));
}

function dedupePointArray(points) {
  const unique = [];
  points.forEach((point) => {
    if (!unique.some((candidate) => pointsNear(candidate, point))) {
      unique.push(point.slice());
    }
  });
  return unique;
}

function dedupeAdjacentPoints(points) {
  const deduped = points.filter((point, index) => index === 0 || !pointsNear(point, points[index - 1]));
  if (deduped.length > 1 && pointsNear(deduped[0], deduped[deduped.length - 1])) {
    deduped.pop();
  }
  return deduped;
}

function pointsNear(first, second) {
  const scaleValue = 1 + Math.max(vectorLength(first), vectorLength(second));
  return vectorLength(subtract(first, second)) <= GEOMETRY_TOLERANCE * scaleValue;
}

function comparePoints(first, second) {
  for (let index = 0; index < 3; index += 1) {
    if (Math.abs(first[index] - second[index]) > GEOMETRY_TOLERANCE) {
      return first[index] - second[index];
    }
  }
  return 0;
}

function averagePoint(points) {
  if (!points.length) return [0, 0, 0];
  return scale(points.reduce((sum, point) => add(sum, point), [0, 0, 0]), 1 / points.length);
}

function edgeKey(firstId, secondId) {
  return firstId < secondId ? `${firstId}|${secondId}` : `${secondId}|${firstId}`;
}

function dot(first, second) {
  return first[0] * second[0] + first[1] * second[1] + first[2] * second[2];
}

function add(first, second) {
  return [first[0] + second[0], first[1] + second[1], first[2] + second[2]];
}

function subtract(first, second) {
  return [first[0] - second[0], first[1] - second[1], first[2] - second[2]];
}

function scale(vector, factor) {
  return vector.map((value) => value * factor);
}

function cross(first, second) {
  return [
    first[1] * second[2] - first[2] * second[1],
    first[2] * second[0] - first[0] * second[2],
    first[0] * second[1] - first[1] * second[0],
  ];
}

function vectorLength(vector) {
  return Math.hypot(vector[0], vector[1], vector[2]);
}

function normalizeVector(vector) {
  const magnitude = vectorLength(vector);
  return magnitude <= EPSILON ? null : scale(vector, 1 / magnitude);
}

function finiteOrZero(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

export default analyzeLP3D;
