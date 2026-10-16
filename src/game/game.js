// ============================================================================
// GAME FLOW: modes, spawning, the line-clear sequence (flash → shatter →
// collapse → cascade), scoring, combos, chains, levels & sector themes,
// danger tracking, top-out / Zen purge and game over.
// ============================================================================
import * as THREE from 'three';
import { G } from '../state.js';
import {
  MODES,
  LINES_PER_LEVEL,
  SCORE,
  CLEAR_NAMES,
  MAX_STACK_GY,
  CELL,
  GRID_W,
  GRID_D,
  GRID_H,
  POWERUPS,
  randomPowerupKey,
} from '../config.js';
import * as board from './board.js';
import { spawnPiece, despawnPiece, resetQueue, updatePiece, resolvePieceOverlap } from './piece.js';
import { clearBeacons, clearProjectiles } from './beacons.js';
import { resetPowerups, grantPowerup, onPieceSpawnedForPowerups } from './powerups.js';
import { fxLanding, fxShatterCell, fxLineSweep, fxClearImpact, fxPowerCore, clearFx } from '../gfx/fx.js';
import { flashBlock } from '../gfx/blocks.js';
import { screenFlash, addShake } from '../gfx/renderer.js';
import { setTheme, themeForLevel } from '../gfx/theme.js';
import { audio } from '../audio/audio.js';
import { music } from '../audio/music.js';
import { emit, on } from '../events.js';
import { submitHighScore } from '../settings.js';

const clearer = {
  state: 'idle', // idle | flash | settle
  timer: 0,
  lines: [],
  cells: [],
  chain: 0,
  lockOwned: false,
  pending: false,
  pendingLock: false,
  totalLines: 0,
};

let dangerAlarm = 0;
let lastTick = -1;

export function initGame() {
  on('pieceLocked', onPieceLocked);
  on('addScore', ({ points, label, pos }) => addScore(points, label, pos));
  on('powerCoreCleared', ({ key, pos }) => {
    fxPowerCore(pos, POWERUPS[key].color);
    grantPowerup(key, 'core');
  });
  on('boardChanged', (cause) => requestSettledCheck(cause));
}

export function startGame(modeKey) {
  const cfg = MODES[modeKey] || MODES.marathon;
  G.mode = modeKey;
  G.modeCfg = cfg;
  G.score = cfg.startScore || 0;
  G.displayScore = G.score;
  G.level = cfg.startLevel;
  G.lines = cfg.startLines || 0;
  G.combo = -1;
  G.maxCombo = 0;
  G.backToBack = false;
  G.piecesPlaced = 0;
  G.powerupsUsed = 0;
  G.bestClear = 0;
  G.elapsed = 0;
  G.timeLeft = cfg.timeLimit || 0;
  G.danger = 0;
  G.slowmo = 0;
  G.timeScale = 1;
  lastTick = -1;

  despawnPiece();
  board.clearBoard();
  if (cfg.reference) board.populateReferenceFormation();
  clearFx();
  clearBeacons(true);
  clearProjectiles();
  resetPowerups();
  resetQueue();
  Object.assign(clearer, { state: 'idle', timer: 0, lines: [], cells: [], chain: 0, pending: false, pendingLock: false });

  setTheme(themeForLevel(G.level), true);
  music.bpm = 112 + Math.min(24, (G.level - 1) * 2);
  G.phase = 'playing';
  G.flow = 'spawnDelay';
  G.flowTimer = 1.4;
  emit('gameStarted', cfg);
  emit('notify', { title: cfg.name, sub: cfg.timeLimit ? 'THREE MINUTES — GO!' : 'TAG THE SKY PIECE — ANCHOR IT — DROP IT', color: 0x00e5ff });
}

// ----------------------------------------------------------------- scoring --
function addScore(points, label = '', pos = null) {
  const mult = G.effects.overdrive > 0 ? 2 : 1;
  const total = Math.round(points * mult);
  G.score += total;
  emit('scorePopup', { points: total, label, pos, overdrive: mult > 1 });
  return total;
}

