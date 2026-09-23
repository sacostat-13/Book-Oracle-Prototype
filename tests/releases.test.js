// tests/releases.test.js — v0.71.1
//
// Each entry in bodyEn / bodyEs is rendered as its own paragraph. v0.69
// shipped its notes hard-wrapped at ~80 columns, one array item per line, so
// the modal showed eleven fragments that each stopped mid-sentence. A body
// item must be a whole paragraph: it ends like a sentence does.

import { describe, it, expect } from 'vitest';
import { RELEASES } from '../src/lib/releases.js';

const ENDS_LIKE_A_SENTENCE = /[.!?…:)»"”']$/;

describe('release notes', () => {
  for (const r of RELEASES) {
    for (const key of ['bodyEn', 'bodyEs']) {
      it(`${r.version} ${key}: every item is a full paragraph`, () => {
        const broken = (r[key] || []).filter((p) => !ENDS_LIKE_A_SENTENCE.test(String(p).trim()));
        expect(broken).toEqual([]);
      });
    }
  }
});
