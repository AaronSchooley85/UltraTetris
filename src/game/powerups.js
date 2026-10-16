// ============================================================================
// POWER-UPS: floating orbs to collect with the jetpack, a 3-slot inventory
// and seven abilities — Chrono Field, Nova Bomb, Laser Lance, Nano Cube,
// Overdrive, Seismic Quake and the Oracle AI auto-pilot.
// ============================================================================
import * as THREE from 'three';
import { G } from '../state.js';
import {
  POWERUPS,
  randomPowerupKey,
  CELL,
  GRID_W,
  GRID_H,
  GRID_D,
  MAX_STACK_GY,
  ARENA_MIN_X,
  ARENA_MIN_Z,
  SCORE,
  PLAYER_HEIGHT,
} from '../config.js';
import { grid, cellCenter, removeCell, collapseColumns, compactAllColumns, columnHeight, maxHeight } from './board.js';
import {
  morphToNano,
  allOrientations,
  canOccupy,
  canOccupyFloat,
  computeLanding,
  setPieceConfiguration,
  resolvePieceOverlap,
} from './piece.js';
import { fx, fxPickup, fxExplosion, fxShatterCell } from '../gfx/fx.js';
import { orbGlyphTexture, softDotTexture } from '../gfx/textures.js';
import { addShake, screenFlash, pulseAberration } from '../gfx/renderer.js';
import { audio } from '../audio/audio.js';
import { music } from '../audio/music.js';
import { emit, on } from '../events.js';

export const orbs = [];
let orbTimer = 10;
const orbGroup = new THREE.Group();

export function initPowerups() {
  G.scene.add(orbGroup);
  on('novaImpact', (target) => detonateNova(target));
}

export function resetPowerups() {
  orbs.forEach((o) => orbGroup.remove(o.group));
  orbs.length = 0;
  G.inventory = [null, null, null];
  G.loadedWeapon = null;
  G.effects.chrono = 0;
  G.effects.overdrive = 0;
  G.pendingNano = false;
  G.pendingOracle = false;
  audio.setChrono(false);
  music.tempoScale = 1;
  orbTimer = 8 + Math.random() * 4;
}

// ------------------------------------------------------------------- orbs --
const orbCoreGeo = new THREE.IcosahedronGeometry(1.1, 2);
const ringGeo = new THREE.TorusGeometry(2.1, 0.08, 8, 48);

function spawnOrb(key = randomPowerupKey()) {
  const def = POWERUPS[key];
  const group = new THREE.Group();
  const coreMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(def.color).multiplyScalar(2.2) });
  const core = new THREE.Mesh(orbCoreGeo, coreMat);
  group.add(core);
  const glow = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: softDotTexture(), color: new THREE.Color(def.color).multiplyScalar(2.5), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  glow.scale.setScalar(9);
  group.add(glow);
  const glyph = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: orbGlyphTexture(key), color: new THREE.Color(0xffffff).multiplyScalar(2), transparent: true, depthWrite: false, depthTest: true })
  );
  glyph.scale.setScalar(3.4);
  glyph.position.y = 3.2;
  group.add(glyph);
  const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(def.color).multiplyScalar(2), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
  const r1 = new THREE.Mesh(ringGeo, ringMat);
  const r2 = new THREE.Mesh(ringGeo, ringMat);
  r2.scale.setScalar(0.8);
  group.add(r1, r2);

  // Place it somewhere reachable above the stack
  const x = -24 + Math.random() * 48;
  const z = -24 + Math.random() * 54;
  let minY = 10;
  if (z < 30) {
    const gx = Math.max(0, Math.min(GRID_W - 1, Math.floor((x - ARENA_MIN_X) / CELL)));
    const gz = Math.max(0, Math.min(GRID_D - 1, Math.floor((z - ARENA_MIN_Z) / CELL)));
    minY = Math.max(minY, columnHeight(gx, gz) * CELL + 6);
  }
  const y = Math.min(68, minY + Math.random() * 26);
  group.position.set(x, y, z);
  group.scale.setScalar(0.01);
  orbGroup.add(group);
  const orb = { key, group, core, r1, r2, glyph, glow, base: new THREE.Vector3(x, y, z), age: 0, life: 26, phase: Math.random() * 6 };
  orbs.push(orb);
  audio.orbSpawn(group.position);
  emit('orbSpawned', orb);
  return orb;
}

