// src/components/landing/StarField.jsx
// Mount point for the landing's optional WebGL layer (see starfield/scene.js).
//
// Progressive enhancement, strictly:
//   - The canvas is empty until the scene chunk loads, and the chunk (three +
//     the scene) is only requested once the main thread is idle after first
//     paint. LCP is the h1, and it never waits on this.
//   - canUseWebGL() refuses reduced motion, Save-Data, low-memory devices,
//     software GL and `?gl=0`. In every refusal — and on any load or init
//     failure — the page is exactly the DOM landing that ships today.
//   - Only on success does `.lps-has-gl` go on the root, which retires the DOM
//     dust motes in favour of the GPU ones. Nothing else in the DOM changes.
//
// `fadeRef` is the Act II anchor: the sky fades out as it scrolls in, and the
// render loop stops once it is gone.
import { useEffect, useRef } from 'react';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { canUseWebGL, whenIdle } from '../../lib/webgl';

export default function StarField({ fadeRef }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !canUseWebGL()) return undefined;
    const root = canvas.closest('.lps-root');
    let disposed = false;
    let api = null;
    let st = null;

    const cancelIdle = whenIdle(() => {
      import('./starfield/scene')
        .then(({ createStarScene }) => {
          if (disposed) return;
          api = createStarScene(canvas, { mobile: window.innerWidth <= 640 });
          if (!api) return;
          root?.classList.add('lps-has-gl');
          const el = fadeRef?.current;
          if (el) {
            st = ScrollTrigger.create({
              trigger: el,
              start: 'top bottom',
              end: 'top 25%',
              onUpdate: (self) => api?.setFade(1 - self.progress),
              onRefresh: (self) => api?.setFade(1 - self.progress),
            });
            api.setFade(1 - st.progress);
          }
        })
        .catch(() => { /* stay on the DOM landing */ });
    });

    return () => {
      disposed = true;
      cancelIdle();
      st?.kill();
      api?.dispose();
      root?.classList.remove('lps-has-gl');
    };
  }, [fadeRef]);

  return <canvas className="lps-starfield" ref={canvasRef} aria-hidden="true" />;
}
