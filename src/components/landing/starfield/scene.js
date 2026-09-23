// src/components/landing/starfield/scene.js — the landing's WebGL layer.
//
// Lazy chunk (the only place on the landing that imports three). Rendered on a
// fixed canvas BEHIND the Act I theater; the DOM cards, copy and gold thread
// all stay on top and unchanged. Two point systems, one draw call each:
//
//   DUST   — gold motes filling a long corridor of space. Scroll-driven:
//            they gather and swirl toward the cards during the consideration,
//            are thrown outward by the reveal burst, and — because the camera
//            flies through them in the threshold — streak past as parallax.
//            Scroll velocity also turns the whole vortex a little.
//
//   BOOKS  — spine-out volumes lining the corridor beyond the card. As the
//            camera passes each one it turns into a star and rises to its
//            place in the sky ahead. By the end of Act I every book is a star,
//            a few are joined by faint constellation lines, and the whole sky
//            fades as Act II scrolls in. The page's constellation motif,
//            literally: your books become the stars you navigate by.
//
// Progress beats (from ActSpread, via sceneBus):
//   0.10–0.45 gather · 0.45 burst · 0.50–0.60 books appear · 0.50–0.92 fly ·
//   0.86–0.96 all remaining books become stars · 0.93–1.0 constellations.
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

const BOOK_VERT = /* glsl */ `
  uniform float uTime, uCamZ, uForce, uScale, uOpacity, uBookIn;
  attribute vec3 aStar;
  attribute vec4 aRand;  // size, phase, tilt, twinkle
  attribute vec3 aColor;
  varying float vM;
  varying float vAlpha;
  varying float vTilt;
  varying vec3 vColor;
  void main() {
    // A book turns into a star as the camera reaches it…
    float passed = smoothstep(position.z + 7.0, position.z + 0.5, uCamZ);
    // …and at the end of the flight every book does, reached or not.
    float m = max(passed, uForce);
    float e = m * m * (3.0 - 2.0 * m);
    vec3 p = mix(position, aStar, e);
    // Arc outward on the way up, so the flight reads as a rise, not a slide.
    p.xy += normalize(position.xy + 0.0001) * sin(e * 3.14159) * 3.0;

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float depth = max(-mv.z, 0.1);
    float bookWorld = 1.05 + aRand.x * 0.5;
    float starWorld = 0.45 + aRand.x * 1.1;
    gl_PointSize = min(mix(bookWorld, starWorld, e) * uScale / depth, 220.0);

    float tw = mix(1.0, 0.72 + 0.28 * sin(uTime * (0.6 + aRand.w * 1.8) + aRand.y * 30.0), e);
    // Books only read up close — far ones would pile up at the vanishing
    // point, right behind the card. Stars keep their full sky.
    float farFade = mix(1.0 - smoothstep(18.0, 34.0, depth), 1.0, e);
    vAlpha = uOpacity * mix(uBookIn, 1.0, e) * tw * smoothstep(0.4, 3.0, depth) * farFade;
    vM = m;
    vTilt = aRand.z * (1.0 - e);
    vColor = aColor;
  }
`;

