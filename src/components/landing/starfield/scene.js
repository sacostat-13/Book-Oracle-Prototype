// src/components/landing/starfield/scene.js — the landing's WebGL layer.
//
// Lazy chunk (the only place on the landing that imports three). Rendered on a
// fixed canvas BEHIND the story; the DOM cards, copy and gold thread all stay
// on top and unchanged. Three draw calls:
//
//   DUST   — gold motes filling a long corridor of space. Scroll-driven:
//            they gather and swirl toward the cards during the consideration,
//            are thrown outward by the reveal burst, and — because the camera
//            flies through them in the threshold — streak past as parallax.
//            Scroll velocity also turns the whole vortex a little.
//
//   STARS  — sparks born along the corridor beyond the card as the camera
//            passes, each rising to its place in the sky ahead. By the end
//            of Act I the whole sky is lit. (Round 2 tried 3D books here that
//            turned into stars; they made the page look worse and were cut.)
//
//   LINES  — a few of those stars are joined into constellations. When Act II
//            scrolls in the corridor and dust go, but the sky stays behind the
//            rest of the page as a dim backdrop: constellations bright, loose
//            stars faint, drifting slowly with the scroll.
//
// Progress beats (from ActSpread, via sceneBus):
//   0.10–0.45 gather · 0.45 burst · 0.50–0.92 fly (stars born as passed) ·
//   0.86–0.96 every remaining star lit · 0.93–1.0 constellations.
import {
  WebGLRenderer,
  Scene,
  PerspectiveCamera,
  BufferGeometry,
  BufferAttribute,
  Points,
  ShaderMaterial,
  AdditiveBlending,
  NormalBlending,
  LineSegments,
  LineBasicMaterial,
  Color,
} from 'three';
import { sceneBus } from '../sceneBus';
import { readRgbVar, isParchment, onThemeChange, hasHover } from './util';

const FOV = 50;
const CAM_START = 10;
const CAM_END = -60;

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

// Seeded PRNG so the sky is the same on every visit (constellations are a
// place, not a slot machine).
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Shaders ────────────────────────────────────────────────────────────────
const DUST_VERT = /* glsl */ `
  uniform float uTime, uGather, uShock, uSpin, uPix, uOpacity;
  attribute vec4 aRand; // size, phase, speed, twinkle
  varying float vAlpha;
  void main() {
    vec3 p = position;
    float t = uTime * (0.25 + aRand.z * 0.5);
    p.x += sin(t + aRand.y * 6.2831) * 0.35;
    p.y += cos(t * 0.8 + aRand.y * 4.0) * 0.30;

    // Only motes near the stage take part in the card's beats.
    float near = smoothstep(-12.0, 0.0, p.z);
    float r = length(p.xy);

    // The consideration: drawn in toward the cards, turning as they come.
    p.xy *= 1.0 - uGather * 0.38 * near;
    float ang = uGather * 1.1 * near * (1.0 - clamp(r / 16.0, 0.0, 1.0)) + uSpin * (0.4 + aRand.z);
    float cs = cos(ang), sn = sin(ang);
    p.xy = mat2(cs, sn, -sn, cs) * p.xy;

    // The reveal: a ring of force thrown outward from the card.
    p.xy += normalize(p.xy + 0.0001) * uShock * (1.6 + aRand.x * 2.4) * near;

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float depth = -mv.z;
    gl_PointSize = min((1.2 + aRand.x * 2.6) * uPix * (9.0 / max(depth, 0.1)), 28.0 * uPix);
    float tw = 0.55 + 0.45 * sin(uTime * (0.8 + aRand.w * 1.6) + aRand.y * 20.0);
    vAlpha = tw * uOpacity * smoothstep(0.3, 2.5, depth) * (0.3 + aRand.x * 0.7)
           * (1.0 - smoothstep(60.0, 90.0, depth));
  }
`;

const DUST_FRAG = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d);
    a *= a;
    if (a * vAlpha < 0.004) discard;
    gl_FragColor = vec4(uColor, a * vAlpha);
  }
