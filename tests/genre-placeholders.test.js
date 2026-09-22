import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { GENRE_PLACEHOLDERS, isPlaceholderGenre } from '../src/lib/genrePlaceholders.js';

describe('isPlaceholderGenre', () => {
  it('catches placeholders however they are spelled', () => {
    for (const n of ['unknown', 'Unknown', ' UNKNOWN ', 'N/A', 'Other', 'Uncategorised', 'the unknown', '']) {
      expect(isPlaceholderGenre(n)).toBe(true);
    }
  });

  it('leaves real genres alone', () => {
    for (const n of ['Folk Horror', 'Weird Fiction', 'Otherworld', 'Unknown Armies Fiction', 'Canadian Literature']) {
      expect(isPlaceholderGenre(n)).toBe(false);
    }
  });
});

// The database constraint is the authority; the JS list only lets writers drop
// a placeholder quietly. If the two drift, a writer either trips the constraint
// or keeps a name the database would have allowed.
describe('GENRE_PLACEHOLDERS matches genres_not_placeholder', () => {
  it('lists exactly the same names', () => {
    const sql = readFileSync('supabase/migrations/20260922120000_retire_unknown_genre.sql', 'utf8');
    const block = sql.match(/add constraint genres_not_placeholder check \(\s*normalized_name not in \(([\s\S]*?)\)\s*\)/);
    expect(block).not.toBeNull();
    const inSql = [...block[1].matchAll(/'([a-z0-9]+)'/g)].map((m) => m[1]).sort();
    expect(inSql).toEqual([...GENRE_PLACEHOLDERS].sort());
  });
});
