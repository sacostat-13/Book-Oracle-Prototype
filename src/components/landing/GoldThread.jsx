// src/components/landing/GoldThread.jsx
// The constellation thread: ONE SVG path system spanning the whole document.
// It ignites at the chosen card's reveal in Act I (≈45% of the hero pin) and
// terminates into the returned card in the Epilogue.
//
// Draw model: the path's y is monotonic, so we sample (y → arc length) once
// per build and, on every scroll tick, set the dashoffset so the drawn head
// sits exactly at the viewport's reading line (~55% down). That keeps the
// head with the reader everywhere — no drift between anchor-dense sections
// (the Rite II nodes, the companion tiles) and long quiet stretches.
//
// Anchors arrive as refs from LandingPage:
//   anchors = [{ ref, edge: 'center'|'top' }, …]  (document order)
// Geometry is rebuilt from live anchor rects on every ScrollTrigger refresh
// (resize, pin re-measure, FAQ expansion).
//
// Reduced motion: rendered fully drawn at low opacity, no scrub.
import { useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';
import { prefersReducedMotion } from './motion';
import { PIN_DEPTH_DESKTOP, PIN_DEPTH_MOBILE, IGNITE_PROGRESS } from './ActSpread';

gsap.registerPlugin(ScrollTrigger, useGSAP);

const SAMPLES = 260; // y→length lookup resolution
const HEAD_AT = 0.55; // the head rides at 55% of the viewport height

export default function GoldThread({ anchors = [] }) {
  const wrapRef = useRef(null);
  const svgRef = useRef(null);
  const pathRef = useRef(null);
  const staticMode = prefersReducedMotion();

  useGSAP(
    () => {
      const wrap = wrapRef.current;
      const svg = svgRef.current;
      const path = pathRef.current;
      if (!wrap || !svg || !path) return;

      let samples = []; // [{ y, len }] — monotonic in both
      let totalLen = 0;

      const pinDist = () => {
        const vh = window.innerHeight;
        return (window.innerWidth <= 640 ? PIN_DEPTH_MOBILE : PIN_DEPTH_DESKTOP) * vh;
      };

      // Rebuild the full path `d` from the ignition point + live anchors.
      function build() {
        // Zero our own height BEFORE measuring, or the wrapper inflates the
        // document and the measurement ratchets upward forever (the phantom
        // space after the footer).
        wrap.style.height = '0px';
        const docH = document.documentElement.scrollHeight;
        const vw = document.documentElement.clientWidth;
        const vh = window.innerHeight;

        wrap.style.height = `${docH}px`;
        svg.setAttribute('viewBox', `0 0 ${vw} ${docH}`);
        svg.setAttribute('width', vw);
        svg.setAttribute('height', docH);

        // Ignition: the card sits at viewport center when the reveal lands.
        const points = [{ x: vw / 2, y: pinDist() * IGNITE_PROGRESS + vh * 0.5 }];

        anchors.forEach(({ ref, edge = 'center' }) => {
          const el = ref?.current;
          if (!el) return;
          const r = el.getBoundingClientRect();
          points.push({
            x: r.left + r.width / 2 + window.scrollX,
            y: (edge === 'top' ? r.top : r.top + r.height / 2) + window.scrollY,
          });
        });
        points.sort((a, b) => a.y - b.y);

        // Long gaps get a gentle alternating sway so the thread weaves rather
        // than plumb-lines between sections.
        const woven = [];
        let dir = 1;
        for (let i = 0; i < points.length; i++) {
          woven.push(points[i]);
          const next = points[i + 1];
          if (next && next.y - points[i].y > vh * 1.15) {
            woven.push({
              x: (points[i].x + next.x) / 2 + dir * Math.min(90, vw * 0.08),
              y: (points[i].y + next.y) / 2,
            });
            dir *= -1;
          }
        }

        let d = `M ${woven[0].x},${woven[0].y}`;
        for (let i = 1; i < woven.length; i++) {
          const a = woven[i - 1];
          const b = woven[i];
          const dy = (b.y - a.y) * 0.42;
          d += ` C ${a.x},${a.y + dy} ${b.x},${b.y - dy} ${b.x},${b.y}`;
        }
        path.setAttribute('d', d);

        totalLen = path.getTotalLength();
        samples = [];
        for (let i = 0; i <= SAMPLES; i++) {
          const len = (totalLen * i) / SAMPLES;
          samples.push({ y: path.getPointAtLength(len).y, len });
        }

        if (staticMode) {
          gsap.set(path, { strokeDasharray: 'none', strokeDashoffset: 0 });
        } else {
          gsap.set(path, { strokeDasharray: totalLen });
        }
      }

      // Arc length at a given document y (binary search over the samples).
      function lengthAtY(y) {
        if (!samples.length || y <= samples[0].y) return 0;
        const last = samples[samples.length - 1];
        if (y >= last.y) return last.len;
        let lo = 0;
        let hi = samples.length - 1;
        while (lo < hi - 1) {
          const mid = (lo + hi) >> 1;
          if (samples[mid].y <= y) lo = mid; else hi = mid;
        }
        const a = samples[lo];
        const b = samples[hi];
        return a.len + ((b.len - a.len) * (y - a.y)) / (b.y - a.y || 1);
      }

      if (staticMode) {
        build();
        const onResize = () => build();
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
      }

      build();

      // Smooth the head slightly so Lenis + fast flicks don't stutter it.
      const qOffset = gsap.quickTo(path, 'strokeDashoffset', {
        duration: 0.25,
        ease: 'power1.out',
      });

      function apply() {
        const headY = window.scrollY + window.innerHeight * HEAD_AT;
        qOffset(totalLen - lengthAtY(headY));
      }

      const st = ScrollTrigger.create({
        start: 0,
        end: 'max',
        onUpdate: apply,
      });

      const onRefresh = () => { build(); apply(); };
      ScrollTrigger.addEventListener('refresh', onRefresh);
      apply();

      return () => {
        ScrollTrigger.removeEventListener('refresh', onRefresh);
        st.kill();
      };
    },
    { scope: wrapRef, dependencies: [] }
  );

  return (
    <div className={`lps-thread${staticMode ? ' is-static' : ''}`} ref={wrapRef} aria-hidden="true">
      <svg ref={svgRef} preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
        <path ref={pathRef} className="lps-thread__path" d="M 0,0" />
      </svg>
    </div>
  );
}
