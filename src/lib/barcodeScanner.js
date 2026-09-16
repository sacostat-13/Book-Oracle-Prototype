// barcodeScanner.js — camera + barcode decode, framework-free.
//
// Everything in here was proven against real books on a phone before it landed;
// the notes below are the failures that cost a debugging session each, so please
// read them before "simplifying" any of it.
//
// The decoder is loaded with a dynamic import so @zxing/library becomes its own
// Vite chunk and never touches first paint. It must NOT come from a CDN:
// script-src in netlify.toml is 'self', so a CDN tag fails silently and the
// result is a working camera that decodes nothing, with no error anywhere.

import { cleanIsbn, isValidIsbn, isbn10to13 } from './isbn';

// Formats deliberately wider than EAN-13. The format filter below rejects the
// rest, and knowing *what* the camera found is what makes failures diagnosable:
// a library loan sticker is usually Codabar or Code 39, and a book's price
// add-on is an EAN-5. Restricting the decoder would throw that signal away.
const ZX_FORMAT_NAMES = [
  'EAN_13', 'EAN_8', 'UPC_A', 'UPC_E', 'CODE_128', 'CODE_39', 'CODABAR', 'ITF',
];

const DETECT_INTERVAL_MS = 125;  // ~8/s. Faster burns battery and finds nothing.
const CONFIRM_READS = 2;         // same code twice before we believe it
const COOLDOWN_MS = 700;         // after an accept, before the same frame re-fires
const CROP_RATIO = 0.85;         // decode the reticle region, not the whole frame

export const REJECT_FORMAT = 'format';
export const REJECT_PREFIX = 'prefix';
export const REJECT_CHECKSUM = 'checksum';

// ---------------------------------------------------------------------------
// The four filters. Pure, synchronous, and free — they run before any network.
// ---------------------------------------------------------------------------

// Returns { ok: true, isbn } or { ok: false, reason, value }.
export function screenCode(raw) {
  const digits = String(raw || '').replace(/[^0-9Xx]/g, '').toUpperCase();

  // 1. Shape. A book's second barcode is an EAN-5 price add-on that decodes
  //    cleanly and means nothing; shipping labels and loyalty cards land here too.
  if (digits.length !== 13 && digits.length !== 10) {
    return { ok: false, reason: REJECT_FORMAT, value: raw };
  }
  const isbn13 = digits.length === 10 ? isbn10to13(digits) : cleanIsbn(digits);
  if (!isbn13) return { ok: false, reason: REJECT_FORMAT, value: raw };

  // 2. Bookland. 978/979 is the book registration group; everything else is a
  //    grocery UPC or a sticker that happened to be in frame.
  if (!/^97[89]/.test(isbn13)) {
    return { ok: false, reason: REJECT_PREFIX, value: isbn13 };
  }

  // 3. Check digit. Arithmetic, offline, and it catches the misreads that get
  //    past everything above BEFORE they cost a lookup.
  if (!isValidIsbn(isbn13)) {
    return { ok: false, reason: REJECT_CHECKSUM, value: isbn13 };
  }

  return { ok: true, isbn: isbn13 };
}

// ---------------------------------------------------------------------------
// Engine selection
// ---------------------------------------------------------------------------

let zxingModule = null;
async function loadZxing() {
  if (!zxingModule) zxingModule = await import('@zxing/library');
  return zxingModule;
}

// 'BarcodeDetector' in window is NOT a capability check. On Windows — and on
// some Linux builds — Chrome exposes the constructor but ships no barcode
// backend: construction succeeds, detect() rejects on every frame, and if those
// rejections are swallowed the scanner is silently dead. getSupportedFormats()
// is the only honest gate.
async function pickEngine() {
  if (typeof window !== 'undefined'
      && 'BarcodeDetector' in window
      && typeof window.BarcodeDetector.getSupportedFormats === 'function') {
    try {
      const formats = await window.BarcodeDetector.getSupportedFormats();
      if (formats && formats.length && formats.includes('ean_13')) {
        return { kind: 'native', detector: new window.BarcodeDetector({ formats }) };
      }
    } catch { /* fall through to ZXing */ }
  }

  const Z = await loadZxing();
  const hints = new Map();
  hints.set(
    Z.DecodeHintType.POSSIBLE_FORMATS,
    ZX_FORMAT_NAMES.map((n) => Z.BarcodeFormat[n]).filter((v) => v !== undefined),
  );
  hints.set(Z.DecodeHintType.TRY_HARDER, true);
  const reader = new Z.MultiFormatReader();
  reader.setHints(hints);
  return { kind: 'zxing', reader, Z };
}

