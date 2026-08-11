// supabaseClient.mjs — one createClient() for every batch script.
//
// THE CRASH THIS EXISTS TO PREVENT
// --------------------------------
//   Error: Node.js 20 detected without native WebSocket support.
//     at WebSocketFactory.getWebSocketConstructor (@supabase/realtime-js/...)
//     at new SupabaseClient (...)  at createClient (...)
//
// createClient() constructs a RealtimeClient unconditionally, and realtime-js
// demands a global WebSocket. Node 22 provides one; Node 20 does not. None of
// these scripts open a realtime channel — they make REST and RPC calls — but
// the constructor throws before any of that, at import time, so the script dies
// on line one having done nothing.
//
// WHY A SHARED MODULE RATHER THAN A FIFTH FIX
// -------------------------------------------
// This exact crash had already been hit and fixed four times, four different
// ways, each documented in place and none of them reusable:
//
//   netlify/functions/send-notification-email.js  imports ws, passes it as realtime.transport
//   netlify/functions/catalog-crawl.mjs           dropped supabase-js, calls PostgREST over fetch
//   netlify/functions/sitemap.js                  same, and its header notes it "missed the memo"
//   scripts/seedCuratedCatalog.mjs                optional dynamic ws import, version-gated
//
// The batch scripts were the fifth site and the ninth file. A fix that has to
// be rediscovered once per file is not a fix, so this is the one place it
// lives now. Import from here; do not call createClient directly in a script.
//
// It is also version-independent by design — the point sitemap.js argues in its
// own header. Bumping the workflows to Node 22 would paper over this in CI
// while leaving anyone on Node 20 locally with the same opaque startup crash.

import { createClient } from '@supabase/supabase-js';
import { createRequire } from 'module';

// Synchronous on purpose. A dynamic `await import('ws')` would make this
// function async and force `await createServiceClient(...)` on every caller —
// which works at ESM top level, but turns a one-line change into a
// nine-file refactor with a real chance of one script being missed. `ws` is
// CommonJS, so createRequire loads it synchronously.
const require = createRequire(import.meta.url);

// Resolved once at module load, not per call.
const wsTransport = (() => {
  // Capability detection, deliberately not a version check. Node 22+ ships a
  // native global WebSocket, but `process.versions.node >= 22` is the wrong
  // question — it is also true under a runtime that reports 22 without the
  // global, and false under a Node 20 that has been polyfilled. realtime-js
  // asks whether globalThis.WebSocket exists, so ask exactly that.
  // seedCuratedCatalog.mjs version-gates instead; this is the better shape.
  if (typeof globalThis.WebSocket === 'function') return null;
  try {
    const mod = require('ws');
    return mod.default || mod;
  } catch {
    // `ws` is a regular dependency (package.json), so this should not happen
    // after npm ci. If it does, fall through: createClient will throw its own
    // reasonably clear message rather than this module inventing a worse one.
    return null;
  }
})();

// Drop-in replacement for createClient() in a batch script.
//
// Defaults chosen for scripts rather than browsers:
//   persistSession    false — nothing to persist, and it avoids touching disk
//   autoRefreshToken  false — a service key does not expire mid-run, and the
//                     refresh timer keeps the event loop alive, so a finished
//                     script would hang instead of exiting
export function createServiceClient(url, key, options = {}) {
  const opts = {
    auth: { persistSession: false, autoRefreshToken: false },
    ...options,
  };

  if (wsTransport) {
    opts.realtime = { transport: wsTransport, ...(options.realtime || {}) };
    opts.global = { WebSocket: wsTransport, ...(options.global || {}) };
  }

  return createClient(url, key, opts);
}
