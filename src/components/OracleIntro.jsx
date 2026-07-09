// src/components/OracleIntro.jsx
// "The Reading" — full-screen cinematic intro shown over the Landing page on
// a visitor's first arrival of the session. A 30s tarot reading: five cards
// are dealt, four bestseller-cards are flipped, judged, and burned, then the
// constellation divines into the last card, which reveals the Oracle's pick.
// Ends in a settled brand tableau with a chevron to continue to the site
// (scroll/keydown also dismiss once settled). Skip dismisses immediately.
//
// Gating lives in Landing.jsx (sessionStorage 'tbo.introSeen' + reduced
// motion). This component assumes it should play, and reports completion via
// onDone after its exit transition. While mounted it locks body scroll.
//
// Styling: pages/_oracle-intro.scss. Like .lp-root, the .oi surface pins its
// own --ro-* values (theme-dark's wine palette) so the marketing intro never
// depends on the visitor's stored app theme.
import { useEffect, useRef, useState } from 'react';
import { useT } from '../lib/I18nContext';

const FATED_INDEX = 2; // center card of the five

export default function OracleIntro({ onDone }) {
  const t = useT();
  const rootRef = useRef(null);
  const canvasRef = useRef(null);
  const timersRef = useRef([]);
  const embersRef = useRef([]);
  const rafRef = useRef(null);
  const [settled, setSettled] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const leavingRef = useRef(false);

  // ── timeline helpers ──────────────────────────────────────────────────────
  function at(ms, fn) { timersRef.current.push(setTimeout(fn, ms)); }
  function clearTimers() { timersRef.current.forEach(clearTimeout); timersRef.current = []; }
  function setPhase(n) {
    const el = rootRef.current;
    if (!el) return;
    el.className = el.className.replace(/oi--phase-\d/g, '').trim();
    el.classList.add(`oi--phase-${n}`);
  }
  function sayLine(text, isTagline) {
    const line = rootRef.current?.querySelector('.oi__line span');
    if (!line) return;
    line.classList.remove('is-on', 'is-tagline');
    timersRef.current.push(setTimeout(() => {
      line.textContent = text;
      line.classList.add('is-on');
      if (isTagline) line.classList.add('is-tagline');
    }, 650));
  }

  // ── ember/mote canvas ─────────────────────────────────────────────────────
  function burst(x, y, n = 28) {
    for (let i = 0; i < n; i++) {
      embersRef.current.push({
        x: x + (Math.random() - 0.5) * 44,
        y: y + (Math.random() - 0.5) * 70,
        r: 0.8 + Math.random() * 2.2,
        vy: -(0.5 + Math.random() * 1.5),
        vx: (Math.random() - 0.5) * 1,
        life: 1,
      });
    }
  }

  // ── the settled tableau (also skip target) ───────────────────────────────
  function settle() {
    const el = rootRef.current;
    if (!el) return;
    clearTimers();
    setPhase(5);
    el.classList.add('oi--dealt', 'oi--laid');
    el.querySelectorAll('.oi__card').forEach((c, i) => {
      if (i === FATED_INDEX) c.classList.add('is-open');
      else c.style.display = 'none';
    });
    sayLine(t('landing.intro.tagline'), true);
    setSettled(true);
  }

  function dismiss() {
    if (leavingRef.current) return;
    leavingRef.current = true;
    try { sessionStorage.setItem('tbo.introSeen', '1'); } catch { /* private mode */ }
    setLeaving(true);
    timersRef.current.push(setTimeout(() => onDone?.(), 1150));
  }

  function skip() {
    // Skipping means "take me to the site" — settle the tableau for the
    // curtain lift to reveal, then leave immediately.
    settle();
    dismiss();
  }

  // ── mount: lock scroll, run canvas + timeline ────────────────────────────
  useEffect(() => {
    const el = rootRef.current;
    const canvas = canvasRef.current;
    if (!el || !canvas) return undefined;

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // canvas: ambient motes + ember bursts
    const ctx = canvas.getContext('2d');
    let motes = [];
    let tt = 0;
    function sizeCanvas() {
      canvas.width = el.clientWidth;
      canvas.height = el.clientHeight;
      const n = Math.min(55, Math.floor(canvas.width / 22));
      motes = Array.from({ length: n }, () => ({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        r: 0.5 + Math.random() * 1.6,
        vy: -(0.04 + Math.random() * 0.15),
        vx: (Math.random() - 0.5) * 0.1,
        a: 0.12 + Math.random() * 0.35,
        ph: Math.random() * Math.PI * 2,
      }));
    }
    function draw() {
      tt += 0.016;
      const flick = 0.85 + 0.15 * Math.sin(tt * 7.1) * Math.sin(tt * 2.3);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const m of motes) {
        m.y += m.vy; m.x += m.vx + Math.sin(tt * 0.7 + m.ph) * 0.07;
        if (m.y < -5) { m.y = canvas.height + 5; m.x = Math.random() * canvas.width; }
        const tw = 0.6 + 0.4 * Math.sin(tt * 1.3 + m.ph);
        ctx.beginPath(); ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(216,184,94,${m.a * tw * flick})`; ctx.fill();
      }
      embersRef.current = embersRef.current.filter((e) => e.life > 0);
      for (const e of embersRef.current) {
        e.y += e.vy; e.x += e.vx; e.vy *= 0.985; e.life -= 0.011;
        ctx.beginPath(); ctx.arc(e.x, e.y, e.r * e.life, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(216,166,86,${0.85 * e.life})`; ctx.fill();
      }
      rafRef.current = requestAnimationFrame(draw);
    }
    sizeCanvas();
    draw();
    window.addEventListener('resize', sizeCanvas);

    // ── the 30s reading ─────────────────────────────────────────────────────
    const cards = Array.from(el.querySelectorAll('.oi__card'));

    /* P1 (0–4.5s) — deal into the tarot line */
    at(200, () => { el.classList.add('oi--dealt', 'oi--laid'); setPhase(1); });
    at(1600, () => sayLine(t('landing.intro.line1')));

    /* P2 (4.5–19s) — flip, question, judge, burn — left to right */
    at(4500, () => {
      const readOrder = [0, 1, 3, 4];
      readOrder.forEach((ci, i) => {
        const c = cards[ci];
        const base = i * 3600;
        timersRef.current.push(setTimeout(() => {
          c.classList.add('is-reading', 'is-open');
          sayLine(t(`landing.intro.q${i + 1}`));
        }, base));
        timersRef.current.push(setTimeout(() => {
          c.classList.add('is-burning');
          const r = c.getBoundingClientRect();
          burst(r.left + r.width / 2, r.top + r.height / 2 - el.clientHeight * 0.03);
        }, base + 2400));
      });
    });

    /* P3 (19.2–25.5s) — constellation divines into the last card */
    at(19200, () => { setPhase(4); sayLine(t('landing.intro.reads')); });
    at(23800, () => cards[FATED_INDEX].classList.add('is-open'));

    /* P4 (25.5–30s) — the verdict; settled tableau + chevron */
    at(25500, () => setPhase(5));
    at(26200, () => sayLine(t('landing.intro.tagline'), true));
    at(29600, () => setSettled(true));

    return () => {
      clearTimers();
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', sizeCanvas);
      document.body.style.overflow = prevOverflow;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── once settled, any scroll intent continues to the site ────────────────
  useEffect(() => {
    if (!settled) return undefined;
    const onWheel = (e) => { if (e.deltaY > 0) dismiss(); };
    const onTouch = () => dismiss();
    const onKey = (e) => {
      if (['ArrowDown', 'PageDown', ' ', 'Enter'].includes(e.key)) dismiss();
    };
    window.addEventListener('wheel', onWheel, { passive: true });
    window.addEventListener('touchmove', onTouch, { passive: true });
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('touchmove', onTouch);
      window.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settled]);

  const rejects = [1, 2, 3, 4].map((n) => t(`landing.intro.reject${n}`));
  let rejectCursor = 0;

  return (
    <div
      className={`oi${leaving ? ' oi--leaving' : ''}${settled ? ' oi--settled' : ''}`}
      ref={rootRef}
      role="dialog"
      aria-label={t('landing.intro.ariaLabel')}
    >
      <div className="oi__table-glow" aria-hidden />
      <canvas className="oi__embers" ref={canvasRef} aria-hidden />
      <div className="oi__vignette" aria-hidden />

      <div className="oi__stage">
        {/* sky: constellation, then logo */}
        <div className="oi__sky">
          <svg className="oi__constellation" viewBox="0 0 560 200" preserveAspectRatio="xMidYMax meet" aria-hidden>
            <path className="oi__thread" d="M 70 42 C 130 90, 210 140, 280 196" />
            <path className="oi__thread" d="M 175 24 C 210 90, 250 150, 280 196" />
            <path className="oi__thread" d="M 300 16 C 296 80, 288 150, 280 196" />
            <path className="oi__thread" d="M 402 38 C 360 95, 310 150, 280 196" />
            <path className="oi__thread" d="M 492 70 C 420 115, 330 160, 280 196" />
            {[[70, 42], [175, 24], [300, 16], [402, 38], [492, 70]].map(([x, y], i) => (
              <g key={i}>
                <circle className="oi__star-halo" cx={x} cy={y} r="7" />
                <circle className="oi__star" cx={x} cy={y} r="2.4" style={{ animationDelay: `${i * 0.5}s, ${1 + i * 0.5}s` }} />
              </g>
            ))}
          </svg>
          <div className="oi__rising-thread" aria-hidden />
          <div className="oi__logo-form">
            <img src="/logo-dark-mode.png" alt={t('landing.intro.logoAlt')} />
            <div className="oi__wordmark">The <em>Books</em> Oracle</div>
          </div>
        </div>

        {/* the tarot line */}
        <div className="oi__spread">
          {[0, 1, 2, 3, 4].map((i) => {
            const fated = i === FATED_INDEX;
            const rejectTitle = fated ? null : rejects[rejectCursor++];
            return (
              <div className={`oi__card${fated ? ' oi__card--fated' : ''}`} key={i}>
                <div className="oi__card-body">
                  <div className="oi__card-inner">
                    <div className="oi__face oi__face--back">
                      <img src="/logo-dark-mode.png" alt="" />
                    </div>
                    {fated ? (
                      <div className="oi__face oi__face--front oi__face--pick">
                        <div className="oi__pick-glyph">☾</div>
                        <div className="oi__pick-title">{t('landing.intro.pickTitle')}</div>
                        <div className="oi__pick-match">{t('landing.intro.pickMatch')}</div>
                      </div>
                    ) : (
                      <div className="oi__face oi__face--front oi__face--reject">
                        <div className="oi__reject-ribbon">{t('landing.intro.ribbon')}</div>
                        <div className="oi__reject-title">{rejectTitle}</div>
                        <div className="oi__reject-stars">★★★★★</div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          <div className="oi__orbit" aria-hidden><span>✶</span><span>☾</span><span>✦</span><span>◇</span></div>
        </div>

        <p className="oi__line"><span /></p>
      </div>

      {/* continue chevron — appears once the reading settles */}
      <button
        className="oi__continue"
        onClick={dismiss}
        aria-label={t('landing.intro.continue')}
        tabIndex={settled ? 0 : -1}
      >
        <span className="oi__continue-label">{t('landing.intro.continue')}</span>
        <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
          <path d="M4 9l8 7 8-7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {!settled && (
        <button className="oi__skip" onClick={skip}>{t('landing.intro.skip')}</button>
      )}
    </div>
  );
}