function removeOrb(i) {
  const o = orbs[i];
  orbGroup.remove(o.group);
  orbs.splice(i, 1);
}

export function updateOrbs(dt, time) {
  if (G.phase !== 'playing') return;
  orbTimer -= dt;
  const [a, b] = G.modeCfg.orbInterval;
  if (orbTimer <= 0) {
    orbTimer = a + Math.random() * (b - a);
    if (orbs.length < 3) spawnOrb();
  }
  const pl = G.player;
  const center = new THREE.Vector3(pl.pos.x, pl.pos.y + PLAYER_HEIGHT * 0.55, pl.pos.z);
  for (let i = orbs.length - 1; i >= 0; i--) {
    const o = orbs[i];
    o.age += dt;
    const appear = Math.min(1, o.age * 2.5);
    const pop = appear < 1 ? 1 + Math.sin(appear * Math.PI) * 0.3 : 1;
    o.group.scale.setScalar(appear * pop);
    o.group.position.set(o.base.x, o.base.y + Math.sin(time * 2 + o.phase) * 0.8, o.base.z);
    o.core.rotation.y = time * 1.5;
    o.core.rotation.x = time * 0.7;
    o.r1.rotation.set(time * 1.3, time * 0.9, 0);
    o.r2.rotation.set(-time * 0.8, 0, time * 1.4);
    const remaining = o.life - o.age;
    o.group.visible = remaining > 5 || Math.sin(time * (remaining < 2 ? 30 : 14)) > -0.2;
    if (Math.random() < 0.3) {
      fx.particles.emit(o.group.position.x + (Math.random() - 0.5) * 2, o.group.position.y + (Math.random() - 0.5) * 2, o.group.position.z + (Math.random() - 0.5) * 2, 0, 1.5, 0, POWERUPS[o.key].color, 0.5, 0.8, 0, 0.5);
    }
    if (o.group.position.distanceTo(center) < 3.8) {
      collectOrb(i);
      continue;
    }
    if (remaining <= 0) {
      fx.particles.burst(o.group.position, 20, { color: POWERUPS[o.key].color, speed: [2, 6], life: [0.3, 0.6], size: [0.3, 0.7] });
      removeOrb(i);
    }
  }
}

function collectOrb(i) {
  const o = orbs[i];
  fxPickup(o.group.position.clone(), POWERUPS[o.key].color);
  removeOrb(i);
  grantPowerup(o.key, 'orb');
}

// Puts a power-up in the first free slot (or converts it to points).
export function grantPowerup(key, source = 'orb') {
  const slot = G.inventory.indexOf(null);
  if (slot === -1) {
    const pts = SCORE.orbBonusWhenFull * G.level;
    emit('addScore', { points: pts, label: 'INVENTORY FULL' });
    audio.invFull();
    emit('notify', { title: 'INVENTORY FULL', sub: `+${pts.toLocaleString()} PTS`, color: POWERUPS[key].color });
    return false;
  }
  G.inventory[slot] = key;
  audio.pickup();
  emit('inventoryChanged', { slot, key, source });
  emit('notify', { title: POWERUPS[key].name, sub: `ACQUIRED — PRESS ${slot + 1}`, color: POWERUPS[key].color, small: true });
  return true;
}

