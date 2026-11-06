import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import {
  EMITTER, BEAM_DEFAULT, PRISM, CAMERA, GLASS, DEG,
  prismPlanes, prismCorners, traceBeam, spectralSamples, beamDirection,
  add, scale, intersectPrism, glassIOR,
} from '../lib/optics.js';
import { glassVertex, glassFragment } from './glassShader.js';

const MAX_SEGMENTS = 1200;
const SPECTRUM = spectralSamples(72);
const SPECTRAL_BOOST = 2.7;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const easeOutCubic = (t) => 1 - (1 - t) ** 3;
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

function convexHull(points) {
  const pts = points.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length < 3) return pts;
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function projectToNdc(camera, p) {
  const v = new THREE.Vector3(p[0], p[1], p[2]).project(camera);
  return new THREE.Vector2(v.x, v.y);
}

function screenRay(camera, nx, ny) {
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
  const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
  const fwd = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 2).negate();
  const tanHalfY = Math.tan((camera.fov * DEG) / 2);
  const dir = fwd
    .addScaledVector(right, nx * tanHalfY * camera.aspect)
    .addScaledVector(up, ny * tanHalfY)
    .normalize();
  return { origin: camera.position.toArray(), dir: dir.toArray() };
}

function segmentDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = clamp(t, 0, 1);
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

const IOR_R = glassIOR(630);
const IOR_G = glassIOR(550);
const IOR_B = glassIOR(462);

export class PrismExperience {
  constructor(container, options = {}) {
    this.container = container;
    this.introEnabled = options.intro !== false;
    this.onHintChange = options.onHintChange || (() => {});
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    this.width = 1;
    this.height = 1;
    this.aspect = 1;
    this.layout = null;
    this.yaw = 0;
    this.beam = { azimuth: BEAM_DEFAULT.azimuth, elevation: BEAM_DEFAULT.elevation };
    this.beamLevel = 0;
    this.reveal = 0;
    this.exposure = 1;
    this.hover = { prism: 0, beam: 0 };
    this.hoverTarget = { prism: 0, beam: 0 };
    this.drag = null;
    this.pointerType = 'mouse';
    this.parallax = { x: 0, y: 0, tx: 0, ty: 0 };
    this.intro = null;
    this.settle = null;
    this.dirty = true;
    this.visible = true;
    this.hintShown = false;
    this.hintDismissed = false;
    this.trace = null;
    this.disposed = false;
    this.cameraBase = new THREE.Vector3();

    this.initRenderer();
    this.initInteraction();
    this.resize();
    this.startIntro();
    this.loop = this.loop.bind(this);
    if (typeof window !== 'undefined') window.__prism = this;
    this.raf = requestAnimationFrame(this.loop);
  }

  // -------------------------------------------------------------------------
  // Setup
  // -------------------------------------------------------------------------

  initRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(0x04050a, 1);
    this.canvas = this.renderer.domElement;
    this.canvas.className = 'prism-canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.container.appendChild(this.canvas);

