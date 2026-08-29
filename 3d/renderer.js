import * as THREE from "./vendor/three.module.min.js";
import { OrbitControls } from "./vendor/OrbitControls.js";

const DEFAULT_CAMERA_DIRECTION = new THREE.Vector3(1.25, 0.95, 1.35).normalize();
const AXIS_COLORS = { x: 0xc24a2d, y: 0x3569b7, z: 0x177c78 };
const HANDLE_MOUSE_RADIUS = 18;
const HANDLE_TOUCH_RADIUS = 24;
const DRAG_VALUE_DECIMALS = 3;
const MIN_PROJECTED_AXIS_PIXELS = 4;
const MAX_DRAG_PIXEL_WORLD_FACTOR = 0.65;

function mathToScene(point) {
  return new THREE.Vector3(point[0], point[2], point[1]);
}

function sceneNormal(coefficients) {
  return new THREE.Vector3(coefficients[0], coefficients[2], coefficients[1]);
}

function vectorLength(vector) {
  return Math.hypot(vector[0], vector[1], vector[2]);
}

export function planeValueAfterSceneOffset(startValue, coefficients, signedSceneOffset) {
  const magnitude = vectorLength(coefficients);
  if (!Number.isFinite(startValue) || !Number.isFinite(signedSceneOffset) || magnitude <= 1e-12) {
    return Number(startValue);
  }
  return startValue + magnitude * signedSceneOffset;
}

export function sceneOffsetAfterScreenDrag(deltaX, deltaY, screenAxis, worldPerPixel) {
  const axisX = Number(screenAxis?.[0]);
  const axisY = Number(screenAxis?.[1]);
  const axisLength = Math.hypot(axisX, axisY);
  if (![deltaX, deltaY, axisX, axisY, worldPerPixel].every(Number.isFinite) || axisLength <= 1e-12) {
    return 0;
  }
  const offset = ((deltaX * axisX + deltaY * axisY) / axisLength) * worldPerPixel;
  return Object.is(offset, -0) ? 0 : offset;
}

function roundDragValue(value) {
  if (!Number.isFinite(value)) return value;
  const rounded = Number(value.toFixed(DRAG_VALUE_DECIMALS));
  return Object.is(rounded, -0) ? 0 : rounded;
}

function dragTargetKey(kind, constraintId = "") {
  return kind === "objective" ? "objective" : `constraint:${constraintId}`;
}