function updateLevel() {
  const cfg = G.modeCfg;
  const newLevel = cfg.startLevel + Math.max(0, Math.floor((G.lines - (cfg.startLines || 0)) / LINES_PER_LEVEL));
  if (newLevel > G.level) {
    G.level = newLevel;
    const idx = themeForLevel(newLevel);
    setTheme(idx);
    audio.levelUp();
    music.bpm = 112 + Math.min(24, (newLevel - 1) * 2);
    screenFlash(0.25);
    emit('levelUp', { level: newLevel, themeIndex: idx });
    setTimeout(() => G.phase === 'playing' && grantPowerup(randomPowerupKey(), 'level'), 900);
  }
}

// --------------------------------------------------------- piece locking --
function onPieceLocked({ def, placed, worldCells, dropped }) {
  placed.forEach((c) => {
    const cell = board.placeCell(c.x, c.y, c.z, def, c.power);
    if (cell) flashBlock(cell.mesh, 0xffffff, 0.3, 0.9);
  });
  const power = dropped > 0 ? 1.45 : 1;
  fxLanding(worldCells, def.color, power);
  const center = worldCells.reduce((a, p) => a.add(p), new THREE.Vector3()).divideScalar(worldCells.length);
  audio.land(center, power);
  G.piecesPlaced++;
  const pts = SCORE.lock * G.level + dropped * SCORE.hardDropPerCell * G.level;
  addScore(pts, dropped > 0 ? 'SLAM' : '', center);
  emit('stackChanged');

  const busy = requestLineCheck('lock');
  if (busy) {
    G.flow = 'waitClear';
  } else {
    if (G.combo >= 0) emit('comboBroken', G.combo);
    G.combo = -1;
    if (!checkTopOut()) {
      G.flow = 'spawnDelay';
      G.flowTimer = 0.14;
    }
  }
}

// ----------------------------------------------------------- line clears --
function requestLineCheck(cause) {
  if (clearer.state !== 'idle') {
    clearer.pending = true;
    if (cause === 'lock') clearer.pendingLock = true;
    return true;
  }
  const { lines, cells } = board.findFullLines();
  if (!lines.length) return false;
  clearer.chain = -1; // incremented to 0 on the first clear of the sequence
  clearer.lockOwned = cause === 'lock';
  clearer.totalLines = 0;
  beginFlash(lines, cells);
  return true;
}

// Power-ups move blocks with animation; wait for them to land, then check.
function requestSettledCheck(cause) {
  if (clearer.state !== 'idle') {
    clearer.pending = true;
    return;
  }
  clearer.state = 'settle';
  clearer.timer = 0.12;
  clearer.chain = -1;
  clearer.lockOwned = false;
  clearer.totalLines = 0;
}

function lineEndpoints(l) {
  if (l.axis === 'x') {
    const a = board.cellCenter(0, l.y, l.z);
    const b = board.cellCenter(GRID_W - 1, l.y, l.z);
    a.x -= CELL * 0.6;
    b.x += CELL * 0.6;
    return [a, b];
  }
  const a = board.cellCenter(l.x, l.y, 0);
  const b = board.cellCenter(l.x, l.y, GRID_D - 1);
  a.z -= CELL * 0.6;
  b.z += CELL * 0.6;
  return [a, b];
}

function beginFlash(lines, cells) {
  clearer.state = 'flash';
  clearer.timer = 0.4;
  clearer.lines = lines;
  clearer.cells = cells;
  cells.forEach(([x, y, z]) => {
    const c = board.getCell(x, y, z);
    if (c) flashBlock(c.mesh, 0xffffff, 0.45, 1.8);
  });
  lines.forEach((l, i) => {
    const [a, b] = lineEndpoints(l);
    const color = i % 2 === 0 ? 0x00f7ff : 0xff2be2;
    setTimeout(() => fxLineSweep(a, b, color), i * 40);
  });
  audio.lineCharge(lines.length);
  if (lines.length >= 3) {
    G.slowmo = 0.7;
    G.slowmoScale = 0.3;
  }
}

