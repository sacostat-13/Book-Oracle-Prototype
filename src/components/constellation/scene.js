// src/components/constellation/scene.js — the reader's sky (lazy chunk).
//
// Draw calls: one Points for the reader's stars, one Points for the deep
// field (background dust at many depths, for parallax), one LineSegments per
// family figure, one Line for the gold thread (a curve through the last
// reads, drawn in the first time the sky comes into view). Family names are
// DOM labels the caller renders; this scene only moves them, so they stay
// crisp, selectable and translated.
//
// Camera: an orbit round a target. Drag turns the sky (all the way round),
// shift/right-drag pans, wheel or pinch zooms toward the pointer, a double
// click zooms in there. The wheel zooms only once the reader has engaged the
// sky (pressed on it) or holds Ctrl/⌘ (trackpad pinch sends that), so
// scrolling the Profile page past the sky never gets trapped.
//
// Picking is done in screen space: the nearest star within a finger-sized
// radius wins, so small stars are as easy to hit as big ones.
//
// Glimpse (Free): only sky.lit stars are named, hoverable and bright; the rest
// are faint and unnamed, there is no thread and no zoom.
import {
  WebGLRenderer,
  Scene,
  PerspectiveCamera,
  BufferGeometry,
  BufferAttribute,
  Points,
  ShaderMaterial,
  LineSegments,
  LineBasicMaterial,
  Line,
  Vector3,
  Color,
  AdditiveBlending,
  NormalBlending,
} from 'three';

const FOV = 42;
const PICK_PX = 16; // minimum hit radius, CSS px
const DUST_COUNT = 1400;

const TINTS_INK = ['#fff3d6', '#f5d9a8', '#e9c98f', '#ffe9c4', '#f3e2d0', '#e6d3a3', '#fbe7b5', '#efd8b8', '#cfc6b4'];
const TINTS_PARCHMENT = ['#3a2a14', '#4a3216', '#5a3d18', '#3f2e1c', '#4d3a22', '#553f1c', '#47341a', '#3c2d18', '#6b5a45'];

const VERT = /* glsl */ `
  uniform float uScale, uTime, uHover, uIntro, uNear, uSpan, uMaxPx;
  attribute float aSize, aBright, aIndex, aVis, aLock;
  attribute vec3 aTint;
  varying vec3 vTint;
  varying float vAlpha, vHot;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float hot = 1.0 - step(0.5, abs(aIndex - uHover));
    float tw = 0.82 + 0.18 * sin(uTime * (0.7 + fract(aIndex * 0.618) * 1.4) + aIndex);
    // Stars arrive in index order during the intro.
    float born = smoothstep(aIndex * 0.002, aIndex * 0.002 + 0.25, uIntro);
    // Depth cue: stars far behind the focus fade toward the dark.
    float fog = mix(0.3, 1.0, clamp(1.0 - (-mv.z - uNear) / uSpan, 0.0, 1.0));
    float lockSize = mix(1.0, 0.8, aLock);
    gl_PointSize = min(aSize * lockSize * (0.3 + hot * 0.18) * uScale / -mv.z, uMaxPx) * born * step(0.001, aVis);
    vTint = mix(aTint, vec3(dot(aTint, vec3(0.333))), aLock * 0.7);
    vAlpha = aBright * tw * born * fog * aVis * mix(1.0, 0.7, aLock);
    vHot = hot;
  }
`;
const FRAG = /* glsl */ `
  uniform vec3 uGold;
  varying vec3 vTint;
  varying float vAlpha, vHot;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    float core = pow(smoothstep(0.5, 0.0, d), 2.6);
    float flare = (max(0.0, 1.0 - abs(c.x) * 26.0) * smoothstep(0.5, 0.0, abs(c.y))
                 + max(0.0, 1.0 - abs(c.y) * 26.0) * smoothstep(0.5, 0.0, abs(c.x))) * 0.35;
    float ring = vHot * smoothstep(0.03, 0.0, abs(d - 0.42));
    float a = clamp(core + flare, 0.0, 1.0) * vAlpha + ring;
    if (a < 0.01) discard;
    gl_FragColor = vec4(mix(vTint, uGold, ring), a);
  }
`;
// The deep field: tiny, dim, fixed-size-in-world points. They are what makes
// the sky read as a volume when it turns — near dust slides past far dust.
const DUST_VERT = /* glsl */ `
  uniform float uScale, uIntro, uDim;
  attribute float aSize, aBright;
  varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(aSize * uScale / -mv.z, 1.0, 4.0);
    vAlpha = aBright * uIntro * uDim;
  }
`;
const DUST_FRAG = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.1, d) * vAlpha;
    if (a < 0.01) discard;
    gl_FragColor = vec4(uColor, a);
  }
