// ============================================================================
// THE FALLING MEGA-TETROMINO: bag randomizer, next queue, hold, 3D rotation
// with wall kicks and a springy visual, lock delay, hologram ghost and
// vertical drop guides.
// ============================================================================
import * as THREE from 'three';
import { G } from '../state.js';
import {
  CELL,
  GRID_W,
  GRID_D,
  SPAWN_GY,
  PIECES,
  NANO_PIECE,
  POWERUPS,
  LOCK_DELAY,
  MAX_LOCK_RESETS,
  ARENA_MIN_X,
  ARENA_MIN_Z,
  PLAYER_HEIGHT,
  fallSpeedForLevel,
  randomPowerupKey,
} from '../config.js';
import { isSolid } from './board.js';
import {
  createBlockMesh,
  createGhostMaterial,
  createGhostEdgeMaterial,
  createGhostCell,
  createDropGuide,
  flashBlock,
} from '../gfx/blocks.js';
import { emit } from '../events.js';
import { audio } from '../audio/audio.js';
import { fx } from '../gfx/fx.js';

export const pieceGroup = new THREE.Group();
export const ghostGroup = new THREE.Group();

const SPAWN_GX = 4;
const SPAWN_GZ = 4;

export const queue = { bag: [], next: [], hold: null, canHold: true };