// -------------------------------------------------------------- activation --
export function activateSlot(slot) {
  const key = G.inventory[slot];
  if (!key || G.phase !== 'playing') return false;
  const def = POWERUPS[key];
  if (def.weapon && G.loadedWeapon) {
    emit('notify', { title: 'WEAPON ALREADY ARMED', sub: 'FIRE IT FIRST (LMB)', color: 0xff5566, small: true });
    audio.invFull();
    return false;
  }
  if ((key === 'oracle' || key === 'nano') && !G.piece) {
    if (key === 'oracle') G.pendingOracle = true;
    else G.pendingNano = true;
  }
  G.inventory[slot] = null;
  G.powerupsUsed++;
  audio.powerupUse();
  emit('inventoryChanged', { slot, key: null });

  switch (key) {
    case 'chrono':
      G.effects.chrono = def.duration;
      audio.chronoOn();
      audio.setChrono(true);
      music.tempoScale = 0.82;
      emit('notify', { title: 'CHRONO FIELD', sub: 'TIME DILATED', color: def.color });
      break;
    case 'overdrive':
      G.effects.overdrive = def.duration;
      audio.overdriveOn();
      emit('notify', { title: 'OVERDRIVE', sub: '2× SCORE • INFINITE FUEL • TURBO', color: def.color });
      break;
    case 'nova':
    case 'laser':
      G.loadedWeapon = key;
      audio.weaponArmed();
      emit('notify', { title: `${def.name} ARMED`, sub: key === 'nova' ? 'LMB: FIRE AT THE STACK' : 'LMB: VAPORIZE A ROW', color: def.color });
      break;
    case 'quake':
      runQuake();
      break;
    case 'nano':
      if (G.piece) applyNano();
      else emit('notify', { title: 'NANO CUBE', sub: 'NEXT PIECE WILL SHRINK', color: def.color });
      break;
    case 'oracle':
      if (G.piece) applyOracle();
      else emit('notify', { title: 'ORACLE AI', sub: 'STANDING BY FOR NEXT PIECE', color: def.color });
      break;
  }
  emit('powerupActivated', key);
  return true;
}

export function updateEffects(dt) {
  if (G.effects.chrono > 0) {
    G.effects.chrono -= dt;
    if (G.effects.chrono <= 0) {
      G.effects.chrono = 0;
      audio.chronoOff();
      audio.setChrono(false);
      music.tempoScale = 1;
      emit('notify', { title: 'CHRONO FIELD EXPIRED', sub: '', color: POWERUPS.chrono.color, small: true });
    }
  }
  if (G.effects.overdrive > 0) {
    G.effects.overdrive -= dt;
    if (G.effects.overdrive <= 0) {
      G.effects.overdrive = 0;
      emit('notify', { title: 'OVERDRIVE ENDED', sub: '', color: POWERUPS.overdrive.color, small: true });
    }
  }
}

// Called by the game whenever a new piece appears.
export function onPieceSpawnedForPowerups() {
  if (G.pendingNano) {
    G.pendingNano = false;
    applyNano();
  }
  if (G.pendingOracle) {
    G.pendingOracle = false;
    setTimeout(() => G.piece && applyOracle(), 250);
  }
}

function applyNano() {
  if (morphToNano()) {
    audio.nanoMorph();
    emit('pieceMorphed');
    emit('notify', { title: 'NANO CUBE', sub: 'PIECE COMPRESSED TO ONE CUBE', color: POWERUPS.nano.color });
  }
}

// ----------------------------------------------------------------- weapons --
// LMB with a weapon armed. Returns true if the shot was taken.
export function fireLoadedWeapon(fireNova) {
  const w = G.loadedWeapon;
  if (!w) return false;
  if (w === 'nova') {
    if (fireNova()) G.loadedWeapon = null;
    emit('inventoryChanged', {});
    return true;
  }
  if (w === 'laser') {
    if (fireLaser()) G.loadedWeapon = null;
    emit('inventoryChanged', {});
    return true;
  }
  return false;
}

