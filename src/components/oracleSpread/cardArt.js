// src/components/oracleSpread/cardArt.js — 2D canvas art for the WebGL cards.
//
// Card faces are drawn once into canvases and uploaded as textures: the
// face-down Oracle back (the same back the landing deals), the face-up arcana
// the stars choose, and the soft halo behind a chosen card. All local art —
// no remote images, so no CORS and nothing to wait on.

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

// A face-up Oracle card: a sigil and an arcana name, in the landing's
// language (gold frame, serif name, a short divider). Used by the long-wait
// tarot spread when the stars choose a card.
export function drawFace({ name, sigil }, { gold, ink, text }) {
  const c = canvas();
  const ctx = c.getContext('2d');
  roundRect(ctx, 0, 0, CARD_W, CARD_H, RADIUS);
  ctx.fillStyle = ink;
  ctx.fill();
  ctx.save();
  ctx.clip();
  const g = ctx.createRadialGradient(CARD_W / 2, CARD_H * 0.38, 8, CARD_W / 2, CARD_H * 0.38, CARD_H * 0.55);
  g.addColorStop(0, 'rgba(201,162,75,0.28)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  ctx.restore();
  frame(ctx, gold);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = gold;
  ctx.font = `110px ${SERIF}`;
  ctx.fillText(sigil, CARD_W / 2, CARD_H * 0.38);
  ctx.fillStyle = text;
  ctx.font = `italic 38px ${SERIF}`;
  const lines = wrap(ctx, name, CARD_W - 60, 2);
  lines.forEach((l, i) => ctx.fillText(l, CARD_W / 2, CARD_H * 0.64 + i * 42));
  ctx.strokeStyle = gold;
  ctx.globalAlpha = 0.7;
  ctx.lineWidth = 2;
  ctx.beginPath();
  const dy = CARD_H * 0.64 + lines.length * 42 + 6;
  ctx.moveTo(CARD_W / 2 - 34, dy);
  ctx.lineTo(CARD_W / 2 + 34, dy);
  ctx.stroke();
  ctx.globalAlpha = 1;
  return c;
}

// Soft round glow, for the halo behind the chosen card.
export function drawGlow(hex) {
  const n = parseInt(String(hex).replace('#', ''), 16) || 0xc9a24b;
  const rgb = `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, `rgba(${rgb}, 0.95)`);
  g.addColorStop(0.35, `rgba(${rgb}, 0.35)`);
  g.addColorStop(1, `rgba(${rgb}, 0)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  return c;
}
