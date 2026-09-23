// src/components/oracleSpread/cardArt.js — 2D canvas art for the WebGL cards.
//
// Card faces are drawn once into canvases and uploaded as textures. Covers
// come from wherever the shelf got them (Open Library, Google Books, Amazon,
// Hardcover…). WebGL can only sample an image the host serves with CORS
// headers, so every cover is requested with crossOrigin="anonymous"; when a
// host refuses, the card falls back to the same generated placeholder
// BookCover shows (palette + ornament + title), rather than a blank card.
import { PALETTES, ORNAMENTS, hashStr } from '../../lib/bookHelpers';

export const CARD_W = 320;
export const CARD_H = 480;
const RADIUS = 22;
const SERIF = "'Instrument Serif', 'EB Garamond', Georgia, serif";

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function canvas() {
  const c = document.createElement('canvas');
  c.width = CARD_W;
  c.height = CARD_H;
  return c;
}

function frame(ctx, gold) {
  ctx.strokeStyle = gold;
  ctx.lineWidth = 4;
  roundRect(ctx, 5, 5, CARD_W - 10, CARD_H - 10, RADIUS - 4);
  ctx.stroke();
  ctx.globalAlpha = 0.45;
  ctx.lineWidth = 1.5;
  roundRect(ctx, 16, 16, CARD_W - 32, CARD_H - 32, RADIUS - 10);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function wrap(ctx, text, maxW, maxLines) {
  const words = String(text || '').split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW && line) {
      lines.push(line);
      line = w;
      if (lines.length === maxLines) break;
    } else {
      line = test;
    }
  }
  if (lines.length < maxLines && line) lines.push(line);
  return lines;
}

// The face-down Oracle card — the same back the landing deals.
export function drawBack({ gold, ink }) {
  const c = canvas();
  const ctx = c.getContext('2d');
  roundRect(ctx, 0, 0, CARD_W, CARD_H, RADIUS);
  ctx.fillStyle = ink;
  ctx.fill();
  ctx.save();
  ctx.clip();
  const g = ctx.createRadialGradient(CARD_W / 2, CARD_H / 2, 10, CARD_W / 2, CARD_H / 2, CARD_H * 0.6);
  g.addColorStop(0, 'rgba(201,162,75,0.18)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  // a faint lattice of stars
  ctx.fillStyle = gold;
  for (let i = 0; i < 26; i++) {
    const x = 30 + ((i * 97) % (CARD_W - 60));
    const y = 30 + ((i * 173) % (CARD_H - 60));
    ctx.globalAlpha = 0.25 + ((i * 37) % 50) / 100;
    ctx.beginPath();
    ctx.arc(x, y, 1.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.restore();
  frame(ctx, gold);
  ctx.fillStyle = gold;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `120px ${SERIF}`;
  ctx.fillText('☩', CARD_W / 2, CARD_H / 2 - 16);
  ctx.font = `22px ${SERIF}`;
  ctx.globalAlpha = 0.8;
  ctx.fillText('The Books Oracle', CARD_W / 2, CARD_H - 58);
  ctx.globalAlpha = 1;
  return c;
}

// Generated face for a book with no usable cover.
export function drawPlaceholder(book, { gold }) {
  const c = canvas();
  const ctx = c.getContext('2d');
  const palette = PALETTES[hashStr(book?.t || '') % PALETTES.length];
  const stops = palette.bg.match(/#[0-9a-f]{6}/gi) || ['#2a1810', '#5a2a1f'];
  roundRect(ctx, 0, 0, CARD_W, CARD_H, RADIUS);
  const g = ctx.createLinearGradient(0, 0, CARD_W, CARD_H);
  g.addColorStop(0, stops[0]);
  g.addColorStop(1, stops[1] || stops[0]);
  ctx.fillStyle = g;
  ctx.fill();
  frame(ctx, gold);
  const orn = ORNAMENTS[hashStr(book?.a || '') % ORNAMENTS.length];
  ctx.fillStyle = palette.accent;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `36px ${SERIF}`;
  ctx.fillText(orn, CARD_W / 2, 78);
  ctx.fillText(orn, CARD_W / 2, CARD_H - 78);
  ctx.font = `34px ${SERIF}`;
  const lines = wrap(ctx, book?.t || '?', CARD_W - 70, 5);
  const top = CARD_H / 2 - (lines.length * 40) / 2 - 16;
  lines.forEach((l, i) => ctx.fillText(l, CARD_W / 2, top + i * 40));
  ctx.font = `italic 22px ${SERIF}`;
  ctx.globalAlpha = 0.85;
  ctx.fillText(book?.a || '', CARD_W / 2, top + lines.length * 40 + 22, CARD_W - 60);
  ctx.globalAlpha = 1;
  return c;
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url.replace(/^http:\/\//, 'https://');
  });
}

// Resolves to a canvas: the real cover framed in gold, or the placeholder.
export async function drawFront(book, colors) {
  if (!book?.coverUrl) return drawPlaceholder(book, colors);
  try {
    const img = await loadImage(book.coverUrl);
    // Covers that are really 1×1 "no image" pixels count as missing.
    if (img.naturalWidth < 20) return drawPlaceholder(book, colors);
    const c = canvas();
    const ctx = c.getContext('2d');
    roundRect(ctx, 0, 0, CARD_W, CARD_H, RADIUS);
    ctx.save();
    ctx.clip();
    const s = Math.max(CARD_W / img.naturalWidth, CARD_H / img.naturalHeight);
    const w = img.naturalWidth * s;
    const h = img.naturalHeight * s;
    ctx.drawImage(img, (CARD_W - w) / 2, (CARD_H - h) / 2, w, h);
    ctx.restore();
    frame(ctx, colors.gold);
    c.getContext('2d').getImageData(0, 0, 1, 1); // throws if tainted
    return c;
  } catch {
    return drawPlaceholder(book, colors);
  }
}
