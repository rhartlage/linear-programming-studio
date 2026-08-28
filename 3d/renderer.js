import * as THREE from "./vendor/three.module.min.js";
import { OrbitControls } from "./vendor/OrbitControls.js";

const DEFAULT_CAMERA_DIRECTION = new THREE.Vector3(1.25, 0.95, 1.35).normalize();
const AXIS_COLORS = { x: 0xc24a2d, y: 0x3569b7, z: 0x177c78 };

function mathToScene(point) {
  return new THREE.Vector3(point[0], point[2], point[1]);
}

function sceneNormal(coefficients) {
  return new THREE.Vector3(coefficients[0], coefficients[2], coefficients[1]);
}

function vectorLength(vector) {
  return Math.hypot(vector[0], vector[1], vector[2]);
}

function centroid(points) {
  if (!points?.length) return [0, 0, 0];
  const total = points.reduce(
    (sum, point) => [sum[0] + point[0], sum[1] + point[1], sum[2] + point[2]],
    [0, 0, 0],
  );
  return total.map((value) => value / points.length);
}

function projectPointToPlane(point, coefficients, rhs) {
  const denominator = coefficients.reduce((sum, value) => sum + value * value, 0);
  if (denominator <= 1e-12) return [...point];
  const signed = coefficients.reduce((sum, value, index) => sum + value * point[index], -rhs);
  return point.map((value, index) => value - (signed * coefficients[index]) / denominator);
}