const BOOK_FRAG = /* glsl */ `
  uniform vec3 uGold, uStarCore;
  varying float vM;
  varying float vAlpha;
  varying float vTilt;
  varying vec3 vColor;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    c.y = -c.y;
    float cs = cos(vTilt), sn = sin(vTilt);
    vec2 r = vec2(cs * c.x - sn * c.y, sn * c.x + cs * c.y);

    // ── The book: a spine seen end-on — narrow, tall, gilt-banded.
    vec2 q = abs(r) - vec2(0.15, 0.46);
    float box = 1.0 - smoothstep(0.0, 0.02, max(q.x, q.y));
    float inSpine = step(abs(r.x), 0.15);
    float band = (smoothstep(0.014, 0.0, abs(r.y - 0.34))
                + smoothstep(0.014, 0.0, abs(r.y + 0.34))
                + smoothstep(0.010, 0.0, abs(r.y - 0.29))
                + smoothstep(0.010, 0.0, abs(r.y + 0.29))) * inSpine;
    float plate = step(abs(r.x), 0.085) * step(abs(r.y - 0.06), 0.11);
    float round = 0.6 + 0.55 * (1.0 - pow(abs(r.x) / 0.15, 2.0)); // curved spine shading
    vec3 book = vColor * round;
    book = mix(book, uGold, clamp(band + plate * 0.45, 0.0, 1.0));

    // ── The star: a soft core with a thin cross flare.
    float d = length(c);
    float core = pow(smoothstep(0.5, 0.0, d), 3.0);
    float flare = (max(0.0, 1.0 - abs(c.x) * 30.0) * smoothstep(0.5, 0.0, abs(c.y))
                 + max(0.0, 1.0 - abs(c.y) * 30.0) * smoothstep(0.5, 0.0, abs(c.x))) * 0.4;
    float star = clamp(core + flare, 0.0, 1.0);
    vec3 starCol = mix(uGold, uStarCore, core * 0.7);

    float m = smoothstep(0.12, 0.8, vM);
    float a = mix(box, star, m) * vAlpha;
    if (a < 0.004) discard;
    gl_FragColor = vec4(mix(book, starCol, m), a);
  }
`;

