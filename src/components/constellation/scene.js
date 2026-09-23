// src/components/constellation/scene.js — the reader's sky (lazy chunk).
//
// One Points draw for the stars, one LineSegments for the family figures, one
// Line for the gold thread (a smooth curve through the last reads, drawn in
// the first time the sky comes into view). Family names are DOM labels the
// caller renders; this scene only moves them, so they stay crisp, selectable
// and translated. Drag to sway the sky (it springs back gently), hover a star
// for its book, click to open it.
import {
  WebGLRenderer,
  Scene,
  PerspectiveCamera,
  Group,
  BufferGeometry,
  BufferAttribute,
  Points,
  ShaderMaterial,
  LineSegments,
  LineBasicMaterial,
  Line,
  Vector3,
  Raycaster,
  Vector2,
  Color,
  AdditiveBlending,
  NormalBlending,
} from 'three';

const FOV = 42;

const TINTS_INK = ['#fff3d6', '#f5d9a8', '#e9c98f', '#ffe9c4', '#f3e2d0', '#e6d3a3', '#fbe7b5', '#efd8b8', '#cfc6b4'];
const TINTS_PARCHMENT = ['#3a2a14', '#4a3216', '#5a3d18', '#3f2e1c', '#4d3a22', '#553f1c', '#47341a', '#3c2d18', '#6b5a45'];

