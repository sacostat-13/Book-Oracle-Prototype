// reportService.js — v0.20
// Submits user book reports to the book_reports table.
// Reports are consumed by the future admin tool to queue targeted Oracle re-runs.

import { supabase } from './supabase';

// fields: array of strings from ['title', 'description', 'series', 'genres']
// comment: free text string (may be empty)
// bookId: uuid from the books table (may be null for undiscovered/preview books)
export async function submitBookReport({ bookId, fields, comment }) {
  if (!bookId) return { error: 'Book has no ID yet — add it to your collection first.' };
  if (!fields || fields.length === 0) return { error: 'Select at least one field to report.' };

  const { error } = await supabase.from('book_reports').insert({
    book_id: bookId,
    fields,
    comment: comment?.trim() || null,
    status: 'open',
  });

  if (error) {
    console.error('submitBookReport failed', error);
    return { error: 'Could not submit the report. Please try again.' };
  }
  return { ok: true };
}