`;

// ── Stars ─────────────────────────────────────────────────────────────────
// Each is born as a spark along the corridor as the camera passes, then
// rises to its place in the sky. aConst marks the constellation members that stay bright behind the
// Rites once the rest of the sky has dimmed.
const STAR_VERT = /* glsl */ `
  uniform float uTime, uCamZ, uForce, uScale, uOpacity, uAfter;
  attribute vec3 aStar;
  attribute vec4 aRand;
  attribute float aConst;
  varying float vAlpha;
  void main() {
    float passed = smoothstep(position.z + 7.0, position.z + 0.5, uCamZ);
    float m = max(passed, uForce);
    float e = smoothstep(0.2, 1.0, m);
    e = e * e * (3.0 - 2.0 * e);
    vec3 p = mix(position, aStar, e);
    p.xy += normalize(position.xy + 0.0001) * sin(e * 3.14159) * 3.0;

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float depth = max(-mv.z, 0.1);
    // Capped small while a spark is still close to the camera, so a freshly
    // born star reads as a spark, not a lens flare.
    gl_PointSize = min((0.45 + aRand.x * 1.1) * uScale / depth, mix(14.0, 160.0, e));

    float tw = 0.72 + 0.28 * sin(uTime * (0.6 + aRand.w * 1.8) + aRand.y * 30.0);
    float birth = smoothstep(0.2, 0.6, m);
    float keep = mix(1.0, mix(0.2, 0.9, aConst), uAfter);
    vAlpha = uOpacity * birth * tw * keep * smoothstep(0.4, 3.0, depth);
  }
`;

const STAR_FRAG = /* glsl */ `
  uniform vec3 uGold, uStarCore;
  varying float vAlpha;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    float core = pow(smoothstep(0.5, 0.0, d), 3.0);
    float flare = (max(0.0, 1.0 - abs(c.x) * 30.0) * smoothstep(0.5, 0.0, abs(c.y))
                 + max(0.0, 1.0 - abs(c.y) * 30.0) * smoothstep(0.5, 0.0, abs(c.x))) * 0.4;
    float a = clamp(core + flare, 0.0, 1.0) * vAlpha;
    if (a < 0.004) discard;
    gl_FragColor = vec4(mix(uGold, uStarCore, core * 0.7), a);
  }