    this.camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, 0.1, 120);
    this.scene = new THREE.Scene();
    this.glassCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this.uniforms = {
      uRes: { value: new THREE.Vector2(1, 1) },
      uCamPos: { value: new THREE.Vector3() },
      uCamRight: { value: new THREE.Vector3() },
      uCamUp: { value: new THREE.Vector3() },
      uCamFwd: { value: new THREE.Vector3() },
      uTan: { value: new THREE.Vector2(1, 1) },
      uCenter: { value: new THREE.Vector3(...PRISM.center) },
      uRot: { value: new THREE.Matrix3() },
      uIor: { value: new THREE.Vector3(IOR_R, IOR_G, IOR_B) },
      uAbsorb: { value: new THREE.Vector3(...GLASS.absorption) },
      uP0: { value: new THREE.Vector4() },
      uP1: { value: new THREE.Vector4() },
      uP2: { value: new THREE.Vector4() },
      uP3: { value: new THREE.Vector4() },
      uP4: { value: new THREE.Vector4() },
      uV0: { value: new THREE.Vector3() },
      uV1: { value: new THREE.Vector3() },
      uV2: { value: new THREE.Vector3() },
      uV3: { value: new THREE.Vector3() },
      uV4: { value: new THREE.Vector3() },
      uV5: { value: new THREE.Vector3() },
      uH0: { value: new THREE.Vector2() },
      uH1: { value: new THREE.Vector2() },
      uH2: { value: new THREE.Vector2() },
      uH3: { value: new THREE.Vector2() },
      uH4: { value: new THREE.Vector2() },
      uH5: { value: new THREE.Vector2() },
      uReveal: { value: 1 },
      uHover: { value: 0 },
      uInnerA: { value: new THREE.Vector3() },
      uInnerB: { value: new THREE.Vector3() },
      uInnerTint: { value: new THREE.Vector3(1, 0.98, 0.96) },
      uInnerI: { value: 0 },
    };

    const glassMaterial = new THREE.ShaderMaterial({
      vertexShader: glassVertex,
      fragmentShader: glassFragment,
      uniforms: this.uniforms,
      depthTest: false,
      depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), glassMaterial);
    quad.frustumCulled = false;
    quad.renderOrder = 0;
    this.scene.add(quad);

    this.initBeamMeshes();
    this.initComposer();
  }

  initBeamMeshes() {
    const geometry = new THREE.BufferGeometry();
    const verts = MAX_SEGMENTS * 4;
    this.beamA = new Float32Array(verts * 3);
    this.beamB = new Float32Array(verts * 3);
    this.beamT = new Float32Array(verts);
    this.beamSide = new Float32Array(verts);
    this.beamColor = new Float32Array(verts * 3);
    this.beamInt = new Float32Array(verts);

    geometry.setAttribute('aA', new THREE.BufferAttribute(this.beamA, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('aB', new THREE.BufferAttribute(this.beamB, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('aT', new THREE.BufferAttribute(this.beamT, 1).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('aSide', new THREE.BufferAttribute(this.beamSide, 1).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(this.beamColor, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('aIntensity', new THREE.BufferAttribute(this.beamInt, 1).setUsage(THREE.DynamicDrawUsage));
    const index = new Uint32Array(MAX_SEGMENTS * 6);
    for (let s = 0; s < MAX_SEGMENTS; s++) {
      const v = s * 4;
      const o = s * 6;
      index[o] = v;
      index[o + 1] = v + 1;
      index[o + 2] = v + 2;
      index[o + 3] = v + 2;
      index[o + 4] = v + 1;
      index[o + 5] = v + 3;
    }
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
    geometry.setDrawRange(0, 0);
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1e4);
    this.beamGeometry = geometry;

    const vertex = /* glsl */ `
      uniform vec2 uRes;
      uniform float uWidth;
      attribute vec3 aA;
      attribute vec3 aB;
      attribute float aT;
      attribute float aSide;
      attribute vec3 aColor;
      attribute float aIntensity;
      varying float vSide;
      varying vec3 vColor;
      varying float vIntensity;
      void main() {
        vec4 ca = projectionMatrix * viewMatrix * vec4(aA, 1.0);
        vec4 cb = projectionMatrix * viewMatrix * vec4(aB, 1.0);
        vec2 sa = ca.xy / max(ca.w, 1e-4) * 0.5 * uRes;
        vec2 sb = cb.xy / max(cb.w, 1e-4) * 0.5 * uRes;
        vec2 dir = sb - sa;
        float len = length(dir);
        dir = len < 1e-3 ? vec2(1.0, 0.0) : dir / len;
        vec2 nrm = vec2(-dir.y, dir.x);
        vec2 pos = mix(sa, sb, aT) + nrm * aSide * uWidth;
        vec4 base = mix(ca, cb, aT);
        base.xy = pos / (0.5 * uRes) * base.w;
        gl_Position = base;
        vSide = aSide;
        vColor = aColor;
        vIntensity = aIntensity;
      }
    `;
    const fragment = /* glsl */ `
      precision highp float;
      uniform float uGain;
      uniform float uFalloff;
      uniform float uLevel;
      varying float vSide;
      varying vec3 vColor;
      varying float vIntensity;
      void main() {
        float x = abs(vSide);
        float profile = exp(-x * x * uFalloff) * (1.0 - smoothstep(0.86, 1.0, x));
        gl_FragColor = vec4(vColor * (vIntensity * uGain * uLevel * profile), 1.0);
      }
    `;

    this.beamGlowMat = new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: {
        uRes: { value: new THREE.Vector2(1, 1) },
        uWidth: { value: 11 },
        uGain: { value: 0.06 },
        uFalloff: { value: 2.0 },
        uLevel: { value: 0 },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    this.beamCoreMat = new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: {
        uRes: { value: new THREE.Vector2(1, 1) },
        uWidth: { value: 1.6 },
        uGain: { value: 1.15 },
        uFalloff: { value: 4.0 },
        uLevel: { value: 0 },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });

    const glow = new THREE.Mesh(geometry, this.beamGlowMat);
    const core = new THREE.Mesh(geometry, this.beamCoreMat);
    glow.frustumCulled = false;
    core.frustumCulled = false;
    glow.renderOrder = 1;
    core.renderOrder = 2;
    this.scene.add(glow, core);

    this.emitterUniforms = {
      uIntensity: { value: 1 },
      uHover: { value: 0 },
      uColor: { value: new THREE.Vector3(0.82, 0.91, 1.0) },
    };
    const emitterMat = new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform float uIntensity;
        uniform float uHover;
        uniform vec3 uColor;
        varying vec2 vUv;
        void main() {
          vec2 p = (vUv - 0.5) * 2.0;
          float r2 = dot(p, p);
          float core = exp(-r2 * 520.0) * 3.2;
          float halo = exp(-r2 * 90.0) * 0.35;
          float wide = exp(-r2 * 16.0) * 0.035;
          float a = (core + halo + wide) * uIntensity * (1.0 + uHover * 0.7);
          gl_FragColor = vec4(uColor * a, 1.0);
        }
      `,
      uniforms: this.emitterUniforms,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.emitterMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.7), emitterMat);
    this.emitterMesh.frustumCulled = false;
    this.emitterMesh.renderOrder = 0;
    this.scene.add(this.emitterMesh);
  }

  initComposer() {
    const target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      samples: 4,
    });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.setPixelRatio(this.pixelRatio());
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.30, 0.28, 1.4);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.composer.setSize(this.width, this.height);
  }

  pixelRatio() {
    const dpr = window.devicePixelRatio || 1;
    const area = this.width * this.height;
    const pr = Math.min(dpr, 1.85, Math.sqrt(3.4e6 / Math.max(area, 1)));
    return Math.max(0.8, pr);
  }

  // -------------------------------------------------------------------------
  // Layout / camera
  // -------------------------------------------------------------------------

  computeLayout() {
    const aspect = this.aspect;
    const fov = aspect < 0.95 ? 36 : CAMERA.fov;
    const target = new THREE.Vector3();
    let dist;
    let az;
    let el;
    let roll = 0;

    if (aspect < 0.95) {
      target.set(0.95, 0.30, 0);
      dist = 11.6;
      az = 15 * DEG;
      el = 11 * DEG;
      roll = -28 * DEG;
    } else {
      target.set(0.35, 0.3, 0);
      dist = 9.35;
      az = 14.6 * DEG;
      el = 11 * DEG;
      const tanHalfY = Math.tan((fov * DEG) / 2);
      const halfWidth = dist * tanHalfY * aspect;
      const needed = 3.55;
      if (halfWidth < needed) dist *= needed / halfWidth;
    }

    this.camera.fov = fov;
    this.camera.aspect = aspect;
    this.camera.up.set(Math.sin(roll), Math.cos(roll), 0);
    this.camera.position.set(
      target.x + Math.sin(az) * Math.cos(el) * dist,
      target.y + Math.sin(el) * dist,
      target.z + Math.cos(az) * Math.cos(el) * dist,
    );
    this.camera.lookAt(target);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld(true);
    this.cameraBase.copy(this.camera.position);

    const desktopEmitter = [...EMITTER];
    const dir = beamDirection(BEAM_DEFAULT.azimuth, BEAM_DEFAULT.elevation);
    const hit = intersectPrism(prismPlanes(0), desktopEmitter, dir);
    const entry = hit ? add(desktopEmitter, scale(dir, hit.t0)) : desktopEmitter;
    this.layout = {
      portrait: aspect < 0.95,
      emitter: aspect < 0.95 ? add(entry, scale(dir, -1.0)) : desktopEmitter,
      roll,
    };
    this.parallax = { x: 0, y: 0, tx: 0, ty: 0 };
  }

  // -------------------------------------------------------------------------
  // Beam
  // -------------------------------------------------------------------------

  rebuildBeam() {
    const dir = beamDirection(this.beam.azimuth, this.beam.elevation);
    const trace = traceBeam({
      yaw: this.yaw,
      emitter: this.layout.emitter,
      direction: dir,
      samples: SPECTRUM,
    });
    this.trace = trace;

    let s = 0;
    const push = (a, b, color, intensity) => {
      if (s >= MAX_SEGMENTS) return;
      const base = s * 4;
      for (let k = 0; k < 4; k++) {
        const v = base + k;
        this.beamA[v * 3] = a[0];
        this.beamA[v * 3 + 1] = a[1];
        this.beamA[v * 3 + 2] = a[2];
        this.beamB[v * 3] = b[0];
        this.beamB[v * 3 + 1] = b[1];
        this.beamB[v * 3 + 2] = b[2];
        this.beamT[v] = k < 2 ? 0 : 1;
        this.beamSide[v] = k % 2 === 0 ? -1 : 1;
        this.beamColor[v * 3] = color[0];
        this.beamColor[v * 3 + 1] = color[1];
        this.beamColor[v * 3 + 2] = color[2];
        this.beamInt[v] = intensity;
      }
      s++;
    };

    if (trace.incoming) {
      push(trace.incoming.a, trace.incoming.b, [1.0, 1.0, 1.02], 1.9);
    }
    for (const path of trace.paths) {
      for (const seg of path.segments) {
        push(seg.a, seg.b, path.color, path.intensity * SPECTRAL_BOOST);
      }
    }

    for (const name of ['aA', 'aB', 'aT', 'aSide', 'aColor', 'aIntensity']) {
      this.beamGeometry.attributes[name].needsUpdate = true;
    }
    this.beamGeometry.setDrawRange(0, s * 6);

    const mid = trace.paths.length ? trace.paths[Math.floor(trace.paths.length / 2)] : null;
    const inner = mid && mid.segments.find((q) => q.internal);
    this.hasInner = Boolean(inner);
    if (inner) {
      this.uniforms.uInnerA.value.set(...inner.a);
      this.uniforms.uInnerB.value.set(...inner.b);
    }

    this.dirty = true;
  }

  // -------------------------------------------------------------------------
  // Interaction
  // -------------------------------------------------------------------------

  initInteraction() {
    this.boundMove = (e) => this.onPointerMove(e);
    this.boundDown = (e) => this.onPointerDown(e);
    this.boundUp = (e) => this.onPointerUp(e);
    this.boundLeave = () => this.onPointerLeave();
    this.boundTouch = (e) => this.onTouchStart(e);
    this.canvas.addEventListener('pointermove', this.boundMove);
    this.canvas.addEventListener('pointerdown', this.boundDown);
    this.canvas.addEventListener('pointerup', this.boundUp);
    this.canvas.addEventListener('pointercancel', this.boundUp);
    this.canvas.addEventListener('pointerleave', this.boundLeave);
    this.canvas.addEventListener('touchstart', this.boundTouch, { passive: false });

    this.observer = new IntersectionObserver(
      (entries) => { for (const entry of entries) this.visible = entry.isIntersecting; },
      { threshold: 0 },
    );
    this.observer.observe(this.container);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
  }

  onTouchStart(e) {
    if (!e.touches.length) return;
    const touch = e.touches[0];
    if (this.hitTest(touch.clientX, touch.clientY)) e.preventDefault();
  }

  hitTest(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const emitter = this.projectWorld(this.layout.emitter);
    if (Math.hypot(px - emitter.x, py - emitter.y) < 30) return { type: 'beam', px, py };

    const nx = (px / rect.width) * 2 - 1;
    const ny = -((py / rect.height) * 2 - 1);
    const ray = screenRay(this.camera, nx, ny);
    const hit = intersectPrism(prismPlanes(this.yaw), ray.origin, ray.dir);
    if (hit && hit.t0 > 0) return { type: 'prism', px, py };

    if (this.trace && this.trace.incoming) {
      const a = this.projectWorld(this.trace.incoming.a);
      const b = this.projectWorld(this.trace.incoming.b);
      if (segmentDistance(px, py, a.x, a.y, b.x, b.y) < 17) return { type: 'beam', px, py };
    }
    return null;
  }

  projectWorld(p) {
    const v = new THREE.Vector3(p[0], p[1], p[2]).project(this.camera);
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (v.x * 0.5 + 0.5) * rect.width,
      y: (-v.y * 0.5 + 0.5) * rect.height,
    };
  }

  updatePointerFromEvent(e) {
    this.pointerType = e.pointerType || 'mouse';
    if (this.pointerType !== 'mouse') return;
    const rect = this.canvas.getBoundingClientRect();
    this.parallax.tx = clamp((e.clientX - rect.left) / rect.width - 0.5, -0.5, 0.5);
    this.parallax.ty = clamp((e.clientY - rect.top) / rect.height - 0.5, -0.5, 0.5);
  }

  onPointerDown(e) {
    if (this.drag) return;
    const hit = this.hitTest(e.clientX, e.clientY);
    if (!hit) return;
    e.preventDefault();
    this.setPointerCaptureSafe(e.pointerId);
    this.canvas.style.touchAction = 'none';
    this.canvas.style.cursor = 'grabbing';
    this.takeOverIntro();
    this.updatePointerFromEvent(e);

    const rect = this.canvas.getBoundingClientRect();
    this.drag = {
      type: hit.type,
      id: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      yaw: this.yaw,
      azimuth: this.beam.azimuth,
      elevation: this.beam.elevation,
      rect,
    };
    if (hit.type === 'beam') {
      const emitter = this.projectWorld(this.layout.emitter);
      this.drag.angle0 = Math.atan2(this.drag.startY - (emitter.y + rect.top), this.drag.startX - (emitter.x + rect.left));
    }
    this.hideHint();
    this.dirty = true;
  }

  onPointerMove(e) {
    this.updatePointerFromEvent(e);
    if (this.drag) {
      if (e.pointerId !== this.drag.id) return;
      if (this.drag.type === 'prism') {
        const next = this.drag.yaw + ((e.clientX - this.drag.startX) / this.drag.rect.width) * 2.7;
        this.yaw = clamp(next, -0.62, 0.62);
        this.rebuildBeam();
      } else {
        const emitter = this.projectWorld(this.layout.emitter);
        const ex = emitter.x + this.drag.rect.left;
        const ey = emitter.y + this.drag.rect.top;
        const angle = Math.atan2(e.clientY - ey, e.clientX - ex);
        let delta = angle - this.drag.angle0;
        if (delta > Math.PI) delta -= Math.PI * 2;
        if (delta < -Math.PI) delta += Math.PI * 2;
        this.beam.azimuth = clamp(this.drag.azimuth + delta * 0.9, -34 * DEG, 80 * DEG);
        if (e.shiftKey) {
          this.beam.elevation = clamp(this.drag.elevation - (e.clientY - this.drag.startY) * 0.0042, -30 * DEG, 30 * DEG);
        }
        this.rebuildBeam();
      }
      return;
    }

    const hit = this.hitTest(e.clientX, e.clientY);
    this.hoverTarget.prism = hit && hit.type === 'prism' ? 1 : 0;
    this.hoverTarget.beam = hit && hit.type === 'beam' ? 1 : 0;
    const want = hit ? 'grab' : 'default';
    if (this.canvas.style.cursor !== want) this.canvas.style.cursor = want;
    this.dirty = true;
  }

  onPointerUp(e) {
    if (!this.drag || e.pointerId !== this.drag.id) return;
    this.drag = null;
    try { this.canvas.releasePointerCapture(e.pointerId); } catch { /* already freed */ }
    this.canvas.style.touchAction = 'pan-y';
    this.canvas.style.cursor = this.hoverTarget.prism || this.hoverTarget.beam ? 'grab' : 'default';
    this.dirty = true;
  }

  onPointerLeave() {
    if (this.drag) return;
    this.hoverTarget.prism = 0;
    this.hoverTarget.beam = 0;
    this.parallax.tx = 0;
    this.parallax.ty = 0;
    this.canvas.style.cursor = 'default';
    this.dirty = true;
  }

  setPointerCaptureSafe(id) {
    try { this.canvas.setPointerCapture(id); } catch { /* unsupported */ }
  }

  showHintOnce() {
    if (this.hintDismissed || this.hintShown) return;
    this.hintShown = true;
    this.onHintChange('show');
  }

  hideHint() {
    if (!this.hintShown) {
      this.hintDismissed = true;
      return;
    }
    this.hintShown = false;
    this.hintDismissed = true;
    this.onHintChange('hide');
  }

  // -------------------------------------------------------------------------
  // Intro
  // -------------------------------------------------------------------------

  startIntro() {
    if (!this.introEnabled || this.reducedMotion) {
      this.yaw = 0;
      this.reveal = 1;
      this.beamLevel = 1;
      this.exposure = 1;
      this.rebuildBeam();
      this.showHintOnce();
      this.dirty = true;
      return;
    }
    this.yaw = -0.145;
    this.reveal = 0.12;
    this.beamLevel = 0;
    this.exposure = 0.84;
    this.intro = { start: performance.now() + 260, duration: 4050 };
    this.rebuildBeam();
    this.dirty = true;
  }

  takeOverIntro() {
    if (!this.intro) return;
    this.intro = null;
    this.settle = { start: performance.now() };
  }

  // -------------------------------------------------------------------------
  // Frame
  // -------------------------------------------------------------------------

  resize() {
    const rect = this.container.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    if (width === this.width && height === this.height && this.layout) return;
    this.width = width;
    this.height = height;
    this.aspect = width / height;

    const pr = this.pixelRatio();
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(width, height, false);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(width, height);

    this.computeLayout();
    this.uniforms.uRes.value.set(Math.round(width * pr), Math.round(height * pr));
    this.beamGlowMat.uniforms.uRes.value.set(width, height);
    this.beamCoreMat.uniforms.uRes.value.set(width, height);
    this.rebuildBeam();
    this.dirty = true;
  }

  updateCamera(dt) {
    const tx = this.drag || this.reducedMotion || this.pointerType !== 'mouse' ? 0 : this.parallax.tx;
    const ty = this.drag || this.reducedMotion || this.pointerType !== 'mouse' ? 0 : this.parallax.ty;
    const k = 1 - Math.pow(0.0006, dt / 1000);
    const nx = this.parallax.x + (tx - this.parallax.x) * k;
    const ny = this.parallax.y + (ty - this.parallax.y) * k;
    if (Math.abs(nx - this.parallax.x) > 2e-4 || Math.abs(ny - this.parallax.y) > 2e-4) this.dirty = true;
    this.parallax.x = nx;
    this.parallax.y = ny;

    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
    this.camera.position.copy(this.cameraBase)
      .addScaledVector(right, nx * 0.22)
      .addScaledVector(up, ny * 0.15);
    this.camera.updateMatrixWorld(true);
  }

  updateIntro(now) {
    if (this.intro) {
      const t = (now - this.intro.start) / this.intro.duration;
      if (t < 0) {
        this.dirty = true;
        return;
      }
      if (t >= 1) {
        this.intro = null;
        this.yaw = 0;
        this.reveal = 1;
        this.beamLevel = 1;
        this.exposure = 1;
        this.rebuildBeam();
        this.showHintOnce();
        this.dirty = true;
      } else {
        const reveal = smoothstep(0, 0.26, t);
        this.reveal = 0.12 + 0.88 * easeOutCubic(reveal);
        this.beamLevel = smoothstep(0.16, 0.46, t);
        const rot = easeInOutCubic(clamp((t - 0.22) / 0.62, 0, 1));
        const yaw = -0.145 * (1 - rot);
        if (Math.abs(yaw - this.yaw) > 1e-5) {
          this.yaw = yaw;
          this.rebuildBeam();
        }
        this.exposure = 0.84 + 0.16 * easeOutCubic(clamp((t - 0.3) / 0.7, 0, 1));
        this.dirty = true;
      }
    } else if (this.settle) {
      const t = (now - this.settle.start) / 700;
      const k = 1 - Math.pow(0.02, 1 / 60);
      this.reveal += (1 - this.reveal) * k;
      this.beamLevel += (1 - this.beamLevel) * k;
      this.exposure += (1 - this.exposure) * k;
      this.dirty = true;
      if (t >= 1) {
        this.settle = null;
        this.reveal = 1;
        this.beamLevel = 1;
        this.exposure = 1;
        this.rebuildBeam();
        this.showHintOnce();
      }
    }

    const level = this.beamLevel;
    this.beamGlowMat.uniforms.uLevel.value = level;
    this.beamCoreMat.uniforms.uLevel.value = level;
    this.emitterUniforms.uIntensity.value = 0.1 + level * 0.9;
    this.uniforms.uInnerI.value = this.hasInner ? level : 0;
    this.uniforms.uReveal.value = this.reveal;
    this.renderer.toneMappingExposure = this.exposure;
  }

  updateHover() {
    const k = 0.16;
    const p = this.hover.prism + (this.hoverTarget.prism - this.hover.prism) * k;
    const b = this.hover.beam + (this.hoverTarget.beam - this.hover.beam) * k;
    const changed = Math.abs(p - this.hover.prism) > 0.001 || Math.abs(b - this.hover.beam) > 0.001;
    this.hover.prism = p;
    this.hover.beam = b;
    this.emitterUniforms.uHover.value = b;
    this.uniforms.uHover.value = p;
    if (changed) this.dirty = true;
  }

  updateUniforms() {
    const u = this.uniforms;
    const planes = prismPlanes(this.yaw);
    for (let i = 0; i < 5; i++) u[`uP${i}`].value.set(planes[i].n[0], planes[i].n[1], planes[i].n[2], planes[i].d);

    const corners = prismCorners(this.yaw);
    for (let i = 0; i < 6; i++) u[`uV${i}`].value.set(corners[i][0], corners[i][1], corners[i][2]);

    const hull = convexHull(corners.map((c) => projectToNdc(this.camera, c)));
    for (let i = 0; i < 6; i++) {
      const p = hull[i] || hull[0] || new THREE.Vector2();
      u[`uH${i}`].value.copy(p);
    }

    u.uCamPos.value.copy(this.camera.position);
    u.uCamRight.value.setFromMatrixColumn(this.camera.matrixWorld, 0);
    u.uCamUp.value.setFromMatrixColumn(this.camera.matrixWorld, 1);
    u.uCamFwd.value.setFromMatrixColumn(this.camera.matrixWorld, 2).negate();
    const tanHalfY = Math.tan((this.camera.fov * DEG) / 2);
    u.uTan.value.set(tanHalfY * this.camera.aspect, tanHalfY);

    u.uRot.value.set(
      Math.cos(this.yaw), 0, Math.sin(this.yaw),
      0, 1, 0,
      -Math.sin(this.yaw), 0, Math.cos(this.yaw),
    );

    this.emitterMesh.position.set(...this.layout.emitter);
    this.emitterMesh.quaternion.copy(this.camera.quaternion);
  }

  render() {
    this.updateUniforms();
    this.composer.render();
    this.dirty = false;
  }

  loop(now) {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    if (!this.visible || document.hidden) return;

    const time = typeof now === 'number' ? now : performance.now();
    const prev = this._lastTime || time;
    const dt = clamp(time - prev, 1, 64);
    this._lastTime = time;

    this.updateIntro(time);
    this.updateHover();
    this.updateCamera(dt);
    if (this.dirty) this.render();
  }

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    if (this.observer) this.observer.disconnect();
    if (this.resizeObserver) this.resizeObserver.disconnect();
    this.canvas.removeEventListener('pointermove', this.boundMove);
    this.canvas.removeEventListener('pointerdown', this.boundDown);
    this.canvas.removeEventListener('pointerup', this.boundUp);
    this.canvas.removeEventListener('pointercancel', this.boundUp);
    this.canvas.removeEventListener('pointerleave', this.boundLeave);
    this.canvas.removeEventListener('touchstart', this.boundTouch);
    this.beamGeometry.dispose();
    this.beamGlowMat.dispose();
    this.beamCoreMat.dispose();
    this.emitterMesh.geometry.dispose();
    this.emitterMesh.material.dispose();
    this.scene.traverse((obj) => {
      if (obj.isMesh && obj.material && obj.material.uniforms) {
        if (obj.geometry) obj.geometry.dispose();
        obj.material.dispose();
      }
    });
    this.bloom.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    if (this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
  }
}