// Leather bindings. Deliberately dark on ink — the books read as silhouettes
// with gilt catching the light, which is the dark-academia shelf.
const LEATHER_INK = ['#5a1f22', '#1f3a2c', '#1d2842', '#6b4a1f', '#3b2238', '#2b2b2b', '#4a3520'];
const LEATHER_PARCHMENT = ['#7a2e2e', '#2f5641', '#2c3b5e', '#8a6428', '#553150', '#4b3b2a', '#6a4a2a'];

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

  // ── Books → stars ───────────────────────────────────────────────────────
  const BOOKS = mobile ? 200 : 420;
  const bPos = new Float32Array(BOOKS * 3);
  const bStar = new Float32Array(BOOKS * 3);
  const bRand = new Float32Array(BOOKS * 4);
  const bColor = new Float32Array(BOOKS * 3);

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

  for (let i = 0; i < BOOKS; i++) {
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
      const sx = k.cx + (rand() * 2 - 1) * 5;
      const sy = k.cy + (rand() * 2 - 1) * 3.6;
      bStar[i * 3] = sx;
      bStar[i * 3 + 1] = sy;
      bStar[i * 3 + 2] = SKY_Z - rand() * 6;
      k.members.push(i);
    } else {
      bStar[i * 3] = (rand() * 2 - 1) * 46;
      bStar[i * 3 + 1] = (rand() * 2 - 1) * 26;
      bStar[i * 3 + 2] = SKY_Z - rand() * 30;
    }
    bRand[i * 4] = ci >= 0 ? 0.6 + rand() * 0.4 : rand() * rand();
    bRand[i * 4 + 1] = rand();
    bRand[i * 4 + 2] = (rand() * 2 - 1) * 0.22;
    bRand[i * 4 + 3] = rand();
  }

  const bookGeo = new BufferGeometry();
  bookGeo.setAttribute('position', new BufferAttribute(bPos, 3));
  bookGeo.setAttribute('aStar', new BufferAttribute(bStar, 3));
  bookGeo.setAttribute('aRand', new BufferAttribute(bRand, 4));
  const colorAttr = new BufferAttribute(bColor, 3);
  bookGeo.setAttribute('aColor', colorAttr);
  const bookMat = new ShaderMaterial({
    vertexShader: BOOK_VERT,
    fragmentShader: BOOK_FRAG,
    transparent: true,
    depthWrite: false,
    blending: NormalBlending,
    uniforms: {
      uTime: { value: 0 },
      uCamZ: { value: CAM_START },
      uForce: { value: 0 },
      uScale: { value: 1 },
      uOpacity: { value: 0 },
      uBookIn: { value: 0 },
      uGold: { value: new Color() },
      uStarCore: { value: new Color() },
    },
  });
  const books = new Points(bookGeo, bookMat);
  books.frustumCulled = false;
  scene.add(books);

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
  function applyTheme() {
    const parchment = isParchment();
    const gold = readRgbVar(parchment ? '--lps-gold-rgb' : '--lps-glow-rgb');
    dustMat.uniforms.uColor.value.setRGB(...gold);
    dustMat.blending = parchment ? NormalBlending : AdditiveBlending;
    dustMat.needsUpdate = true;
    bookMat.uniforms.uGold.value.setRGB(...gold);
    bookMat.uniforms.uStarCore.value.set(parchment ? '#5a4214' : '#fff6dc');
    lineMat.color.setRGB(...gold);
    const leather = parchment ? LEATHER_PARCHMENT : LEATHER_INK;
    const tmp = new Color();
    const r2 = rng(7);
    for (let i = 0; i < BOOKS; i++) {
      tmp.set(leather[Math.floor(r2() * leather.length)]);
      bColor[i * 3] = tmp.r;
      bColor[i * 3 + 1] = tmp.g;
      bColor[i * 3 + 2] = tmp.b;
    }
    colorAttr.needsUpdate = true;
    themeScale = parchment ? 0.8 : 1;
  }
  let themeScale = 1;
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
    bookMat.uniforms.uScale.value = (h * pr) / (2 * Math.tan((FOV * Math.PI) / 360));
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
  let fade = 1;
  let intro = 0;
  let raf = 0;
  let running = false;
  let lastP = 0;
  let spin = 0;
  let prev = performance.now();
  const t0 = prev;

  function frame(now) {
    raf = 0;
    const dt = Math.min(0.05, (now - prev) / 1000);
    prev = now;
    const time = (now - t0) / 1000;
    const p = sceneBus.progress;

    intro = Math.min(1, intro + dt / 1.4);
    const vis = fade * intro * themeScale;

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

    cx += (px * 0.6 - cx) * Math.min(1, dt * 3);
    cy += (-py * 0.4 - cy) * Math.min(1, dt * 3);
    camera.position.set(cx, cy, camZ);
    camera.rotation.z = Math.sin(fly * Math.PI) * 0.06;

    const du = dustMat.uniforms;
    du.uTime.value = time;
    du.uGather.value = gather;
    du.uShock.value = shock;
    du.uSpin.value = spin;
    du.uOpacity.value = vis * (0.9 - 0.35 * smooth(0.9, 1, p));

    const bu = bookMat.uniforms;
    bu.uTime.value = time;
    bu.uCamZ.value = camZ;
    bu.uForce.value = smooth(0.86, 0.96, p);
    bu.uBookIn.value = smooth(0.5, 0.6, p);
    bu.uOpacity.value = vis;

    lineMat.opacity = smooth(0.93, 1.0, p) * 0.35 * vis;

    renderer.render(scene, camera);
    if (running) raf = requestAnimationFrame(frame);
  }

  function start() {
    if (running || fade <= 0.001 || document.hidden) return;
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
    // 1 while Act I is on screen, → 0 as Act II arrives. At 0 the loop stops:
    // no frames are spent on a sky nobody can see.
    setFade(v) {
      fade = clamp01(v);
      canvas.style.opacity = String(fade);
      if (fade <= 0.001) stop();
      else start();
    },
    dispose() {
      stop();
      stopTheme();
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', onPointer);
      document.removeEventListener('visibilitychange', onVisibility);
      dustGeo.dispose();
      dustMat.dispose();
      bookGeo.dispose();
      bookMat.dispose();
      lineGeo.dispose();
      lineMat.dispose();
      renderer.dispose();
      renderer.forceContextLoss?.();
    },
  };
}