function finishFlash() {
  const n = clearer.lines.length;
  const center = new THREE.Vector3();
  let count = 0;
  clearer.cells.forEach(([x, y, z]) => {
    const c = board.getCell(x, y, z);
    if (!c) return;
    const pos = board.cellCenter(x, y, z);
    center.add(pos);
    count++;
    fxShatterCell(pos, c.piece.color, n >= 3 ? 1.3 : 1);
    if (c.power) {
      fxPowerCore(pos, POWERUPS[c.power].color);
      grantPowerup(c.power, 'core');
    }
    board.removeCell(x, y, z);
  });
  if (count) center.divideScalar(count);
  board.collapseColumns(clearer.cells);
  resolvePieceOverlap();
  emit('stackChanged');

  clearer.chain++;
  const chain = clearer.chain; // 0 = first clear of this sequence
  if (clearer.lockOwned && chain === 0) {
    G.combo++;
    G.maxCombo = Math.max(G.maxCombo, G.combo);
  }
  const base = n < SCORE.lineBase.length ? SCORE.lineBase[n] : SCORE.lineBase[SCORE.lineBase.length - 1] + (n - SCORE.lineBase.length + 1) * 8000;
  const chainBonus = chain > 0 ? chain * SCORE.chainStep : 0;
  const comboBonus = clearer.lockOwned && G.combo > 0 ? G.combo * SCORE.comboStep : 0;
  let b2b = false;
  if (clearer.lockOwned && chain === 0) {
    b2b = n >= 3 && G.backToBack;
    G.backToBack = n >= 3;
  }
  const total = addScore((base + chainBonus + comboBonus) * G.level * (b2b ? 1.5 : 1), '', center);
  G.lines += n;
  clearer.totalLines += n;
  G.bestClear = Math.max(G.bestClear, n);

  fxClearImpact(center, n);
  audio.lineClear(n);
  if (chain > 0) audio.chain(chain);
  if (clearer.lockOwned && G.combo > 0) audio.combo(G.combo);
  emit('linesCleared', {
    count: n,
    name: CLEAR_NAMES[Math.min(n, CLEAR_NAMES.length - 1)] || `${n}× ULTRA`,
    chain,
    combo: clearer.lockOwned ? G.combo : -1,
    b2b,
    points: total,
  });

  if (n >= 3 || chain >= 1 || (n === 2 && Math.random() < 0.35)) {
    setTimeout(() => G.phase === 'playing' && grantPowerup(randomPowerupKey(), 'clear'), 450);
  }
  updateLevel();
  clearer.state = 'settle';
  clearer.timer = 0.32;
}

function updateClearer(dt) {
  if (clearer.state === 'flash') {
    clearer.timer -= dt;
    // shake building up during the charge
    if (clearer.lines.length >= 2) addShake(dt * 0.4);
    if (clearer.timer <= 0) finishFlash();
  } else if (clearer.state === 'settle') {
    clearer.timer -= dt;
    if (clearer.timer <= 0 && !board.isSettling()) {
      const { lines, cells } = board.findFullLines();
      if (lines.length) {
        beginFlash(lines, cells);
      } else {
        clearer.state = 'idle';
        if (clearer.pending) {
          const wasLock = clearer.pendingLock;
          clearer.pending = false;
          clearer.pendingLock = false;
          if (requestLineCheck(wasLock ? 'lock' : 'pending')) return;
          if (wasLock) {
            G.combo = -1;
          }
        }
        endSequence();
      }
    }
  }
}

function endSequence() {
  emit('clearFinished', { lines: clearer.totalLines });
  checkTopOut();
}

export function isClearing() {
  return clearer.state !== 'idle';
}

// -------------------------------------------------------- top-out / purge --
function checkTopOut() {
  if (G.phase !== 'playing') return true;
  for (let x = 0; x < GRID_W; x++)
    for (let y = MAX_STACK_GY; y < GRID_H; y++)
      for (let z = 0; z < GRID_D; z++)
        if (board.grid[x][y][z]) {
          if (G.modeCfg.topOut) {
            endGame('topout');
            return true;
          }
          zenPurge();
          return false;
        }
  return false;
}