function fireLaser() {
  const aim = G.aim;
  if (!aim || aim.type !== 'ground') {
    audio.rotateDenied();
    return false;
  }
  const gy = Math.max(0, aim.gy);
  // Laser runs along whichever horizontal axis the player is facing.
  const f = new THREE.Vector3(0, 0, -1).applyQuaternion(G.camera.quaternion);
  const alongX = Math.abs(f.x) > Math.abs(f.z);
  const removed = [];
  for (let i = 0; i < (alongX ? GRID_W : GRID_D); i++) {
    const x = alongX ? i : aim.gx;
    const z = alongX ? aim.gz : i;
    const c = grid[x][gy][z];
    if (c) {
      const pos = cellCenter(x, gy, z);
      fxShatterCell(pos, c.piece.color, 1.2);
      if (c.power) emit('powerCoreCleared', { key: c.power, pos });
      removeCell(x, gy, z);
      removed.push([x, gy, z]);
    }
  }
  const a = alongX ? cellCenter(0, gy, aim.gz) : cellCenter(aim.gx, gy, 0);
  const b = alongX ? cellCenter(GRID_W - 1, gy, aim.gz) : cellCenter(aim.gx, gy, GRID_D - 1);
  if (alongX) {
    a.x -= CELL * 0.5;
    b.x += CELL * 0.5;
  } else {
    a.z -= CELL * 0.5;
    b.z += CELL * 0.5;
  }
  fx.beams.fire(a, b, POWERUPS.laser.color, { life: 0.9, thickness: 2.0, strand: 0xffffff });
  // Muzzle beam starts a little ahead of the lens so its glow never fills the screen.
  const muzzle = new THREE.Vector3();
  if (G.player.muzzle && G.player.firstPerson) G.player.muzzle.getWorldPosition(muzzle);
  else muzzle.copy(G.player.pos).add(new THREE.Vector3(0, 1.4, 0));
  muzzle.addScaledVector(aim.point.clone().sub(muzzle).normalize(), 3);
  fx.beams.fire(muzzle, aim.point, POWERUPS.laser.color, { life: 0.3, thickness: 0.25, strand: 0xffaaaa });
  audio.laser();
  addShake(0.45);
  screenFlash(0.1, POWERUPS.laser.color);
  pulseAberration(0.012);
  emit('gunFired', { color: POWERUPS.laser.color, recoil: 2.2 });
  const pts = removed.length * SCORE.novaPerBlock * 1.5 * G.level;
  if (removed.length) {
    emit('addScore', { points: Math.round(pts), label: 'LASER LANCE', pos: aim.point });
    collapseColumns(removed);
    resolvePieceOverlap();
    emit('boardChanged', 'laser');
  }
  emit('notify', { title: 'LASER LANCE', sub: `${removed.length} BLOCKS VAPORIZED`, color: POWERUPS.laser.color });
  return true;
}

function detonateNova(target) {
  let cx = target.gx;
  let cy = Math.max(0, target.gy);
  let cz = target.gz;
  const removed = [];
  for (let x = cx - 1; x <= cx + 1; x++)
    for (let y = cy - 1; y <= cy + 1; y++)
      for (let z = cz - 1; z <= cz + 1; z++) {
        if (x < 0 || x >= GRID_W || y < 0 || y >= GRID_H || z < 0 || z >= GRID_D) continue;
        const c = grid[x][y][z];
        if (!c) continue;
        const pos = cellCenter(x, y, z);
        fxShatterCell(pos, c.piece.color, 1.4);
        if (c.power) emit('powerCoreCleared', { key: c.power, pos });
        removeCell(x, y, z);
        removed.push([x, y, z]);
      }
  const center = cellCenter(cx, cy, cz);
  fxExplosion(center, POWERUPS.nova.color, 1.2);
  audio.explosion(center, 1.3);
  G.slowmo = Math.max(G.slowmo, 0.35);
  G.slowmoScale = 0.35;
  if (removed.length) {
    emit('addScore', { points: removed.length * SCORE.novaPerBlock * G.level, label: 'NOVA', pos: center });
    collapseColumns(removed);
    resolvePieceOverlap();
    emit('boardChanged', 'nova');
  }
  emit('notify', { title: 'NOVA DETONATION', sub: `${removed.length} BLOCKS DESTROYED`, color: POWERUPS.nova.color });
}

function runQuake() {
  const moved = compactAllColumns();
  resolvePieceOverlap();
  audio.quake();
  addShake(1.0);
  pulseAberration(0.02);
  for (let i = 0; i < 6; i++) {
    const p = new THREE.Vector3(-25 + Math.random() * 50, 0.4, -25 + Math.random() * 50);
    fx.rings.spawn(p, POWERUPS.quake.color, { radius: 30, life: 1.2, horizontal: true, brightness: 1.6 });
  }
  emit('notify', { title: 'SEISMIC QUAKE', sub: moved ? `${moved} BLOCKS SETTLED` : 'THE STACK IS ALREADY SOLID', color: POWERUPS.quake.color });
  emit('boardChanged', 'quake');
}

// --------------------------------------------------------------- ORACLE AI --
function heightsSnapshot() {
  const h = new Int8Array(GRID_W * GRID_D);
  for (let x = 0; x < GRID_W; x++) for (let z = 0; z < GRID_D; z++) h[x + z * GRID_W] = columnHeight(x, z);
  return h;
}

function filled(x, y, z, placed) {
  if (grid[x][y][z]) return true;
  return placed.has(x + y * 16 + z * 512);
}