`;
// The thread fades from the oldest read to the newest, so the path reads as
// a direction of travel rather than a knot.
const THREAD_VERT = /* glsl */ `
  attribute float aAlpha;
  varying float vA;
  void main() {
    vA = aAlpha;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const THREAD_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vA;
  void main() { gl_FragColor = vec4(uColor, vA * uOpacity); }
`;

// Small seeded PRNG, so the deep field is the same on every visit.
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

export function createConstellationScene(host, {
  sky, colors, labels = [], glimpse = false, onHover, onPick, onView, onHint,
}) {
  let renderer;
  try {
    renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
  } catch {
    return null;
  }
  const pr = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(pr);
  renderer.setClearColor(0x000000, 0);
  const canvas = renderer.domElement;
  canvas.className = 'rc__canvas';
  host.prepend(canvas);

  const scene = new Scene();
  const camera = new PerspectiveCamera(FOV, 1, 0.05, 400);

  const parchment = colors.parchment;
  const tints = (parchment ? TINTS_PARCHMENT : TINTS_INK).map((c) => new Color(c));
  const gold = new Color(colors.gold);

  // ── Stars ───────────────────────────────────────────────────────────────
  const n = sky.stars.length;
  const litSet = new Set(glimpse ? sky.lit || [] : sky.stars.map((_, i) => i));
  const locked = (i) => !litSet.has(i);
  const pos = new Float32Array(n * 3);
  const size = new Float32Array(n);
  const bright = new Float32Array(n);
  const index = new Float32Array(n);
  const tint = new Float32Array(n * 3);
  const vis = new Float32Array(n).fill(1);
  const lock = new Float32Array(n);
  sky.stars.forEach((s, i) => {
    pos.set([s.x, s.y, s.z], i * 3);
    size[i] = s.size;
    bright[i] = parchment ? 0.55 + s.bright * 0.45 : s.bright;
    index[i] = i;
    lock[i] = locked(i) ? 1 : 0;
    const c = tints[s.tint % tints.length];
    tint.set([c.r, c.g, c.b], i * 3);
  });
  const starGeo = new BufferGeometry();
  starGeo.setAttribute('position', new BufferAttribute(pos, 3));
  starGeo.setAttribute('aSize', new BufferAttribute(size, 1));
  starGeo.setAttribute('aBright', new BufferAttribute(bright, 1));
  starGeo.setAttribute('aIndex', new BufferAttribute(index, 1));
  starGeo.setAttribute('aTint', new BufferAttribute(tint, 3));
  starGeo.setAttribute('aLock', new BufferAttribute(lock, 1));
  const visAttr = new BufferAttribute(vis, 1);
  starGeo.setAttribute('aVis', visAttr);
  const starMat = new ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    blending: parchment ? NormalBlending : AdditiveBlending,
    uniforms: {
      uScale: { value: 1 },
      uTime: { value: 0 },
      uHover: { value: -10 },
      uIntro: { value: 0 },
      uNear: { value: 10 },
      uSpan: { value: 12 },
      uMaxPx: { value: 90 * pr },
      uGold: { value: gold },
    },
  });
  const stars = new Points(starGeo, starMat);
  stars.frustumCulled = false;
  scene.add(stars);

  // ── Deep field ──────────────────────────────────────────────────────────
  const rnd = mulberry32(0x5eed + n);
  const dPos = new Float32Array(DUST_COUNT * 3);
  const dSize = new Float32Array(DUST_COUNT);
  const dBright = new Float32Array(DUST_COUNT);
  for (let i = 0; i < DUST_COUNT; i++) {
    // Two shells: a near veil among the constellations, a far sky behind.
    const near = i < DUST_COUNT * 0.35;
    const r = near ? 4 + rnd() * 9 : 20 + rnd() * 45;
    const u = rnd() * 2 - 1;
    const th = rnd() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    dPos.set([Math.cos(th) * s * r * 1.4, u * r * 0.9, Math.sin(th) * s * r], i * 3);
    dSize[i] = near ? 0.06 + rnd() * 0.06 : 0.25 + rnd() * 0.35;
    dBright[i] = (near ? 0.25 : 0.35) + rnd() * 0.45;
  }
  const dustGeo = new BufferGeometry();
  dustGeo.setAttribute('position', new BufferAttribute(dPos, 3));
  dustGeo.setAttribute('aSize', new BufferAttribute(dSize, 1));
  dustGeo.setAttribute('aBright', new BufferAttribute(dBright, 1));
  const dustMat = new ShaderMaterial({
    vertexShader: DUST_VERT,
    fragmentShader: DUST_FRAG,
    transparent: true,
    depthWrite: false,
    blending: parchment ? NormalBlending : AdditiveBlending,
    uniforms: {
      uScale: { value: 1 },
      uIntro: { value: 0 },
      uDim: { value: parchment ? 0.35 : 0.55 },
      uColor: { value: new Color(parchment ? '#5a4630' : '#d9cdb4') },
    },
  });
  const dust = new Points(dustGeo, dustMat);
  dust.frustumCulled = false;
  scene.add(dust);

  // ── Family figures: a nearest-neighbour walk through the brightest few ──
  // One LineSegments per family, so a focused family can keep its figure
  // while the others fade.
  const figures = sky.families.map((f) => {
    // In the glimpse the figures still show the shape of the whole sky (the
    // pull toward Pro is seeing it's there), just fainter; see figBase in the loop.
    const pool = [...f.members];
    const pick = pool.sort((a, b) => sky.stars[b].bright - sky.stars[a].bright).slice(0, 9);
    if (pick.length < 2) return null;
    const seg = [];
    const left = pick.slice(1);
    let cur = pick[0];
    while (left.length) {
      let bi = 0;
      let bd = Infinity;
      left.forEach((m, j) => {
        const a = sky.stars[m];
        const b = sky.stars[cur];
        const d = (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;
        if (d < bd) { bd = d; bi = j; }
      });
      const nx = left.splice(bi, 1)[0];
      const a = sky.stars[cur];
      const b = sky.stars[nx];
      seg.push(a.x, a.y, a.z, b.x, b.y, b.z);
      cur = nx;
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(seg), 3));
    const mat = new LineBasicMaterial({ color: gold, transparent: true, opacity: 0, depthWrite: false });
    const line = new LineSegments(geo, mat);
    scene.add(line);
    return { geo, mat };
  });

  // ── The thread (Pro) ────────────────────────────────────────────────────
  let threadGeo = null;
  let threadMat = null;
  let threadCount = 0;
  if (!glimpse && sky.thread.length >= 2) {
    // Each hop is a shallow bow (a quadratic curve bent a little off the
    // straight line), not a spline through all points: splines overshoot
    // wildly when consecutive reads sit in opposite families.
    const pts = sky.thread.map((i) => new Vector3(sky.stars[i].x, sky.stars[i].y, sky.stars[i].z));
    const STEPS = 14;
    const out = [];
    const alpha = [];
    const hops = pts.length - 1;
    for (let h = 0; h < hops; h++) {
      const a = pts[h];
      const b = pts[h + 1];
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const bow = 0.12 * (h % 2 ? 1 : -1);
      const cx = mx - dy * bow;
      const cy = my + dx * bow;
      const cz = (a.z + b.z) / 2 + 0.4;
      for (let k = h === 0 ? 0 : 1; k <= STEPS; k++) {
        const t = k / STEPS;
        const u = 1 - t;
        out.push(u * u * a.x + 2 * u * t * cx + t * t * b.x, u * u * a.y + 2 * u * t * cy + t * t * b.y, u * u * a.z + 2 * u * t * cz + t * t * b.z);
        alpha.push(0.12 + 0.88 * Math.pow((h + t) / hops, 1.6));
      }
    }
    threadCount = alpha.length;
    threadGeo = new BufferGeometry();
    threadGeo.setAttribute('position', new BufferAttribute(new Float32Array(out), 3));
    threadGeo.setAttribute('aAlpha', new BufferAttribute(new Float32Array(alpha), 1));
    threadGeo.setDrawRange(0, 0);
    threadMat = new ShaderMaterial({
      vertexShader: THREAD_VERT,
      fragmentShader: THREAD_FRAG,
      transparent: true,
      depthWrite: false,
      uniforms: { uColor: { value: gold }, uOpacity: { value: parchment ? 0.8 : 0.6 } },
    });
    const line = new Line(threadGeo, threadMat);
    line.frustumCulled = false;
    scene.add(line);
  }

  // ── Camera: orbit round a target, eased toward a goal ───────────────────
  let extentX = 1;
  let extentY = 1;
  sky.stars.forEach((s) => {
    extentX = Math.max(extentX, Math.abs(s.x));
    extentY = Math.max(extentY, Math.abs(s.y));
  });
  sky.families.forEach((f) => { extentY = Math.max(extentY, Math.abs(f.y) + 0.3); });
  extentX += 1.2;
  extentY += 0.9;

  const tan = Math.tan((FOV * Math.PI) / 360);
  let homeD = 10;
  const cur = { yaw: 0, pitch: 0, d: 10, t: new Vector3() };
  const goal = { yaw: 0, pitch: 0, d: 10, t: new Vector3() };
  let focused = -1;
  const minD = () => Math.max(0.9, homeD * 0.1);
  const maxD = () => homeD * 1.35;

  let W = 1;
  let H = 1;
  let first = true;
  function resize() {
    W = host.clientWidth || 1;
    H = host.clientHeight || 1;
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    const prevHome = homeD;
    homeD = Math.max(extentY / tan, extentX / (tan * camera.aspect)) + 1.5;
    if (first) { cur.d = goal.d = homeD; first = false; }
    else if (focused < 0 && Math.abs(goal.d - prevHome) < 1e-3) goal.d = homeD;
    starMat.uniforms.uScale.value = (H * pr) / (2 * tan);
    dustMat.uniforms.uScale.value = (H * pr) / (2 * tan);
  }
  resize();
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
  ro?.observe(host);

  const fwd = new Vector3();
  const right = new Vector3();
  const up = new Vector3();
  function placeCamera() {
    const cp = Math.cos(cur.pitch);
    fwd.set(-Math.sin(cur.yaw) * cp, -Math.sin(cur.pitch), -Math.cos(cur.yaw) * cp); // camera → target
    camera.position.copy(cur.t).addScaledVector(fwd, -cur.d);
    camera.up.set(0, 1, 0);
    camera.lookAt(cur.t);
    camera.updateMatrixWorld();
    right.setFromMatrixColumn(camera.matrixWorld, 0);
    up.setFromMatrixColumn(camera.matrixWorld, 1);
  }
  placeCamera();

  let zoomedFlag = false;
  function reportView() {
    const z = focused >= 0 || goal.d < homeD * 0.92 || goal.t.lengthSq() > 0.05;
    if (z !== zoomedFlag) {
      zoomedFlag = z;
      // At the home view a one-finger vertical swipe scrolls the page; once
      // the reader is inside the sky, gestures belong to the sky.
      canvas.style.touchAction = z ? 'none' : 'pan-y';
      onView?.({ zoomed: z });
    }
  }

  // Zoom by factor f (<1 = in) toward a screen point (CSS px; default centre).
  const tmp = new Vector3();
  function zoomAt(f, sx = W / 2, sy = H / 2) {
    if (glimpse) return;
    const nd = clamp(goal.d * f, minD(), maxD());
    const real = nd / goal.d;
    if (Math.abs(real - 1) < 1e-4) return;
    // Anchor: the star under the pointer if there is one, else the point on
    // the target plane under it. Scaling camera and target about the anchor
    // keeps the anchor on the same screen ray, so what you aim at stays put.
    const hit = pickAt(sx, sy);
    if (hit >= 0) {
      const s = sky.stars[hit];
      tmp.set(s.x, s.y, s.z);
    } else {
      const nx = (sx / W) * 2 - 1;
      const ny = -(sy / H) * 2 + 1;
      const hh = tan * goal.d;
      tmp.copy(goal.t)
        .addScaledVector(right, nx * hh * camera.aspect)
        .addScaledVector(up, ny * hh);
    }
    goal.t.sub(tmp).multiplyScalar(real).add(tmp);
    goal.d = nd;
    // Zooming back out to the home distance drifts home.
    if (goal.d >= homeD * 0.98 && focused < 0) goal.t.set(0, 0, 0);
    reportView();
  }
  function panBy(dx, dy) {
    if (glimpse) return;
    const k = (2 * tan * cur.d) / H;
    goal.t.addScaledVector(right, -dx * k).addScaledVector(up, dy * k);
    reportView();
  }

  // ── Focus a family ──────────────────────────────────────────────────────
  const visGoal = new Float32Array(n).fill(1);
  const famAlpha = sky.families.map(() => 1);
  const famGoal = sky.families.map(() => 1);
  let threadVis = 1;
  function focus(fi) {
    focused = fi != null && fi >= 0 && sky.families[fi] ? fi : -1;
    sky.stars.forEach((s, i) => { visGoal[i] = focused < 0 || s.family === focused ? 1 : 0; });
    sky.families.forEach((_, i) => { famGoal[i] = focused < 0 || i === focused ? 1 : 0; });
    if (focused >= 0) {
      const f = sky.families[focused];
      goal.t.set(f.cx, f.cy, f.cz);
      goal.d = clamp(f.radius / (tan * Math.min(1, camera.aspect)) * 1.25 + f.radius, minD(), homeD);
    } else {
      goal.t.set(0, 0, 0);
      goal.d = homeD;
    }
    if (hovered >= 0 && visGoal[hovered] === 0) setHover(-1);
    reportView();
  }
  function reset() {
    if (focused >= 0) { focus(-1); return; }
    goal.t.set(0, 0, 0);
    goal.d = homeD;
    goal.pitch = 0;
    reportView();
  }

  // ── Screen-space picking ────────────────────────────────────────────────
  const screen = new Float32Array(n * 3); // x, y, radius (CSS px); radius 0 = not pickable
  function projectStars() {
    const scale = starMat.uniforms.uScale.value / pr;
    for (let i = 0; i < n; i++) {
      const s = sky.stars[i];
      tmp.set(s.x, s.y, s.z).applyMatrix4(camera.matrixWorldInverse);
      const depth = -tmp.z;
      if (depth <= 0.05 || vis[i] < 0.5) { screen[i * 3 + 2] = 0; continue; }
      tmp.applyMatrix4(camera.projectionMatrix);
      screen[i * 3] = (tmp.x * 0.5 + 0.5) * W;
      screen[i * 3 + 1] = (-tmp.y * 0.5 + 0.5) * H;
      const px = Math.min((s.size * 0.3 * scale) / depth, 90);
      screen[i * 3 + 2] = Math.max(PICK_PX, px * 0.45);
    }
  }
  function pickAt(x, y) {
    let best = -1;
    let bestScore = 1;
    for (let i = 0; i < n; i++) {
      const r = screen[i * 3 + 2];
      if (!r) continue;
      const dx = screen[i * 3] - x;
      const dy = screen[i * 3 + 1] - y;
      const score = Math.sqrt(dx * dx + dy * dy) / r; // <1 = inside its radius
      if (score < bestScore) { bestScore = score; best = i; }
    }
    return best;
  }

  // ── Interaction ─────────────────────────────────────────────────────────
  let hovered = -1;
  let pointerInside = false;
  let engaged = false;
  let lastInput = 0;
  const pointers = new Map(); // id → { x, y }
  let drag = null; // { mode: 'turn'|'pan', moved }
  let pinch = null; // { dist, mx, my }
  let lastPos = null;

  const local = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  function setHover(i, p) {
    if (i === hovered) {
      if (i >= 0 && p) onHover?.(i, p, locked(i));
      return;
    }
    hovered = i;
    starMat.uniforms.uHover.value = i >= 0 && !locked(i) ? i : -10;
    canvas.style.cursor = i >= 0 ? 'pointer' : 'grab';
    onHover?.(i, i >= 0 ? p : null, i >= 0 && locked(i));
  }
  function onMove(e) {
    const p = local(e);
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, p);
    lastInput = performance.now();
    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      zoomAt(pinch.dist / dist, mx, my);
      panBy(mx - pinch.mx, my - pinch.my);
      pinch = { dist, mx, my };
      return;
    }
    if (drag) {
      const dx = p.x - lastPos.x;
      const dy = p.y - lastPos.y;
      lastPos = p;
      drag.moved += Math.abs(dx) + Math.abs(dy);
      if (drag.mode === 'pan') panBy(dx, dy);
      else {
        goal.yaw -= dx * 0.005;
        goal.pitch = clamp(goal.pitch + dy * 0.004, -1.2, 1.2);
      }
      return;
    }
    setHover(pickAt(p.x, p.y), p);
  }
  function onDown(e) {
    const p = local(e);
    engaged = true;
    lastInput = performance.now();
    pointers.set(e.pointerId, p);
    canvas.setPointerCapture?.(e.pointerId);
    if (pointers.size >= 2 && !glimpse) {
      const [a, b] = [...pointers.values()];
      pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
      drag = null;
      return;
    }
    const pan = (e.shiftKey || e.button === 2) && !glimpse;
    drag = { mode: pan ? 'pan' : 'turn', moved: 0 };
    lastPos = p;
  }
  function onUp(e) {
    const had = pointers.delete(e.pointerId);
    canvas.releasePointerCapture?.(e.pointerId);
    if (pinch) {
      if (pointers.size < 2) pinch = null;
      drag = null;
      return;
    }
    if (!had || !drag) return;
    const d = drag;
    drag = null;
    if (e.type === 'pointercancel' || d.moved >= 6) return;
    const p = local(e);
    const i = pickAt(p.x, p.y);
    if (e.pointerType !== 'mouse') setHover(i, p); // tap = reveal first…
    else if (i >= 0 && !locked(i)) onPick?.(i);    // …click = open
  }
  function onLeave() {
    pointerInside = false;
    engaged = false;
    if (!drag) setHover(-1);
  }
  function onEnter() { pointerInside = true; }
  let hintAt = 0;
  function onWheel(e) {
    if (glimpse) return;
    const pinchGesture = e.ctrlKey || e.metaKey;
    if (!engaged && !pinchGesture) {
      const now = performance.now();
      if (now - hintAt > 4000) { hintAt = now; onHint?.(); }
      return; // let the page scroll
    }
    e.preventDefault();
    lastInput = performance.now();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? H : 1;
    const dy = e.deltaY * unit;
    const f = Math.exp(dy * (pinchGesture ? 0.01 : 0.0015));
    const p = local(e);
    zoomAt(f, p.x, p.y);
  }
  function onDbl(e) {
    if (glimpse) return;
    const p = local(e);
    zoomAt(0.5, p.x, p.y);
  }
  const noMenu = (e) => { if (!glimpse) e.preventDefault(); };
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('pointerenter', onEnter);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('dblclick', onDbl);
  canvas.addEventListener('contextmenu', noMenu);
  canvas.style.touchAction = 'pan-y';

  // ── Loop ────────────────────────────────────────────────────────────────
  let raf = 0;
  let disposed = false;
  let inView = false;
  let introStart = 0;
  let prev = performance.now();
  const t0 = prev;
  const v = new Vector3();

  function frame(now) {
    raf = 0;
    const dt = Math.min(0.05, (now - prev) / 1000);
    prev = now;
    const time = (now - t0) / 1000;
    if (!introStart) introStart = now;
    const intro = Math.min(1, (now - introStart) / 2600);

    // A slow drift round the sky while nobody is touching it, so the depth
    // shows even to a reader who never drags.
    const idle = !drag && !pinch && !pointerInside && now - lastInput > 3500;
    if (idle && focused < 0) goal.yaw += dt * 0.05;

    const k = 1 - Math.exp(-dt * 7);
    cur.yaw += (goal.yaw - cur.yaw) * k;
    cur.pitch += (goal.pitch - cur.pitch) * k;
    cur.d += (goal.d - cur.d) * k;
    cur.t.lerp(goal.t, k);
    placeCamera();

    // Focus fades
    const kf = 1 - Math.exp(-dt * 6);
    let dirty = false;
    for (let i = 0; i < n; i++) {
      const dv = visGoal[i] - vis[i];
      if (Math.abs(dv) > 0.002) { vis[i] += dv * kf; dirty = true; } else if (dv) { vis[i] = visGoal[i]; dirty = true; }
    }
    if (dirty) visAttr.needsUpdate = true;
    famAlpha.forEach((a, i) => { famAlpha[i] = a + (famGoal[i] - a) * kf; });
    threadVis += ((focused < 0 ? 1 : 0) - threadVis) * kf;

    starMat.uniforms.uTime.value = time;
    starMat.uniforms.uIntro.value = intro * 1.3;
    starMat.uniforms.uNear.value = Math.max(0.1, cur.d - 3);
    starMat.uniforms.uSpan.value = 9 + cur.d * 0.3;
    dustMat.uniforms.uIntro.value = Math.min(1, intro * 1.5);
    const figBase = (parchment ? 0.32 : 0.16) * (glimpse ? 0.6 : 1) * Math.min(1, Math.max(0, (intro - 0.35) / 0.4));
    figures.forEach((fg, i) => {
      if (!fg) return;
      // A focused family's figure comes forward a little.
      fg.mat.opacity = figBase * famAlpha[i] * (focused === i ? 1.8 : 1);
    });
    if (threadGeo) {
      const kt = Math.min(1, Math.max(0, (now - introStart - 900) / 3200));
      threadGeo.setDrawRange(0, Math.floor(threadCount * (1 - Math.pow(1 - kt, 3))));
      threadMat.uniforms.uOpacity.value = (parchment ? 0.8 : 0.6) * threadVis;
    }

    // Family labels follow their constellations; hidden behind the camera,
    // dimmed with depth, faded out when another family has the focus.
    labels.forEach((el, i) => {
      const f = sky.families[i];
      if (!el || !f) return;
      v.set(f.x, f.y, f.z).applyMatrix4(camera.matrixWorldInverse);
      const depth = -v.z;
      v.applyMatrix4(camera.projectionMatrix);
      const x = (v.x * 0.5 + 0.5) * W;
      const y = (-v.y * 0.5 + 0.5) * H;
      const fog = clamp(1 - (depth - (cur.d + 2)) / 14, 0.35, 1);
      const a = depth <= 0.2 ? 0 : Math.min(1, Math.max(0, (intro - 0.5) / 0.3)) * fog * famAlpha[i];
      el.style.transform = `translate(-50%, -100%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      el.style.opacity = a.toFixed(3);
      el.style.pointerEvents = a > 0.3 ? 'auto' : 'none';
      el.style.zIndex = String(Math.round(1000 - depth * 10));
    });

    projectStars();
    renderer.render(scene, camera);
    loop();
  }
  function loop() {
    if (!disposed && inView && !document.hidden && !raf) raf = requestAnimationFrame(frame);
  }
  const io = typeof IntersectionObserver !== 'undefined'
    ? new IntersectionObserver(([e]) => { inView = e.isIntersecting; if (inView) { prev = performance.now(); loop(); } }, { threshold: 0.15 })
    : null;
  if (io) io.observe(host);
  else { inView = true; loop(); }
  function onVis() { prev = performance.now(); loop(); }
  document.addEventListener('visibilitychange', onVis);

  return {
    zoomBy: (f) => { lastInput = performance.now(); zoomAt(f); },
    reset,
    focus,
    dispose() {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      io?.disconnect();
      ro?.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('pointerenter', onEnter);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('dblclick', onDbl);
      canvas.removeEventListener('contextmenu', noMenu);
      figures.forEach((fg) => { fg?.geo.dispose(); fg?.mat.dispose(); });
      [starGeo, starMat, dustGeo, dustMat, threadGeo, threadMat].forEach((d) => d?.dispose());
      renderer.dispose();
      renderer.forceContextLoss?.();
      canvas.remove();
    },
  };
}