// ---------------------------------------------------------------------------
// The scanner
// ---------------------------------------------------------------------------

/**
 * createScanner({ video, onAccept, onReject, onReady, onError })
 *
 * start() must be called from a user gesture. That is not ceremony: applying
 * the continuous-autofocus constraint is only reliably honoured after an
 * interaction, and without autofocus a barcode at reading distance is a grey
 * smear that no decoder can read.
 */
export function createScanner({ video, onAccept, onReject, onReady, onError }) {
  let stream = null;
  let track = null;
  let engine = null;
  let canvas = null;
  let ctx = null;
  let raf = null;
  let running = false;
  let disposed = false;
  let lastTick = 0;
  let lastCandidate = null;
  let candidateHits = 0;
  let cooldownUntil = 0;
  let nativeErrors = 0;

  function grabFrame() {
    if (!video || !video.videoWidth) return false;
    let cw = Math.round(video.videoWidth * CROP_RATIO);
    let ch = Math.round((cw * 3) / 5);
    if (ch > video.videoHeight) {
      ch = Math.round(video.videoHeight * 0.92);
      cw = Math.round((ch * 5) / 3);
    }
    const sx = Math.round((video.videoWidth - cw) / 2);
    const sy = Math.round((video.videoHeight - ch) / 2);
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
    ctx.drawImage(video, sx, sy, cw, ch, 0, 0, cw, ch);
    return true;
  }

  function handleRaw(rawValue, format) {
    const screened = screenCode(rawValue);
    if (!screened.ok) {
      if (onReject) onReject({ reason: screened.reason, value: screened.value, format });
      return;
    }

    // 4. Double-read. ZXing will hand back a confident single-frame misread in
    //    poor light; requiring agreement costs ~125ms and removes nearly all.
    if (screened.isbn === lastCandidate) candidateHits += 1;
    else { lastCandidate = screened.isbn; candidateHits = 1; }
    if (candidateHits < CONFIRM_READS) return;

    const now = performance.now();
    if (now < cooldownUntil) return;
    cooldownUntil = now + COOLDOWN_MS;
    lastCandidate = null;
    candidateHits = 0;

    if (onAccept) onAccept(screened.isbn, format);
  }

  function decodeCanvas() {
    if (engine.kind === 'native') {
      engine.detector.detect(canvas).then((codes) => {
        for (const c of codes) handleRaw(c.rawValue, c.format);
      }).catch((err) => {
        nativeErrors += 1;
        // A backend that vanishes mid-session must not fail quietly.
        if (nativeErrors === 4) {
          loadZxing().then(async () => { engine = await pickEngineZxingOnly(); }).catch(() => {});
          if (onError) onError({ kind: 'engine-fallback', name: err && err.name });
        }
      });
      return;
    }
    try {
      const { Z, reader } = engine;
      const source = new Z.HTMLCanvasElementLuminanceSource(canvas);
      const bitmap = new Z.BinaryBitmap(new Z.HybridBinarizer(source));
      const result = reader.decode(bitmap);
      if (result) {
        handleRaw(result.getText(), Z.BarcodeFormat[result.getBarcodeFormat()]);
      }
    } catch {
      // NotFoundException fires on every frame without a barcode. Expected.
    }
  }

  async function pickEngineZxingOnly() {
    const Z = await loadZxing();
    const hints = new Map();
    hints.set(
      Z.DecodeHintType.POSSIBLE_FORMATS,
      ZX_FORMAT_NAMES.map((n) => Z.BarcodeFormat[n]).filter((v) => v !== undefined),
    );
    hints.set(Z.DecodeHintType.TRY_HARDER, true);
    const reader = new Z.MultiFormatReader();
    reader.setHints(hints);
    return { kind: 'zxing', reader, Z };
  }

  function loop(now) {
    if (!running) return;
    raf = requestAnimationFrame(loop);
    if (now - lastTick < DETECT_INTERVAL_MS) return;
    lastTick = now;
    if (!grabFrame()) return;
    decodeCanvas();
  }

  async function start() {
    if (disposed || running) return;
    canvas = document.createElement('canvas');
    ctx = canvas.getContext('2d', { willReadFrequently: true });

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      if (onError) onError({ kind: 'no-camera-api' });
      return;
    }

    try {
      // Ask for real resolution. A 640-wide stream does not carry enough pixels
      // across an EAN-13's narrowest bar at reading distance.
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      });
    } catch (err) {
      // NotAllowedError here is usually the site's Permissions-Policy, not the
      // reader: camera=() denies same-origin pages before any prompt appears.
      if (onError) onError({ kind: 'camera-denied', name: err && err.name });
      return;
    }
    if (disposed) { stopStream(); return; }

    video.srcObject = stream;
    video.setAttribute('playsinline', '');   // iOS plays fullscreen without it
    video.muted = true;
    try { await video.play(); } catch { /* autoplay guards; the gesture covers us */ }

    track = stream.getVideoTracks()[0];
    let caps = {};
    try { caps = track.getCapabilities ? track.getCapabilities() : {}; } catch { caps = {}; }

    const advanced = [];
    if (caps.focusMode && caps.focusMode.includes('continuous')) {
      advanced.push({ focusMode: 'continuous' });
    }
    if (advanced.length) {
      try { await track.applyConstraints({ advanced }); } catch { /* best effort */ }
    }

    try {
      engine = await pickEngine();
    } catch (err) {
      if (onError) onError({ kind: 'no-decoder', name: err && err.name });
      return;
    }
    if (disposed) { stopStream(); return; }

    let settings = {};
    try { settings = track.getSettings ? track.getSettings() : {}; } catch { settings = {}; }

    running = true;
    raf = requestAnimationFrame(loop);
    if (onReady) {
      onReady({
        engine: engine.kind,
        width: settings.width || null,
        height: settings.height || null,
        torch: !!(caps && 'torch' in caps),
        autofocus: advanced.length > 0,
      });
    }
  }

  function pause() { running = false; if (raf) cancelAnimationFrame(raf); raf = null; }
  function resume() {
    if (disposed || running || !engine || !stream) return;
    running = true;
    raf = requestAnimationFrame(loop);
  }

  function stopStream() {
    if (stream) stream.getTracks().forEach((t) => { try { t.stop(); } catch { /* noop */ } });
    stream = null; track = null;
  }

  function stop() {
    disposed = true;
    pause();
    stopStream();
    if (video) { try { video.srcObject = null; } catch { /* noop */ } }
  }

  async function setTorch(on) {
    if (!track) return false;
    try {
      await track.applyConstraints({ advanced: [{ torch: !!on }] });
      return true;
    } catch { return false; }
  }

  // Decode a still photo. The camera app autofocuses a capture properly, so
  // this reads books that a live preview cannot — and it is the fallback for
  // devices with no usable video path at all.
  async function decodeImageFile(file) {
    if (!file) return null;
    if (!engine) {
      try { engine = await pickEngine(); } catch { return null; }
    }
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = reject;
        el.src = url;
      });
      const max = 1600;
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);

      if (engine.kind === 'native') {
        const codes = await engine.detector.detect(c);
        for (const code of codes) {
          const screened = screenCode(code.rawValue);
          if (screened.ok) return screened.isbn;
        }
        return null;
      }
      const { Z, reader } = engine;
      const source = new Z.HTMLCanvasElementLuminanceSource(c);
      const bitmap = new Z.BinaryBitmap(new Z.HybridBinarizer(source));
      const result = reader.decode(bitmap);
      const screened = screenCode(result.getText());
      return screened.ok ? screened.isbn : null;
    } catch {
      return null;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  return { start, stop, pause, resume, setTorch, decodeImageFile };
}
