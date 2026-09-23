// src/components/oracleSpread/scene.js — the Oracle's long-wait tarot spread.
//
// Lazy chunk. A tarot spread of face-down Oracle cards under a sky of stars,
// in the landing's constellation language. Every ~12 s the stars choose:
//
//   1. a handful of stars brighten, one after another, high in the sky;
//   2. a constellation line draws through them, descending toward one card;
//   3. the last star falls along the line to that card, which glows, rises
//      and turns over to show an arcana (The Star, The Lantern…);
//   4. it holds, then everything settles back and the stars choose again.
//
// It is a waiting ritual, not a result: the arcana are the Oracle's own
// cards, never the recommendation and never a book from the shelf.
// Interaction is light: the sky leans toward the pointer, and clicking a card
// asks the stars to choose that one next.
//
// Runs only while on screen and the tab is visible.
import {
  WebGLRenderer,
  Scene,
  PerspectiveCamera,
  PlaneGeometry,
  MeshBasicMaterial,
  Mesh,
  Group,
  CanvasTexture,
  SRGBColorSpace,
  Raycaster,
  Vector2,
  Vector3,
  BufferGeometry,
  BufferAttribute,
  Points,
  ShaderMaterial,
  Line,
  LineBasicMaterial,
  Color,
  AdditiveBlending,
  NormalBlending,
} from 'three';
import gsap from 'gsap';
import { drawBack, drawFace, drawGlow } from './cardArt';

const PATH_STARS = 5;
const SEG_STEPS = 24; // line samples per hop

const STAR_VERT = /* glsl */ `
  uniform float uTime, uPix;
  attribute float aSize, aAlpha, aPhase;
  varying float vA;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float tw = 0.65 + 0.35 * sin(uTime * (0.8 + fract(aPhase * 7.3) * 1.6) + aPhase * 40.0);
    gl_PointSize = aSize * uPix * (20.0 / -mv.z);
    vA = aAlpha * tw;
  }
`;
const STAR_FRAG = /* glsl */ `
  uniform vec3 uColor, uCore;
  varying float vA;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    float core = pow(smoothstep(0.5, 0.0, d), 2.8);
    float flare = (max(0.0, 1.0 - abs(c.x) * 26.0) * smoothstep(0.5, 0.0, abs(c.y))
                 + max(0.0, 1.0 - abs(c.y) * 26.0) * smoothstep(0.5, 0.0, abs(c.x))) * 0.45;
    float a = clamp(core + flare, 0.0, 1.0) * vA;
    if (a < 0.01) discard;
    gl_FragColor = vec4(mix(uColor, uCore, core * 0.6), a);
  }
`;

function starMaterial(colors, pr) {
  return new ShaderMaterial({
    vertexShader: STAR_VERT,
    fragmentShader: STAR_FRAG,
    transparent: true,
    depthWrite: false,
    blending: colors.parchment ? NormalBlending : AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uPix: { value: pr },
      uColor: { value: new Color(colors.gold) },
      uCore: { value: new Color(colors.parchment ? '#4a3510' : '#fff6dc') },
    },
  });
}

