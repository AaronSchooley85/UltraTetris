// ============================================================================
// THE STACK: placed-block grid [x][y][z], line detection along both
// horizontal axes, per-column gravity (with animated falls) and queries.
// ============================================================================
import * as THREE from 'three';
import { G } from '../state.js';
import { CELL, GRID_W, GRID_H, GRID_D, ARENA_MIN_X, ARENA_MIN_Z, PIECES } from '../config.js';
import { createBlockMesh } from '../gfx/blocks.js';
import { fx } from '../gfx/fx.js';

export const grid = Array.from({ length: GRID_W }, () =>
  Array.from({ length: GRID_H }, () => Array(GRID_D).fill(null))
);

export const boardGroup = new THREE.Group();
let raycastCache = null;

export function initBoard() {
  G.scene.add(boardGroup);
}

export function cellCenter(x, y, z, out = new THREE.Vector3()) {
  return out.set(ARENA_MIN_X + (x + 0.5) * CELL, (y + 0.5) * CELL, ARENA_MIN_Z + (z + 0.5) * CELL);
}

export function worldToCellXZ(wx, wz) {
  return {
    gx: Math.max(0, Math.min(GRID_W - 1, Math.floor((wx - ARENA_MIN_X) / CELL))),
    gz: Math.max(0, Math.min(GRID_D - 1, Math.floor((wz - ARENA_MIN_Z) / CELL))),
  };
}

// Out of bounds counts as solid (walls + floor); above the grid is open sky.
export function isSolid(x, y, z) {
  if (x < 0 || x >= GRID_W || z < 0 || z >= GRID_D || y < 0) return true;
  if (y >= GRID_H) return false;
  return grid[x][y][z] !== null;
}

export function getCell(x, y, z) {
  if (x < 0 || x >= GRID_W || z < 0 || z >= GRID_D || y < 0 || y >= GRID_H) return null;
  return grid[x][y][z];
}

export function placeCell(x, y, z, piece, power = null) {
  if (x < 0 || x >= GRID_W || y < 0 || y >= GRID_H || z < 0 || z >= GRID_D) return null;
  if (grid[x][y][z]) removeCell(x, y, z);
  const mesh = createBlockMesh(piece, power, false);
  cellCenter(x, y, z, mesh.position);
  mesh.userData = { isPlaced: true, gx: x, gy: y, gz: z };
  boardGroup.add(mesh);
  const cell = { mesh, piece, power, fall: 0, fallVel: 0, delay: 0 };
  grid[x][y][z] = cell;
  raycastCache = null;
  return cell;
}

export function removeCell(x, y, z) {
  const cell = grid[x][y][z];
  if (!cell) return null;
  boardGroup.remove(cell.mesh);
  grid[x][y][z] = null;
  raycastCache = null;
  return cell;
}

export function clearBoard() {
  for (let x = 0; x < GRID_W; x++)
    for (let y = 0; y < GRID_H; y++)
      for (let z = 0; z < GRID_D; z++) if (grid[x][y][z]) removeCell(x, y, z);
}

export function forEachCell(fn) {
  for (let x = 0; x < GRID_W; x++)
    for (let y = 0; y < GRID_H; y++)
      for (let z = 0; z < GRID_D; z++) if (grid[x][y][z]) fn(grid[x][y][z], x, y, z);
}

export function countCells() {
  let n = 0;
  forEachCell(() => n++);
  return n;
}

export function columnHeight(x, z) {
  for (let y = GRID_H - 1; y >= 0; y--) if (grid[x][y][z]) return y + 1;
  return 0;
}

export function maxHeight() {
  let h = 0;
  for (let x = 0; x < GRID_W; x++) for (let z = 0; z < GRID_D; z++) h = Math.max(h, columnHeight(x, z));
  return h;
}

// Full lines run along X (fixed y,z) or along Z (fixed x,y).
export function findFullLines() {
  const lines = [];
  const keys = new Set();
  const cells = [];
  const add = (x, y, z) => {
    const k = x + y * 100 + z * 10000;
    if (!keys.has(k)) {
      keys.add(k);
      cells.push([x, y, z]);
    }
  };
  for (let y = 0; y < GRID_H; y++) {
    for (let z = 0; z < GRID_D; z++) {
      let full = true;
      for (let x = 0; x < GRID_W && full; x++) if (!grid[x][y][z]) full = false;
      if (full) {
        lines.push({ axis: 'x', y, z });
        for (let x = 0; x < GRID_W; x++) add(x, y, z);
      }
    }
    for (let x = 0; x < GRID_W; x++) {
      let full = true;
      for (let z = 0; z < GRID_D && full; z++) if (!grid[x][y][z]) full = false;
      if (full) {
        lines.push({ axis: 'z', y, x });
        for (let z = 0; z < GRID_D; z++) add(x, y, z);
      }
    }
  }
  return { lines, cells };
}