function zenPurge() {
  const removed = [];
  board.forEachCell((c, x, y, z) => {
    if (y >= MAX_STACK_GY - 4) removed.push([x, y, z, c]);
  });
  removed.forEach(([x, y, z, c]) => {
    fxShatterCell(board.cellCenter(x, y, z), c.piece.color, 0.8);
    board.removeCell(x, y, z);
  });
  audio.explosion(new THREE.Vector3(0, MAX_STACK_GY * CELL, 0), 0.8);
  addShake(0.5);
  emit('notify', { title: 'ZEN PURGE', sub: 'TOP LAYERS DISSOLVED', color: 0x5effc8 });
}

export function endGame(reason) {
  if (G.phase !== 'playing') return;
  G.phase = 'gameover';
  G.flow = 'idle';
  despawnPiece();
  clearBeacons(true);
  clearProjectiles();
  audio.silenceLoops();
  audio.setChrono(false);
  music.tempoScale = 1;
  G.effects.chrono = 0;
  G.effects.overdrive = 0;
  G.loadedWeapon = null;
  if (reason === 'time') {
    audio.victory();
    screenFlash(0.4, 0xffd740);
  } else {
    audio.gameOver();
    screenFlash(0.5, 0xff2244);
    addShake(0.8);
    board.forEachCell((c) => flashBlock(c.mesh, 0xff2244, 1.6, 1.2));
  }
  G.slowmo = 1.2;
  G.slowmoScale = 0.3;
  const stats = {
    score: G.score,
    level: G.level,
    lines: G.lines,
    maxCombo: Math.max(0, G.maxCombo),
    pieces: G.piecesPlaced,
    powerups: G.powerupsUsed,
    bestClear: G.bestClear,
    time: G.elapsed,
    date: Date.now(),
  };
  const rank = submitHighScore(G.mode, { score: stats.score, lines: stats.lines, level: stats.level, date: stats.date });
  emit('gameOver', { reason, stats, rank });
}

// ----------------------------------------------------------------- update --
export function updateGame(dt) {
  if (G.phase !== 'playing') return;
  G.elapsed += dt;

  if (G.modeCfg.timeLimit) {
    G.timeLeft -= dt;
    const sec = Math.ceil(G.timeLeft);
    if (sec !== lastTick && sec <= 10 && sec > 0) {
      lastTick = sec;
      audio.tick(sec <= 5);
    }
    if (G.timeLeft <= 0) {
      G.timeLeft = 0;
      endGame('time');
      return;
    }
  }

  updateClearer(dt);

  switch (G.flow) {
    case 'spawnDelay':
      G.flowTimer -= dt;
      if (G.flowTimer <= 0 && clearer.state === 'idle') {
        if (!spawnPiece()) {
          if (G.modeCfg.topOut) {
            endGame('topout');
            return;
          }
          zenPurge();
          G.flowTimer = 0.5;
          return;
        }
        G.flow = 'falling';
        onPieceSpawnedForPowerups();
      }
      break;
    case 'falling':
      updatePiece(dt);
      break;
    case 'waitClear':
      if (clearer.state === 'idle' && G.phase === 'playing') {
        G.flow = 'spawnDelay';
        G.flowTimer = 0.25;
      }
      break;
  }

  // Danger: how close the stack is to the ceiling
  const h = board.maxHeight();
  const target = h / MAX_STACK_GY;
  G.danger += (target - G.danger) * Math.min(1, dt * 3);
  if (G.danger > 0.8 && G.modeCfg.topOut) {
    dangerAlarm -= dt;
    if (dangerAlarm <= 0) {
      audio.danger();
      dangerAlarm = 2.4;
    }
  }

  // Music intensity follows the action
  let intensity = 0.5 + Math.min(0.25, (G.level - 1) * 0.04) + G.danger * 0.25;
  if (G.combo > 1 || G.effects.overdrive > 0) intensity += 0.15;
  music.setIntensity(intensity);
  music.danger = G.danger > 0.78;
}
