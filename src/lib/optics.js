// Analytic ray optics for a solid triangular glass prism.
// All vectors are plain [x, y, z] arrays. Units are loosely centimetres.

const DEG = Math.PI / 180;

export const PRISM = {
  R: 1.18, // circumradius of the triangular cross-section
  thickness: 1.55,
  center: [1.2, 0.1, 0],
  // Triangle in the XY plane, apex up, extruded along Z.
  tri: [
    [0, 1.18],
    [-1.18 * Math.sqrt(3) / 2, -0.59],
    [1.18 * Math.sqrt(3) / 2, -0.59],
  ],
};

// A dense optical flint: nd 1.75, Abbe number 35. Cauchy dispersion.
export const GLASS = {
  cauchy: [1.7175, 0.01122],
  // Beer-Lambert absorption per world unit, per channel.
  absorption: [0.045, 0.012, 0.032],
};

export const EMITTER = [-2.95, -1.82, 0];
export const BEAM_DEFAULT = { azimuth: 31 * DEG, elevation: 0 };

export const CAMERA = {
  fov: 30,
  pos: [2.85, 1.85, 8.9],
  target: [0.55, 0.05, 0],
};

export const prismFaces = PRISM.tri.map((a, i) => {
  const b = PRISM.tri[(i + 1) % 3];
  const ex = b[0] - a[0];
  const ey = b[1] - a[1];
  let nx = ey;
  let ny = -ex;
  const len = Math.hypot(nx, ny);
  nx /= len;
  ny /= len;
  let d = nx * a[0] + ny * a[1];
  if (d < 0) {
    nx = -nx;
    ny = -ny;
    d = -d;
  }
  return { n: [nx, ny, 0], d };
});

const HALF_T = PRISM.thickness / 2;
export const prismPlanesLocal = [
  ...prismFaces,
  { n: [0, 0, 1], d: HALF_T },
  { n: [0, 0, -1], d: HALF_T },
];

// Local corner positions: six vertices of the closed solid.
export const prismCornersLocal = [];
for (const z of [-HALF_T, HALF_T]) {
  for (const [x, y] of PRISM.tri) prismCornersLocal.push([x, y, z]);
}

export function rotationY(yaw) {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [
    [c, 0, s],
    [0, 1, 0],
    [-s, 0, c],
  ];
}

export function applyMat3(m, v) {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}

// World-space planes for a prism turned by yaw.
export function prismPlanes(yaw) {
  const rot = rotationY(yaw);
  const c = PRISM.center;
  return prismPlanesLocal.map(({ n, d }) => {
    const nw = applyMat3(rot, n);
    return {
      n: nw,
      d: d + nw[0] * c[0] + nw[1] * c[1] + nw[2] * c[2],
    };
  });
}

export function prismCorners(yaw) {
  const rot = rotationY(yaw);
  const c = PRISM.center;
  return prismCornersLocal.map((v) => {
    const w = applyMat3(rot, v);
    return [w[0] + c[0], w[1] + c[1], w[2] + c[2]];
  });
}

