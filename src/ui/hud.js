// ============================================================================
// HEADS-UP DISPLAY: score count-up, level / sector progress, next & hold
// previews (isometric icons), power-up inventory, effect timers, jetpack
// fuel, beacon link status, minimap, danger meter, clear callouts, toasts,
// floating score popups, off-screen trackers, contextual hints and reticle.
// ============================================================================
import * as THREE from 'three';
import { G } from '../state.js';
import { on } from '../events.js';
import { POWERUPS, THEMES, GRID_W, GRID_D, CELL, ARENA_MIN_X, ARENA_MIN_Z, ARENA_MAX_X, DECK_MAX_Z, LINES_PER_LEVEL, MAX_STACK_GY } from '../config.js';
import { getQueueState, pieceCenter } from '../game/piece.js';
import { beaconStatus } from '../game/beacons.js';
import { playerStatus } from '../game/player.js';
import { orbs } from '../game/powerups.js';
import { grid, columnHeight } from '../game/board.js';
import { powerupIconURL, drawGlyph } from '../gfx/textures.js';
import { getBestScore } from '../settings.js';

const $ = (sel, root = document) => root.querySelector(sel);
const css = (hex) => '#' + (hex >>> 0).toString(16).padStart(6, '0');

let root;
const el = {};
const popups = [];
const toasts = [];
const bannerQueue = [];
let bannerTimer = 0;
let calloutTimer = 0;
let minimapTimer = 0;
let lastScoreText = '';
let lastInventoryKey = '';
let lastQueueKey = '';
let lastHint = '';
let bestScore = 0;

// ------------------------------------------------------------- piece icons --
const iconCache = new Map();

function shade(hex, k) {
  const c = new THREE.Color(hex);
  if (k > 1) c.lerp(new THREE.Color(1, 1, 1), k - 1);
  else c.multiplyScalar(k);
  return '#' + c.getHexString();
}