export function initPieces() {
  G.scene.add(pieceGroup);
  G.scene.add(ghostGroup);
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function drawEntry() {
  if (!queue.bag.length) queue.bag = shuffle([...PIECES]);
  const def = queue.bag.pop();
  const chance = G.modeCfg && G.modeCfg.timeLimit ? 0.3 : 0.17;
  const power = Math.random() < chance ? randomPowerupKey() : null;
  return { def, power };
}

export function resetQueue() {
  queue.bag = [];
  queue.next = [];
  queue.hold = null;
  queue.canHold = true;
  while (queue.next.length < 4) queue.next.push(drawEntry());
}

function takeNext() {
  const e = queue.next.shift();
  while (queue.next.length < 4) queue.next.push(drawEntry());
  emit('queueChanged');
  return e;
}

// ---------------------------------------------------------- grid helpers --
export function canOccupy(cells, gx, gy, gz) {
  for (let i = 0; i < cells.length; i++) {
    if (isSolid(gx + cells[i][0], gy + cells[i][1], gz + cells[i][2])) return false;
  }
  return true;
}

export function canOccupyFloat(cells, gx, gyF, gz) {
  const f = Math.floor(gyF);
  const c = Math.ceil(gyF);
  return canOccupy(cells, gx, f, gz) && (c === f || canOccupy(cells, gx, c, gz));
}

export function computeLanding(cells, gx, gyF, gz) {
  let gy = Math.floor(gyF);
  while (canOccupy(cells, gx, gy - 1, gz)) gy--;
  return gy;
}

// Integer 90° rotation of cell offsets about a signed world axis.
export function rotateCells(cells, axis, sign) {
  return cells.map(([x, y, z]) => {
    if (axis === 'x') return [x, -sign * z, sign * y];
    if (axis === 'y') return [sign * z, y, -sign * x];
    return [-sign * y, sign * x, z];
  });
}

function normKey(cells) {
  let mx = Infinity, my = Infinity, mz = Infinity;
  cells.forEach(([x, y, z]) => {
    mx = Math.min(mx, x);
    my = Math.min(my, y);
    mz = Math.min(mz, z);
  });
  return cells
    .map(([x, y, z]) => `${x - mx},${y - my},${z - mz}`)
    .sort()
    .join('|');
}

// Every distinct 3D orientation reachable by 90° rotations (up to 24).
export function allOrientations(cells) {
  const seen = new Map();
  const stack = [cells];
  while (stack.length) {
    const c = stack.pop();
    const k = normKey(c);
    if (seen.has(k)) continue;
    seen.set(k, c);
    ['x', 'y', 'z'].forEach((ax) => stack.push(rotateCells(c, ax, 1)));
  }
  return [...seen.values()];
}

// --------------------------------------------------------------- spawning --
function clearVisuals() {
  while (pieceGroup.children.length) pieceGroup.remove(pieceGroup.children[0]);
  while (ghostGroup.children.length) ghostGroup.remove(ghostGroup.children[0]);
}

function buildVisuals(P) {
  clearVisuals();
  P.segs = P.cells.map((_, i) => {
    const power = P.power && P.power.index === i ? P.power.key : null;
    const mesh = createBlockMesh(P.def, power, true);
    mesh.userData = { isFalling: true, segmentIndex: i };
    pieceGroup.add(mesh);
    return mesh;
  });
  P.ghostMat = P.ghostMat || createGhostMaterial(P.def.color);
  P.ghostMat.uniforms.uColor.value.set(P.def.color);
  P.edgeMat = P.edgeMat || createGhostEdgeMaterial(P.def.color);
  P.edgeMat.color.set(P.def.color);
  P.ghosts = P.cells.map(() => {
    const g = createGhostCell(P.ghostMat, P.edgeMat);
    ghostGroup.add(g);
    return g;
  });
  P.guides = P.cells.map(() => {
    const g = createDropGuide(P.def.color);
    ghostGroup.add(g);
    return g;
  });
}

function makePiece(entry, gx, gy, gz) {
  const P = {
    def: entry.def,
    cells: entry.def.cells.map((c) => [...c]),
    power: entry.power ? { index: Math.floor(Math.random() * entry.def.cells.length), key: entry.power } : null,
    gx,
    gz,
    gy,
    visualX: gx,
    visualZ: gz,
    lockTimer: 0,
    lockResets: 0,
    grounded: false,
    hardDropping: false,
    hardSpeed: 0,
    dropStart: gy,
    rotRemaining: 0,
    rotVel: 0,
    rotAxis: new THREE.Vector3(0, 1, 0),
    rotPivot: [0, 0, 0],
    landing: 0,
    age: 0,
    autopilot: null,
  };
  buildVisuals(P);
  return P;
}

// Returns false when the spawn zone is blocked (top-out).
export function spawnPiece(entry = null) {
  const e = entry || takeNext();
  queue.canHold = true;
  const P = makePiece(e, SPAWN_GX, SPAWN_GY, SPAWN_GZ);
  if (!canOccupyFloat(P.cells, P.gx, P.gy, P.gz)) {
    clearVisuals();
    G.piece = null;
    return false;
  }
  G.piece = P;
  P.landing = computeLanding(P.cells, P.gx, P.gy, P.gz);
  updatePieceVisuals(0);
  emit('pieceSpawned', P);
  return true;
}

export function despawnPiece() {
  clearVisuals();
  G.piece = null;
}

// Swap the falling piece with the hold slot (once per piece). The incoming
// piece appears in place when it fits, otherwise back at the spawn point.
export function holdPiece() {
  const P = G.piece;
  if (!P || !queue.canHold || P.hardDropping || P.autopilot) return false;
  const outgoing = { def: P.def === NANO_PIECE ? P.originalDef || P.def : P.def, power: P.power ? P.power.key : null };
  const incoming = queue.hold || takeNext();
  queue.hold = outgoing;
  const N = makePiece(incoming, P.gx, P.gy, P.gz);
  if (!canOccupyFloat(N.cells, N.gx, N.gy, N.gz)) {
    N.gx = SPAWN_GX;
    N.gz = SPAWN_GZ;
    N.gy = SPAWN_GY;
    N.visualX = N.gx;
    N.visualZ = N.gz;
    if (!canOccupyFloat(N.cells, N.gx, N.gy, N.gz)) {
      // nowhere to put it: undo
      queue.hold = incoming;
      buildVisuals(P);
      return false;
    }
  }
  N.ghostMat = P.ghostMat;
  N.edgeMat = P.edgeMat;
  buildVisuals(N);
  G.piece = N;
  queue.canHold = false;
  N.landing = computeLanding(N.cells, N.gx, N.gy, N.gz);
  updatePieceVisuals(0);
  audio.holdSwap();
  emit('queueChanged');
  emit('pieceSpawned', N);
  return true;
}

// ---------------------------------------------------------------- control --
function onMoved(P) {
  P.landing = computeLanding(P.cells, P.gx, P.gy, P.gz);
  if (P.grounded && P.lockResets < MAX_LOCK_RESETS) {
    P.lockTimer = 0;
    P.lockResets++;
  }
  if (P.gy > P.landing + 0.001) P.grounded = false;
}

export function tryMove(dx, dz) {
  const P = G.piece;
  if (!P || P.hardDropping) return false;
  if (!canOccupyFloat(P.cells, P.gx + dx, P.gy, P.gz + dz)) return false;
  P.gx += dx;
  P.gz += dz;
  onMoved(P);
  return true;
}

// axis: 'x' | 'y' | 'z', sign: ±1, pivotIndex: which segment stays put.
export function rotatePiece(axis, sign, pivotIndex = 1) {
  const P = G.piece;
  if (!P || P.hardDropping) return false;
  if (P.cells.length === 1) {
    // Nano cube: purely cosmetic spin
    P.rotAxis.set(axis === 'x' ? sign : 0, axis === 'y' ? sign : 0, axis === 'z' ? sign : 0);
    P.rotPivot = [0, 0, 0];
    P.rotRemaining = Math.PI / 2;
    P.rotVel = -1.6;
    return true;
  }
  const pivotIdx = Math.max(0, Math.min(P.cells.length - 1, pivotIndex));
  const pivot = P.cells[pivotIdx];
  const rel = P.cells.map(([x, y, z]) => [x - pivot[0], y - pivot[1], z - pivot[2]]);
  const rotated = rotateCells(rel, axis, sign).map(([x, y, z]) => [x + pivot[0], y + pivot[1], z + pivot[2]]);
  const kicks = [
    [0, 0, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1],
    [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
    [2, 0, 0], [-2, 0, 0], [0, 0, 2], [0, 0, -2],
    [0, 1, 0], [1, 1, 0], [-1, 1, 0], [0, 1, 1], [0, 1, -1],
  ];
  for (const [kx, ky, kz] of kicks) {
    const ngy = P.gy + ky;
    if (canOccupyFloat(rotated, P.gx + kx, ngy, P.gz + kz)) {
      P.cells = rotated;
      P.gx += kx;
      P.gz += kz;
      P.gy = ngy;
      P.rotAxis.set(axis === 'x' ? sign : 0, axis === 'y' ? sign : 0, axis === 'z' ? sign : 0);
      P.rotPivot = [...pivot];
      P.rotRemaining = Math.PI / 2;
      P.rotVel = -1.6;
      onMoved(P);
      updatePieceVisuals(0);
      return true;
    }
  }
  return false;
}

export function hardDrop() {
  const P = G.piece;
  if (!P || P.hardDropping) return false;
  P.hardDropping = true;
  P.hardSpeed = 10;
  P.dropStart = P.gy;
  audio.hardDrop();
  emit('hardDrop', P);
  return true;
}

// NANO CUBE: collapse the piece into a single cube at its pivot segment.
export function morphToNano() {
  const P = G.piece;
  if (!P) return false;
  const keepIdx = P.power ? P.power.index : Math.min(1, P.cells.length - 1);
  const keep = P.cells[keepIdx];
  P.originalDef = P.def;
  P.def = NANO_PIECE;
  P.gx += keep[0];
  P.gz += keep[2];
  P.gy += keep[1];
  P.visualX += keep[0];
  P.visualZ += keep[2];
  P.cells = [[0, 0, 0]];
  P.power = null;
  P.rotRemaining = 0;
  P.rotVel = 0;
  P.ghostMat.uniforms.uColor.value.set(NANO_PIECE.color);
  P.edgeMat.color.set(NANO_PIECE.color);
  buildVisuals(P);
  onMoved(P);
  P.segs.forEach((s) => flashBlock(s, NANO_PIECE.color, 0.5, 1.4));
  updatePieceVisuals(0);
  return true;
}

// Re-orient and reposition the piece (used by the Oracle auto-pilot).
export function setPieceConfiguration(cells, gx, gz) {
  const P = G.piece;
  if (!P) return false;
  if (!canOccupyFloat(cells, gx, P.gy, gz)) return false;
  P.cells = cells.map((c) => [...c]);
  P.gx = gx;
  P.gz = gz;
  P.rotAxis.set(0, 1, 0);
  P.rotPivot = [0, 0, 0];
  P.rotRemaining = Math.PI * 2;
  P.rotVel = -4;
  onMoved(P);
  updatePieceVisuals(0);
  return true;
}

// ---------------------------------------------------------------- update --
const _q = new THREE.Quaternion();
const _rel = new THREE.Vector3();
const _w = new THREE.Vector3();

export function getSegmentWorldPos(i, out = new THREE.Vector3()) {
  const P = G.piece;
  if (!P || !P.segs[i]) return null;
  return out.copy(P.segs[i].position);
}

export function pieceCenter(out = new THREE.Vector3()) {
  const P = G.piece;
  if (!P) return null;
  out.set(0, 0, 0);
  P.segs.forEach((s) => out.add(s.position));
  return out.divideScalar(P.segs.length);
}

export function updatePieceVisuals(dt) {
  const P = G.piece;
  if (!P) return;
  const k = dt > 0 ? Math.min(1, dt * 9) : 1;
  P.visualX += (P.gx - P.visualX) * k;
  P.visualZ += (P.gz - P.visualZ) * k;

  if (dt > 0 && (Math.abs(P.rotRemaining) > 0.0008 || Math.abs(P.rotVel) > 0.0008)) {
    const acc = -38 * P.rotRemaining - 8.6 * P.rotVel;
    P.rotVel += acc * dt;
    P.rotRemaining += P.rotVel * dt;
    if (Math.abs(P.rotRemaining) < 0.001 && Math.abs(P.rotVel) < 0.01) {
      P.rotRemaining = 0;
      P.rotVel = 0;
    }
  }
  _q.identity();
  if (Math.abs(P.rotRemaining) > 0.0005) _q.setFromAxisAngle(P.rotAxis, -P.rotRemaining);
  const [px, py, pz] = P.rotPivot;

  P.cells.forEach(([ox, oy, oz], i) => {
    _rel.set(ox - px, oy - py, oz - pz).applyQuaternion(_q);
    const seg = P.segs[i];
    seg.position.set(
      ARENA_MIN_X + (P.visualX + px + _rel.x + 0.5) * CELL,
      (P.gy + py + _rel.y + 0.5) * CELL,
      ARENA_MIN_Z + (P.visualZ + pz + _rel.z + 0.5) * CELL
    );
    seg.quaternion.copy(_q);
    const gh = P.ghosts[i];
    gh.position.set(ARENA_MIN_X + (P.gx + ox + 0.5) * CELL, (P.landing + oy + 0.5) * CELL, ARENA_MIN_Z + (P.gz + oz + 0.5) * CELL);
    gh.visible = P.gy - P.landing > 0.35;

    // Drop guide from the bottom of each column-lowest segment to its ghost.
    const guide = P.guides[i];
    let lowest = true;
    for (const [bx, by, bz] of P.cells) if (bx === ox && bz === oz && by < oy) lowest = false;
    const top = (P.gy + oy) * CELL;
    const bottom = (P.landing + oy + 1) * CELL;
    const len = top - bottom;
    if (lowest && len > 0.5) {
      guide.visible = true;
      guide.position.set(gh.position.x, top, gh.position.z);
      guide.scale.set(1, len, 1);
      guide.material.uniforms.uLen.value = len;
      guide.material.uniforms.uTime.value = G.time;
    } else {
      guide.visible = false;
    }
  });
  P.ghostMat.uniforms.uTime.value = G.time;
  P.ghostMat.uniforms.uOpacity.value = Math.min(1, (P.gy - P.landing) / 2);
}

export function currentFallSpeed() {
  const lvl = G.modeCfg && G.modeCfg.noSpeedup ? 1 : G.level;
  let s = fallSpeedForLevel(lvl);
  if (G.effects.chrono > 0) s *= 0.18;
  return s;
}

// Advances the piece; emits 'pieceLocked' when it settles.
export function updatePiece(dt) {
  const P = G.piece;
  if (!P) return;
  P.age += dt;

  if (P.autopilot) {
    P.autopilot.t -= dt;
    if (P.autopilot.t <= 0 && !P.hardDropping) {
      P.autopilot = null;
      hardDrop();
    }
  }

  P.landing = computeLanding(P.cells, P.gx, P.gy, P.gz);
  let rate;
  if (P.hardDropping) {
    P.hardSpeed = Math.min(48, P.hardSpeed + dt * 140);
    rate = P.hardSpeed;
    if (Math.random() < 0.9) {
      P.segs.forEach((s) => {
        fx.particles.emit(
          s.position.x + (Math.random() - 0.5) * CELL * 0.9,
          s.position.y + CELL * 0.4,
          s.position.z + (Math.random() - 0.5) * CELL * 0.9,
          0,
          18,
          0,
          P.def.color,
          0.5 + Math.random() * 0.6,
          0.35,
          0,
          1
        );
      });
    }
  } else {
    rate = currentFallSpeed();
  }

  const next = P.gy - rate * dt;
  if (next <= P.landing) {
    P.gy = P.landing;
    if (!P.grounded) {
      P.grounded = true;
      if (!P.hardDropping) audio.lockClick();
    }
    P.lockTimer += dt;
  } else {
    P.gy = next;
    P.grounded = false;
  }

  updatePieceVisuals(dt);
  pushPlayerOutOfPiece();

  if (P.grounded && (P.hardDropping || P.lockTimer >= LOCK_DELAY || (P.lockResets >= MAX_LOCK_RESETS && P.lockTimer >= 0.15))) {
    lockPiece();
  }
}

function lockPiece() {
  const P = G.piece;
  const placed = P.cells.map(([ox, oy, oz], i) => ({
    x: P.gx + ox,
    y: P.landing + oy,
    z: P.gz + oz,
    power: P.power && P.power.index === i ? P.power.key : null,
  }));
  const worldCells = P.segs.map((s) => s.position.clone());
  const dropped = P.hardDropping ? Math.max(0, Math.round(P.dropStart - P.landing)) : 0;
  const def = P.def;
  despawnPiece();
  emit('pieceLocked', { def, placed, worldCells, dropped });
}

// Falling cubes shove the player out of the way instead of clipping.
function pushPlayerOutOfPiece() {
  const P = G.piece;
  const pl = G.player;
  if (!P || !pl) return;
  const half = CELL / 2;
  for (const seg of P.segs) {
    const dx = Math.abs(pl.pos.x - seg.position.x);
    const dz = Math.abs(pl.pos.z - seg.position.z);
    if (dx > half + 0.4 || dz > half + 0.4) continue;
    const bottom = seg.position.y - half;
    const top = seg.position.y + half;
    if (pl.pos.y + PLAYER_HEIGHT > bottom && pl.pos.y < top) {
      // shove sideways toward the nearer edge
      const sx = pl.pos.x - seg.position.x;
      const sz = pl.pos.z - seg.position.z;
      if (Math.abs(sx) > Math.abs(sz)) {
        pl.pos.x = seg.position.x + Math.sign(sx || 1) * (half + 0.6);
        pl.vel.x = Math.sign(sx || 1) * 10;
      } else {
        pl.pos.z = seg.position.z + Math.sign(sz || 1) * (half + 0.6);
        pl.vel.z = Math.sign(sz || 1) * 10;
      }
      pl.vel.y = Math.min(pl.vel.y, -2);
      if (!pl.crushCooldown || pl.crushCooldown <= 0) {
        audio.crushed();
        pl.crushCooldown = 0.6;
        emit('playerShoved');
      }
    }
  }
}

// After the stack shifts under a power-up, nudge the piece up if a block
// dropped into its space (only possible when it was tucked under an overhang).
export function resolvePieceOverlap() {
  const P = G.piece;
  if (!P) return;
  let guard = 0;
  while (!canOccupyFloat(P.cells, P.gx, P.gy, P.gz) && guard++ < 30) P.gy = Math.floor(P.gy) + 1;
  P.landing = computeLanding(P.cells, P.gx, P.gy, P.gz);
}

export function pieceCellsWorld() {
  const P = G.piece;
  if (!P) return [];
  return P.cells.map(([ox, oy, oz]) => _w.set(P.gx + ox, P.gy + oy, P.gz + oz).clone());
}

export function getQueueState() {
  return { next: queue.next.slice(0, 3), hold: queue.hold, canHold: queue.canHold };
}

export { SPAWN_GX, SPAWN_GZ, POWERUPS };