function moveCell(x, fromY, toY, z, delay = 0) {
  const cell = grid[x][fromY][z];
  grid[x][fromY][z] = null;
  grid[x][toY][z] = cell;
  cell.fall += (fromY - toY) * CELL;
  cell.delay = Math.max(cell.delay, delay);
  cell.mesh.userData.gy = toY;
  cellCenter(x, toY, z, cell.mesh.position);
  cell.mesh.position.y += cell.fall;
}

// After cells were removed: everything above a removed cell drops by the
// number of removed cells beneath it (naive per-column gravity).
export function collapseColumns(removed) {
  const byColumn = new Map();
  removed.forEach(([x, y, z]) => {
    const k = x + z * 100;
    if (!byColumn.has(k)) byColumn.set(k, { x, z, ys: [] });
    byColumn.get(k).ys.push(y);
  });
  let moved = 0;
  byColumn.forEach(({ x, z, ys }) => {
    ys.sort((a, b) => a - b);
    for (let y = 0; y < GRID_H; y++) {
      if (!grid[x][y][z]) continue;
      let shift = 0;
      for (const ry of ys) if (ry < y) shift++;
      if (shift > 0) {
        moveCell(x, y, y - shift, z, 0.04 + Math.random() * 0.04);
        moved++;
      }
    }
  });
  if (moved) raycastCache = null;
  return moved;
}

// Seismic Quake: drop every block to the lowest free cell in its column.
export function compactAllColumns() {
  let moved = 0;
  for (let x = 0; x < GRID_W; x++) {
    for (let z = 0; z < GRID_D; z++) {
      let write = 0;
      for (let y = 0; y < GRID_H; y++) {
        if (!grid[x][y][z]) continue;
        if (y !== write) {
          moveCell(x, y, write, z, 0.1 + write * 0.035 + Math.random() * 0.1);
          moved++;
        }
        write++;
      }
    }
  }
  if (moved) raycastCache = null;
  return moved;
}

export function isSettling() {
  let busy = false;
  forEachCell((c) => {
    if (c.fall > 0.001) busy = true;
  });
  return busy;
}

// Animate falling blocks with gravity and a tiny bounce on touchdown.
const _p = new THREE.Vector3();
export function updateBoard(dt) {
  for (let x = 0; x < GRID_W; x++) {
    for (let y = 0; y < GRID_H; y++) {
      for (let z = 0; z < GRID_D; z++) {
        const c = grid[x][y][z];
        if (!c || c.fall <= 0) continue;
        if (c.delay > 0) {
          c.delay -= dt;
          continue;
        }
        c.fallVel += 95 * dt;
        c.fall -= c.fallVel * dt;
        if (c.fall <= 0) {
          const impact = c.fallVel;
          c.fall = 0;
          c.fallVel = 0;
          if (impact > 12) {
            cellCenter(x, y, z, _p);
            _p.y -= CELL / 2;
            fx.particles.burst(_p, 6, { color: [c.piece.color, 0xffffff], speed: [3, 9], life: [0.3, 0.6], size: [0.4, 0.9], flat: true, drag: 3, spread: CELL * 0.7 });
          }
        }
        cellCenter(x, y, z, c.mesh.position);
        c.mesh.position.y += Math.max(0, c.fall);
      }
    }
  }
}

export function getRaycastTargets() {
  if (raycastCache) return raycastCache;
  raycastCache = [];
  forEachCell((c) => raycastCache.push(c.mesh));
  return raycastCache;
}

// The original UltraTetris "reference formation" (matches the reference art).
export function populateReferenceFormation() {
  clearBoard();
  const yellow = PIECES.find((p) => p.key === 'J');
  const blue = PIECES.find((p) => p.key === 'Z');
  const green = PIECES.find((p) => p.key === 'O');
  const yellowCoords = [
    [1, 0, 3], [2, 0, 3], [3, 0, 3], [4, 0, 3],
    [1, 0, 4], [2, 0, 4],
    [1, 1, 3], [2, 1, 3],
    [1, 1, 4], [2, 1, 4],
    [1, 2, 3], [2, 2, 3],
  ];
  yellowCoords.forEach(([x, y, z]) => placeCell(x, y, z, yellow));
  const blueCoords = [
    [5, 0, 3], [6, 0, 3],
    [5, 0, 4], [6, 0, 4],
    [6, 1, 3], [6, 1, 4],
  ];
  blueCoords.forEach(([x, y, z]) => placeCell(x, y, z, blue));
  const greenCoords = [
    [7, 0, 3], [8, 0, 3],
    [7, 0, 4], [8, 0, 4],
    [7, 1, 3], [8, 1, 3],
    [7, 1, 4], [8, 1, 4],
    [7, 2, 3], [7, 2, 4],
  ];
  greenCoords.forEach(([x, y, z]) => placeCell(x, y, z, green));
}
