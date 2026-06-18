// src/lib/useShelfBooks.js
// Maps DataContext book objects to the visual config each Three.js mesh needs.
// Pure data transformation — no React state, no Three.js imports here.

import { useMemo } from 'react';
import { hashStr, SPINE_COLORS } from './bookHelpers';

// Leather/cloth spine palette matching the dark-academia theme.
// Each entry: [topColour, bottomColour] as hex strings.
const SPINE_PALETTE = [
  ['#7a312a', '#52201c'],
  ['#5a221d', '#36130f'],
  ['#2f4434', '#1c2c20'],
  ['#23484a', '#13282a'],
  ['#212f50', '#121a30'],
  ['#2f2552', '#1a1330'],
  ['#3e2746', '#251530'],
  ['#6e5527', '#42330f'],
  ['#4c4c24', '#2c2c11'],
  ['#4a3322', '#2a1c11'],
  ['#2c333c', '#171b21'],
  ['#5e2436', '#37111e'],
  ['#244049', '#13242a'],
  ['#5a3d1a', '#33210d'],
  ['#3a2030', '#21121c'],
  ['#1f3a2e', '#10211a'],
];

const FOIL_COLORS = [
  '#e8d8b4',
  '#c9a24b',
  '#dcc8d2',
  '#d2b48c',
];

function mod(a, n) { return ((a % n) + n) % n; }

function deterministicHash(n) {
  return (Math.imul((n + 1) * 2654435761, 1) >>> 0);
}

/**
 * Returns the per-book visual config needed to build a Three.js BookMesh.
 * Spine width is proportional to page count (18–44px in world units = 0.18–0.44).
 * Spine height varies slightly to mimic real shelves (1.48–1.84 world units).
 */
function buildBookConfig(book, index) {
  const h = deterministicHash(index);
  const pages = book.pp || book.pages || 280;

  // Spine width: thicker books have wider spines. Range 0.18–0.44 world units.
  const spineWidth = 0.18 + Math.min(pages, 900) / 900 * 0.26;
  // Spine depth (how deep the book is front-to-back). Tracks width.
  const spineDepth = Math.max(0.14, spineWidth * 1.25);
  // Height varies slightly to mimic real books.
  const spineHeight = 1.48 + mod(h >>> 5, 5) * 0.09;

  const palette = SPINE_PALETTE[mod(index * 5 + (h >>> 3), SPINE_PALETTE.length)];
  const foilColor = FOIL_COLORS[mod(h >>> 11, FOIL_COLORS.length)];

  // Highlight factor for the spine gradient (simulates fabric weave).
  const highlight = mod(h >>> 13, 100) / 100;

  return {
    // identity
    book,
    index,
    // geometry
    spineWidth,
    spineHeight,
    spineDepth,
    // colours
    spineColorTop: palette[0],
    spineColorBottom: palette[1],
    foilColor,
    highlight,
    // optional real cover
    coverUrl: book.coverUrl || null,
  };
}

/**
 * useShelfBooks(books, maxRows)
 * Returns books split into rows, each book annotated with its Three.js config.
 * Stable between renders as long as the books array reference doesn't change.
 */
export function useShelfBooks(books, maxRows = 3) {
  return useMemo(() => {
    const configs = books.map((b, i) => buildBookConfig(b, i));
    const perRow = Math.ceil(configs.length / maxRows);
    const rows = [];
    for (let r = 0; r < maxRows; r++) {
      rows.push(configs.slice(r * perRow, (r + 1) * perRow));
    }
    return rows;
  }, [books, maxRows]);
}