export function evaluatePlacement(cells, gx, land, gz, heights) {
  const placed = new Set();
  let maxY = 0;
  const cols = new Map();
  for (const [ox, oy, oz] of cells) {
    const x = gx + ox, y = land + oy, z = gz + oz;
    placed.add(x + y * 16 + z * 512);
    maxY = Math.max(maxY, y);
    const k = x + z * GRID_W;
    const c = cols.get(k);
    if (!c) cols.set(k, { x, z, minY: y, maxY: y });
    else {
      c.minY = Math.min(c.minY, y);
      c.maxY = Math.max(c.maxY, y);
    }
  }
  // completed lines through the placed cells
  const lineKeys = new Set();
  for (const [ox, oy, oz] of cells) {
    const x = gx + ox, y = land + oy, z = gz + oz;
    let fullX = true;
    for (let i = 0; i < GRID_W && fullX; i++) if (!filled(i, y, z, placed)) fullX = false;
    if (fullX) lineKeys.add(`x${y},${z}`);
    let fullZ = true;
    for (let i = 0; i < GRID_D && fullZ; i++) if (!filled(x, y, i, placed)) fullZ = false;
    if (fullZ) lineKeys.add(`z${x},${y}`);
  }
  const lines = lineKeys.size;
  // new holes + updated heights
  let holes = 0;
  const h = Int8Array.from(heights);
  cols.forEach(({ x, z, minY, maxY: top }) => {
    const old = heights[x + z * GRID_W];
    for (let y = old; y < minY; y++) if (!grid[x][y][z]) holes++;
    // gaps inside the piece's own column span
    for (let y = minY; y < top; y++) if (!filled(x, y, z, placed)) holes++;
    h[x + z * GRID_W] = Math.max(old, top + 1);
  });
  // fill-in reward: cells adjacent to existing blocks/walls (snug fit)
  let contact = 0;
  for (const [ox, oy, oz] of cells) {
    const x = gx + ox, y = land + oy, z = gz + oz;
    const nb = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0]];
    for (const [dx, dy, dz] of nb) {
      const nx = x + dx, ny = y + dy, nz = z + dz;
      if (nx < 0 || nx >= GRID_W || nz < 0 || nz >= GRID_D || ny < 0) contact++;
      else if (grid[nx][ny][nz]) contact++;
    }
  }
  let bump = 0;
  for (let x = 0; x < GRID_W; x++)
    for (let z = 0; z < GRID_D; z++) {
      const v = h[x + z * GRID_W];
      if (x + 1 < GRID_W) bump += Math.abs(v - h[x + 1 + z * GRID_W]);
      if (z + 1 < GRID_D) bump += Math.abs(v - h[x + (z + 1) * GRID_W]);
    }
  let score = lines * 14 - holes * 6 - bump * 0.22 - maxY * 1.1 + contact * 0.7;
  if (maxY >= MAX_STACK_GY - 1) score -= 500;
  return score;
}

export function findBestPlacement(P) {
  const heights = heightsSnapshot();
  const orients = allOrientations(P.cells);
  let best = null;
  for (const cells of orients) {
    for (let gx = -3; gx < GRID_W + 3; gx++) {
      for (let gz = -3; gz < GRID_D + 3; gz++) {
        if (!canOccupyFloat(cells, gx, P.gy, gz)) continue;
        const land = computeLanding(cells, gx, P.gy, gz);
        const s = evaluatePlacement(cells, gx, land, gz, heights);
        if (!best || s > best.score) best = { cells, gx, gz, land, score: s };
      }
    }
  }
  return best;
}

function applyOracle() {
  const P = G.piece;
  if (!P) return;
  const best = findBestPlacement(P);
  audio.oracle();
  if (!best) {
    emit('notify', { title: 'ORACLE AI', sub: 'NO SAFE SOLUTION FOUND', color: POWERUPS.oracle.color });
    return;
  }
  setPieceConfiguration(best.cells, best.gx, best.gz);
  P.autopilot = { t: 0.65 };
  emit('pieceMorphed');
  emit('notify', { title: 'ORACLE AI', sub: 'OPTIMAL PLACEMENT LOCKED', color: POWERUPS.oracle.color });
}

export function debugSpawnOrb(key) {
  return spawnOrb(key);
}