function makeTextSprite(text, color, scale) {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.font = "700 42px system-ui, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.lineWidth = 9;
  context.strokeStyle = "rgba(255,255,255,0.92)";
  context.strokeText(text, canvas.width / 2, canvas.height / 2);
  context.fillStyle = color;
  context.fillText(text, canvas.width / 2, canvas.height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(scale * 1.65, scale * 0.82, 1);
  sprite.userData.dispose = () => {
    texture.dispose();
    material.dispose();
  };
  return sprite;
}

function disposeObject(object) {
  object.traverse((child) => {
    if (child.userData?.dispose) child.userData.dispose();
    child.geometry?.dispose?.();
    if (Array.isArray(child.material)) child.material.forEach((material) => material.dispose?.());
    else child.material?.dispose?.();
  });
}

function faceGeometry(vertices, faces) {
  const positions = [];
  for (const face of faces) {
    if (!face.indices || face.indices.length < 3) continue;
    const first = mathToScene(vertices[face.indices[0]]);
    for (let index = 1; index < face.indices.length - 1; index += 1) {
      const second = mathToScene(vertices[face.indices[index]]);
      const third = mathToScene(vertices[face.indices[index + 1]]);
      for (const point of [first, second, third]) positions.push(point.x, point.y, point.z);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function uniqueFaceEdges(faces) {
  const edges = new Map();
  for (const face of faces) {
    const indices = face.indices ?? [];
    for (let index = 0; index < indices.length; index += 1) {
      const a = indices[index];
      const b = indices[(index + 1) % indices.length];
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      const existing = edges.get(key);
      if (!existing) edges.set(key, { a, b, artificial: Boolean(face.artificial) });
      else existing.artificial = existing.artificial || Boolean(face.artificial);
    }
  }
  return [...edges.values()];
}

function lineSegmentsGeometry(vertices, edges) {
  const positions = [];
  for (const edge of edges) {
    const start = mathToScene(vertices[edge.a]);
    const end = mathToScene(vertices[edge.b]);
    positions.push(start.x, start.y, start.z, end.x, end.y, end.z);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
}

function colorForConstraint(constraint, index) {
  return new THREE.Color(constraint.color || ["#2F6DF6", "#E05F35", "#1B9C85", "#A13CF5", "#C38A06", "#D94173"][index % 6]);
}

export class LP3DRenderer {
  constructor(container, statusElement) {
    this.container = container;
    this.statusElement = statusElement;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xf8faf8);
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.05, 2000);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.domElement.className = "viewport-canvas";
    this.renderer.domElement.tabIndex = 0;
    this.renderer.domElement.setAttribute("role", "img");
    this.renderer.domElement.setAttribute(
      "aria-label",
      "Interactive three-dimensional linear programming graph. Drag to rotate, right-drag, Shift-drag, or use the arrow keys to pan, and use the mouse wheel to zoom.",
    );
    container.replaceChildren(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.controls.dampingFactor = 0.08;
    this.controls.screenSpacePanning = true;
    this.controls.minDistance = 1.5;
    this.controls.maxDistance = 400;
    this.controls.listenToKeyEvents(container);
    container.addEventListener("keydown", (event) => {
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
        this.setStatus("Panned the 3D view with the keyboard.");
      }
    });
    this.controls.addEventListener("change", () => this.syncCameraDataset());
    this.controls.addEventListener("start", () => this.setStatus("Moving the 3D view."));
    this.controls.addEventListener("end", () => this.setStatus("3D view ready."));

    this.modelGroup = new THREE.Group();
    this.scene.add(this.modelGroup);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x778899, 1.8));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(8, 14, 10);
    this.scene.add(key);

    this.currentLimit = 10;
    this.currentTarget = [0, 0, 0];
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resetCamera();
    this.resize();
    this.renderer.setAnimationLoop(() => {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    });
  }

  setStatus(message) {
    if (this.statusElement) this.statusElement.textContent = message;
  }

  syncCameraDataset() {
    this.renderer.domElement.dataset.cameraPosition = JSON.stringify(
      this.camera.position.toArray().map((value) => Number(value.toFixed(5))),
    );
    this.renderer.domElement.dataset.cameraTarget = JSON.stringify(
      this.controls.target.toArray().map((value) => Number(value.toFixed(5))),
    );
  }

  resize() {
    const rect = this.container.getBoundingClientRect();
    const width = Math.max(280, Math.round(rect.width));
    const height = Math.max(320, Math.round(rect.height));
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  clearModel() {
    this.scene.remove(this.modelGroup);
    disposeObject(this.modelGroup);
    this.modelGroup = new THREE.Group();
    this.scene.add(this.modelGroup);
  }

  render(analysis, model) {
    this.clearModel();
    this.currentLimit = Math.max(4, analysis.viewLimit || 10);
    const displayPoints = analysis.displayPolyhedron?.vertices ?? analysis.vertices ?? [];
    this.currentTarget = analysis.feasiblePoint ?? centroid(displayPoints);

    this.addAxes();
    this.addConstraintPlanes(analysis.constraints ?? [], this.currentTarget);
    if (analysis.feasible && analysis.displayPolyhedron?.vertices?.length) {
      this.addFeasiblePolyhedron(analysis.displayPolyhedron);
      this.addTrueVertices(analysis.vertices ?? []);
    }
    this.addObjectivePlane(model.objective, analysis);
    this.addOptimum(analysis.optimum);
    if (analysis.improvingRay) this.addImprovingRay(analysis.improvingRay, analysis.feasiblePoint);

    const outcome = analysis.feasible
      ? `${analysis.regionBounded ? "bounded" : "unbounded"} feasible region; ${analysis.objectiveStatus}.`
      : "infeasible model; no feasible solid.";
    this.renderer.domElement.setAttribute(
      "aria-label",
      `Interactive three-dimensional linear programming graph showing a ${outcome} Drag to rotate, right-drag, Shift-drag, or use the arrow keys to pan, and use the mouse wheel to zoom.`,
    );
    this.renderer.domElement.dataset.feasible = String(Boolean(analysis.feasible));
    this.renderer.domElement.dataset.regionBounded = String(Boolean(analysis.regionBounded));
    this.renderer.domElement.dataset.objectiveStatus = analysis.objectiveStatus ?? "unknown";
    this.renderer.domElement.dataset.objectiveDirection = model.objective.mode === "min" ? "decrease" : "increase";
    this.renderer.domElement.dataset.constraintCount = String(analysis.constraints?.length ?? 0);
    this.renderer.domElement.dataset.objectiveIntersects = String(Boolean(analysis.objectiveIntersects));
    this.renderer.domElement.dataset.objectiveVisible = String(Boolean(analysis.objectiveVisibleInDisplay));
    this.renderer.domElement.dataset.optimumType = analysis.optimum?.type ?? "none";
    this.renderer.domElement.dataset.optimumDisplayClipped = String(Boolean(analysis.optimum?.displayClipped));
    this.renderer.domElement.dataset.vertexCount = String(analysis.vertices?.length ?? 0);
    this.renderer.domElement.dataset.faceCount = String(analysis.faces?.length ?? 0);
    this.renderer.domElement.dataset.displayVertexCount = String(analysis.displayPolyhedron?.vertices?.length ?? 0);
    this.renderer.domElement.dataset.roleCounts = JSON.stringify(this.collectModelDebug().roleCounts);
    this.setStatus("3D view ready.");
  }

  addAxes() {
    const limit = this.currentLimit;
    const grid = new THREE.GridHelper(limit * 2, 10, 0x9aa9a5, 0xd8dfdc);
    grid.material.opacity = 0.58;
    grid.material.transparent = true;
    this.modelGroup.add(grid);

    const axes = [
      { name: "x", direction: new THREE.Vector3(1, 0, 0), color: AXIS_COLORS.x },
      { name: "z", direction: new THREE.Vector3(0, 1, 0), color: AXIS_COLORS.z },
      { name: "y", direction: new THREE.Vector3(0, 0, 1), color: AXIS_COLORS.y },
    ];
    for (const axis of axes) {
      const arrow = new THREE.ArrowHelper(axis.direction, new THREE.Vector3(), limit * 0.92, axis.color, limit * 0.05, limit * 0.025);
      this.modelGroup.add(arrow);
      const label = makeTextSprite(axis.name, `#${axis.color.toString(16).padStart(6, "0")}`, limit * 0.08);
      label.position.copy(axis.direction.clone().multiplyScalar(limit));
      this.modelGroup.add(label);
    }
  }

  addConstraintPlanes(constraints, referencePoint) {
    const size = this.currentLimit * 2.5;
    constraints.forEach((constraint, index) => {
      const norm = vectorLength(constraint.coefficients);
      if (norm <= 1e-10) return;
      const color = colorForConstraint(constraint, index);
      const normal = sceneNormal(constraint.coefficients).normalize();
      const anchorMath = projectPointToPlane(referencePoint, constraint.coefficients, constraint.rhs);
      const anchor = mathToScene(anchorMath);
      const geometry = new THREE.PlaneGeometry(size, size);
      const material = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.095,
        side: THREE.DoubleSide,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: index + 1,
      });
      const plane = new THREE.Mesh(geometry, material);
      plane.position.copy(anchor);
      plane.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
      plane.userData.constraintId = constraint.id;
      plane.userData.rendererRole = "constraint-plane";
      this.modelGroup.add(plane);

      const feasibleDirection = normal.clone().multiplyScalar(-1);
      const arrowLength = Math.max(0.75, this.currentLimit * 0.14);
      const arrowOrigin = anchor.clone().add(feasibleDirection.clone().multiplyScalar(-arrowLength * 0.2));
      const arrow = new THREE.ArrowHelper(feasibleDirection, arrowOrigin, arrowLength, color, arrowLength * 0.28, arrowLength * 0.14);
      arrow.userData.constraintId = constraint.id;
      arrow.userData.rendererRole = "constraint-arrow";
      this.modelGroup.add(arrow);
    });
  }

  addFeasiblePolyhedron(polyhedron) {
    const trueFaces = polyhedron.faces.filter((face) => !face.artificial);
    const artificialFaces = polyhedron.faces.filter((face) => face.artificial);
    if (trueFaces.length) {
      const geometry = faceGeometry(polyhedron.vertices, trueFaces);
      const material = new THREE.MeshPhongMaterial({
        color: 0x2a9d8f,
        transparent: true,
        opacity: 0.28,
        side: THREE.DoubleSide,
        depthWrite: false,
        shininess: 25,
      });
      const solid = new THREE.Mesh(geometry, material);
      solid.userData.rendererRole = "feasible-solid";
      this.modelGroup.add(solid);
    }
    if (artificialFaces.length) {
      const geometry = faceGeometry(polyhedron.vertices, artificialFaces);
      const material = new THREE.MeshBasicMaterial({
        color: 0x78909c,
        transparent: true,
        opacity: 0.055,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const cutoff = new THREE.Mesh(geometry, material);
      cutoff.userData.rendererRole = "display-cutoff";
      this.modelGroup.add(cutoff);
    }

    const edges = uniqueFaceEdges(polyhedron.faces);
    const realEdges = edges.filter((edge) => !edge.artificial);
    const clipEdges = edges.filter((edge) => edge.artificial);
    if (realEdges.length) {
      const geometry = lineSegmentsGeometry(polyhedron.vertices, realEdges);
      const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: 0x087f75, transparent: true, opacity: 0.9 }));
      lines.userData.rendererRole = "feasible-edge";
      this.modelGroup.add(lines);
    }
    if (clipEdges.length) {
      const geometry = lineSegmentsGeometry(polyhedron.vertices, clipEdges);
      const lines = new THREE.LineSegments(
        geometry,
        new THREE.LineDashedMaterial({ color: 0x607d8b, transparent: true, opacity: 0.55, dashSize: 0.18, gapSize: 0.12 }),
      );
      lines.computeLineDistances();
      lines.userData.rendererRole = "display-cutoff-edge";
      this.modelGroup.add(lines);
    }
  }

  addTrueVertices(vertices) {
    if (vertices.length > 80) return;
    const radius = Math.max(0.045, this.currentLimit * 0.012);
    const geometry = new THREE.SphereGeometry(radius, 16, 12);
    const material = new THREE.MeshStandardMaterial({ color: 0x006d67, roughness: 0.42, metalness: 0.05 });
    for (const vertex of vertices) {
      const marker = new THREE.Mesh(geometry, material);
      marker.position.copy(mathToScene(vertex));
      marker.userData.rendererRole = "feasible-vertex";
      this.modelGroup.add(marker);
    }
  }

  addObjectivePlane(objective, analysis) {
    const coefficients = objective.coefficients;
    const norm = vectorLength(coefficients);
    if (norm <= 1e-10) return;
    const size = this.currentLimit * 2.7;
    const normal = sceneNormal(coefficients).normalize();
    const anchorMath = projectPointToPlane(analysis.feasiblePoint ?? [0, 0, 0], coefficients, objective.level);
    const anchor = mathToScene(anchorMath);
    const geometry = new THREE.PlaneGeometry(size, size);
    const material = new THREE.MeshBasicMaterial({
      color: 0xf5a623,
      transparent: true,
      opacity: analysis.objectiveVisibleInDisplay ? 0.18 : 0.09,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const plane = new THREE.Mesh(geometry, material);
    plane.position.copy(anchor);
    plane.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    plane.userData.objectivePlane = true;
    plane.userData.rendererRole = "objective-plane";
    this.modelGroup.add(plane);

    const direction = objective.mode === "min" ? normal.clone().multiplyScalar(-1) : normal;
    const arrowLength = Math.max(0.9, this.currentLimit * 0.18);
    const arrow = new THREE.ArrowHelper(direction, anchor, arrowLength, 0xd67b00, arrowLength * 0.3, arrowLength * 0.16);
    arrow.userData.objectiveDirection = objective.mode === "min" ? "decrease" : "increase";
    arrow.userData.rendererRole = "objective-arrow";
    this.modelGroup.add(arrow);
  }

  addOptimum(optimum) {
    if (!optimum?.points?.length) return;
    const points = optimum.points;
    if (optimum.type === "vertex") {
      const geometry = new THREE.SphereGeometry(Math.max(0.09, this.currentLimit * 0.024), 24, 18);
      const material = new THREE.MeshStandardMaterial({ color: 0xf5a623, emissive: 0x5f3300, emissiveIntensity: 0.2 });
      const marker = new THREE.Mesh(geometry, material);
      marker.position.copy(mathToScene(points[0]));
      marker.userData.rendererRole = "optimum-vertex";
      this.modelGroup.add(marker);
      return;
    }
    if (optimum.type === "edge") {
      let pair = [points[0], points[1]];
      let distance = -1;
      for (let i = 0; i < points.length; i += 1) {
        for (let j = i + 1; j < points.length; j += 1) {
          const candidate = points[i].reduce((sum, value, axis) => sum + (value - points[j][axis]) ** 2, 0);
          if (candidate > distance) {
            distance = candidate;
            pair = [points[i], points[j]];
          }
        }
      }
      const geometry = new THREE.BufferGeometry().setFromPoints(pair.map(mathToScene));
      const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0xf5a623, linewidth: 4 }));
      line.userData.rendererRole = "optimum-edge";
      this.modelGroup.add(line);
      return;
    }
    if (optimum.type === "face" && points.length >= 3) {
      const indices = points.map((_point, index) => index);
      const geometry = faceGeometry(points, [{ indices }]);
      const material = new THREE.MeshBasicMaterial({ color: 0xf5a623, transparent: true, opacity: 0.42, side: THREE.DoubleSide, depthWrite: false });
      const face = new THREE.Mesh(geometry, material);
      face.userData.rendererRole = "optimum-face";
      this.modelGroup.add(face);
    }
  }

  addImprovingRay(ray, originPoint) {
    if (!ray || vectorLength(ray) <= 1e-10) return;
    const direction = mathToScene(ray).normalize();
    const origin = mathToScene(originPoint ?? [0, 0, 0]);
    const length = Math.max(1.1, this.currentLimit * 0.24);
    const arrow = new THREE.ArrowHelper(direction, origin, length, 0x7c3aed, length * 0.28, length * 0.14);
    arrow.userData.rendererRole = "improving-ray";
    this.modelGroup.add(arrow);
  }

  resetCamera(target = this.currentTarget) {
    const sceneTarget = mathToScene(target ?? [0, 0, 0]);
    const distance = Math.max(8, this.currentLimit * 2.45);
    this.controls.target.copy(sceneTarget);
    this.camera.position.copy(sceneTarget.clone().add(DEFAULT_CAMERA_DIRECTION.clone().multiplyScalar(distance)));
    this.camera.near = Math.max(0.02, distance / 2000);
    this.camera.far = distance * 30;
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.setStatus("Camera reset to the isometric teaching view.");
  }

  setViewPreset(name) {
    const target = this.controls.target.clone();
    const distance = Math.max(8, this.currentLimit * 2.45);
    const directions = {
      front: new THREE.Vector3(0, 0.15, 1),
      top: new THREE.Vector3(0.02, 1, 0.02),
      isometric: DEFAULT_CAMERA_DIRECTION,
    };
    const direction = (directions[name] || directions.isometric).clone().normalize();
    this.camera.position.copy(target.clone().add(direction.multiplyScalar(distance)));
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(target);
    this.controls.update();
    this.setStatus(`${name === "top" ? "Top" : name === "front" ? "Front" : "Isometric"} view selected.`);
  }

  zoom(multiplier) {
    const offset = this.camera.position.clone().sub(this.controls.target);
    const nextLength = THREE.MathUtils.clamp(offset.length() * multiplier, this.controls.minDistance, this.controls.maxDistance);
    this.camera.position.copy(this.controls.target.clone().add(offset.setLength(nextLength)));
    this.controls.update();
    this.setStatus(multiplier < 1 ? "Zoomed in." : "Zoomed out.");
  }

  focusPoints(points) {
    if (!points?.length) return;
    this.currentTarget = centroid(points);
    this.resetCamera(this.currentTarget);
  }

  getDebugState() {
    const modelDebug = this.collectModelDebug();
    return {
      camera: this.camera.position.toArray(),
      target: this.controls.target.toArray(),
      limit: this.currentLimit,
      ...modelDebug,
      canvas: {
        width: this.renderer.domElement.width,
        height: this.renderer.domElement.height,
        dataset: { ...this.renderer.domElement.dataset },
      },
    };
  }

  collectModelDebug() {
    const roleCounts = {};
    let objectiveDirection = null;
    this.modelGroup.traverse((object) => {
      const role = object.userData?.rendererRole;
      if (role) roleCounts[role] = (roleCounts[role] ?? 0) + 1;
      if (object.userData?.objectiveDirection) objectiveDirection = object.userData.objectiveDirection;
    });
    return { objectiveDirection, roleCounts };
  }
}

export { mathToScene };