`;

export function createStarScene(canvas, { mobile = false } = {}) {
  let renderer;
  try {
    renderer = new WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: 'low-power' });
  } catch {
    return null;
  }
  const pr = Math.min(window.devicePixelRatio || 1, 1.5);
  renderer.setPixelRatio(pr);
  renderer.setClearColor(0x000000, 0);

  const scene = new Scene();
  const camera = new PerspectiveCamera(FOV, 1, 0.1, 400);
  camera.position.set(0, 0, CAM_START);

  const rand = rng(0x0bad5eed);

  // ── Dust ────────────────────────────────────────────────────────────────
  const DUST = mobile ? 650 : 1700;
  const dPos = new Float32Array(DUST * 3);
  const dRand = new Float32Array(DUST * 4);
  for (let i = 0; i < DUST; i++) {
    dPos[i * 3] = (rand() * 2 - 1) * 15;
    dPos[i * 3 + 1] = (rand() * 2 - 1) * 9;
    dPos[i * 3 + 2] = 6 - rand() * 84;
    dRand[i * 4] = rand();
    dRand[i * 4 + 1] = rand();
    dRand[i * 4 + 2] = rand();
    dRand[i * 4 + 3] = rand();
  }
  const dustGeo = new BufferGeometry();
  dustGeo.setAttribute('position', new BufferAttribute(dPos, 3));
  dustGeo.setAttribute('aRand', new BufferAttribute(dRand, 4));
  const dustMat = new ShaderMaterial({
    vertexShader: DUST_VERT,
    fragmentShader: DUST_FRAG,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uGather: { value: 0 },
      uShock: { value: 0 },
      uSpin: { value: 0 },
      uPix: { value: pr },
      uOpacity: { value: 0 },
      uColor: { value: new Color() },
    },
  });
  const dust = new Points(dustGeo, dustMat);
  dust.frustumCulled = false;
  scene.add(dust);

  // ── Stars ───────────────────────────────────────────────────────
  const STARS = mobile ? 160 : 320;
  const bPos = new Float32Array(STARS * 3);
  const bStar = new Float32Array(STARS * 3);
  const bRand = new Float32Array(STARS * 4);
  const bConst = new Float32Array(STARS);

  // Sky: a wide shell ahead of where the camera stops. A handful of
  // constellations get tight clusters; everything else is scattered.
  const SKY_Z = CAM_END - 50;
  const CONST_COUNT = mobile ? 4 : 7;
  const PER_CONST = 6;
  const constellations = [];
  for (let c = 0; c < CONST_COUNT; c++) {
    const a = (c / CONST_COUNT) * Math.PI * 2 + rand() * 0.6;
    const rr = 8 + rand() * 12;
    constellations.push({ cx: Math.cos(a) * rr * 1.5, cy: Math.sin(a) * rr * 0.8, members: [] });
  }

  for (let i = 0; i < STARS; i++) {
    // Corridor walls: a ring around the flight path, clear of the centre so
    // the card and the "beyond" copy keep the middle of the frame.
    const theta = rand() * Math.PI * 2;
    const r = 3.8 + rand() * 5.2;
    bPos[i * 3] = Math.cos(theta) * r * 1.35;
    bPos[i * 3 + 1] = Math.sin(theta) * r;
    bPos[i * 3 + 2] = 3 - rand() * (3 - CAM_END + 2);

    const ci = i < CONST_COUNT * PER_CONST ? Math.floor(i / PER_CONST) : -1;
    if (ci >= 0) {
      const k = constellations[ci];
      bStar[i * 3] = k.cx + (rand() * 2 - 1) * 5;
      bStar[i * 3 + 1] = k.cy + (rand() * 2 - 1) * 3.6;
      bStar[i * 3 + 2] = SKY_Z - rand() * 6;
      k.members.push(i);
      bConst[i] = 1;
    } else {
      bStar[i * 3] = (rand() * 2 - 1) * 46;
      bStar[i * 3 + 1] = (rand() * 2 - 1) * 26;
      bStar[i * 3 + 2] = SKY_Z - rand() * 30;
    }
    bRand[i * 4] = ci >= 0 ? 0.6 + rand() * 0.4 : rand() * rand();
    bRand[i * 4 + 1] = rand();
    bRand[i * 4 + 2] = rand() * 2 - 1;
    bRand[i * 4 + 3] = rand();
  }

  // The stars, born along the corridor.
  const starGeo = new BufferGeometry();
  starGeo.setAttribute('position', new BufferAttribute(bPos, 3));
  starGeo.setAttribute('aStar', new BufferAttribute(bStar, 3));
  starGeo.setAttribute('aRand', new BufferAttribute(bRand, 4));
  starGeo.setAttribute('aConst', new BufferAttribute(bConst, 1));
  const starMat = new ShaderMaterial({
    vertexShader: STAR_VERT,
    fragmentShader: STAR_FRAG,
    transparent: true,
    depthWrite: false,
    blending: NormalBlending,
    uniforms: {
      uTime: { value: 0 },
      uCamZ: { value: CAM_START },
      uForce: { value: 0 },
      uScale: { value: 1 },
      uOpacity: { value: 0 },
      uAfter: { value: 0 },
      uGold: { value: new Color() },
      uStarCore: { value: new Color() },
    },
  });
  const stars = new Points(starGeo, starMat);
  stars.frustumCulled = false;
  scene.add(stars);

  // ── Constellation lines: a nearest-neighbour walk through each cluster ──
  const segs = [];
  for (const k of constellations) {
    const left = [...k.members];
    let cur = left.shift();
    while (left.length) {
      let best = 0;
      let bestD = Infinity;
      for (let j = 0; j < left.length; j++) {
        const dx = bStar[left[j] * 3] - bStar[cur * 3];
        const dy = bStar[left[j] * 3 + 1] - bStar[cur * 3 + 1];
        const d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = j; }
      }
      const nxt = left.splice(best, 1)[0];
      segs.push(...bStar.slice(cur * 3, cur * 3 + 3), ...bStar.slice(nxt * 3, nxt * 3 + 3));
      cur = nxt;
    }
  }
  const lineGeo = new BufferGeometry();
  lineGeo.setAttribute('position', new BufferAttribute(new Float32Array(segs), 3));
  const lineMat = new LineBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
  const lines = new LineSegments(lineGeo, lineMat);
  lines.frustumCulled = false;
  scene.add(lines);

  // ── Palette (follows the landing's ink / parchment toggle) ───────────────
  let themeScale = 1;
  function applyTheme() {
    const parchment = isParchment();
    const gold = readRgbVar(parchment ? '--lps-gold-rgb' : '--lps-glow-rgb');
    dustMat.uniforms.uColor.value.setRGB(...gold);
    dustMat.blending = parchment ? NormalBlending : AdditiveBlending;
    dustMat.needsUpdate = true;
    starMat.uniforms.uGold.value.setRGB(...gold);
    starMat.uniforms.uStarCore.value.set(parchment ? '#5a4214' : '#fff6dc');
    lineMat.color.setRGB(...gold);
    themeScale = parchment ? 0.85 : 1;
  }
  applyTheme();
  const stopTheme = onThemeChange(applyTheme);

  // ── Size ────────────────────────────────────────────────────────────────
  let lastW = 0;
  let lastH = 0;
  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    // Mobile address bars change innerHeight on every scroll direction flip;
    // ignore small height-only changes rather than reallocating the canvas.
    if (w === lastW && Math.abs(h - lastH) < 120) return;
    lastW = w;
    lastH = h;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    starMat.uniforms.uScale.value = (h * pr) / (2 * Math.tan((FOV * Math.PI) / 360));
  }
  resize();
  window.addEventListener('resize', resize);

  // ── Pointer parallax (fine pointers only) ───────────────────────────────
  let px = 0;
  let py = 0;
  let cx = 0;
  let cy = 0;
  function onPointer(e) {
    px = (e.clientX / window.innerWidth) * 2 - 1;
    py = (e.clientY / window.innerHeight) * 2 - 1;
  }
  if (hasHover()) window.addEventListener('pointermove', onPointer, { passive: true });

  // ── Loop ────────────────────────────────────────────────────────────────
  // `after` (0–1) is how far Act II has scrolled in. At 1 the corridor and
  // dust are gone and the sky settles into a quiet backdrop for the rest of
  // the page: the constellations stay, the loose stars dim, and the sky
  // drifts gently with the scroll. That backdrop renders at ~30 fps.
  let after = 0;
  let afterStart = Infinity; // document y where the backdrop phase begins
  let intro = 0;
  let raf = 0;
  let running = false;
  let lastP = 0;
  let spin = 0;
  let skip = false;
  let prev = performance.now();
  const t0 = prev;

  function frame(now) {
    raf = 0;
    if (!running) return;
    if (after >= 0.999) {
      skip = !skip;
      if (skip) { raf = requestAnimationFrame(frame); return; }
    }
    const dt = Math.min(0.05, (now - prev) / 1000);
    prev = now;
    const time = (now - t0) / 1000;
    const p = sceneBus.progress;

    intro = Math.min(1, intro + dt / 1.4);
    const vis = intro * themeScale;

    // Scroll velocity turns the vortex: scrolling winds it, stillness holds it.
    const dp = p - lastP;
    lastP = p;
    spin += dp * 2.2;

    const gather = smooth(0.1, 0.26, p) * (1 - smooth(0.42, 0.47, p));
    let shock = 0;
    if (sceneBus.burstAt) {
      const k = (now - sceneBus.burstAt) / 1600;
      if (k >= 0 && k < 1) shock = Math.sin(k * Math.PI) * (1 - k * 0.6);
    }
    const fly = easeInOut(smooth(0.5, 0.92, p));
    const camZ = CAM_START + (CAM_END - CAM_START) * fly;

    // Past Act I the sky drifts upward with the page, slowly.
    const past = Math.max(0, window.scrollY - afterStart);
    const drift = Math.min(past * 0.0011, 9);

    cx += (px * 0.6 - cx) * Math.min(1, dt * 3);
    cy += (-py * 0.4 - cy) * Math.min(1, dt * 3);
    camera.position.set(cx, cy - drift, camZ);
    camera.rotation.z = Math.sin(fly * Math.PI) * 0.06 + Math.sin(time * 0.05) * 0.02 * after;

    const du = dustMat.uniforms;
    du.uTime.value = time;
    du.uGather.value = gather;
    du.uShock.value = shock;
    du.uSpin.value = spin;
    du.uOpacity.value = vis * (0.9 - 0.35 * smooth(0.9, 1, p)) * (1 - after);

    const su = starMat.uniforms;
    su.uTime.value = time;
    su.uCamZ.value = camZ;
    su.uForce.value = smooth(0.86, 0.96, p);
    su.uOpacity.value = vis;
    su.uAfter.value = after;

    lineMat.opacity = smooth(0.93, 1.0, p) * vis * (0.35 - 0.1 * after);

    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  }

  function start() {
    if (running || document.hidden) return;
    running = true;
    prev = performance.now();
    raf = requestAnimationFrame(frame);
  }
  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }
  function onVisibility() {
    if (document.hidden) stop();
    else start();
  }
  document.addEventListener('visibilitychange', onVisibility);
  start();

  return {
    // 0 while Act I is on screen, → 1 as Act II arrives (see the loop note).
    setAfter(v, startY) {
      after = clamp01(v);
      if (Number.isFinite(startY)) afterStart = startY;
    },
    dispose() {
      stop();
      stopTheme();
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', onPointer);
      document.removeEventListener('visibilitychange', onVisibility);
      [dustGeo, dustMat, starGeo, starMat, lineGeo, lineMat].forEach((d) => d.dispose());
      renderer.dispose();
      renderer.forceContextLoss?.();
    },
  };
}
