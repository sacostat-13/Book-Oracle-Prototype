// src/lib/anthologyCover.js — v0.71.1
//
// Custom Anthology covers (Pro). Schema: 20260927120000_anthology_covers.sql.
//
// The image is re-encoded in the browser before upload: max 1200px on the long
// side, WebP. A phone photo is 3–8 MB; the bucket takes 2 MB, and a share card
// never needs more than this. Re-encoding also drops EXIF, which on a phone
// photo includes where it was taken.
//
// Paths are <uid>/<listId>-<timestamp>.webp. The timestamp makes every upload a
// new URL, so a replaced cover is never served stale from a CDN cache.

import { supabase } from './supabase';

const BUCKET = 'anthology-covers';
const MAX_SIDE = 1200;
const QUALITY = 0.86;
const MAX_INPUT_BYTES = 20 * 1024 * 1024;

export class CoverError extends Error {
  constructor(code) { super(code); this.code = code; }
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new CoverError('unreadable')); };
    img.src = url;
  });
}

async function toWebp(file) {
  const img = await loadImage(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(img, 0, 0, w, h);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', QUALITY));
  // Safari before 16 cannot encode WebP and hands back PNG or null; JPEG is
  // the universal fallback.
  if (blob && blob.type === 'image/webp') return blob;
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', QUALITY));
}

function pathFromUrl(url) {
  const marker = `/storage/v1/object/public/${BUCKET}/`;
  const i = url ? url.indexOf(marker) : -1;
  return i === -1 ? null : decodeURIComponent(url.slice(i + marker.length));
}

/** Upload a new cover for a list and return its public URL. Throws CoverError. */
export async function uploadAnthologyCover(listId, file) {
  if (!file || !/^image\//.test(file.type)) throw new CoverError('not_image');
  if (file.size > MAX_INPUT_BYTES) throw new CoverError('too_large');

  const { data: sessionData } = await supabase.auth.getSession();
  const uid = sessionData?.session?.user?.id;
  if (!uid) throw new CoverError('signed_out');

  const blob = await toWebp(file);
  if (!blob) throw new CoverError('unreadable');
  const ext = blob.type === 'image/webp' ? 'webp' : 'jpg';
  const path = `${uid}/${listId}-${Date.now()}.${ext}`;

  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
    contentType: blob.type,
    cacheControl: '31536000',
    upsert: false,
  });
  if (error) throw new CoverError(/row-level security|403|Unauthorized/i.test(error.message) ? 'pro_required' : 'upload_failed');

  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

/** Best-effort removal of an old cover file. Never throws. */
export async function deleteAnthologyCoverFile(url) {
  const path = pathFromUrl(url);
  if (!path) return;
  try { await supabase.storage.from(BUCKET).remove([path]); } catch { /* orphan is harmless */ }
}
