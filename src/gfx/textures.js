// ============================================================================
// Procedural canvas textures: armored sci-fi block panels (albedo, normal,
// roughness, emissive), power-up glyphs and small sprite textures.
// ============================================================================
import * as THREE from 'three';

const SIZE = 512;

function makeCanvas(size = SIZE) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  return c;
}

// Deterministic PRNG so every load generates identical textures.
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Panel layout in texture pixels (the rounded bevel occupies ~6% per edge).
const RIM = 30;
const GROOVE_IN = 44;
const GROOVE_W = 10;
const EMBLEM = 92; // half-size of the central diamond

function diamondPath(ctx, cx, cy, r) {
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.lineTo(cx + r, cy);
  ctx.lineTo(cx, cy + r);
  ctx.lineTo(cx - r, cy);
  ctx.closePath();
}

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// Circuit traces radiating from the emblem toward the groove.
function traceLines(ctx) {
  const c = SIZE / 2;
  const g = GROOVE_IN + GROOVE_W + 6;
  const segs = [
    [[c, c - EMBLEM], [c, c - EMBLEM - 40], [c - 60, c - EMBLEM - 40], [c - 60, g]],
    [[c + EMBLEM, c], [c + EMBLEM + 50, c], [c + EMBLEM + 50, c - 70], [SIZE - g, c - 70]],
    [[c, c + EMBLEM], [c, c + EMBLEM + 36], [c + 70, c + EMBLEM + 36], [c + 70, SIZE - g]],
    [[c - EMBLEM, c], [c - EMBLEM - 44, c], [c - EMBLEM - 44, c + 64], [g, c + 64]],
  ];
  segs.forEach((pts) => {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.stroke();
    const end = pts[pts.length - 1];
    ctx.beginPath();
    ctx.arc(end[0], end[1], 5, 0, Math.PI * 2);
    ctx.fill();
  });
}

function addNoise(ctx, amount, rng, size = SIZE) {
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rng() - 0.5) * amount;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
  }
  ctx.putImageData(img, 0, 0);
}

