// src/lib/anthologyInsights.js — v0.74
//
// Which Anthologies move readers. Spec: docs/pro-tier-v1-spec.md §7 ·
// Schema: 20260926120000_anthology_insights.sql
//
// Writers (all fire-and-forget, all silent, all skipped under Do Not Track or
// Global Privacy Control):
//   logAnthologyView(listId)          — ListView, once per load
//   logAnthologyOpen(listId, book)    — ListView, a book opened from it; also
//                                       remembers the context for the add below
//   noteAnthologyAdd(book)            — BookPage, when a reader shelves a book
//                                       they reached from an Anthology
//   rememberReferral(listId)          — ListView, signed-out visitor
//   claimAnthologyReferral()          — Onboarding, once, on a new account
//
// Reader:
//   fetchAnthologyInsights()          — Lists (owner view)
//
// The visitor id is a random UUID made in this browser. It is not derived from
// anything about the person and the server never returns it; it exists so
// "12 views" can also say "from 9 people".

import { supabase } from './supabase';
import { bookKey } from './bookHelpers';

const VISITOR_KEY  = 'tbo_vid';
const REF_KEY      = 'tbo_ref';
const CTX_KEY      = 'tbo_anthology_ctx';
const REF_TTL_MS   = 7 * 86400e3;
const CTX_TTL_MS   = 2 * 3600e3;

function trackingAllowed() {
  try {
    if (typeof navigator === 'undefined') return false;
    if (navigator.globalPrivacyControl) return false;
    const dnt = navigator.doNotTrack || window.doNotTrack || navigator.msDoNotTrack;
    return !(dnt === '1' || dnt === 'yes');
  } catch { return false; }
}

function visitorId() {
  try {
    let v = localStorage.getItem(VISITOR_KEY);
    if (!v) {
      v = (crypto.randomUUID?.() || `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`).toLowerCase();
      localStorage.setItem(VISITOR_KEY, v);
    }
    return v;
  } catch { return null; }
}

async function log(listId, event, extra = {}) {
  if (!listId || !trackingAllowed()) return;
  try {
    const { error } = await supabase.rpc('log_anthology_event', {
      p_list_id: listId,
      p_event: event,
      p_visitor: extra.visitor ?? null,
      p_book_key: extra.bookKey ?? null,
    });
    if (error) console.warn('log_anthology_event:', error.message);
  } catch { /* instrumentation never surfaces */ }
}

export function logAnthologyView(listId) {
  const visitor = visitorId();
  if (visitor) log(listId, 'view', { visitor });
}

export function logAnthologyOpen(listId, book) {
  const visitor = visitorId();
  const key = book ? bookKey(book) : null;
  if (visitor && key) log(listId, 'open', { visitor, bookKey: key });
  try {
    sessionStorage.setItem(CTX_KEY, JSON.stringify({ listId, key, at: Date.now() }));
  } catch { /* private mode: no attribution, no harm */ }
}

export function noteAnthologyAdd(book) {
  try {
    const raw = sessionStorage.getItem(CTX_KEY);
    if (!raw || !book) return;
    const ctx = JSON.parse(raw);
    if (!ctx?.listId || Date.now() - ctx.at > CTX_TTL_MS) return;
    const key = bookKey(book);
    if (key !== ctx.key) return;
    log(ctx.listId, 'add', { bookKey: key });
  } catch { /* ignore */ }
}

export function rememberReferral(listId) {
  if (!listId || !trackingAllowed()) return;
  try {
    localStorage.setItem(REF_KEY, JSON.stringify({ kind: 'a', id: listId, at: Date.now() }));
  } catch { /* ignore */ }
}

export function claimAnthologyReferral() {
  try {
    const raw = localStorage.getItem(REF_KEY);
    if (!raw) return;
    localStorage.removeItem(REF_KEY);
    const ref = JSON.parse(raw);
    if (ref?.kind !== 'a' || !ref.id || Date.now() - ref.at > REF_TTL_MS) return;
    log(ref.id, 'signup');
  } catch { /* ignore */ }
}

export async function fetchAnthologyInsights() {
  try {
    const { data, error } = await supabase.rpc('get_anthology_insights');
    if (error || data?.status !== 'ok') return null;
    return data;
  } catch { return null; }
}