export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a, b) => [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
export const normalize = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
export const reflect = (d, n) => sub(d, scale(n, 2 * dot(d, n)));
export const lerp3 = (a, b, t) => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

export function refract(d, n, eta) {
  const cosi = -dot(d, n);
  const k = 1 - eta * eta * (1 - cosi * cosi);
  if (k < 0) return null;
  return normalize(add(scale(d, eta), scale(n, eta * cosi - Math.sqrt(k))));
}

// Unpolarised Fresnel reflectance for a dielectric interface.
export function fresnel(cosi, n1, n2) {
  const eta = n1 / n2;
  const sint2 = eta * eta * (1 - cosi * cosi);
  if (sint2 >= 1) return 1;
  const cost = Math.sqrt(1 - sint2);
  const rs = (n1 * cosi - n2 * cost) / (n1 * cosi + n2 * cost);
  const rp = (n1 * cost - n2 * cosi) / (n1 * cost + n2 * cosi);
  return (rs * rs + rp * rp) * 0.5;
}

// Cauchy dispersion, wavelength in nanometres.
export function glassIOR(nm) {
  const l2 = (nm / 1000) ** 2;
  return GLASS.cauchy[0] + GLASS.cauchy[1] / l2;
}

export function intersectPrism(planes, ro, rd) {
  let t0 = -Infinity;
  let t1 = Infinity;
  let n0 = null;
  for (const p of planes) {
    const denom = dot(p.n, rd);
    const t = (p.d - dot(p.n, ro)) / denom;
    if (denom < 0) {
      if (t > t0) {
        t0 = t;
        n0 = p.n;
      }
    } else if (denom > 0) {
      if (t < t1) t1 = t;
    }
  }
  if (!n0 || t1 < Math.max(t0, 0)) return null;
  return { t0, t1, n0 };
}

function nextFace(planes, p, d) {
  let best = null;
  for (const pl of planes) {
    const denom = dot(pl.n, d);
    if (denom > 1e-7) {
      const t = (pl.d - dot(pl.n, p)) / denom;
      if (t > 1e-5 && (!best || t < best.t)) best = { t, n: pl.n };
    }
  }
  return best;
}

// Wyman/Sloan/Shirley analytic fit of the CIE 1931 observer.
function cmf(nm) {
  const g = (x, mu, s1, s2) => {
    const t = (x - mu) / (x < mu ? s1 : s2);
    return Math.exp(-0.5 * t * t);
  };
  const x =
    1.056 * g(nm, 599.8, 37.9, 31.0) +
    0.362 * g(nm, 442.0, 16.0, 26.7) -
    0.065 * g(nm, 501.1, 20.4, 26.2);
  const y = 0.821 * g(nm, 568.8, 46.9, 40.5) + 0.286 * g(nm, 530.9, 16.3, 31.1);
  const z = 1.217 * g(nm, 437.0, 11.8, 36.0) + 0.681 * g(nm, 459.0, 26.0, 13.8);
  return [x, y, z];
}

// Linear sRGB, channel balance normalised so the whole spectrum sums to white.
export function spectralSamples(count = 64) {
  const samples = [];
  for (let i = 0; i < count; i++) {
    const nm = 400 + (300 * i) / (count - 1);
    const [X, Y, Z] = cmf(nm);
    const r = Math.max(0, 3.2406 * X - 1.5372 * Y - 0.4986 * Z);
    const g = Math.max(0, -0.9689 * X + 1.8758 * Y + 0.0415 * Z);
    const b = Math.max(0, 0.0557 * X - 0.204 * Y + 1.057 * Z);
    samples.push({ nm, rgb: [r, g, b], ior: glassIOR(nm) });
  }
  const total = [0, 0, 0];
  for (const s of samples) for (let c = 0; c < 3; c++) total[c] += s.rgb[c];
  for (const s of samples) {
    s.rgb = s.rgb.map((v, c) => v / total[c]);
    s.luminance = 0.2126 * s.rgb[0] + 0.7152 * s.rgb[1] + 0.0722 * s.rgb[2];
  }
  return samples;
}

export function beamDirection(azimuth, elevation) {
  const ce = Math.cos(elevation);
  return [Math.cos(azimuth) * ce, Math.sin(azimuth) * ce, Math.sin(elevation)];
}

const FAR = 26;

// Trace the visible beam: the incident white ray plus one path per wavelength.
export function traceBeam({ yaw, emitter, direction, samples, maxBounces = 5 }) {
  const planes = prismPlanes(yaw);
  const hit = intersectPrism(planes, emitter, direction);
  const incoming = {
    a: emitter,
    b: hit ? add(emitter, scale(direction, hit.t0)) : add(emitter, scale(direction, FAR)),
    hit: Boolean(hit),
  };
  if (!hit) return { incoming, paths: [] };

  const entry = add(emitter, scale(direction, hit.t0));
  const n0 = hit.n0;
  const cosi = Math.max(0, -dot(direction, n0));
  const paths = [];

  for (const s of samples) {
    const eta = 1 / s.ior;
    let d = refract(direction, n0, eta);
    if (!d) continue;
    let p = entry;
    let inside = 0;
    let intensity = 1 - fresnel(cosi, 1, s.ior);
    const segments = [];
    let escaped = false;

    for (let bounce = 0; bounce <= maxBounces; bounce++) {
      const face = nextFace(planes, p, d);
      if (!face) break;
      const pExit = add(p, scale(d, face.t));
      inside += face.t;
      const cosIn = Math.abs(dot(d, face.n));
      const out = refract(d, scale(face.n, -1), s.ior);
      segments.push({ a: p, b: pExit, internal: true });

      if (!out) {
        // Total internal reflection: keep tracing the reflected path.
        d = reflect(d, face.n);
        p = pExit;
        continue;
      }
      const R = fresnel(cosIn, s.ior, 1);
      intensity *= 1 - R;
      segments.push({ a: pExit, b: add(pExit, scale(out, FAR)), internal: false });
      escaped = true;
      p = pExit;
      d = out;
      break;
    }

    const tint = [0, 0, 0].map((_, c) => Math.exp(-GLASS.absorption[c] * inside));
    paths.push({
      nm: s.nm,
      color: mul(s.rgb, tint),
      intensity,
      segments,
      escaped,
      ior: s.ior,
    });
  }

  // A faint ghost of the beam that reflects inside before leaving.
  return { incoming, paths };
}

export { DEG, FAR };