export function createSpreadScene(host, { colors, faces, mobile = false }) {
  let renderer;
  try {
    renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
  } catch {
    return null;
  }
  let disposed = false;
  const pr = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(pr);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = SRGBColorSpace;
  const canvas = renderer.domElement;
  canvas.className = 'ows__canvas';
  host.appendChild(canvas);

  const scene = new Scene();
  const camera = new PerspectiveCamera(40, 1, 0.1, 50);
  // Framed with a clear margin under the cards (they lift and scale up when
  // chosen) — the first framing cropped their bottoms.
  camera.position.set(0, 0.75, 6.8);
  camera.lookAt(0, 0.75, 0);
  const world = new Group();
  scene.add(world);

  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const disposables = [];
  const tex = (cv) => {
    const t = new CanvasTexture(cv);
    t.colorSpace = SRGBColorSpace;
    t.anisotropy = aniso;
    disposables.push(t);
    return t;
  };

  // ── The spread ──────────────────────────────────────────────────────────
  const N = mobile ? 3 : 5;
  const GAP = mobile ? 1.18 : 1.3;
  const geo = new PlaneGeometry(1, 1.5);
  const backTex = tex(drawBack(colors));
  const faceTex = faces.map((f) => tex(drawFace(f, colors)));
  disposables.push(geo);

  const cards = [];
  for (let i = 0; i < N; i++) {
    const off = i - (N - 1) / 2;
    const frontMat = new MeshBasicMaterial({ map: faceTex[0], transparent: true, alphaTest: 0.05 });
    const backMat = new MeshBasicMaterial({ map: backTex, transparent: true, alphaTest: 0.05 });
    disposables.push(frontMat, backMat);
    const front = new Mesh(geo, frontMat);
    const back = new Mesh(geo, backMat);
    back.rotation.y = Math.PI;
    const group = new Group();
    group.add(front, back);
    const home = { x: off * GAP, y: -0.5 - off * off * 0.05, rz: -off * 0.05 };
    const card = { i, group, front, back, frontMat, backMat, home, lift: 0, flip: 0, dim: 0, deal: 0 };
    front.userData.card = card;
    back.userData.card = card;
    cards.push(card);
    world.add(group);
  }

  // Halo behind the chosen card.
  const glowTex = tex(drawGlow(colors.gold));
  const glowMat = new MeshBasicMaterial({
    map: glowTex,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: colors.parchment ? NormalBlending : AdditiveBlending,
  });
  const glow = new Mesh(new PlaneGeometry(2.8, 2.8), glowMat);
  glow.position.z = -0.05;
  world.add(glow);
  disposables.push(glowMat, glow.geometry);

  // ── Sky ─────────────────────────────────────────────────────────────────
  const BG = mobile ? 45 : 80;
  const bgPos = new Float32Array(BG * 3);
  const bgSize = new Float32Array(BG);
  const bgAlpha = new Float32Array(BG);
  const bgPhase = new Float32Array(BG);
  for (let i = 0; i < BG; i++) {
    bgPos[i * 3] = (Math.random() * 2 - 1) * (mobile ? 2.6 : 4.6);
    bgPos[i * 3 + 1] = 0.5 + Math.random() * 2.5;
    bgPos[i * 3 + 2] = -0.6 - Math.random() * 1.2;
    bgSize[i] = 1 + Math.random() * 2.2;
    bgAlpha[i] = 0.25 + Math.random() * 0.45;
    bgPhase[i] = Math.random();
  }
  const bgGeo = new BufferGeometry();
  bgGeo.setAttribute('position', new BufferAttribute(bgPos, 3));
  bgGeo.setAttribute('aSize', new BufferAttribute(bgSize, 1));
  bgGeo.setAttribute('aAlpha', new BufferAttribute(bgAlpha, 1));
  bgGeo.setAttribute('aPhase', new BufferAttribute(bgPhase, 1));
  const bgMat = starMaterial(colors, pr);
  world.add(new Points(bgGeo, bgMat));
  disposables.push(bgGeo, bgMat);

  // The choosing constellation (+1 slot for the falling star).
  const pPos = new Float32Array((PATH_STARS + 1) * 3);
  const pSize = new Float32Array(PATH_STARS + 1).fill(6);
  const pAlpha = new Float32Array(PATH_STARS + 1);
  const pPhase = new Float32Array(PATH_STARS + 1).map(() => Math.random());
  pSize[PATH_STARS] = 7.5;
  const pGeo = new BufferGeometry();
  const pPosAttr = new BufferAttribute(pPos, 3);
  const pAlphaAttr = new BufferAttribute(pAlpha, 1);
  pGeo.setAttribute('position', pPosAttr);
  pGeo.setAttribute('aSize', new BufferAttribute(pSize, 1));
  pGeo.setAttribute('aAlpha', pAlphaAttr);
  pGeo.setAttribute('aPhase', new BufferAttribute(pPhase, 1));
  const pMat = starMaterial(colors, pr);
  const pathPoints = new Points(pGeo, pMat);
  pathPoints.frustumCulled = false;
  world.add(pathPoints);
  disposables.push(pGeo, pMat);

  const LINE_PTS = PATH_STARS * SEG_STEPS + 1; // hops between stars + tail to card
  const lPos = new Float32Array(LINE_PTS * 3);
  const lGeo = new BufferGeometry();
  const lPosAttr = new BufferAttribute(lPos, 3);
  lGeo.setAttribute('position', lPosAttr);
  lGeo.setDrawRange(0, 0);
  const lMat = new LineBasicMaterial({ color: colors.gold, transparent: true, opacity: 0.7, depthWrite: false });
  const pathLine = new Line(lGeo, lMat);
  pathLine.frustumCulled = false;
  world.add(pathLine);
  disposables.push(lGeo, lMat);

  // State the timeline animates; the frame loop writes it into buffers.
  const st = { starA: new Array(PATH_STARS).fill(0), draw: 0, fall: 0, sparkA: 0, lineA: 0.7, glow: 0 };
  const tail = [];

  function buildPath(card) {
    const tx = card.home.x;
    const top = new Vector3(tx, card.home.y + 0.9, 0.05);
    const span = mobile ? 2.2 : 4;
    const sx = gsap.utils.clamp(-span, span, tx + (Math.random() < 0.5 ? -1 : 1) * (1.2 + Math.random() * 1.6));
    const pts = [];
    for (let k = 0; k < PATH_STARS; k++) {
      const u = k / (PATH_STARS - 1);
      pts.push(new Vector3(
        sx + (tx - sx) * u * 0.85 + (Math.random() * 2 - 1) * 0.35 * (1 - u * 0.6),
        2.35 - u * 1.35 + (Math.random() * 2 - 1) * 0.12,
        -0.4 - Math.random() * 0.4,
      ));
    }
    pts.forEach((p, k) => pPos.set([p.x, p.y, p.z], k * 3));
    pPosAttr.needsUpdate = true;
    // Line: straight hops between stars, then a gentle arc down to the card.
    let n = 0;
    for (let k = 0; k < PATH_STARS - 1; k++) {
      for (let s = k === 0 ? 0 : 1; s <= SEG_STEPS; s++) {
        const v = new Vector3().lerpVectors(pts[k], pts[k + 1], s / SEG_STEPS);
        lPos.set([v.x, v.y, v.z], n++ * 3);
      }
    }
    tail.length = 0;
    const a = pts[PATH_STARS - 1];
    const ctrl = new Vector3((a.x + top.x) / 2 + (a.x - top.x) * 0.3, (a.y + top.y) / 2 + 0.2, 0);
    for (let s = 1; s <= SEG_STEPS; s++) {
      const t = s / SEG_STEPS;
      const u = 1 - t;
      const v = new Vector3(
        u * u * a.x + 2 * u * t * ctrl.x + t * t * top.x,
        u * u * a.y + 2 * u * t * ctrl.y + t * t * top.y,
        u * u * a.z + 2 * u * t * ctrl.z + t * t * top.z,
      );
      tail.push(v);
      lPos.set([v.x, v.y, v.z], n++ * 3);
    }
    lPosAttr.needsUpdate = true;
    return { hopPts: (PATH_STARS - 1) * SEG_STEPS + 1, total: n };
  }

  // ── Choreography ────────────────────────────────────────────────────────
  let tl = null;
  let last = -1;
  let queued = -1;
  let faceIdx = Math.floor(Math.random() * faces.length);

  function pick() {
    if (queued >= 0) { const q = queued; queued = -1; return q; }
    let c;
    do { c = Math.floor(Math.random() * N); } while (N > 1 && c === last);
    return c;
  }

  function cycle(first) {
    if (disposed) return;
    const ci = pick();
    last = ci;
    const card = cards[ci];
    faceIdx = (faceIdx + 1) % faces.length;
    card.frontMat.map = faceTex[faceIdx];
    card.frontMat.needsUpdate = true;
    const { hopPts, total } = buildPath(card);
    glow.position.set(card.home.x, card.home.y + 0.35, -0.05);

    tl = gsap.timeline({ onComplete: () => cycle(false) });
    if (first) {
      cards.forEach((c, k) => tl.to(c, { deal: 1, duration: 0.9, ease: 'power3.out' }, k * 0.12));
      tl.addLabel('go', '+=0.2');
    } else {
      tl.addLabel('go');
    }
    // 1. stars brighten one by one
    for (let k = 0; k < PATH_STARS; k++) {
      tl.to(st.starA, { [k]: 1, duration: 0.5, ease: 'power2.out' }, `go+=${k * 0.35}`);
    }
    // 2. the constellation draws through them
    tl.set(st, { lineA: 0.7 }, 'go')
      .fromTo(st, { draw: 0 }, { draw: hopPts, duration: 2.4, ease: 'none' }, 'go+=0.35')
    // 3. the last star falls to the card
      .set(st, { sparkA: 1 }, '>')
      .to(st.starA, { [PATH_STARS - 1]: 0.35, duration: 0.3 }, '<')
      .fromTo(st, { fall: 0 }, { fall: 1, duration: 1.0, ease: 'power2.in' }, '<')
      .to(st, { sparkA: 0, duration: 0.25 }, '>-0.1')
      .to(st, { glow: 1, duration: 0.7, ease: 'power2.out' }, '<')
      .to(card, { lift: 1, duration: 0.8, ease: 'power2.out' }, '<')
      .to(cards.filter((c) => c !== card), { dim: 1, duration: 0.8 }, '<')
    // 4. it turns over, holds…
      .to(card, { flip: 1, duration: 1.2, ease: 'power2.inOut' }, '>-0.3')
      .to({}, { duration: 3.4 })
    // 5. …and everything settles for the next choosing
      .to(card, { flip: 0, duration: 0.9, ease: 'power2.inOut' })
      .to(card, { lift: 0, duration: 0.8, ease: 'power2.inOut' }, '<')
      .to(st, { glow: 0, lineA: 0, duration: 0.8 }, '<')
      .to(st.starA, { ...Object.fromEntries(st.starA.map((_, k) => [k, 0])), duration: 0.8 }, '<')
      .to(cards, { dim: 0, duration: 0.8 }, '<')
      .set(st, { draw: 0, fall: 0 })
      .to({}, { duration: 0.5 });
    st.total = total;
  }

  // ── Interaction ─────────────────────────────────────────────────────────
  const ray = new Raycaster();
  const ndc = new Vector2(9, 9);
  const lean = { x: 0, y: 0 };
  let leanT = { x: 0, y: 0 };
  function setNdc(e) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }
  function hit() {
    ray.setFromCamera(ndc, camera);
    return ray.intersectObjects(cards.flatMap((c) => [c.front, c.back]), false)[0]?.object.userData.card || null;
  }
  function onMove(e) {
    setNdc(e);
    leanT = { x: ndc.y * 0.06, y: ndc.x * 0.12 };
    if (e.pointerType === 'mouse') canvas.style.cursor = hit() ? 'pointer' : 'default';
  }
  function onClick(e) {
    setNdc(e);
    const c = hit();
    if (c) queued = c.i;
  }
  function onLeave() { leanT = { x: 0, y: 0 }; }
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('click', onClick);
  canvas.addEventListener('pointerleave', onLeave);

  // ── Size ────────────────────────────────────────────────────────────────
  function resize() {
    const w = host.clientWidth || 1;
    const h = host.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
  ro?.observe(host);

  // ── Loop ────────────────────────────────────────────────────────────────
  let raf = 0;
  let inView = true;
  let prev = performance.now();
  const t0 = prev;

  function frame(now) {
    raf = 0;
    const dt = Math.min(0.05, (now - prev) / 1000);
    prev = now;
    const time = (now - t0) / 1000;
    bgMat.uniforms.uTime.value = time;
    pMat.uniforms.uTime.value = time;

    lean.x += (leanT.x - lean.x) * Math.min(1, dt * 3);
    lean.y += (leanT.y - lean.y) * Math.min(1, dt * 3);
    world.rotation.set(lean.x, lean.y, 0);

    for (const c of cards) {
      const d = c.deal;
      const float = Math.sin(time * 0.9 + c.i) * 0.03;
      c.group.position.set(c.home.x * d, -3.2 + (c.home.y + 3.2) * d + c.lift * 0.22 + float, c.lift * 0.35);
      c.group.rotation.set(0, Math.PI + c.flip * Math.PI, c.home.rz * d * (1 - c.lift));
      const s = 1 + c.lift * 0.08;
      c.group.scale.set(s, s, s);
      const o = (1 - c.dim * 0.55) * Math.min(1, d * 1.5);
      c.frontMat.opacity = o;
      c.backMat.opacity = o;
    }
    glowMat.opacity = st.glow * (colors.parchment ? 0.45 : 0.8) * (0.9 + 0.1 * Math.sin(time * 2));

    for (let k = 0; k < PATH_STARS; k++) pAlpha[k] = st.starA[k];
    // The falling star rides the tail curve.
    if (tail.length) {
      const f = Math.min(tail.length - 1, Math.floor(st.fall * (tail.length - 1)));
      const v = tail[f];
      pPos.set([v.x, v.y, v.z], PATH_STARS * 3);
      pPosAttr.needsUpdate = true;
    }
    pAlpha[PATH_STARS] = st.sparkA;
    pAlphaAttr.needsUpdate = true;

    const hop = (PATH_STARS - 1) * SEG_STEPS + 1;
    const count = st.fall > 0 ? hop + Math.floor(st.fall * SEG_STEPS) : Math.floor(st.draw);
    lGeo.setDrawRange(0, Math.min(count, st.total || 0));
    lMat.opacity = st.lineA;

    renderer.render(scene, camera);
    loop();
  }
  function loop() {
    if (!disposed && inView && !document.hidden && !raf) raf = requestAnimationFrame(frame);
  }
  const io = typeof IntersectionObserver !== 'undefined'
    ? new IntersectionObserver(([e]) => { inView = e.isIntersecting; if (inView) { prev = performance.now(); loop(); } })
    : null;
  io?.observe(host);
  function onVis() { prev = performance.now(); loop(); }
  document.addEventListener('visibilitychange', onVis);

  cycle(true);
  loop();

  return {
    dispose() {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      tl?.kill();
      gsap.killTweensOf([st, st.starA, ...cards]);
      io?.disconnect();
      ro?.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('click', onClick);
      canvas.removeEventListener('pointerleave', onLeave);
      disposables.forEach((d) => d.dispose?.());
      renderer.dispose();
      renderer.forceContextLoss?.();
      canvas.remove();
    },
  };
}