function blotches(ctx, rng, count, alpha, light) {
  for (let i = 0; i < count; i++) {
    const x = rng() * SIZE;
    const y = rng() * SIZE;
    const r = 30 + rng() * 120;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const c = light ? 255 : 0;
    g.addColorStop(0, `rgba(${c},${c},${c},${alpha})`);
    g.addColorStop(1, `rgba(${c},${c},${c},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
}

function heightToNormal(heightCanvas, strength) {
  const ctx = heightCanvas.getContext('2d', { willReadFrequently: true });
  const src = ctx.getImageData(0, 0, SIZE, SIZE).data;
  const out = makeCanvas();
  const octx = out.getContext('2d');
  const img = octx.createImageData(SIZE, SIZE);
  const d = img.data;
  const h = (x, y) => {
    x = Math.max(0, Math.min(SIZE - 1, x));
    y = Math.max(0, Math.min(SIZE - 1, y));
    return src[(y * SIZE + x) * 4] / 255;
  };
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dx = (h(x + 1, y) - h(x - 1, y)) * strength;
      const dy = (h(x, y + 1) - h(x, y - 1)) * strength;
      let nx = -dx;
      let ny = dy;
      let nz = 1;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx /= len;
      ny /= len;
      nz /= len;
      const i = (y * SIZE + x) * 4;
      d[i] = (nx * 0.5 + 0.5) * 255;
      d[i + 1] = (ny * 0.5 + 0.5) * 255;
      d[i + 2] = (nz * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  return out;
}

function toTexture(canvas, srgb) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.anisotropy = 8;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.needsUpdate = true;
  return tex;
}

let blockTexCache = null;

export function getBlockTextures() {
  if (blockTexCache) return blockTexCache;
  const rng = mulberry32(1337);
  const c = SIZE / 2;

  // ---------------------------------------------------------------- height --
  const hCan = makeCanvas();
  const h = hCan.getContext('2d', { willReadFrequently: true });
  h.fillStyle = 'rgb(176,176,176)';
  h.fillRect(0, 0, SIZE, SIZE);
  // inner plate slightly lower than the rim
  h.fillStyle = 'rgb(150,150,150)';
  roundRectPath(h, GROOVE_IN, GROOVE_IN, SIZE - GROOVE_IN * 2, SIZE - GROOVE_IN * 2, 18);
  h.fill();
  // groove
  h.strokeStyle = 'rgb(40,40,40)';
  h.lineWidth = GROOVE_W;
  roundRectPath(h, GROOVE_IN, GROOVE_IN, SIZE - GROOVE_IN * 2, SIZE - GROOVE_IN * 2, 18);
  h.stroke();
  // recessed emblem with a raised core
  h.fillStyle = 'rgb(110,110,110)';
  diamondPath(h, c, c, EMBLEM);
  h.fill();
  h.strokeStyle = 'rgb(60,60,60)';
  h.lineWidth = 7;
  diamondPath(h, c, c, EMBLEM);
  h.stroke();
  h.fillStyle = 'rgb(190,190,190)';
  diamondPath(h, c, c, EMBLEM * 0.52);
  h.fill();
  // raised traces
  h.strokeStyle = 'rgb(172,172,172)';
  h.fillStyle = 'rgb(172,172,172)';
  h.lineWidth = 6;
  traceLines(h);
  // rivets
  h.fillStyle = 'rgb(225,225,225)';
  [[86, 86], [SIZE - 86, 86], [86, SIZE - 86], [SIZE - 86, SIZE - 86]].forEach(([x, y]) => {
    h.beginPath();
    h.arc(x, y, 9, 0, Math.PI * 2);
    h.fill();
  });
  addNoise(h, 10, rng);
  h.filter = 'blur(1.2px)';
  h.drawImage(hCan, 0, 0);
  h.filter = 'none';
  const normalCanvas = heightToNormal(hCan, 5.5);

  // ---------------------------------------------------------------- albedo --
  const aCan = makeCanvas();
  const a = aCan.getContext('2d', { willReadFrequently: true });
  a.fillStyle = 'rgb(236,238,242)';
  a.fillRect(0, 0, SIZE, SIZE);
  blotches(a, rng, 26, 0.05, false);
  blotches(a, rng, 12, 0.06, true);
  a.fillStyle = 'rgb(214,218,226)';
  roundRectPath(a, GROOVE_IN, GROOVE_IN, SIZE - GROOVE_IN * 2, SIZE - GROOVE_IN * 2, 18);
  a.fill();
  a.strokeStyle = 'rgb(48,52,60)';
  a.lineWidth = GROOVE_W + 2;
  roundRectPath(a, GROOVE_IN, GROOVE_IN, SIZE - GROOVE_IN * 2, SIZE - GROOVE_IN * 2, 18);
  a.stroke();
  a.fillStyle = 'rgb(150,156,170)';
  diamondPath(a, c, c, EMBLEM);
  a.fill();
  a.fillStyle = 'rgb(246,248,252)';
  diamondPath(a, c, c, EMBLEM * 0.52);
  a.fill();
  a.strokeStyle = 'rgb(196,200,210)';
  a.fillStyle = 'rgb(196,200,210)';
  a.lineWidth = 6;
  traceLines(a);
  // subtle panel line hatching across the plate
  a.strokeStyle = 'rgba(0,0,0,0.05)';
  a.lineWidth = 2;
  for (let i = GROOVE_IN + 30; i < SIZE - GROOVE_IN; i += 34) {
    a.beginPath();
    a.moveTo(GROOVE_IN + 14, i);
    a.lineTo(GROOVE_IN + 60, i);
    a.moveTo(SIZE - GROOVE_IN - 60, i);
    a.lineTo(SIZE - GROOVE_IN - 14, i);
    a.stroke();
  }
  addNoise(a, 9, rng);

  // ------------------------------------------------------------- roughness --
  const rCan = makeCanvas();
  const r = rCan.getContext('2d', { willReadFrequently: true });
  r.fillStyle = 'rgb(92,92,92)';
  r.fillRect(0, 0, SIZE, SIZE);
  blotches(r, rng, 30, 0.08, true);
  r.fillStyle = 'rgb(70,70,70)';
  roundRectPath(r, GROOVE_IN, GROOVE_IN, SIZE - GROOVE_IN * 2, SIZE - GROOVE_IN * 2, 18);
  r.fill();
  r.strokeStyle = 'rgb(210,210,210)';
  r.lineWidth = GROOVE_W + 2;
  roundRectPath(r, GROOVE_IN, GROOVE_IN, SIZE - GROOVE_IN * 2, SIZE - GROOVE_IN * 2, 18);
  r.stroke();
  r.fillStyle = 'rgb(140,140,140)';
  diamondPath(r, c, c, EMBLEM);
  r.fill();
  r.fillStyle = 'rgb(40,40,40)';
  diamondPath(r, c, c, EMBLEM * 0.52);
  r.fill();
  // fine scratches
  r.strokeStyle = 'rgba(255,255,255,0.18)';
  r.lineWidth = 1;
  for (let i = 0; i < 70; i++) {
    const x = rng() * SIZE;
    const y = rng() * SIZE;
    const ang = rng() * Math.PI;
    const len = 10 + rng() * 40;
    r.beginPath();
    r.moveTo(x, y);
    r.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    r.stroke();
  }
  addNoise(r, 14, rng);

  // -------------------------------------------------------------- emissive --
  const eCan = drawEmissive(null);

  blockTexCache = {
    map: toTexture(aCan, true),
    normalMap: toTexture(normalCanvas, false),
    roughnessMap: toTexture(rCan, false),
    emissiveMap: toTexture(eCan, true),
  };
  return blockTexCache;
}

// Emissive seams. With a glyph, the emblem becomes a glowing power-up symbol.
function drawEmissive(glyph) {
  const c = SIZE / 2;
  const can = makeCanvas();
  const e = can.getContext('2d', { willReadFrequently: true });
  e.fillStyle = '#000';
  e.fillRect(0, 0, SIZE, SIZE);
  e.shadowColor = '#fff';
  e.shadowBlur = 14;
  e.strokeStyle = '#ffffff';
  e.lineWidth = GROOVE_W - 4;
  roundRectPath(e, GROOVE_IN, GROOVE_IN, SIZE - GROOVE_IN * 2, SIZE - GROOVE_IN * 2, 18);
  e.stroke();
  e.strokeStyle = 'rgba(255,255,255,0.55)';
  e.fillStyle = 'rgba(255,255,255,0.55)';
  e.lineWidth = 3;
  e.shadowBlur = 8;
  traceLines(e);
  if (glyph) {
    e.fillStyle = 'rgba(255,255,255,0.18)';
    diamondPath(e, c, c, EMBLEM + 4);
    e.fill();
    e.shadowBlur = 18;
    drawGlyph(e, glyph, c, c, EMBLEM * 1.25, '#ffffff', 11);
  } else {
    e.strokeStyle = 'rgba(255,255,255,0.9)';
    e.lineWidth = 4;
    e.shadowBlur = 12;
    diamondPath(e, c, c, EMBLEM);
    e.stroke();
    e.fillStyle = 'rgba(255,255,255,0.75)';
    diamondPath(e, c, c, EMBLEM * 0.22);
    e.fill();
  }
  // corner status LEDs
  e.shadowBlur = 10;
  e.fillStyle = '#ffffff';
  [[86, 86], [SIZE - 86, SIZE - 86]].forEach(([x, y]) => {
    e.beginPath();
    e.arc(x, y, 5, 0, Math.PI * 2);
    e.fill();
  });
  return can;
}

const glyphEmissiveCache = new Map();
export function getGlyphEmissive(kind) {
  if (!glyphEmissiveCache.has(kind)) glyphEmissiveCache.set(kind, toTexture(drawEmissive(kind), true));
  return glyphEmissiveCache.get(kind);
}

// ------------------------------------------------------------------ glyphs --
export function drawGlyph(ctx, kind, cx, cy, size, color, lw = 6) {
  const s = size / 2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = lw;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  switch (kind) {
    case 'chrono': {
      ctx.beginPath();
      ctx.moveTo(-s * 0.6, -s * 0.8);
      ctx.lineTo(s * 0.6, -s * 0.8);
      ctx.lineTo(-s * 0.6, s * 0.8);
      ctx.lineTo(s * 0.6, s * 0.8);
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-s * 0.8, -s * 0.8);
      ctx.lineTo(s * 0.8, -s * 0.8);
      ctx.moveTo(-s * 0.8, s * 0.8);
      ctx.lineTo(s * 0.8, s * 0.8);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-s * 0.32, s * 0.62);
      ctx.lineTo(s * 0.32, s * 0.62);
      ctx.lineTo(0, s * 0.2);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'nova': {
      ctx.beginPath();
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2 - Math.PI / 2;
        const r = i % 2 === 0 ? s * 0.95 : s * 0.38;
        ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.18, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'laser': {
      ctx.beginPath();
      ctx.moveTo(-s * 0.9, s * 0.9);
      ctx.lineTo(s * 0.55, -s * 0.55);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(s * 0.95, -s * 0.95);
      ctx.lineTo(s * 0.25, -s * 0.7);
      ctx.lineTo(s * 0.7, -s * 0.25);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-s * 0.55, s * 0.15);
      ctx.lineTo(-s * 0.15, s * 0.55);
      ctx.moveTo(-s * 0.25, -s * 0.15);
      ctx.lineTo(s * 0.15, s * 0.25);
      ctx.stroke();
      break;
    }
    case 'nano': {
      const r = s * 0.78;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
        ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.closePath();
      ctx.stroke();
      // Inner "Y" edges: center to the bottom, upper-left and upper-right vertices
      ctx.beginPath();
      [Math.PI / 2, (Math.PI * 7) / 6, -Math.PI / 6].forEach((a) => {
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      });
      ctx.stroke();
      break;
    }
    case 'overdrive': {
      for (let k = 0; k < 2; k++) {
        const y = s * 0.15 + k * -s * 0.6;
        ctx.beginPath();
        ctx.moveTo(-s * 0.7, y + s * 0.4);
        ctx.lineTo(0, y - s * 0.25);
        ctx.lineTo(s * 0.7, y + s * 0.4);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(-s * 0.5, s * 0.85);
      ctx.lineTo(s * 0.5, s * 0.85);
      ctx.stroke();
      break;
    }
    case 'quake': {
      ctx.beginPath();
      ctx.moveTo(-s * 0.95, 0);
      ctx.lineTo(-s * 0.55, 0);
      ctx.lineTo(-s * 0.35, -s * 0.7);
      ctx.lineTo(-s * 0.05, s * 0.75);
      ctx.lineTo(s * 0.2, -s * 0.45);
      ctx.lineTo(s * 0.42, s * 0.3);
      ctx.lineTo(s * 0.58, 0);
      ctx.lineTo(s * 0.95, 0);
      ctx.stroke();
      break;
    }
    case 'oracle': {
      ctx.beginPath();
      ctx.moveTo(-s * 0.95, 0);
      ctx.quadraticCurveTo(0, -s * 0.85, s * 0.95, 0);
      ctx.quadraticCurveTo(0, s * 0.85, -s * 0.95, 0);
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.95);
      ctx.lineTo(0, -s * 0.62);
      ctx.moveTo(-s * 0.55, -s * 0.8);
      ctx.lineTo(-s * 0.4, -s * 0.52);
      ctx.moveTo(s * 0.55, -s * 0.8);
      ctx.lineTo(s * 0.4, -s * 0.52);
      ctx.stroke();
      break;
    }
    default:
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.6, 0, Math.PI * 2);
      ctx.stroke();
  }
  ctx.restore();
}

function hexCss(hex) {
  return '#' + hex.toString(16).padStart(6, '0');
}

// Round badge icon for HUD slots, returned as a data URL.
const iconCache = new Map();
export function powerupIconURL(kind, colorHex) {
  const key = `${kind}-${colorHex}`;
  if (iconCache.has(key)) return iconCache.get(key);
  const S = 128;
  const can = makeCanvas(S);
  const ctx = can.getContext('2d');
  const col = hexCss(colorHex);
  const grad = ctx.createRadialGradient(S / 2, S / 2, 4, S / 2, S / 2, S / 2);
  grad.addColorStop(0, 'rgba(255,255,255,0.18)');
  grad.addColorStop(0.7, col + '33');
  grad.addColorStop(1, col + '00');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, S, S);
  ctx.shadowColor = col;
  ctx.shadowBlur = 16;
  drawGlyph(ctx, kind, S / 2, S / 2, S * 0.62, '#ffffff', 7);
  ctx.shadowBlur = 0;
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = col;
  ctx.globalAlpha = 0.35;
  ctx.fillRect(0, 0, S, S);
  const url = can.toDataURL('image/png');
  iconCache.set(key, url);
  return url;
}

// Glyph billboard texture for floating power-up orbs.
const orbTexCache = new Map();
export function orbGlyphTexture(kind) {
  if (orbTexCache.has(kind)) return orbTexCache.get(kind);
  const S = 256;
  const can = makeCanvas(S);
  const ctx = can.getContext('2d');
  ctx.shadowColor = '#fff';
  ctx.shadowBlur = 18;
  drawGlyph(ctx, kind, S / 2, S / 2, S * 0.58, '#ffffff', 14);
  const tex = toTexture(can, true);
  orbTexCache.set(kind, tex);
  return tex;
}

let softDot = null;
export function softDotTexture() {
  if (softDot) return softDot;
  const S = 128;
  const can = makeCanvas(S);
  const ctx = can.getContext('2d');
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.2, 'rgba(255,255,255,0.75)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.18)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  softDot = toTexture(can, true);
  return softDot;
}

let ringTexCache = null;
export function planetRingTexture() {
  if (ringTexCache) return ringTexCache;
  const W = 1024;
  const can = document.createElement('canvas');
  can.width = W;
  can.height = 8;
  const ctx = can.getContext('2d');
  const rng = mulberry32(99);
  for (let x = 0; x < W; x++) {
    const t = x / W;
    const band = 0.5 + 0.5 * Math.sin(t * 90 + Math.sin(t * 13) * 3);
    const gap = t > 0.55 && t < 0.6 ? 0.1 : 1;
    const edge = Math.min(1, t * 8) * Math.min(1, (1 - t) * 5);
    const a = (0.25 + band * 0.55 + rng() * 0.15) * gap * edge;
    const v = 200 + band * 55;
    ctx.fillStyle = `rgba(${v},${v * 0.92},${v * 0.85},${a})`;
    ctx.fillRect(x, 0, 1, 8);
  }
  ringTexCache = toTexture(can, true);
  return ringTexCache;
}

export { hexCss };
