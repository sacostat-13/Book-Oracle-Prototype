// src/lib/shareService.js — v0.43
//
// Small helpers shared by ShareModal (page shares) and ShareMomentModal
// (action shares). URL building lives here so the share URLs stay in one
// place and always match the routes og-prerender covers.

import { bookKey } from './bookHelpers';

export const SHARE_ORIGIN =
  typeof window !== 'undefined' ? window.location.origin : 'https://thebooksoracle.com';

export function bookShareUrl(book) {
  return `${SHARE_ORIGIN}/book/${encodeURIComponent(bookKey(book))}`;
}

export function seriesShareUrl(seriesName) {
  return `${SHARE_ORIGIN}/series/${encodeURIComponent(seriesName)}`;
}

export function listShareUrl(listId) {
  return `${SHARE_ORIGIN}/l/${listId}`;
}

export function planShareUrl(planId) {
  return `${SHARE_ORIGIN}/plans/${planId}`;
}

export function clubShareUrl(clubId) {
  return `${SHARE_ORIGIN}/clubs/${clubId}`;
}

export function profileShareUrl(username) {
  return `${SHARE_ORIGIN}/u/${encodeURIComponent(username)}`;
}

export function sessionShareUrl(sessionId) {
  return `${SHARE_ORIGIN}/sessions/${sessionId}`;
}

// Native share with clipboard fallback.
// Returns 'shared' | 'copied' | 'failed' so callers can pick the right toast.
export async function shareOrCopy({ title, text, url }) {
  if (navigator.share) {
    try {
      await navigator.share({ title, text, url });
      return 'shared';
    } catch (err) {
      // AbortError = user closed the share sheet — not a failure, do nothing.
      if (err?.name === 'AbortError') return 'shared';
      // Fall through to clipboard on anything else.
    }
  }
  try {
    await navigator.clipboard.writeText(url || text);
    return 'copied';
  } catch {
    return 'failed';
  }
}

// Whether this browser can share an image file via the native sheet
// (mobile Safari/Chrome mostly). Used to decide between a "Share image"
// button and a "Download image" button.
export function canShareFile(file) {
  return !!(navigator.canShare && file && navigator.canShare({ files: [file] }));
}

// Social intent URLs for the page-share modal (used where there's no
// native share sheet, i.e. desktop).
export function twitterIntent({ text, url }) {
  return `https://twitter.com/intent/tweet?text=${encodeURIComponent(text || '')}&url=${encodeURIComponent(url)}`;
}

export function whatsappIntent({ text, url }) {
  return `https://wa.me/?text=${encodeURIComponent(`${text ? text + ' ' : ''}${url}`)}`;
}

export function telegramIntent({ text, url }) {
  return `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text || '')}`;
}
