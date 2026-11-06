// Sanity checks + layout numbers for the optical model.
import {
  traceBeam, spectralSamples, beamDirection, glassIOR, fresnel, refract,
  prismPlanes, prismCorners, intersectPrism, dot, normalize, add, scale,
  EMITTER, PRISM,
} from '../src/lib/optics.js';

const samples = spectralSamples(64);
const dir = beamDirection(31 * Math.PI / 180, 0);
const t = traceBeam({ yaw: 0, emitter: EMITTER, direction: dir, samples });

console.log('entry', t.incoming.a, '->', t.incoming.b);
const red = t.paths[0], violet = t.paths[t.paths.length - 1];
console.log('n(400)', violet.ior.toFixed(4), 'n(700)', red.ior.toFixed(4));
console.log('internal red', red.segments[0]);
console.log('internal violet', violet.segments[0]);
const outR = normalize(red.segments[1].b.map((v, i) => v - red.segments[1].a[i]));
const outV = normalize(violet.segments[1].b.map((v, i) => v - violet.segments[1].a[i]));
console.log('out red', outR, (Math.atan2(outR[1], outR[0]) * 180 / Math.PI).toFixed(2));
console.log('out violet', outV, (Math.atan2(outV[1], outV[0]) * 180 / Math.PI).toFixed(2));
console.log('deviation spread deg', ((Math.atan2(outR[1], outR[0]) - Math.atan2(outV[1], outV[0])) * 180 / Math.PI).toFixed(2));
console.log('incoming angle', Math.atan2(dir[1], dir[0]) * 180 / Math.PI);
console.log('entry height (local)', (t.incoming.b[1] - PRISM.center[1]).toFixed(3));
console.log('fan exits at', red.segments[1].a);

// projection to screen with the desktop camera
import { CAMERA } from '../src/lib/optics.js';
function project(p, aspect, cam = CAMERA) {
  const [fov, pos, target] = [cam.fov, cam.pos, cam.target];
  const f = normalize([target[0] - pos[0], target[1] - pos[1], target[2] - pos[2]]);
  const r = normalize([-f[2], 0, f[0]]);
  const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  const v = [p[0] - pos[0], p[1] - pos[1], p[2] - pos[2]];
  const z = dot(v, f);
  const x = dot(v, r), y = dot(v, u);
  const th = Math.tan(fov * Math.PI / 360);
  return [x / (z * th * aspect), y / (z * th)];
}
const aspect = 16 / 9;
const corners = prismCorners(0);
const proj = corners.map((c) => project(c, aspect));
console.log('prism screen x range', Math.min(...proj.map((p) => p[0])).toFixed(2), Math.max(...proj.map((p) => p[0])).toFixed(2));
console.log('prism screen y range', Math.min(...proj.map((p) => p[1])).toFixed(2), Math.max(...proj.map((p) => p[1])).toFixed(2));
for (const name of ['emitter', 'entry', 'exit']) {
  const p = name === 'emitter' ? EMITTER : name === 'entry' ? t.incoming.b : red.segments[1].a;
  console.log(name, 'screen', project(p, aspect).map((v) => v.toFixed(2)));
}
for (const f of [0.4, 0.7, 1.0]) {
  // where the local fan sits at fractional screen width? approximate along the outgoing ray
  const a = red.segments[1].a, b = red.segments[1].b;
  const p = add(a, scale([b[0] - a[0], b[1] - a[1], b[2] - a[2]], f));
  console.log('fan at', f, project(p, aspect).map((v) => v.toFixed(2)));
}

// checks
const n = glassIOR(587.6);
console.log('n_d', n.toFixed(4));
let ok = true;
if (Math.abs(n - 1.75) > 0.01) { console.log('IOR mismatch'); ok = false; }
if (dot(t.incoming.b, [0, 0, 1]) !== 0) { /* entry z */ }
const inHit = intersectPrism(prismPlanes(0), EMITTER, dir);
const cosi = -dot(dir, inHit.n0);
const insideDir = refract(dir, inHit.n0, 1 / glassIOR(550));
const sinRatio = Math.sin(Math.acos(cosi)) / Math.sin(Math.acos(-dot(insideDir, inHit.n0)));
console.log('snell ratio', sinRatio.toFixed(4), 'expected', glassIOR(550).toFixed(4));
if (Math.abs(sinRatio - glassIOR(550)) > 1e-6) { console.log('snell fail'); ok = false; }
if (Math.abs(t.paths[0].segments[1] && t.incoming.b[1] - (red.segments[0].a[1])) > 1e-9) { /* noop */ }
// internal straight line at constant y for yaw 0
if (Math.abs(red.segments[0].a[1] - red.segments[0].b[1]) > 1e-9) { console.log('not horizontal'); ok = false; }
// TIR: a ray inside, aimed near-parallel to a face
const pl = prismPlanes(0);
const p0 = [1.2, 0.1, 0];
const grazing = beamDirection(40 * Math.PI / 180, 0);
const inside = intersectPrism(pl, [p0[0] - grazing[0] * 0.4, p0[1] - grazing[1] * 0.4, 0], grazing);
console.log('TIR probe hit', Boolean(inside));
if (!ok) process.exitCode = 1;