function inPlaneOffset(normal, index, distance) {
  const helper = Math.abs(normal.y) < 0.82
    ? new THREE.Vector3(0, 1, 0)
    : new THREE.Vector3(1, 0, 0);
  const tangent = new THREE.Vector3().crossVectors(normal, helper).normalize();
  const bitangent = new THREE.Vector3().crossVectors(normal, tangent).normalize();
  const angle = index * 2.399963229728653;
  return tangent.multiplyScalar(Math.cos(angle) * distance)
    .add(bitangent.multiplyScalar(Math.sin(angle) * distance));
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
  constructor(container, statusElement, { onPlaneDrag = null, readoutElement = null } = {}) {
    this.container = container;
    this.statusElement = statusElement;
    this.readoutElement = readoutElement;
    this.onPlaneDrag = typeof onPlaneDrag === "function" ? onPlaneDrag : null;
    this.dragHandles = [];
    this.activePlaneDrag = null;
    this.hoveredHandleKey = null;
    this.planeInteractionEnabled = true;
    this.planeInteractionDisabledReason = "";
    this.lastPlaneDrag = null;
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
      "Interactive three-dimensional linear programming graph. Drag plane handles to change right sides or the objective level; drag elsewhere to rotate, and use the editor fields for precise or keyboard entry.",
    );
    container.replaceChildren(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.controls.dampingFactor = 0.08;
    this.controls.screenSpacePanning = true;
    this.controls.minDistance = 1.5;
    this.controls.maxDistance = 400;
    this.controls.listenToKeyEvents(container);
    this.installPlaneInteraction();
    container.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && this.activePlaneDrag) {
        event.preventDefault();
        this.finishPlaneDrag({ cancelled: true });
        return;
      }
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
        this.setStatus("Panned the 3D view with the keyboard.");
      }
    });
    this.controls.addEventListener("change", () => {
      this.syncCameraDataset();
      this.syncDragHandlePresentation();
    });
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

  installPlaneInteraction() {
    const canvas = this.renderer.domElement;
    canvas.addEventListener("pointerdown", (event) => this.handlePlanePointerDown(event), true);
    canvas.addEventListener("pointermove", (event) => this.handlePlanePointerMove(event), true);
    canvas.addEventListener("pointerup", (event) => this.handlePlanePointerUp(event), true);
    canvas.addEventListener("pointercancel", (event) => this.handlePlanePointerCancel(event), true);
    canvas.addEventListener("lostpointercapture", (event) => {
      if (this.activePlaneDrag?.pointerId === event.pointerId) {
        this.finishPlaneDrag({ cancelled: true });
      }
    }, true);
    canvas.addEventListener("pointerleave", () => {
      if (!this.activePlaneDrag) this.setHoveredHandle(null);
    }, true);
    window.addEventListener("blur", () => {
      if (this.activePlaneDrag) this.finishPlaneDrag({ cancelled: true });
    });
  }

  setPlaneInteractionEnabled(enabled, reason = "") {
    this.planeInteractionEnabled = Boolean(enabled);
    this.planeInteractionDisabledReason = enabled ? "" : String(reason || "Plane dragging is unavailable until the model is valid.");
    this.renderer.domElement.dataset.planeDraggingEnabled = String(this.planeInteractionEnabled);
    if (!this.planeInteractionEnabled) {
      if (this.activePlaneDrag) this.finishPlaneDrag({ cancelled: true });
      this.setHoveredHandle(null);
    }
  }

  handlePlanePointerDown(event) {
    if (this.activePlaneDrag) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (!this.planeInteractionEnabled || event.isPrimary === false) return;
    if (event.button !== 0 || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
    const handle = this.findDragHandle(event);
    if (!handle) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    const target = handle.target;
    const axis = sceneNormal(target.coefficients).normalize();
    const handlePosition = handle.visual.position.clone();
    const dragMapping = this.createPlaneDragMapping(handlePosition, axis);

    this.activePlaneDrag = {
      pointerId: event.pointerId,
      key: target.key,
      kind: target.kind,
      constraintId: target.constraintId,
      label: target.label,
      fieldLabel: target.fieldLabel,
      coefficients: [...target.coefficients],
      startValue: target.value,
      currentValue: target.value,
      startClientX: event.clientX,
      startClientY: event.clientY,
      screenAxis: dragMapping.screenAxis,
      worldPerPixel: dragMapping.worldPerPixel,
      method: dragMapping.method,
    };
    this.controls.enabled = false;
    this.container.classList.add("is-plane-dragging");
    this.container.classList.remove("is-handle-hovered");
    this.renderer.domElement.dataset.activePlaneDrag = target.key;
    this.renderer.domElement.dataset.planeDragMethod = this.activePlaneDrag.method;
    this.container.focus({ preventScroll: true });
    try {
      this.renderer.domElement.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is an enhancement; window blur and pointer cancellation still clean up.
    }
    this.updateDragReadout(target.label, target.fieldLabel, target.value);
    this.emitPlaneDrag("start", target.value);
    this.setStatus(`Moving ${target.label}. Release to set its ${target.fieldLabel}; press Escape to cancel.`);
    this.syncDragHandlePresentation();
  }

  handlePlanePointerMove(event) {
    const active = this.activePlaneDrag;
    if (!active) {
      if (event.buttons === 0) this.setHoveredHandle(this.planeInteractionEnabled ? this.findDragHandle(event) : null);
      return;
    }
    if (active.pointerId !== event.pointerId) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    this.updatePlaneDragFromPointer(event);
  }

  handlePlanePointerUp(event) {
    if (this.activePlaneDrag?.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.updatePlaneDragFromPointer(event);
    this.finishPlaneDrag({ cancelled: false });
  }

  handlePlanePointerCancel(event) {
    if (this.activePlaneDrag?.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.finishPlaneDrag({ cancelled: true });
  }

  updatePlaneDragFromPointer(event) {
    const active = this.activePlaneDrag;
    if (!active) return;
    let signedOffset = sceneOffsetAfterScreenDrag(
      event.clientX - active.startClientX,
      event.clientY - active.startClientY,
      active.screenAxis,
      active.worldPerPixel,
    );
    signedOffset = THREE.MathUtils.clamp(signedOffset, -this.currentLimit * 6, this.currentLimit * 6);
    const value = roundDragValue(planeValueAfterSceneOffset(active.startValue, active.coefficients, signedOffset));
    if (!Number.isFinite(value) || value === active.currentValue) return;
    active.currentValue = value;
    this.lastPlaneDrag = {
      kind: active.kind,
      constraintId: active.constraintId ?? null,
      value,
      phase: "move",
    };
    this.updateDragReadout(active.label, active.fieldLabel, value);
    this.emitPlaneDrag("move", value);
  }

  finishPlaneDrag({ cancelled }) {
    const active = this.activePlaneDrag;
    if (!active) return;
    const finalValue = cancelled ? active.startValue : active.currentValue;
    try {
      this.emitPlaneDrag(cancelled ? "cancel" : "end", finalValue);
    } finally {
      this.lastPlaneDrag = {
        kind: active.kind,
        constraintId: active.constraintId ?? null,
        value: finalValue,
        phase: cancelled ? "cancel" : "end",
      };
      const pointerId = active.pointerId;
      this.activePlaneDrag = null;
      this.controls.enabled = true;
      this.container.classList.remove("is-plane-dragging");
      this.renderer.domElement.dataset.activePlaneDrag = "";
      this.renderer.domElement.dataset.planeDragMethod = "";
      if (this.readoutElement) {
        this.readoutElement.hidden = true;
        this.readoutElement.textContent = "";
      }
      try {
        if (this.renderer.domElement.hasPointerCapture(pointerId)) {
          this.renderer.domElement.releasePointerCapture(pointerId);
        }
      } catch {
        // The browser can release capture first during cancellation.
      }
      this.setStatus(cancelled
        ? `${active.label} movement cancelled; ${active.fieldLabel} remains ${active.startValue}.`
        : `${active.label} ${active.fieldLabel} set to ${finalValue}.`);
      this.syncDragHandlePresentation();
    }
  }

  emitPlaneDrag(phase, value) {
    const active = this.activePlaneDrag;
    if (!active || !this.onPlaneDrag) return;
    this.onPlaneDrag({
      kind: active.kind,
      constraintId: active.constraintId ?? null,
      value,
      phase,
      label: active.label,
      fieldLabel: active.fieldLabel,
    });
  }

  updateDragReadout(label, fieldLabel, value) {
    if (!this.readoutElement) return;
    this.readoutElement.hidden = false;
    this.readoutElement.textContent = `${label} ${fieldLabel}: ${value}`;
  }

  createPlaneDragMapping(handlePosition, axis) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const canvasHeight = Math.max(1, rect.height);
    const cameraDistance = Math.max(0.1, this.camera.position.distanceTo(handlePosition));
    const fallbackWorldPerPixel = (2 * cameraDistance * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))) / canvasHeight;
    const maximumWorldPerPixel = fallbackWorldPerPixel * MAX_DRAG_PIXEL_WORLD_FACTOR;
    const sampleDistance = Math.max(0.5, Math.min(this.currentLimit * 0.16, 2.5));
    const start = this.projectWorldPosition(handlePosition);
    const end = this.projectWorldPosition(handlePosition.clone().addScaledVector(axis, sampleDistance));
    const deltaX = end.x - start.x;
    const deltaY = end.y - start.y;
    const pixelLength = Math.hypot(deltaX, deltaY);

    if (Number.isFinite(pixelLength) && pixelLength >= MIN_PROJECTED_AXIS_PIXELS) {
      return {
        screenAxis: [deltaX / pixelLength, deltaY / pixelLength],
        worldPerPixel: Math.min(sampleDistance / pixelLength, maximumWorldPerPixel),
        method: "projected-plane-normal",
      };
    }
    return {
      screenAxis: [0, -1],
      worldPerPixel: maximumWorldPerPixel,
      method: "screen-vertical-fallback",
    };
  }

  findDragHandle(event) {
    if (!this.dragHandles.length) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const pointerX = event.clientX - rect.left;
    const pointerY = event.clientY - rect.top;
    const hitRadius = event.pointerType === "touch" ? HANDLE_TOUCH_RADIUS : HANDLE_MOUSE_RADIUS;
    let match = null;
    for (const handle of this.dragHandles) {
      const projected = this.projectDragHandle(handle);
      if (!projected.visible) continue;
      const distance = Math.hypot(projected.x - pointerX, projected.y - pointerY);
      if (distance <= hitRadius && (!match || distance < match.distance)) {
        match = { ...handle, distance };
      }
    }
    return match;
  }

  setHoveredHandle(handle) {
    const nextKey = handle?.target?.key ?? null;
    if (nextKey === this.hoveredHandleKey) return;
    const hadHover = Boolean(this.hoveredHandleKey);
    this.hoveredHandleKey = nextKey;
    this.container.classList.toggle("is-handle-hovered", Boolean(nextKey));
    this.renderer.domElement.dataset.hoveredDragTarget = nextKey ?? "";
    if (handle) {
      this.setStatus(`${handle.target.label} handle. Drag to change its ${handle.target.fieldLabel}; use the editor for precise entry.`);
    } else if (hadHover && !this.activePlaneDrag) {
      this.setStatus("3D view ready.");
    }
    this.syncDragHandlePresentation();
  }

  projectDragHandle(handle) {
    return this.projectWorldPosition(handle.visual.position);
  }

  projectWorldPosition(position) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const projected = position.clone().project(this.camera);
    return {
      x: (projected.x * 0.5 + 0.5) * rect.width,
      y: (-projected.y * 0.5 + 0.5) * rect.height,
      depth: projected.z,
      visible: projected.z >= -1 && projected.z <= 1 && projected.x >= -1.05 && projected.x <= 1.05 && projected.y >= -1.05 && projected.y <= 1.05,
    };
  }

  syncDragHandlePresentation() {
    if (!this.renderer?.domElement) return;
    const canvasRect = this.renderer.domElement.getBoundingClientRect();
    const canvasHeight = Math.max(1, canvasRect.height);
    const activeKey = this.activePlaneDrag?.key ?? null;
    const debugHandles = [];
    for (const handle of this.dragHandles) {
      const cameraPoint = handle.visual.position.clone().applyMatrix4(this.camera.matrixWorldInverse);
      const depth = Math.max(0.1, -cameraPoint.z);
      const worldPerPixel = (2 * depth * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))) / canvasHeight;
      const selected = handle.target.key === activeKey || handle.target.key === this.hoveredHandleKey;
      const radiusPixels = (handle.target.kind === "objective" ? 11 : 9) * (selected ? 1.18 : 1);
      handle.visual.scale.setScalar(worldPerPixel * radiusPixels);
      if ("emissiveIntensity" in handle.visual.material) {
        handle.visual.material.emissiveIntensity = selected ? 0.48 : 0.2;
      }
      const projected = this.projectDragHandle(handle);
      debugHandles.push({
        kind: handle.target.kind,
        constraintId: handle.target.constraintId ?? null,
        label: handle.target.label,
        value: handle.target.value,
        x: Number(projected.x.toFixed(2)),
        y: Number(projected.y.toFixed(2)),
        visible: projected.visible,
        hitRadius: HANDLE_MOUSE_RADIUS,
        touchHitRadius: HANDLE_TOUCH_RADIUS,
      });
    }
    this.renderer.domElement.dataset.dragHandleCount = String(this.dragHandles.length);
    this.renderer.domElement.dataset.dragHandles = JSON.stringify(debugHandles);
    this.renderer.domElement.dataset.activePlaneDrag = activeKey ?? "";
    this.renderer.domElement.dataset.hoveredDragTarget = this.hoveredHandleKey ?? "";
    this.renderer.domElement.dataset.planeDraggingEnabled = String(this.planeInteractionEnabled);
    this.renderer.domElement.dataset.lastPlaneDrag = this.lastPlaneDrag ? JSON.stringify(this.lastPlaneDrag) : "";
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
    this.syncDragHandlePresentation();
  }

  clearModel() {
    this.scene.remove(this.modelGroup);
    disposeObject(this.modelGroup);
    this.modelGroup = new THREE.Group();
    this.scene.add(this.modelGroup);
    this.dragHandles = [];
  }

  render(analysis, model) {
    this.clearModel();
    this.currentLimit = Math.max(4, analysis.viewLimit || 10);
    const displayPoints = analysis.displayPolyhedron?.vertices ?? analysis.vertices ?? [];
    this.currentTarget = analysis.feasiblePoint ?? centroid(displayPoints);

    this.addAxes();
    this.addConstraintPlanes(analysis.constraints ?? [], this.currentTarget);
    this.addConstraintDragHandles(model.constraints ?? [], this.currentTarget);
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
      `Interactive three-dimensional linear programming graph showing a ${outcome} Drag a colored round handle to move a constraint plane, or the gold diamond handle to move the objective plane. Drag elsewhere to rotate; use the editor fields for precise or keyboard entry.`,
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
    this.syncDragHandlePresentation();
    if (!this.activePlaneDrag) this.setStatus("3D view ready.");
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

  addConstraintDragHandles(constraints, referencePoint) {
    constraints.forEach((constraint, index) => {
      if (constraint.enabled === false) return;
      const coefficients = Array.isArray(constraint.coefficients)
        ? constraint.coefficients.map(Number)
        : [constraint.a, constraint.b, constraint.c].map(Number);
      const rhs = Number(constraint.rhs);
      if (!coefficients.every(Number.isFinite) || !Number.isFinite(rhs) || vectorLength(coefficients) <= 1e-10) return;
      const anchorMath = projectPointToPlane(referencePoint, coefficients, rhs);
      this.addPlaneDragHandle({
        kind: "constraint",
        constraintId: String(constraint.id ?? `constraint-${index + 1}`),
        label: String(constraint.name || `Constraint ${index + 1}`),
        fieldLabel: "right side",
        coefficients,
        value: rhs,
        anchor: mathToScene(anchorMath),
        color: colorForConstraint(constraint, index),
        offsetIndex: index,
      });
    });
  }

  addPlaneDragHandle({
    kind,
    constraintId = null,
    label,
    fieldLabel,
    coefficients,
    value,
    anchor,
    color,
    offsetIndex,
  }) {
    const normal = sceneNormal(coefficients).normalize();
    const offsetDistance = Math.max(0.7, Math.min(this.currentLimit, 12) * (kind === "objective" ? 0.2 : 0.24));
    const position = anchor.clone().add(inPlaneOffset(normal, offsetIndex, offsetDistance));
    const geometry = kind === "objective"
      ? new THREE.OctahedronGeometry(1, 0)
      : new THREE.SphereGeometry(1, 20, 14);
    const material = new THREE.MeshStandardMaterial({
      color,
      emissive: color.clone().multiplyScalar(kind === "objective" ? 0.3 : 0.18),
      emissiveIntensity: 0.2,
      roughness: 0.28,
      metalness: kind === "objective" ? 0.18 : 0.06,
      depthTest: false,
      depthWrite: false,
    });
    const visual = new THREE.Mesh(geometry, material);
    visual.position.copy(position);
    visual.renderOrder = 40;
    visual.userData.rendererRole = kind === "objective" ? "objective-drag-handle" : "constraint-drag-handle";
    this.modelGroup.add(visual);

    const stemLength = Math.max(0.7, Math.min(this.currentLimit, 12) * 0.13);
    const stemGeometry = new THREE.BufferGeometry().setFromPoints([
      position.clone().addScaledVector(normal, -stemLength),
      position.clone().addScaledVector(normal, stemLength),
    ]);
    const stem = new THREE.Line(stemGeometry, new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0.92,
      depthTest: false,
      depthWrite: false,
    }));
    stem.renderOrder = 39;
    stem.userData.rendererRole = kind === "objective" ? "objective-drag-axis" : "constraint-drag-axis";
    this.modelGroup.add(stem);

    const key = dragTargetKey(kind, constraintId);
    this.dragHandles.push({
      visual,
      target: {
        key,
        kind,
        constraintId,
        label,
        fieldLabel,
        coefficients: [...coefficients],
        value,
      },
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

    this.addPlaneDragHandle({
      kind: "objective",
      label: "Objective plane",
      fieldLabel: "level",
      coefficients,
      value: objective.level,
      anchor,
      color: new THREE.Color(0xf5a623),
      offsetIndex: 7,
    });
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
      handles: this.dragHandles.map((handle) => ({
        kind: handle.target.kind,
        constraintId: handle.target.constraintId ?? null,
        label: handle.target.label,
        value: handle.target.value,
        worldPosition: handle.visual.position.toArray(),
        screenPosition: (() => {
          const projected = this.projectDragHandle(handle);
          return [projected.x, projected.y];
        })(),
      })),
      activePlaneDrag: this.activePlaneDrag ? {
        kind: this.activePlaneDrag.kind,
        constraintId: this.activePlaneDrag.constraintId ?? null,
        value: this.activePlaneDrag.currentValue,
        method: this.activePlaneDrag.method,
      } : null,
      lastPlaneDrag: this.lastPlaneDrag ? { ...this.lastPlaneDrag } : null,
      planeInteractionEnabled: this.planeInteractionEnabled,
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