const VERT = /* glsl */ `
  uniform float uScale, uTime, uHover, uIntro;
  attribute float aSize, aBright, aIndex;
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
    gl_PointSize = aSize * (0.3 + hot * 0.18) * uScale / -mv.z * born;
    vTint = aTint;
    vAlpha = aBright * tw * born;
    vHot = hot;
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

export function createConstellationScene(host, { sky, colors, labels = [], onHover, onPick }) {
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
  const camera = new PerspectiveCamera(FOV, 1, 0.1, 200);
  const sway = new Group();
  scene.add(sway);

  const parchment = colors.parchment;
  const tints = (parchment ? TINTS_PARCHMENT : TINTS_INK).map((c) => new Color(c));
  const gold = new Color(colors.gold);

  // ── Stars ───────────────────────────────────────────────────────────────
  const n = sky.stars.length;
  const pos = new Float32Array(n * 3);
  const size = new Float32Array(n);
  const bright = new Float32Array(n);
  const index = new Float32Array(n);
  const tint = new Float32Array(n * 3);
  sky.stars.forEach((s, i) => {
    pos.set([s.x, s.y, s.z], i * 3);
    size[i] = s.size;
    bright[i] = parchment ? 0.55 + s.bright * 0.45 : s.bright;
    index[i] = i;
    const c = tints[s.tint % tints.length];
    tint.set([c.r, c.g, c.b], i * 3);
  });
  const starGeo = new BufferGeometry();
  starGeo.setAttribute('position', new BufferAttribute(pos, 3));
  starGeo.setAttribute('aSize', new BufferAttribute(size, 1));
  starGeo.setAttribute('aBright', new BufferAttribute(bright, 1));
  starGeo.setAttribute('aIndex', new BufferAttribute(index, 1));
  starGeo.setAttribute('aTint', new BufferAttribute(tint, 3));
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
      uGold: { value: gold },
    },
  });
  const stars = new Points(starGeo, starMat);
  sway.add(stars);

  // ── Family figures: a nearest-neighbour walk through the brightest few ──
  const seg = [];
  for (const f of sky.families) {
    const pick = [...f.members].sort((a, b) => sky.stars[b].bright - sky.stars[a].bright).slice(0, 9);
    if (pick.length < 2) continue;
    const left = pick.slice(1);
    let cur = pick[0];
    while (left.length) {
      let bi = 0;
      let bd = Infinity;
      left.forEach((m, j) => {
        const dx = sky.stars[m].x - sky.stars[cur].x;
        const dy = sky.stars[m].y - sky.stars[cur].y;
        const d = dx * dx + dy * dy;
        if (d < bd) { bd = d; bi = j; }
      });
      const nx = left.splice(bi, 1)[0];
      const a = sky.stars[cur];
      const b = sky.stars[nx];
      seg.push(a.x, a.y, a.z, b.x, b.y, b.z);
      cur = nx;
    }
  }
  const figGeo = new BufferGeometry();
  figGeo.setAttribute('position', new BufferAttribute(new Float32Array(seg), 3));
  const figMat = new LineBasicMaterial({ color: gold, transparent: true, opacity: 0, depthWrite: false });
  const figures = new LineSegments(figGeo, figMat);
  sway.add(figures);

  // ── The thread ──────────────────────────────────────────────────────────
  let threadGeo = null;
  let threadMat = null;
  let threadCount = 0;
  if (sky.thread.length >= 2) {
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
    sway.add(new Line(threadGeo, threadMat));
  }

  // ── Size / fit ──────────────────────────────────────────────────────────
  let extentX = 1;
  let extentY = 1;
  sky.stars.forEach((s) => {
    extentX = Math.max(extentX, Math.abs(s.x));
    extentY = Math.max(extentY, Math.abs(s.y));
  });
  sky.families.forEach((f) => { extentY = Math.max(extentY, Math.abs(f.y) + 0.3); });
  extentX += 1.2;
  extentY += 0.9;

  let W = 1;
  let H = 1;
  function resize() {
    W = host.clientWidth || 1;
    H = host.clientHeight || 1;
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    const tan = Math.tan((FOV * Math.PI) / 360);
    const d = Math.max(extentY / tan, extentX / (tan * camera.aspect)) + 1.5;
    camera.position.set(0, 0, d);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    starMat.uniforms.uScale.value = (H * pr) / (2 * tan);
  }
  resize();
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
  ro?.observe(host);

  // ── Interaction ─────────────────────────────────────────────────────────
  const ray = new Raycaster();
  const ndc = new Vector2(9, 9);
  let hovered = -1;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let moved = 0;
  let yaw = 0;
  let pitch = 0;
  let yawV = 0;
  let pitchV = 0;

  function setNdc(e) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    return r;
  }
  function pick() {
    ray.params.Points.threshold = 0.22;
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObject(stars, false)[0];
    return hit ? hit.index : -1;
  }
  function hover(i, e, r) {
    if (i === hovered) {
      if (i >= 0) onHover?.(i, { x: e.clientX - r.left, y: e.clientY - r.top });
      return;
    }
    hovered = i;
    starMat.uniforms.uHover.value = i;
    canvas.style.cursor = i >= 0 ? 'pointer' : 'grab';
    onHover?.(i, i >= 0 ? { x: e.clientX - r.left, y: e.clientY - r.top } : null);
  }
  function onMove(e) {
    const r = setNdc(e);
    if (dragging) {
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      moved += Math.abs(dx) + Math.abs(dy);
      yawV = dx * 0.004;
      pitchV = dy * 0.003;
      yaw += yawV;
      pitch += pitchV;
      return;
    }
    hover(pick(), e, r);
  }
  function onDown(e) {
    setNdc(e);
    dragging = true;
    moved = 0;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture?.(e.pointerId);
  }
  function onUp(e) {
    if (!dragging) return;
    dragging = false;
    canvas.releasePointerCapture?.(e.pointerId);
    if (moved < 6) {
      const r = setNdc(e);
      const i = pick();
      if (e.pointerType !== 'mouse') hover(i, e, r); // tap = reveal first…
      else if (i >= 0) onPick?.(i);                  // …click = open
    }
  }
  function onLeave() {
    if (!dragging) hover(-1, null, null);
  }
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('pointerleave', onLeave);

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

    if (!dragging) {
      yaw += yawV;
      pitch += pitchV;
      yawV *= Math.pow(0.02, dt);
      pitchV *= Math.pow(0.02, dt);
      // spring home, with a slow drift so the sky is never quite still
      const homeYaw = Math.sin(time * 0.12) * 0.12;
      yaw += (homeYaw - yaw) * Math.min(1, dt * 0.8);
      pitch += (0 - pitch) * Math.min(1, dt * 0.8);
    }
    yaw = Math.max(-0.9, Math.min(0.9, yaw));
    pitch = Math.max(-0.5, Math.min(0.5, pitch));
    sway.rotation.set(pitch, yaw, 0);

    starMat.uniforms.uTime.value = time;
    starMat.uniforms.uIntro.value = intro * 1.3;
    figMat.opacity = (parchment ? 0.32 : 0.16) * Math.min(1, Math.max(0, (intro - 0.35) / 0.4));
    if (threadGeo) {
      const k = Math.min(1, Math.max(0, (now - introStart - 900) / 3200));
      const e = 1 - Math.pow(1 - k, 3);
      threadGeo.setDrawRange(0, Math.floor(threadCount * e));
    }

    // Family labels follow their constellations.
    sway.updateMatrixWorld();
    labels.forEach((el, i) => {
      const f = sky.families[i];
      if (!el || !f) return;
      v.set(f.x, f.y, f.z).applyMatrix4(sway.matrixWorld).project(camera);
      const x = (v.x * 0.5 + 0.5) * W;
      const y = (-v.y * 0.5 + 0.5) * H;
      el.style.transform = `translate(-50%, -100%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      el.style.opacity = String(Math.min(1, Math.max(0, (intro - 0.5) / 0.3)));
    });

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
      [starGeo, starMat, figGeo, figMat, threadGeo, threadMat].forEach((d) => d?.dispose());
      renderer.dispose();
      renderer.forceContextLoss?.();
      canvas.remove();
    },
  };
}
