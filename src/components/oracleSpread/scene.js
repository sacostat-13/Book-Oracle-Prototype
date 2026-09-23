// src/components/oracleSpread/scene.js — the Oracle's long-wait spread.
//
// Lazy chunk. A ring of face-down Oracle cards drawn from the reader's own
// shelf turns slowly while the Oracle works. It is a toy, not a result: the
// cards are the books they already have, never the recommendation.
//
// The loop:
//   - every few seconds the card nearest the front rises, turns face-up to
//     show a book from the shelf, and settles back into the ring;
//   - after three of those the ring gathers into a deck, splits, riffles,
//     and deals back out in a new order.
// The reader can drag sideways to spin the ring (with inertia), hover a card
// to lift it, and click / tap one to turn it over themselves.
//
// Everything is one scene with MeshBasicMaterial (no lights) and alpha-tested
// card textures, so depth sorting is exact and the cost is ~2 draw calls per
// card. The loop pauses when the canvas is off screen or the tab is hidden.
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
  BufferGeometry,
  BufferAttribute,
  Points,
  PointsMaterial,
  AdditiveBlending,
  NormalBlending,
} from 'three';
import gsap from 'gsap';
import { drawBack, drawFront } from './cardArt';

const TAU = Math.PI * 2;
const lerp = (a, b, t) => a + (b - a) * t;
function lerpAngle(a, b, t) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return a + d * t;
}

