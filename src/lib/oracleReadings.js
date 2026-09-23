// src/lib/oracleReadings.js — v0.73
//
// The Pro Oracle extras, and the loop the miss button opened.
// Spec: docs/pro-tier-v1-spec.md §6 · Schema: 20260925120000_oracle_readings.sql
//
//   - loadReading / saveReading: long-form Oracle output worth keeping —
//     "Why this book" (per book) and the reader's chart (one per reader).
//     Stored so a reader who comes back tomorrow does not pay, or wait, twice.
//   - fetchMissHint: the reader's recent "None of these call to me", phrased
//     for a prompt. v0.71 recorded the misses; this is where the Oracle reads
//     them.
//
// Same rule as oracleProvenance.js: nothing here throws. A reading that fails
// to load is a reading that is not cached; a hint that fails is no hint.

import { supabase } from './supabase';

export async function loadReading(kind, subjectKey, lang) {
  try {
    const { data, error } = await supabase
      .from('oracle_readings')
      .select('body, created_at')
      .eq('kind', kind)
      .eq('subject_key', subjectKey || '')
      .eq('lang', lang || 'en')
      .maybeSingle();
    if (error) { console.error('loadReading failed:', error); return null; }
    return data ? { ...data.body, createdAt: data.created_at } : null;
  } catch (e) {
    console.error('loadReading threw:', e);
    return null;
  }
}

export async function saveReading(kind, subjectKey, lang, body) {
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const userId = sessionData?.session?.user?.id;
    if (!userId) return false;
    const { error } = await supabase
      .from('oracle_readings')
      .upsert(
        { user_id: userId, kind, subject_key: subjectKey || '', lang: lang || 'en', body, created_at: new Date().toISOString() },
        { onConflict: 'user_id,kind,subject_key,lang' }
      );
    if (error) { console.error('saveReading failed:', error); return false; }
    return true;
  } catch (e) {
    console.error('saveReading threw:', e);
    return false;
  }
}

const MISS_REASON_WORDS = {
  not_my_taste:  'not their taste',
  already_known: 'already known to them',
  off_request:   'not what they asked for',
  other:         'rejected',
};

// Bounded twice over: the last 60 days, the last 8 misses, 20 titles. The
// point is "don't repeat what they just turned down", not a second denylist
// competing with buildExcludeHint for the prompt budget.
const MISS_WINDOW_DAYS = 60;
const MISS_MAX = 8;
const MISS_TITLES = 20;

/**
 * A prompt fragment naming what this reader recently turned down, or ''.
 * Starts with a newline so callers can append it unconditionally.
 */
export async function fetchMissHint() {
  try {
    const since = new Date(Date.now() - MISS_WINDOW_DAYS * 86400e3).toISOString();
    const { data: misses, error } = await supabase
      .from('oracle_misses')
      .select('recommendation_ids, reason')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(MISS_MAX);
    if (error || !misses?.length) return '';

    const reasonById = new Map();
    for (const m of misses) {
      for (const id of m.recommendation_ids || []) reasonById.set(id, m.reason);
    }
    const ids = [...reasonById.keys()].slice(0, MISS_TITLES);
    if (ids.length === 0) return '';

    const { data: recs, error: recErr } = await supabase
      .from('oracle_recommendations')
      .select('id, book_title, book_author')
      .in('id', ids);
    if (recErr || !recs?.length) return '';

    const lines = recs.map((r) => {
      const why = MISS_REASON_WORDS[reasonById.get(r.id)] || 'rejected';
      return `${r.book_title}${r.book_author ? ` — ${r.book_author}` : ''} (${why})`;
    });

    return `\n\nThe reader recently turned these suggestions down. Do not suggest them again, and treat the reasons as signal about what to avoid: ${lines.join('; ')}.`;
  } catch (e) {
    console.error('fetchMissHint threw:', e);
    return '';
  }
}