// Isometric render of a piece's cells (crisp, cheap, no extra WebGL context).
export function pieceIconURL(def, power = null, size = 120) {
  if (!def) return '';
  const key = `${def.key}-${power || ''}-${size}`;
  if (iconCache.has(key)) return iconCache.get(key);
  const can = document.createElement('canvas');
  can.width = can.height = size;
  const ctx = can.getContext('2d');
  const proj = (x, y, z, s, ox, oy) => [ox + (x - z) * s * 0.866, oy + (x + z) * s * 0.5 - y * s];
  const cells = def.cells.map((c) => [...c]);
  // bounds at unit scale
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  cells.forEach(([x, y, z]) => {
    for (const dx of [0, 1]) for (const dy of [0, 1]) for (const dz of [0, 1]) {
      const [px, py] = proj(x + dx, y + dy, z + dz, 1, 0, 0);
      minX = Math.min(minX, px);
      maxX = Math.max(maxX, px);
      minY = Math.min(minY, py);
      maxY = Math.max(maxY, py);
    }
  });
  const pad = size * 0.12;
  const s = Math.min((size - pad * 2) / (maxX - minX), (size - pad * 2) / (maxY - minY));
  const ox = size / 2 - ((minX + maxX) / 2) * s;
  const oy = size / 2 - ((minY + maxY) / 2) * s;
  const order = cells.map((c, i) => ({ c, i })).sort((a, b) => a.c[0] + a.c[1] + a.c[2] - (b.c[0] + b.c[1] + b.c[2]));
  const top = shade(def.color, 1.35);
  const right = shade(def.color, 0.78);
  const left = shade(def.color, 0.52);
  const edge = shade(def.color, 1.7);
  ctx.lineJoin = 'round';
  ctx.shadowColor = css(def.color);
  ctx.shadowBlur = size * 0.08;
  const face = (pts, fill) => {
    ctx.beginPath();
    pts.forEach(([x, y, z], i) => {
      const [px, py] = proj(x, y, z, s, ox, oy);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = edge;
    ctx.lineWidth = Math.max(1, size / 70);
    ctx.stroke();
  };
  order.forEach(({ c: [x, y, z], i }) => {
    face([[x, y + 1, z], [x + 1, y + 1, z], [x + 1, y + 1, z + 1], [x, y + 1, z + 1]], top);
    face([[x + 1, y, z], [x + 1, y + 1, z], [x + 1, y + 1, z + 1], [x + 1, y, z + 1]], right);
    face([[x, y, z + 1], [x + 1, y, z + 1], [x + 1, y + 1, z + 1], [x, y + 1, z + 1]], left);
    if (power && i === 1) {
      const [cx, cy] = proj(x + 0.5, y + 1, z + 0.5, s, ox, oy);
      ctx.save();
      ctx.shadowColor = css(POWERUPS[power].color);
      ctx.shadowBlur = 8;
      drawGlyph(ctx, power, cx, cy, s * 0.55, '#ffffff', Math.max(1.5, s * 0.08));
      ctx.restore();
    }
  });
  const url = can.toDataURL('image/png');
  iconCache.set(key, url);
  return url;
}

// ------------------------------------------------------------------ build --
const TEMPLATE = /* html */ `
  <div class="hud-panel hud-score" id="hud-score">
    <div class="hud-label">SCORE</div>
    <div class="hud-score-value" id="hud-score-value">0</div>
    <div class="hud-best">BEST <span id="hud-best">0</span></div>
    <div class="hud-row">
      <div class="hud-stat"><span class="hud-label">LEVEL</span><b id="hud-level">1</b></div>
      <div class="hud-stat"><span class="hud-label">LINES</span><b id="hud-lines">0</b></div>
      <div class="hud-stat"><span class="hud-label">PIECES</span><b id="hud-pieces">0</b></div>
    </div>
    <div class="hud-progress"><div class="hud-progress-fill" id="hud-level-fill"></div></div>
    <div class="hud-sector" id="hud-sector">SECTOR · NEON GRID</div>
  </div>

  <div class="hud-timer" id="hud-timer"></div>

  <div class="hud-queue">
    <div class="hud-panel hud-next">
      <div class="hud-label">NEXT</div>
      <div class="hud-next-list" id="hud-next"></div>
    </div>
    <div class="hud-panel hud-hold" id="hud-hold-panel">
      <div class="hud-label">HOLD <kbd>C</kbd></div>
      <div class="hud-hold-slot" id="hud-hold"></div>
    </div>
  </div>

  <div class="hud-toasts" id="hud-toasts"></div>

  <div class="hud-combo" id="hud-combo"><span class="hud-combo-n" id="hud-combo-n">2</span><span class="hud-combo-label">COMBO</span></div>

  <div class="hud-callout" id="hud-callout">
    <div class="hud-callout-title" id="hud-callout-title"></div>
    <div class="hud-callout-sub" id="hud-callout-sub"></div>
    <div class="hud-callout-points" id="hud-callout-points"></div>
  </div>
  <div class="hud-banner" id="hud-banner">
    <div class="hud-banner-title" id="hud-banner-title"></div>
    <div class="hud-banner-sub" id="hud-banner-sub"></div>
  </div>

  <div class="hud-reticle" id="hud-reticle">
    <i class="r-t"></i><i class="r-b"></i><i class="r-l"></i><i class="r-r"></i><i class="r-dot"></i>
    <svg class="r-ring" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" /></svg>
  </div>
  <div class="hud-armed" id="hud-armed"></div>

  <div class="hud-bottom-left">
    <div class="hud-panel hud-pilot">
      <div class="hud-beacons">
        <span class="beacon-pill sky" id="hud-b-sky">SKY TAG</span>
        <span class="beacon-link" id="hud-b-link"></span>
        <span class="beacon-pill ground" id="hud-b-ground">ANCHOR</span>
      </div>
      <div class="hud-bar-row">
        <span class="hud-label">JETPACK</span>
        <div class="hud-bar"><div class="hud-bar-fill" id="hud-fuel"></div></div>
      </div>
      <div class="hud-bar-row">
        <span class="hud-label">DASH <kbd>⇧</kbd></span>
        <div class="hud-bar thin"><div class="hud-bar-fill dash" id="hud-dash"></div></div>
      </div>
      <div class="hud-alt">ALT <b id="hud-alt">0</b> m</div>
    </div>
  </div>

  <div class="hud-bottom-center">
    <div class="hud-effects" id="hud-effects"></div>
    <div class="hud-hint" id="hud-hint"></div>
    <div class="hud-inventory" id="hud-inventory">
      <div class="inv-slot" data-slot="0"><kbd>1</kbd><img alt="" /><span class="inv-name"></span></div>
      <div class="inv-slot" data-slot="1"><kbd>2</kbd><img alt="" /><span class="inv-name"></span></div>
      <div class="inv-slot" data-slot="2"><kbd>3</kbd><img alt="" /><span class="inv-name"></span></div>
    </div>
  </div>

  <div class="hud-bottom-right">
    <div class="hud-danger" id="hud-danger-wrap">
      <div class="hud-danger-fill" id="hud-danger"></div>
      <div class="hud-danger-label">STACK</div>
    </div>
    <div class="hud-panel hud-map">
      <canvas id="hud-minimap" width="150" height="185"></canvas>
    </div>
  </div>

  <div class="hud-warning" id="hud-warning">⚠ STACK CRITICAL ⚠</div>
  <div class="hud-popups" id="hud-popups"></div>
  <div class="hud-trackers" id="hud-trackers"></div>
`;

export function initHud() {
  root = document.getElementById('hud');
  root.innerHTML = TEMPLATE;
  [
    'score-value', 'best', 'level', 'lines', 'pieces', 'level-fill', 'sector', 'timer', 'next', 'hold', 'hold-panel', 'toasts',
    'combo', 'combo-n', 'callout', 'callout-title', 'callout-sub', 'callout-points', 'banner', 'banner-title', 'banner-sub',
    'reticle', 'armed', 'b-sky', 'b-ground', 'b-link', 'fuel', 'dash', 'alt', 'effects', 'hint', 'inventory', 'danger',
    'danger-wrap', 'minimap', 'warning', 'popups', 'trackers', 'score',
  ].forEach((id) => (el[id.replace(/-(\w)/g, (_, c) => c.toUpperCase())] = document.getElementById('hud-' + id)));
  el.slots = [...root.querySelectorAll('.inv-slot')];
  el.mapCtx = el.minimap.getContext('2d');

  // Popup pool
  for (let i = 0; i < 14; i++) {
    const d = document.createElement('div');
    d.className = 'popup';
    el.popups.appendChild(d);
    popups.push({ el: d, life: 0, pos: new THREE.Vector3(), rise: 0 });
  }
  // Trackers: piece + up to 3 orbs
  el.trackerEls = [];
  for (let i = 0; i < 4; i++) {
    const d = document.createElement('div');
    d.className = 'tracker' + (i === 0 ? ' piece' : ' orb');
    d.innerHTML = '<div class="tracker-arrow"></div><div class="tracker-label"></div>';
    el.trackers.appendChild(d);
    el.trackerEls.push(d);
  }

  on('notify', onNotify);
  on('linesCleared', onLinesCleared);
  on('levelUp', ({ level, themeIndex }) => {
    showBanner(`LEVEL ${level}`, `ENTERING SECTOR · ${THEMES[themeIndex].name}`, THEMES[themeIndex].primary, 2.4);
    pulse(el.level);
  });
  on('scorePopup', spawnPopup);
  on('inventoryChanged', (e) => {
    lastInventoryKey = '';
    if (e && e.key && e.slot !== undefined) {
      const s = el.slots[e.slot];
      s.classList.remove('flash');
      void s.offsetWidth;
      s.classList.add('flash');
    }
  });
  on('queueChanged', () => (lastQueueKey = ''));
  on('pieceSpawned', () => (lastQueueKey = ''));
  on('beaconsChanged', () => {
    el.reticle.classList.remove('hit');
    void el.reticle.offsetWidth;
    el.reticle.classList.add('hit');
  });
  on('comboBroken', (n) => {
    if (n >= 2) toast(`COMBO ENDED · ${n}`, 0x8899bb);
  });
  on('gameStarted', () => {
    bestScore = getBestScore(G.mode);
    el.best.textContent = bestScore.toLocaleString();
    lastScoreText = '';
    lastInventoryKey = '';
    lastQueueKey = '';
    bannerQueue.length = 0;
    bannerTimer = 0;
    el.banner.classList.remove('show');
    el.callout.classList.remove('show');
    toasts.forEach((t) => t.el.remove());
    toasts.length = 0;
    popups.forEach((p) => {
      p.life = 0;
      p.el.style.opacity = 0;
    });
  });
  on('tetherAligned', () => {
    el.reticle.classList.add('aligned');
    setTimeout(() => el.reticle.classList.remove('aligned'), 400);
  });
  on('rotateBlocked', () => toast('ROTATION BLOCKED', 0xff5566));
}

export function setHudVisible(v) {
  root.classList.toggle('hidden', !v);
}

function pulse(node) {
  node.classList.remove('pulse');
  void node.offsetWidth;
  node.classList.add('pulse');
}

// ------------------------------------------------------- banners / toasts --
function onNotify({ title, sub = '', color = 0x00e5ff, small = false }) {
  if (small) toast(sub ? `${title} · ${sub}` : title, color);
  else showBanner(title, sub, color, 2.0);
}

function showBanner(title, sub, color, dur = 2) {
  bannerQueue.push({ title, sub, color, dur });
  if (bannerQueue.length > 3) bannerQueue.shift();
}

function toast(text, color = 0x00e5ff) {
  const d = document.createElement('div');
  d.className = 'toast';
  d.style.setProperty('--c', css(color));
  d.textContent = text;
  el.toasts.prepend(d);
  const t = { el: d, life: 3.2 };
  toasts.push(t);
  while (toasts.length > 5) toasts.shift().el.remove();
}

function onLinesCleared({ count, name, chain, combo, b2b, points }) {
  const subs = [];
  if (chain > 0) subs.push(`CHAIN ×${chain + 1}`);
  if (combo > 0) subs.push(`${combo} COMBO`);
  if (b2b) subs.push('BACK-TO-BACK');
  el.calloutTitle.textContent = chain > 0 ? `${name}!` : name;
  el.calloutTitle.dataset.tier = Math.min(4, count);
  el.calloutSub.textContent = subs.join(' · ');
  el.calloutPoints.textContent = `+${points.toLocaleString()}`;
  el.callout.classList.remove('show');
  void el.callout.offsetWidth;
  el.callout.classList.add('show');
  calloutTimer = count >= 3 ? 2.2 : 1.6;
  // the clear callout owns the centre of the screen; clear any banner
  if (bannerTimer > 0) {
    bannerTimer = 0;
    el.banner.classList.remove('show');
  }
  pulse(el.scoreValue);
}

// ---------------------------------------------------------- score popups --
function spawnPopup({ points, label, pos, overdrive }) {
  if (!points) return;
  pulse(el.score);
  if (!pos) return;
  const p = popups.find((q) => q.life <= 0) || popups[0];
  p.life = 1.3;
  p.pos.copy(pos);
  p.rise = 0;
  p.el.innerHTML = `${label ? `<small>${label}</small>` : ''}+${points.toLocaleString()}`;
  p.el.classList.toggle('od', !!overdrive);
  p.el.classList.toggle('big', points >= 10000);
}

const _v = new THREE.Vector3();
function project(pos, out) {
  _v.copy(pos).project(G.camera);
  const behind = _v.z > 1;
  out.x = (_v.x * 0.5 + 0.5) * window.innerWidth;
  out.y = (-_v.y * 0.5 + 0.5) * window.innerHeight;
  out.behind = behind;
  out.ndcX = _v.x;
  out.ndcY = _v.y;
  return out;
}

const _scr = {};
function updatePopups(dt) {
  for (const p of popups) {
    if (p.life <= 0) continue;
    p.life -= dt;
    p.rise += dt * 3.5;
    _v.copy(p.pos);
    _v.y += p.rise;
    project(_v, _scr);
    if (_scr.behind || p.life <= 0) {
      p.el.style.opacity = 0;
      continue;
    }
    const a = Math.min(1, p.life * 2.5);
    const s = 1 + Math.max(0, p.life - 1.0) * 1.6;
    p.el.style.opacity = a;
    p.el.style.transform = `translate(${_scr.x}px, ${_scr.y}px) translate(-50%, -50%) scale(${s})`;
  }
}

// -------------------------------------------------------------- trackers --
const _pc = new THREE.Vector3();
function updateTracker(node, pos, color, label, alwaysLabel) {
  if (!pos) {
    node.style.display = 'none';
    return;
  }
  project(pos, _scr);
  const w = window.innerWidth;
  const h = window.innerHeight;
  const margin = 46;
  let { x, y } = _scr;
  const onScreen = !_scr.behind && x > margin && x < w - margin && y > margin && y < h - margin;
  node.style.display = 'block';
  node.style.setProperty('--c', css(color));
  const lab = node.lastElementChild;
  if (onScreen) {
    node.classList.remove('edge');
    if (!alwaysLabel) {
      node.style.display = 'none';
      return;
    }
    node.style.transform = `translate(${x}px, ${y}px)`;
    lab.textContent = label;
    return;
  }
  // Direction from screen centre, flipped when behind the camera.
  let dx = _scr.ndcX;
  let dy = -_scr.ndcY;
  if (_scr.behind) {
    dx = -dx;
    dy = -dy;
    if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) dy = 1;
  }
  const cx = w / 2;
  const cy = h / 2;
  const sx = (cx - margin) / Math.max(0.0001, Math.abs(dx));
  const sy = (cy - margin) / Math.max(0.0001, Math.abs(dy));
  const k = Math.min(sx, sy);
  x = cx + dx * k;
  y = cy + dy * k;
  node.classList.add('edge');
  node.style.transform = `translate(${x}px, ${y}px)`;
  node.firstElementChild.style.transform = `translate(-50%, -50%) rotate(${Math.atan2(dy, dx)}rad)`;
  lab.textContent = label;
}

function updateTrackers() {
  const playing = G.phase === 'playing';
  const P = G.piece;
  if (playing && P && pieceCenter(_pc)) {
    const dist = Math.round(_pc.distanceTo(G.player.pos));
    updateTracker(el.trackerEls[0], _pc, P.def.color, `${P.def.name} · ${dist}m`, false);
  } else updateTracker(el.trackerEls[0], null);
  for (let i = 0; i < 3; i++) {
    const o = playing ? orbs[i] : null;
    if (o) {
      const dist = Math.round(o.group.position.distanceTo(G.player.pos));
      updateTracker(el.trackerEls[i + 1], o.group.position, POWERUPS[o.key].color, `${POWERUPS[o.key].name} ${dist}m`, true);
    } else updateTracker(el.trackerEls[i + 1], null);
  }
}

// --------------------------------------------------------------- minimap --
function drawMinimap() {
  const ctx = el.mapCtx;
  const W = el.minimap.width;
  const H = el.minimap.height;
  const worldW = ARENA_MAX_X - ARENA_MIN_X;
  const worldD = DECK_MAX_Z - ARENA_MIN_Z;
  const sc = Math.min((W - 10) / worldW, (H - 10) / worldD);
  const ox = (W - worldW * sc) / 2;
  const oy = (H - worldD * sc) / 2;
  const toX = (wx) => ox + (wx - ARENA_MIN_X) * sc;
  const toY = (wz) => oy + (wz - ARENA_MIN_Z) * sc;
  const cs = CELL * sc;
  ctx.clearRect(0, 0, W, H);
  const th = THEMES[G.themeIndex];
  // deck
  ctx.fillStyle = 'rgba(120,160,220,0.08)';
  ctx.fillRect(toX(ARENA_MIN_X), toY(30), worldW * sc, (DECK_MAX_Z - 30) * sc);
  // grid
  ctx.strokeStyle = css(th.primary) + '30';
  ctx.lineWidth = 1;
  for (let i = 0; i <= GRID_W; i++) {
    ctx.beginPath();
    ctx.moveTo(toX(ARENA_MIN_X) + i * cs, toY(ARENA_MIN_Z));
    ctx.lineTo(toX(ARENA_MIN_X) + i * cs, toY(ARENA_MIN_Z) + GRID_D * cs);
    ctx.stroke();
  }
  for (let j = 0; j <= GRID_D; j++) {
    ctx.beginPath();
    ctx.moveTo(toX(ARENA_MIN_X), toY(ARENA_MIN_Z) + j * cs);
    ctx.lineTo(toX(ARENA_MIN_X) + GRID_W * cs, toY(ARENA_MIN_Z) + j * cs);
    ctx.stroke();
  }
  // stack heights coloured by the top block
  for (let x = 0; x < GRID_W; x++) {
    for (let z = 0; z < GRID_D; z++) {
      const h = columnHeight(x, z);
      if (!h) continue;
      const c = grid[x][h - 1][z];
      ctx.globalAlpha = 0.35 + Math.min(0.65, h / MAX_STACK_GY);
      ctx.fillStyle = css(c.piece.color);
      ctx.fillRect(toX(ARENA_MIN_X) + x * cs + 1, toY(ARENA_MIN_Z) + z * cs + 1, cs - 2, cs - 2);
      ctx.globalAlpha = 1;
      if (h > 1) {
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.font = `bold ${Math.floor(cs * 0.55)}px Rajdhani, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(h, toX(ARENA_MIN_X) + (x + 0.5) * cs, toY(ARENA_MIN_Z) + (z + 0.5) * cs + 1);
      }
    }
  }
  // falling piece footprint + landing
  const P = G.piece;
  if (P) {
    ctx.strokeStyle = css(P.def.color);
    ctx.lineWidth = 2;
    ctx.shadowColor = css(P.def.color);
    ctx.shadowBlur = 6;
    const seen = new Set();
    P.cells.forEach(([cx, , cz]) => {
      const k = cx + ',' + cz;
      if (seen.has(k)) return;
      seen.add(k);
      ctx.strokeRect(toX(ARENA_MIN_X) + (P.gx + cx) * cs + 1.5, toY(ARENA_MIN_Z) + (P.gz + cz) * cs + 1.5, cs - 3, cs - 3);
    });
    ctx.shadowBlur = 0;
  }
  const bs = beaconStatus();
  if (bs.ground) {
    ctx.fillStyle = '#00f7ff';
    ctx.beginPath();
    ctx.arc(toX(ARENA_MIN_X) + (bs.ground[0] + 0.5) * cs, toY(ARENA_MIN_Z) + (bs.ground[1] + 0.5) * cs, cs * 0.22, 0, Math.PI * 2);
    ctx.fill();
  }
  // orbs
  orbs.forEach((o) => {
    ctx.fillStyle = css(POWERUPS[o.key].color);
    ctx.save();
    ctx.translate(toX(o.group.position.x), toY(o.group.position.z));
    ctx.rotate(Math.PI / 4);
    ctx.fillRect(-3.5, -3.5, 7, 7);
    ctx.restore();
  });
  // player
  const pl = G.player;
  ctx.save();
  ctx.translate(toX(pl.pos.x), toY(pl.pos.z));
  ctx.rotate(-pl.yaw);
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = '#00f7ff';
  ctx.shadowBlur = 8;
  ctx.beginPath();
  ctx.moveTo(0, -7);
  ctx.lineTo(5, 5);
  ctx.lineTo(0, 2.5);
  ctx.lineTo(-5, 5);
  ctx.closePath();
  ctx.fill();
  // view cone
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(0,247,255,0.12)';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.arc(0, 0, 40, -Math.PI / 2 - 0.55, -Math.PI / 2 + 0.55);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// ----------------------------------------------------------------- update --
function fmtTime(t) {
  const s = Math.max(0, Math.ceil(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function hintText() {
  if (!G.settings.showHints) return '';
  if (G.loadedWeapon) return `<b>LMB</b> fire ${POWERUPS[G.loadedWeapon].name} at the stack`;
  const P = G.piece;
  if (!P) return '';
  const b = beaconStatus();
  if (b.sky < 0 && b.ground == null) return `Look up · <b>LMB</b> tag the falling piece`;
  if (b.sky < 0) return `<b>LMB</b> tag the falling piece to link the tether`;
  if (!b.ground) return `<b>LMB</b> anchor a floor cell or block · the piece lines up above it`;
  if (!b.aligned) return `Tether pulling… <b>R</b> yaw · <b>Q</b> pitch · <b>E</b> roll`;
  return `<b>F</b> slam it down · <b>R/Q/E</b> rotate · <b>X</b> release`;
}

export function updateHud(dt) {
  if (!root) return;
  const playing = G.phase === 'playing' || G.phase === 'paused';

  // Score count-up
  const diff = G.score - G.displayScore;
  G.displayScore = Math.abs(diff) < 1 ? G.score : G.displayScore + diff * Math.min(1, dt * 7);
  const sText = Math.round(G.displayScore).toLocaleString();
  if (sText !== lastScoreText) {
    el.scoreValue.textContent = sText;
    lastScoreText = sText;
    el.score.classList.toggle('record', bestScore > 0 && G.score > bestScore);
  }
  el.level.textContent = G.level;
  el.lines.textContent = G.lines;
  el.pieces.textContent = G.piecesPlaced;
  const cfg = G.modeCfg;
  if (cfg) {
    const into = cfg.noSpeedup ? (G.lines % LINES_PER_LEVEL) : (G.lines - (cfg.startLines || 0)) % LINES_PER_LEVEL;
    el.levelFill.style.width = `${(into / LINES_PER_LEVEL) * 100}%`;
  }
  el.sector.textContent = `SECTOR · ${THEMES[G.themeIndex].name}`;

  // Blitz timer
  if (cfg && cfg.timeLimit) {
    el.timer.style.display = 'block';
    el.timer.textContent = fmtTime(G.timeLeft);
    el.timer.classList.toggle('urgent', G.timeLeft <= 10);
  } else el.timer.style.display = 'none';

  // Queue
  const q = getQueueState();
  const qKey = q.next.map((e) => e.def.key + (e.power || '')).join('|') + '/' + (q.hold ? q.hold.def.key + (q.hold.power || '') : '') + q.canHold;
  if (qKey !== lastQueueKey) {
    lastQueueKey = qKey;
    el.next.innerHTML = q.next
      .map((e, i) => `<div class="next-item${i === 0 ? ' first' : ''}"><img src="${pieceIconURL(e.def, e.power, i === 0 ? 120 : 84)}" alt="${e.def.name}"/>${i === 0 ? `<span>${e.def.name}</span>` : ''}</div>`)
      .join('');
    el.hold.innerHTML = q.hold ? `<img src="${pieceIconURL(q.hold.def, q.hold.power, 96)}" alt="${q.hold.def.name}"/>` : '<span class="empty">EMPTY</span>';
    el.holdPanel.classList.toggle('locked', !q.canHold);
  }

  // Combo
  if (G.combo >= 1 && G.phase === 'playing') {
    el.combo.classList.add('show');
    if (el.comboN.textContent !== String(G.combo)) {
      el.comboN.textContent = G.combo;
      pulse(el.combo);
    }
  } else el.combo.classList.remove('show');

  // Callout / banners
  if (calloutTimer > 0) {
    calloutTimer -= dt;
    if (calloutTimer <= 0) el.callout.classList.remove('show');
  }
  if (bannerTimer > 0) {
    bannerTimer -= dt;
    if (bannerTimer <= 0) el.banner.classList.remove('show');
  } else if (bannerQueue.length && calloutTimer <= 0.3) {
    const b = bannerQueue.shift();
    el.bannerTitle.textContent = b.title;
    el.bannerSub.textContent = b.sub;
    el.banner.style.setProperty('--c', css(b.color));
    el.banner.classList.remove('show');
    void el.banner.offsetWidth;
    el.banner.classList.add('show');
    bannerTimer = b.dur;
  }
  for (let i = toasts.length - 1; i >= 0; i--) {
    const t = toasts[i];
    t.life -= dt;
    if (t.life < 0.4) t.el.classList.add('out');
    if (t.life <= 0) {
      t.el.remove();
      toasts.splice(i, 1);
    }
  }

  // Inventory
  const invKey = G.inventory.join(',') + '/' + G.loadedWeapon;
  if (invKey !== lastInventoryKey) {
    lastInventoryKey = invKey;
    G.inventory.forEach((k, i) => {
      const s = el.slots[i];
      const img = s.querySelector('img');
      const name = s.querySelector('.inv-name');
      if (k) {
        img.src = powerupIconURL(k, POWERUPS[k].color);
        img.style.visibility = 'visible';
        name.textContent = POWERUPS[k].name;
        s.style.setProperty('--c', css(POWERUPS[k].color));
        s.classList.add('full');
        s.title = POWERUPS[k].desc;
      } else {
        img.removeAttribute('src');
        img.style.visibility = 'hidden';
        name.textContent = '';
        s.classList.remove('full');
        s.style.removeProperty('--c');
        s.title = '';
      }
    });
    if (G.loadedWeapon) {
      const w = POWERUPS[G.loadedWeapon];
      el.armed.innerHTML = `<b>${w.name}</b> ARMED · LMB`;
      el.armed.style.setProperty('--c', css(w.color));
      el.armed.classList.add('show');
    } else el.armed.classList.remove('show');
  }

  // Effects
  const fx = [];
  if (G.effects.chrono > 0) fx.push(['chrono', G.effects.chrono / POWERUPS.chrono.duration, G.effects.chrono]);
  if (G.effects.overdrive > 0) fx.push(['overdrive', G.effects.overdrive / POWERUPS.overdrive.duration, G.effects.overdrive]);
  const fxKey = fx.map((f) => f[0]).join(',');
  if (el.effects.dataset.key !== fxKey) {
    el.effects.dataset.key = fxKey;
    el.effects.innerHTML = fx
      .map(([k]) => `<div class="effect" data-k="${k}" style="--c:${css(POWERUPS[k].color)}"><img src="${powerupIconURL(k, POWERUPS[k].color)}"/><div class="effect-body"><span>${POWERUPS[k].name}</span><div class="effect-bar"><i></i></div></div><b></b></div>`)
      .join('');
  }
  fx.forEach(([k, frac, t]) => {
    const node = el.effects.querySelector(`[data-k="${k}"]`);
    if (!node) return;
    node.querySelector('i').style.width = `${frac * 100}%`;
    node.querySelector('b').textContent = `${Math.ceil(t)}s`;
    node.classList.toggle('ending', t < 3);
  });

  // Pilot
  if (G.player) {
    const ps = playerStatus();
    el.fuel.style.width = `${ps.fuel * 100}%`;
    el.fuel.classList.toggle('hot', ps.overheated);
    el.fuel.classList.toggle('od', G.effects.overdrive > 0);
    el.dash.style.width = `${Math.max(0, Math.min(1, ps.dash)) * 100}%`;
    el.dash.classList.toggle('ready', ps.dash >= 1);
    el.alt.textContent = Math.round(ps.altitude);
  }
  const bs = beaconStatus();
  el.bSky.classList.toggle('on', bs.sky >= 0);
  el.bGround.classList.toggle('on', !!bs.ground);
  el.bLink.className = 'beacon-link' + (bs.linked ? (bs.aligned ? ' aligned' : ' linked') : '');

  // Reticle
  const aim = G.aim;
  let rc = 'none';
  if (G.loadedWeapon) rc = aim && aim.type === 'ground' ? 'weapon' : 'weapon-off';
  else if (aim) rc = aim.type;
  if (el.reticle.dataset.aim !== rc) el.reticle.dataset.aim = rc;
  el.reticle.style.setProperty('--wc', G.loadedWeapon ? css(POWERUPS[G.loadedWeapon].color) : '#fff');

  // Danger
  el.danger.style.height = `${Math.min(1, G.danger) * 100}%`;
  const crit = playing && G.danger > 0.8 && cfg && cfg.topOut;
  el.dangerWrap.classList.toggle('crit', crit);
  el.warning.classList.toggle('show', crit && G.phase === 'playing');

  // Hint
  const h = G.phase === 'playing' ? hintText() : '';
  if (h !== lastHint) {
    lastHint = h;
    el.hint.innerHTML = h;
    el.hint.classList.toggle('show', !!h);
  }

  // Minimap @ ~20 fps
  minimapTimer -= dt;
  if (minimapTimer <= 0 && G.player) {
    minimapTimer = 0.05;
    drawMinimap();
  }

  updatePopups(dt);
  updateTrackers();
}

export function setThemeCss(theme) {
  const r = document.documentElement.style;
  r.setProperty('--primary', css(theme.primary));
  r.setProperty('--secondary', css(theme.secondary));
}