export function createSpreadScene(host, { books, colors, mobile = false }) {
  let renderer;
  try {
    renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
  } catch {
    return null;
  }
  const pr = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(pr);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = SRGBColorSpace;
  const canvas = renderer.domElement;
  canvas.className = 'ows__canvas';
  host.appendChild(canvas);

  let disposed = false;
  const scene = new Scene();
  const camera = new PerspectiveCamera(38, 1, 0.1, 50);
  camera.position.set(0, 1.15, 7.1);
  camera.lookAt(0, 0.15, 0);

  const table = new Group();
  scene.add(table);

  // ── Cards ───────────────────────────────────────────────────────────────
  const N = Math.max(6, Math.min(books.length || 0, mobile ? 8 : 11)) || 8;
  const R = mobile ? 2.35 : 2.9;
  const geo = new PlaneGeometry(1, 1.5);
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  function tex(canvasEl) {
    const t = new CanvasTexture(canvasEl);
    t.colorSpace = SRGBColorSpace;
    t.anisotropy = aniso;
    return t;
  }

  const backTex = tex(drawBack(colors));
  const backMat = new MeshBasicMaterial({ map: backTex, alphaTest: 0.5 });
  const disposables = [geo, backTex, backMat];

  const cards = [];
  for (let i = 0; i < N; i++) {
    const book = books.length ? books[i % books.length] : null;
    const group = new Group();
    const frontMat = new MeshBasicMaterial({ color: 0x222222, alphaTest: 0.5 });
    const front = new Mesh(geo, frontMat);
    const back = new Mesh(geo, backMat);
    back.rotation.y = Math.PI;
    group.add(front, back);
    table.add(group);
    const card = {
      slot: i, group, front, back, book,
      deck: 0, peek: 0, lift: 0,
      deckX: 0, deckY: 0, deckRot: 0,
    };
    front.userData.card = card;
    back.userData.card = card;
    cards.push(card);
    disposables.push(frontMat);
    drawFront(book, colors).then((cv) => {
      if (disposed) return;
      const t = tex(cv);
      disposables.push(t);
      frontMat.map = t;
      frontMat.color.set(0xffffff);
      frontMat.needsUpdate = true;
    });
  }

  // ── Motes ───────────────────────────────────────────────────────────────
  const MOTES = mobile ? 70 : 140;
  const mPos = new Float32Array(MOTES * 3);
  for (let i = 0; i < MOTES; i++) {
    const a = Math.random() * TAU;
    const r = R * (0.4 + Math.random() * 1.1);
    mPos[i * 3] = Math.cos(a) * r;
    mPos[i * 3 + 1] = (Math.random() * 2 - 1) * 1.6;
    mPos[i * 3 + 2] = Math.sin(a) * r;
  }
  const moteGeo = new BufferGeometry();
  moteGeo.setAttribute('position', new BufferAttribute(mPos, 3));
  const moteMat = new PointsMaterial({
    color: colors.gold,
    size: 0.045,
    transparent: true,
    opacity: 0.7,
    depthWrite: false,
    blending: colors.parchment ? NormalBlending : AdditiveBlending,
  });
  const motes = new Points(moteGeo, moteMat);
  table.add(motes);
  disposables.push(moteGeo, moteMat);

  // ── Ring state ──────────────────────────────────────────────────────────
  let ringRot = 0;
  let ringVel = 0;
  const AUTO = 0.16; // rad/s
  let tiltX = 0;
  let tiltTarget = 0;
  let shuffling = false;
  let peeking = null;

  function slotAngle(c) {
    return ringRot + (c.slot / N) * TAU;
  }

  function pose(c, time) {
    const a = slotAngle(c);
    // Ring: backs facing out, a gentle wave running round it.
    let x = Math.sin(a) * R;
    let y = Math.sin(a * 2 + time * 0.8) * 0.08;
    let z = Math.cos(a) * R - R * 0.45;
    let ry = a + Math.PI;
    let rz = 0;
    // Deck: stacked at the centre, backs to the reader.
    if (c.deck > 0) {
      x = lerp(x, c.deckX, c.deck);
      y = lerp(y, c.deckY, c.deck);
      z = lerp(z, 0.9, c.deck);
      ry = lerpAngle(ry, Math.PI, c.deck);
      rz = lerp(rz, c.deckRot, c.deck);
    }
    // Peek: rise toward the reader and turn face-up.
    if (c.peek > 0) {
      const e = c.peek;
      x = lerp(x, 0, e);
      y = lerp(y, 0.55, e) + Math.sin(e * Math.PI) * 0.35;
      z = lerp(z, mobile ? 3.4 : 3.9, e);
      ry = lerpAngle(ry, Math.PI, e) - Math.PI * e + Math.sin(time * 0.9) * 0.05 * e;
      rz = lerp(rz, 0, e);
    }
    y += c.lift * 0.28;
    c.group.position.set(x, y, z);
    c.group.rotation.set(0, ry, rz);
    const s = 1 + c.lift * 0.06;
    c.group.scale.set(s, s, s);
  }

  // ── Choreography ────────────────────────────────────────────────────────
  const tweens = new Set();
  const track = (tw) => { tweens.add(tw); return tw; };
  let peeksSinceShuffle = 0;
  let next = null;

  function frontMost() {
    let best = null;
    let bestD = Infinity;
    for (const c of cards) {
      const a = ((slotAngle(c) % TAU) + TAU) % TAU;
      const d = Math.min(a, TAU - a);
      if (d < bestD) { bestD = d; best = c; }
    }
    return best;
  }

  function peek(card, hold = 1.5) {
    if (shuffling || peeking) return;
    peeking = card;
    gsap.killTweensOf(card, 'peek');
    track(gsap.timeline({ onComplete: () => { peeking = null; } })
      .to(card, { peek: 1, duration: 1.1, ease: 'power2.inOut' })
      .to(card, { peek: 0, duration: 0.9, ease: 'power2.inOut' }, `+=${hold}`));
  }

  function shuffle() {
    shuffling = true;
    const order = gsap.utils.shuffle(cards.map((_, i) => i));
    const half = Math.ceil(N / 2);
    const tl = gsap.timeline({ onComplete: () => { shuffling = false; } });
    // Gather into a deck
    cards.forEach((c, k) => {
      tl.to(c, {
        deck: 1, deckX: 0, deckY: -0.2 + k * 0.012, deckRot: (Math.random() - 0.5) * 0.06,
        duration: 0.8, ease: 'power3.inOut',
      }, k * 0.035);
    });
    // Split in two
    tl.addLabel('split', '+=0.15');
    cards.forEach((c, k) => {
      const left = k < half;
      tl.to(c, {
        deckX: left ? -0.72 : 0.72,
        deckY: -0.2 + (left ? k : k - half) * 0.012,
        deckRot: left ? 0.09 : -0.09,
        duration: 0.45, ease: 'power2.out',
      }, 'split');
    });
    // Riffle back together in the new order
    tl.addLabel('riffle', '+=0.1');
    order.forEach((ci, k) => {
      tl.to(cards[ci], { deckX: 0, deckY: -0.2 + k * 0.012, deckRot: 0, duration: 0.22, ease: 'power1.in' }, `riffle+=${k * 0.05}`);
    });
    // New ring order, dealt back out
    tl.add(() => { order.forEach((ci, k) => { cards[ci].slot = k; }); }, '+=0.15');
    order.forEach((ci, k) => {
      tl.to(cards[ci], { deck: 0, duration: 0.9, ease: 'power3.inOut' }, `>-${k === 0 ? 0 : 0.84}`);
    });
    track(tl);
  }

  function schedule() {
    next = gsap.delayedCall(peeksSinceShuffle >= 3 ? 1.2 : 3.4, () => {
      if (peeksSinceShuffle >= 3 && !peeking) {
        peeksSinceShuffle = 0;
        shuffle();
      } else if (!shuffling) {
        peeksSinceShuffle += 1;
        peek(frontMost());
      }
      schedule();
    });
  }
  schedule();

  // ── Interaction ─────────────────────────────────────────────────────────
  const ray = new Raycaster();
  const ndc = new Vector2(9, 9);
  let hovered = null;
  let dragging = false;
  let downX = 0;
  let lastX = 0;
  let moved = 0;

  function toNdc(e) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    tiltTarget = -ndc.y * 0.08;
  }

  function pick() {
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects(cards.flatMap((c) => [c.front, c.back]), false);
    return hits[0]?.object.userData.card || null;
  }

  function setHover(c) {
    if (c === hovered) return;
    if (hovered) track(gsap.to(hovered, { lift: 0, duration: 0.35, ease: 'power2.out' }));
    hovered = c;
    if (c && !shuffling) track(gsap.to(c, { lift: 1, duration: 0.35, ease: 'power2.out' }));
    canvas.style.cursor = c ? 'pointer' : 'grab';
  }

  function onMove(e) {
    toNdc(e);
    if (dragging) {
      const dx = e.clientX - lastX;
      lastX = e.clientX;
      moved += Math.abs(dx);
      ringRot += dx * 0.006;
      ringVel = dx * 0.35;
      return;
    }
    if (e.pointerType === 'mouse') setHover(pick());
  }
  function onDown(e) {
    toNdc(e);
    dragging = true;
    downX = lastX = e.clientX;
    moved = 0;
    canvas.setPointerCapture?.(e.pointerId);
  }
  function onUp(e) {
    if (!dragging) return;
    dragging = false;
    canvas.releasePointerCapture?.(e.pointerId);
    if (moved < 6 && Math.abs(e.clientX - downX) < 6) {
      const c = pick();
      if (c) peek(c, 2.2);
    }
  }
  function onLeave() {
    setHover(null);
    tiltTarget = 0;
  }
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
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
    if (!dragging) {
      ringRot += (AUTO + ringVel) * dt;
      ringVel *= Math.pow(0.04, dt);
    }
    tiltX += (tiltTarget - tiltX) * Math.min(1, dt * 4);
    table.rotation.x = tiltX;
    motes.rotation.y = time * 0.05;
    for (const c of cards) pose(c, time);
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
  loop();

  return {
    dispose() {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      next?.kill();
      tweens.forEach((tw) => tw.kill());
      cards.forEach((c) => gsap.killTweensOf(c));
      io?.disconnect();
      ro?.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('pointerleave', onLeave);
      disposables.forEach((d) => d.dispose?.());
      renderer.dispose();
      renderer.forceContextLoss?.();
      canvas.remove();
    },
  };
}
