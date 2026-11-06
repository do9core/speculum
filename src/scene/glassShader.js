// Fullscreen pass: environment, solid glass prism and its internal optics.
// Every visible ray is intersected analytically with the five prism planes.

export const glassVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const glassFragment = /* glsl */ `
precision highp float;

varying vec2 vUv;

uniform vec2  uRes;
uniform vec3  uCamPos;
uniform vec3  uCamRight;
uniform vec3  uCamUp;
uniform vec3  uCamFwd;
uniform vec2  uTan;
uniform vec3  uCenter;
uniform vec3  uIor;
uniform vec3  uAbsorb;
uniform vec4  uP0;
uniform vec4  uP1;
uniform vec4  uP2;
uniform vec4  uP3;
uniform vec4  uP4;
uniform vec3  uV0;
uniform vec3  uV1;
uniform vec3  uV2;
uniform vec3  uV3;
uniform vec3  uV4;
uniform vec3  uV5;
uniform vec2  uH0;
uniform vec2  uH1;
uniform vec2  uH2;
uniform vec2  uH3;
uniform vec2  uH4;
uniform vec2  uH5;
uniform float uReveal;
uniform float uHover;
uniform vec3  uInnerA;
uniform vec3  uInnerB;
uniform vec3  uInnerTint;
uniform float uInnerI;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// ---------------------------------------------------------------------------
// Environment: a dark room with a few large, soft studio sources.
// ---------------------------------------------------------------------------

vec3 sky(vec3 d) {
  float h = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 c = mix(vec3(0.0022, 0.0027, 0.0042), vec3(0.0125, 0.0155, 0.0225), pow(h, 1.7));

  // Cool halo sitting behind the prism.
  float halo = pow(max(dot(d, normalize(vec3(0.16, 0.24, -0.96))), 0.0), 4.0);
  c += vec3(0.018, 0.024, 0.036) * halo;

  // Faint haze upper-left.
  c += vec3(0.0085, 0.011, 0.017) * pow(max(dot(d, normalize(vec3(-0.55, 0.42, 0.72))), 0.0), 3.0);

  // Warm floor bounce, lower right.
  c += vec3(0.011, 0.0065, 0.0038) * pow(max(dot(d, normalize(vec3(0.62, -0.55, 0.56))), 0.0), 4.0);
  return c;
}

vec3 studio(vec3 d) {
  vec3 c = sky(d);

  // Broad soft key, upper right front.
  float soft = smoothstep(0.62, 0.98, dot(d, normalize(vec3(0.48, 0.58, 0.66))));
  c += vec3(0.07, 0.08, 0.10) * soft;

  // Long studio band: reads as a diagonal highlight across a flat glass face.
  vec3 bandN = normalize(vec3(0.30, 0.92, 0.25));
  float band = exp(-pow(dot(d, bandN) / 0.022, 2.0));
  c += vec3(1.1, 1.2, 1.4) * band;

  vec3 bandN2 = normalize(vec3(0.86, 0.15, 0.48));
  float band2 = exp(-pow(dot(d, bandN2) / 0.02, 2.0));
  c += vec3(0.7, 0.75, 0.85) * band2;

  // Soft window, reflected on the near face.
  float az = atan(d.x, max(d.z, 1e-4));
  float el = asin(clamp(d.y, -1.0, 1.0));
  float diag = az * 0.72 + el * 0.70;
  float winSoft = exp(-pow((diag + 0.275) / 0.018, 2.0)) * exp(-pow((el + 0.145) / 0.075, 2.0));
  c += vec3(0.20, 0.22, 0.26) * winSoft;

  float winCore = exp(-pow((diag + 0.275) / 0.0022, 2.0)) * exp(-pow((el + 0.145) / 0.06, 2.0));
  c += vec3(16.0, 17.0, 19.0) * winCore;

  float winWarm = exp(-pow((diag + 0.185) / 0.0018, 2.0)) * exp(-pow((el + 0.02) / 0.045, 2.0));
  c += vec3(1.9, 1.65, 1.35) * winWarm;

  float win3 = exp(-pow((az + 0.06) / 0.06, 2.0)) * exp(-pow((el + 0.2) / 0.5, 2.0));
  c += vec3(0.14, 0.155, 0.18) * win3;

  // Crisp strip light, right.
  float stripR = smoothstep(0.986, 0.9997, dot(d, normalize(vec3(0.70, 0.30, 0.65))));
  c += vec3(2.2, 2.4, 2.8) * stripR;

  // Narrow strip light, left.
  float stripL = smoothstep(0.985, 0.9997, dot(d, normalize(vec3(-0.66, 0.28, 0.70))));
  c += vec3(1.0, 0.9, 0.78) * stripL;

  // Warm low source, right.
  float warm = smoothstep(0.90, 1.0, dot(d, normalize(vec3(0.30, -0.48, 0.82))));
  c += vec3(0.65, 0.46, 0.28) * warm;

  // Thin horizon band, gives edges something crisp to catch.
  float horizon = exp(-pow((d.y + 0.135) / 0.014, 2.0)) * smoothstep(-0.3, 0.95, d.z);
  c += vec3(0.16, 0.19, 0.24) * horizon;

  // Faint second strip behind, for a doubled reflection through the slab.
  float backStrip = smoothstep(0.94, 0.995, dot(d, normalize(vec3(-0.15, 0.35, -0.92))));
  c += vec3(0.12, 0.14, 0.18) * backStrip;

  return c * uReveal;
}

vec3 background(vec3 rd) {
  vec3 c = sky(rd) * mix(0.25, 1.0, uReveal);
  vec2 q = (vUv - 0.5) * vec2(1.10, 1.0);
  c *= 1.0 - 0.48 * smoothstep(0.35, 0.98, length(q));
  return c;
}

// ---------------------------------------------------------------------------
// Dielectrics
// ---------------------------------------------------------------------------

float fresnelDi(float cosi, float n1, float n2) {
  float eta = n1 / n2;
  float sint2 = eta * eta * (1.0 - cosi * cosi);
  if (sint2 >= 1.0) return 1.0;
  float cost = sqrt(1.0 - sint2);
  float rs = (n1 * cosi - n2 * cost) / (n1 * cosi + n2 * cost);
  float rp = (n1 * cost - n2 * cosi) / (n1 * cost + n2 * cosi);
  return 0.5 * (rs * rs + rp * rp);
}

// March through the solid, sampling the outgoing environment per channel.
vec3 traceGlass(vec3 pEntry, vec3 nEntry, vec3 rd, float iorChannel) {
  vec4 planes[5];
  planes[0] = uP0; planes[1] = uP1; planes[2] = uP2; planes[3] = uP3; planes[4] = uP4;

  // Geometry follows the mean index; the channel index bends the exiting
  // colour only, so the volume stays a coherent single path for every pixel.
  float iorGeo = uIor.g;
  vec3 d = refract(rd, nEntry, 1.0 / iorGeo);
  if (dot(d, d) < 1e-8) return studio(reflect(rd, nEntry));

  vec3 p = pEntry;
  float path = 0.0;

  for (int bounce = 0; bounce < 4; bounce++) {
    float bestT = 1e9;
    vec3 bestN = vec3(0.0);
    for (int i = 0; i < 5; i++) {
      vec4 pl = planes[i];
      float den = dot(pl.xyz, d);
      if (den > 1e-5) {
        float t = (pl.w - dot(pl.xyz, p)) / den;
        if (t > 1e-4 && t < bestT) { bestT = t; bestN = pl.xyz; }
      }
    }
    if (bestT > 1e8) break;

    p += d * bestT;
    path += bestT;
    vec3 tint = exp(-uAbsorb * path);
    vec3 outGeo = refract(d, -bestN, iorGeo);

    if (dot(outGeo, outGeo) < 1e-8) {
      // Total internal reflection: keep going along the reflected path.
      d = reflect(d, bestN);
      continue;
    }

    vec3 outC = refract(d, -bestN, iorChannel);
    vec3 transmitted = sky(dot(outC, outC) < 1e-8 ? outGeo : outC) * tint;
    vec3 reflected = studio(reflect(d, bestN)) * tint;
    float F = fresnelDi(max(dot(d, bestN), 0.0), iorChannel, 1.0);
    return mix(transmitted, reflected, F);
  }
  return sky(reflect(d, vec3(0.0, 1.0, 0.0))) * 0.4;
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

bool hitPrism(vec3 ro, vec3 rd, out float t0, out vec3 n0) {
  vec4 planes[5];
  planes[0] = uP0; planes[1] = uP1; planes[2] = uP2; planes[3] = uP3; planes[4] = uP4;
  float nearT = -1e9;
  float farT = 1e9;
  n0 = vec3(0.0);
  for (int i = 0; i < 5; i++) {
    vec4 pl = planes[i];
    float den = dot(pl.xyz, rd);
    float t = (pl.w - dot(pl.xyz, ro)) / den;
    if (den < 0.0) {
      if (t > nearT) { nearT = t; n0 = pl.xyz; }
    } else if (den > 0.0) {
      if (t < farT) farT = t;
    }
  }
  t0 = nearT;
  return farT > max(nearT, 0.0) && n0 != vec3(0.0);
}

float distSeg(vec3 p, vec3 a, vec3 b) {
  vec3 ab = b - a;
  float t = clamp(dot(p - a, ab) / dot(ab, ab), 0.0, 1.0);
  return length(p - a - ab * t);
}

float edgeDistance(vec3 p) {
  float d = 1e9;
  d = min(d, distSeg(p, uV0, uV1));
  d = min(d, distSeg(p, uV1, uV2));
  d = min(d, distSeg(p, uV2, uV0));
  d = min(d, distSeg(p, uV3, uV4));
  d = min(d, distSeg(p, uV4, uV5));
  d = min(d, distSeg(p, uV5, uV3));
  d = min(d, distSeg(p, uV0, uV3));
  d = min(d, distSeg(p, uV1, uV4));
  d = min(d, distSeg(p, uV2, uV5));
  return d;
}

// Closest approach between the camera ray and a segment, for volumetric glow.
float raySegDistance(vec3 ro, vec3 rd, vec3 a, vec3 b) {
  vec3 u = rd;
  vec3 v = b - a;
  vec3 w0 = ro - a;
  float aa = dot(u, u);
  float bb = dot(u, v);
  float cc = dot(v, v);
  float dd = dot(u, w0);
  float ee = dot(v, w0);
  float den = aa * cc - bb * bb;
  float s = clamp((bb * ee - cc * dd) / max(den, 1e-7), 0.0, 1.0);
  vec3 pRay = ro + u * ((bb * s - dd) / max(aa, 1e-7));
  vec3 pSeg = a + v * s;
  return length(pRay - pSeg);
}

// Screen-space coverage from the convex silhouette, for crisp antialiased edges.
float edgeMargin(vec2 p, vec2 a, vec2 b, float orient) {
  vec2 e = b - a;
  float l = length(e);
  if (l < 0.5) return 1e9;
  return orient * (e.x * (p.y - a.y) - e.y * (p.x - a.x)) / l;
}

float silhouetteCoverage() {
  vec2 p = vUv * uRes;
  float area =
      uH0.x * uH1.y - uH1.x * uH0.y +
      uH1.x * uH2.y - uH2.x * uH1.y +
      uH2.x * uH3.y - uH3.x * uH2.y +
      uH3.x * uH4.y - uH4.x * uH3.y +
      uH4.x * uH5.y - uH5.x * uH4.y +
      uH5.x * uH0.y - uH0.x * uH5.y;
  float orient = area >= 0.0 ? 1.0 : -1.0;
  float m = 1e9;
  m = min(m, edgeMargin(p, (uH0 * 0.5 + 0.5) * uRes, (uH1 * 0.5 + 0.5) * uRes, orient));
  m = min(m, edgeMargin(p, (uH1 * 0.5 + 0.5) * uRes, (uH2 * 0.5 + 0.5) * uRes, orient));
  m = min(m, edgeMargin(p, (uH2 * 0.5 + 0.5) * uRes, (uH3 * 0.5 + 0.5) * uRes, orient));
  m = min(m, edgeMargin(p, (uH3 * 0.5 + 0.5) * uRes, (uH4 * 0.5 + 0.5) * uRes, orient));
  m = min(m, edgeMargin(p, (uH4 * 0.5 + 0.5) * uRes, (uH5 * 0.5 + 0.5) * uRes, orient));
  m = min(m, edgeMargin(p, (uH5 * 0.5 + 0.5) * uRes, (uH0 * 0.5 + 0.5) * uRes, orient));
  return clamp(m + 0.75, 0.0, 1.0);
}

void main() {
  vec2 ndc = vUv * 2.0 - 1.0;
  vec3 rd = normalize(uCamFwd + uCamRight * (ndc.x * uTan.x) + uCamUp * (ndc.y * uTan.y));
  vec3 ro = uCamPos;

  vec3 bg = background(rd);
  vec3 col = bg;

  float t0;
  vec3 n0;
  if (hitPrism(ro, rd, t0, n0) && t0 > 0.0) {
    vec3 p = ro + rd * t0;
    float cosi = clamp(-dot(rd, n0), 0.0, 1.0);
    vec3 refl = studio(reflect(rd, n0));

    float Fr = fresnelDi(cosi, 1.0, uIor.r);
    float Fg = fresnelDi(cosi, 1.0, uIor.g);
    float Fb = fresnelDi(cosi, 1.0, uIor.b);

    vec3 tr = traceGlass(p, n0, rd, uIor.r);
    vec3 tg = traceGlass(p, n0, rd, uIor.g);
    vec3 tb = traceGlass(p, n0, rd, uIor.b);
    vec3 body = vec3(tr.r, tg.g, tb.b);
    body = mix(body, refl, vec3(Fr, Fg, Fb));

    vec3 glass = body;

    // Fine polished bevels along every edge.
    float ed = edgeDistance(p);
    float rim = pow(1.0 - smoothstep(0.0, 0.030, ed), 1.4);
    vec3 outN = normalize(p - uCenter);
    float edgeKey = 0.25 + 0.75 * smoothstep(-0.2, 1.0, dot(outN, normalize(vec3(0.45, 0.75, 0.45))));
    vec3 sheen = vec3(0.86, 0.89, 0.95);
    glass += sheen * rim * (0.55 + 1.9 * Fr + uHover * 0.5) * edgeKey * (0.35 + 0.75 * uReveal);

    // Beam scattering inside the glass.
    if (uInnerI > 0.001) {
      float ds = raySegDistance(ro, rd, uInnerA, uInnerB);
      float glow = exp(-ds * ds * 34.0);
      glass += uInnerTint * glow * uInnerI * 0.55;
      float halo = exp(-ds * ds * 3.0);
      glass += uInnerTint * halo * uInnerI * 0.045;
    }

    // Hover: a soft skin of light over the whole material.
    glass += uHover * (0.030 + 0.16 * pow(1.0 - cosi, 3.0)) * vec3(0.55, 0.68, 0.90);

    glass = mix(bg, glass, silhouetteCoverage());
    col = glass;
  }

  // Very light film grain, to keep the large gradients alive.
  col += (hash12(gl_FragCoord.xy) - 0.5) * 0.0016;

  gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
}
`;
