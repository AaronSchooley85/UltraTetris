// ============================================================================
// THE PILOT: jetpack flight with fuel, dash thrusters, collision against the
// stack, the first-person beacon launcher, the third-person avatar and the
// camera rig (FOV kick, head bob, collision-aware chase cam, screen shake).
// ============================================================================
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { G } from '../state.js';
import {
  CELL,
  GRID_W,
  GRID_D,
  GRID_H,
  ARENA_MIN_X,
  ARENA_MAX_X,
  ARENA_MIN_Z,
  DECK_MAX_Z,
  PLAYER_HEIGHT,
  PLAYER_EYE,
  PLAYER_START,
  POWERUPS,
} from '../config.js';
import { grid } from './board.js';
import { audio } from '../audio/audio.js';
import { fx, fxDash, fxThruster } from '../gfx/fx.js';
import { wallHit, addRipple } from '../gfx/arena.js';
import { applyCameraShake, addShake } from '../gfx/renderer.js';
import { softDotTexture } from '../gfx/textures.js';
import { on, emit } from '../events.js';

const RADIUS = 0.42;
const MIN_X = ARENA_MIN_X + 1.2;
const MAX_X = ARENA_MAX_X - 1.2;
const MIN_Z = ARENA_MIN_Z + 1.2;
const MAX_Z = DECK_MAX_Z - 1.2;
const CEILING = GRID_H * CELL + 12;

const SKY_COLOR = 0xffae2b;
const GROUND_COLOR = 0x00f7ff;

export const player = {
  pos: new THREE.Vector3(PLAYER_START.x, PLAYER_START.y, PLAYER_START.z),
  vel: new THREE.Vector3(),
  yaw: 0,
  pitch: 0.42,
  onGround: true,
  firstPerson: true,
  fuel: 1,
  overheated: false,
  thrusting: false,
  dashCooldown: 0,
  dashTime: 0,
  gunRecoil: 0,
  muzzle: null,
  crushCooldown: 0,
  fovKick: 0,
  bob: 0,
  sway: new THREE.Vector2(),
  airTime: 0,
};

const DASH_COOLDOWN = 1.15;

let gun, gunParts, avatar, avatarParts, marker, markerMat;
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _move = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _cam = new THREE.Vector3();

// ------------------------------------------------------------- collision --
function cellSolid(gx, gy, gz) {
  if (gx < 0 || gx >= GRID_W || gz < 0 || gz >= GRID_D || gy < 0 || gy >= GRID_H) return false;
  return grid[gx][gy][gz] !== null;
}

function solidAtWorld(wx, wy, wz) {
  const gx = Math.floor((wx - ARENA_MIN_X) / CELL);
  const gz = Math.floor((wz - ARENA_MIN_Z) / CELL);
  const gy = Math.floor(wy / CELL);
  return cellSolid(gx, gy, gz);
}

// Does the player's body (a square prism) overlap a placed block?
function bodyBlocked(x, y, z) {
  const ys = [y + 0.3, y + PLAYER_HEIGHT * 0.5, y + PLAYER_HEIGHT - 0.08];
  for (const sx of [-RADIUS, RADIUS]) {
    for (const sz of [-RADIUS, RADIUS]) {
      for (const sy of ys) if (solidAtWorld(x + sx, sy, z + sz)) return true;
    }
  }
  return false;
}

// Highest block top under the player's footprint that is at or below the feet.
function supportHeight(x, y, z) {
  let best = 0;
  for (const sx of [-RADIUS * 0.9, RADIUS * 0.9]) {
    for (const sz of [-RADIUS * 0.9, RADIUS * 0.9]) {
      const gx = Math.floor((x + sx - ARENA_MIN_X) / CELL);
      const gz = Math.floor((z + sz - ARENA_MIN_Z) / CELL);
      if (gx < 0 || gx >= GRID_W || gz < 0 || gz >= GRID_D) continue;
      for (let gy = Math.min(GRID_H - 1, Math.floor((y + 0.7) / CELL)); gy >= 0; gy--) {
        if (grid[gx][gy][gz]) {
          const top = (gy + 1) * CELL;
          if (top <= y + 0.7) best = Math.max(best, top);
          break;
        }
      }
    }
  }
  return best;
}

// If blocks ever end up overlapping the pilot (a collapse, a quake), pop them
// up onto the nearest free surface instead of trapping them inside.
function ensureNotInsideBlock() {
  const p = player.pos;
  if (!bodyBlocked(p.x, p.y, p.z)) return;
  let y = Math.ceil(p.y / CELL) * CELL;
  let guard = 0;
  while (bodyBlocked(p.x, y, p.z) && guard++ < GRID_H + 2) y += CELL;
  p.y = y + 0.01;
  player.vel.y = Math.max(player.vel.y, 4);
  emit('playerShoved');
}

// ------------------------------------------------------------------ build --
function buildGun() {
  gun = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0x141a28, metalness: 0.8, roughness: 0.38, envMapIntensity: 0.55 });
  const metalLight = new THREE.MeshStandardMaterial({ color: 0x3c4760, metalness: 0.85, roughness: 0.3, envMapIntensity: 0.6 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x0b0e16, metalness: 0.1, roughness: 0.75 });
  const energy = new THREE.MeshBasicMaterial({ color: new THREE.Color(GROUND_COLOR).multiplyScalar(1.6) });
  const energyDim = new THREE.MeshBasicMaterial({ color: new THREE.Color(GROUND_COLOR).multiplyScalar(0.9) });

  const body = new THREE.Mesh(new RoundedBoxGeometry(0.12, 0.13, 0.46, 2, 0.028), metal);
  body.position.set(0, 0, -0.1);
  gun.add(body);

  const shroud = new THREE.Mesh(new RoundedBoxGeometry(0.15, 0.06, 0.3, 2, 0.02), metalLight);
  shroud.position.set(0, 0.075, -0.16);
  gun.add(shroud);

  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.035, 0.06), metal);
  sight.position.set(0, 0.12, -0.05);
  gun.add(sight);
  const sightDot = new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 6), energy);
  sightDot.position.set(0, 0.14, -0.05);
  gun.add(sightDot);

  const grip = new THREE.Mesh(new RoundedBoxGeometry(0.075, 0.2, 0.1, 2, 0.02), rubber);
  grip.position.set(0, -0.13, 0.06);
  grip.rotation.x = 0.32;
  gun.add(grip);

  const cell = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.12, 16), metalLight);
  cell.rotation.x = Math.PI / 2;
  cell.position.set(0, -0.035, 0.1);
  gun.add(cell);

  // Side energy strips
  [-1, 1].forEach((s) => {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.016, 0.32), energyDim);
    strip.position.set(s * 0.062, 0.012, -0.12);
    gun.add(strip);
  });

  // Barrel + coils
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.04, 0.22, 20), metalLight);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.005, -0.42);
  gun.add(barrel);
  const coils = [];
  for (let i = 0; i < 3; i++) {
    const coil = new THREE.Mesh(new THREE.TorusGeometry(0.046, 0.008, 8, 28), energyDim.clone());
    coil.position.set(0, 0.005, -0.36 - i * 0.05);
    gun.add(coil);
    coils.push(coil);
  }
  const tip = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.012, 8, 24), metal);
  tip.position.set(0, 0.005, -0.535);
  gun.add(tip);

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.005, -0.56);
  gun.add(muzzle);
  player.muzzle = muzzle;

  const flash = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: softDotTexture(), color: new THREE.Color(GROUND_COLOR).multiplyScalar(3), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 })
  );
  flash.scale.setScalar(0.35);
  muzzle.add(flash);

  // Always present so the light count never changes; intensity animates.
  const light = new THREE.PointLight(GROUND_COLOR, 0, 9, 2);
  light.position.set(0, 0.05, -0.6);
  gun.add(light);

  gun.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = false;
      o.receiveShadow = false;
      o.renderOrder = 10;
    }
  });
  gun.scale.setScalar(0.82);
  gun.position.set(0.3, -0.28, -0.5);
  G.camera.add(gun);
  gunParts = { energy, energyDim, coils, flash, light, cell, strips: energy };
}

function buildAvatar() {
  avatar = new THREE.Group();
  const suit = new THREE.MeshStandardMaterial({ color: 0x1b2333, metalness: 0.55, roughness: 0.38 });
  const armor = new THREE.MeshStandardMaterial({ color: 0xc9d4e6, metalness: 0.7, roughness: 0.25 });
  const trim = new THREE.MeshBasicMaterial({ color: new THREE.Color(GROUND_COLOR).multiplyScalar(2.2) });
  const visorMat = new THREE.MeshPhysicalMaterial({ color: 0x0a1020, metalness: 0.2, roughness: 0.05, clearcoat: 1, emissive: new THREE.Color(0xff8a2b), emissiveIntensity: 0.9 });

  const legGeo = new THREE.CapsuleGeometry(0.11, 0.52, 6, 12);
  const legL = new THREE.Mesh(legGeo, suit);
  legL.position.set(-0.13, 0.4, 0);
  const legR = legL.clone();
  legR.position.x = 0.13;
  avatar.add(legL, legR);
  const bootGeo = new RoundedBoxGeometry(0.16, 0.12, 0.26, 2, 0.04);
  const bootL = new THREE.Mesh(bootGeo, armor);
  bootL.position.set(-0.13, 0.06, -0.03);
  const bootR = bootL.clone();
  bootR.position.x = 0.13;
  avatar.add(bootL, bootR);

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.38, 8, 16), suit);
  torso.position.set(0, 1.12, 0);
  avatar.add(torso);
  const chest = new THREE.Mesh(new RoundedBoxGeometry(0.4, 0.3, 0.2, 2, 0.06), armor);
  chest.position.set(0, 1.22, -0.08);
  avatar.add(chest);
  const chestLight = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.025, 0.01), trim);
  chestLight.position.set(0, 1.22, -0.185);
  avatar.add(chestLight);
  const belt = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.02, 6, 24), trim);
  belt.rotation.x = Math.PI / 2;
  belt.position.y = 0.86;
  avatar.add(belt);

  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.17, 20, 16), armor);
  helmet.position.set(0, 1.63, 0);
  avatar.add(helmet);
  const visor = new THREE.Mesh(new THREE.SphereGeometry(0.15, 20, 12, Math.PI * 0.15, Math.PI * 0.7, Math.PI * 0.3, Math.PI * 0.32), visorMat);
  visor.position.set(0, 1.63, -0.03);
  visor.rotation.y = Math.PI;
  avatar.add(visor);

  const armGeo = new THREE.CapsuleGeometry(0.075, 0.42, 6, 12);
  const armL = new THREE.Mesh(armGeo, suit);
  armL.position.set(-0.31, 1.12, 0);
  armL.rotation.z = 0.12;
  const armR = new THREE.Mesh(armGeo, suit);
  armR.position.set(0.3, 1.2, -0.16);
  armR.rotation.x = Math.PI / 2.4;
  avatar.add(armL, armR);
  const pad = new RoundedBoxGeometry(0.17, 0.1, 0.18, 2, 0.04);
  const padL = new THREE.Mesh(pad, armor);
  padL.position.set(-0.3, 1.4, 0);
  const padR = padL.clone();
  padR.position.x = 0.3;
  avatar.add(padL, padR);

  // Hand cannon (third person)
  const cannon = new THREE.Mesh(new RoundedBoxGeometry(0.09, 0.1, 0.38, 2, 0.02), suit);
  cannon.position.set(0.3, 1.24, -0.48);
  avatar.add(cannon);
  const cannonGlow = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.01, 6, 16), trim);
  cannonGlow.position.set(0.3, 1.24, -0.68);
  avatar.add(cannonGlow);

  // Jetpack
  const pack = new THREE.Mesh(new RoundedBoxGeometry(0.36, 0.46, 0.2, 2, 0.06), armor);
  pack.position.set(0, 1.18, 0.22);
  avatar.add(pack);
  const nozzleGeo = new THREE.CylinderGeometry(0.06, 0.085, 0.14, 14, 1, true);
  const nozzleL = new THREE.Mesh(nozzleGeo, suit);
  nozzleL.position.set(-0.11, 0.92, 0.26);
  const nozzleR = nozzleL.clone();
  nozzleR.position.x = 0.11;
  avatar.add(nozzleL, nozzleR);
  const packStrip = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.32, 0.01), trim);
  packStrip.position.set(0, 1.2, 0.325);
  avatar.add(packStrip);

  const flameGeo = new THREE.ConeGeometry(0.075, 0.7, 14, 1, true);
  flameGeo.rotateX(Math.PI); // apex down
  flameGeo.translate(0, -0.35, 0); // base at the nozzle
  const flameMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(GROUND_COLOR).multiplyScalar(2.5),
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const flameL = new THREE.Mesh(flameGeo, flameMat);
  flameL.position.set(-0.11, 0.85, 0.26);
  const flameR = flameL.clone();
  flameR.position.x = 0.11;
  avatar.add(flameL, flameR);

  const light = new THREE.PointLight(GROUND_COLOR, 0, 10, 2);
  light.position.set(0, 0.6, 0.35);
  avatar.add(light);

  avatar.traverse((o) => {
    if (o.isMesh && o.material !== flameMat) o.castShadow = true;
  });
  avatar.visible = false;
  G.scene.add(avatar);
  avatarParts = { flameL, flameR, flameMat, light, trim, legL, legR, armL };

  // Altitude marker: a soft ring on whatever surface is below the pilot.
  markerMat = new THREE.MeshBasicMaterial({
    map: ringTexture(),
    color: new THREE.Color(GROUND_COLOR).multiplyScalar(1.6),
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  marker = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4), markerMat);
  marker.rotation.x = -Math.PI / 2;
  marker.renderOrder = 5;
  G.scene.add(marker);
}

function ringTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 20, 64, 64, 62);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.15)');
  g.addColorStop(0.8, 'rgba(255,255,255,1)');
  g.addColorStop(0.9, 'rgba(255,255,255,0.3)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.beginPath();
  ctx.arc(64, 64, 5, 0, Math.PI * 2);
  ctx.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ------------------------------------------------------------------ init --
export function initPlayer() {
  G.player = player;
  buildGun();
  buildAvatar();
  on('gunFired', ({ color, recoil }) => {
    player.gunRecoil = Math.min(1.6, player.gunRecoil + (recoil || 1));
    gunParts.light.color.set(color);
    gunParts.light.intensity = 9 * (recoil || 1);
    gunParts.flash.material.color.set(color).multiplyScalar(3);
    gunParts.flash.material.opacity = 1;
    gunParts.flash.material.rotation = Math.random() * Math.PI;
    if (!player.firstPerson) {
      _tmp.copy(player.pos);
      _tmp.y += 1.24;
      fx.particles.burst(_tmp, 8, { color: [color, 0xffffff], speed: [2, 6], life: [0.1, 0.25], size: [0.2, 0.5], brightness: 2 });
    }
  });
  on('stackChanged', ensureNotInsideBlock);
  on('playerShoved', () => addShake(0.25));
}

export function resetPlayer() {
  player.pos.set(PLAYER_START.x, PLAYER_START.y, PLAYER_START.z);
  player.vel.set(0, 0, 0);
  player.yaw = 0;
  player.pitch = 0.42;
  player.onGround = true;
  player.fuel = 1;
  player.overheated = false;
  player.dashCooldown = 0;
  player.dashTime = 0;
  player.gunRecoil = 0;
  player.fovKick = 0;
  player.airTime = 0;
}

// Look input in radians (already sensitivity-scaled by the caller).
export function addLook(dYaw, dPitch) {
  player.yaw += dYaw;
  player.pitch = Math.max(-1.5, Math.min(1.5, player.pitch + dPitch));
  player.sway.x += dYaw * 0.6;
  player.sway.y += dPitch * 0.6;
}

export function toggleCamera() {
  player.firstPerson = !player.firstPerson;
  emit('cameraToggled', player.firstPerson);
}

export function tryDash() {
  if (player.dashCooldown > 0 || G.phase !== 'playing') return false;
  forwardRight();
  readMove();
  const dir = _move.lengthSq() > 0 ? _move.clone() : _fwd.clone();
  const od = G.effects.overdrive > 0;
  const power = od ? 40 : 30;
  player.vel.x = dir.x * power;
  player.vel.z = dir.z * power;
  if (!player.onGround) player.vel.y = Math.max(player.vel.y, 2.5);
  player.dashCooldown = od ? DASH_COOLDOWN * 0.45 : DASH_COOLDOWN;
  player.dashTime = 0.22;
  player.fovKick = Math.max(player.fovKick, 11);
  audio.dash();
  fxDash(player.pos, dir, od ? POWERUPS.overdrive.color : GROUND_COLOR);
  emit('dash');
  return true;
}

function forwardRight() {
  _fwd.set(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
  _right.set(Math.cos(player.yaw), 0, -Math.sin(player.yaw));
}

function readMove() {
  const k = G.keys;
  _move.set(0, 0, 0);
  if (k.KeyW) _move.add(_fwd);
  if (k.KeyS) _move.sub(_fwd);
  if (k.KeyD) _move.add(_right);
  if (k.KeyA) _move.sub(_right);
  if (_move.lengthSq() > 0) _move.normalize();
}

// ---------------------------------------------------------------- update --
export function updatePlayer(dt, time) {
  const p = player;
  const od = G.effects.overdrive > 0;
  p.crushCooldown = Math.max(0, p.crushCooldown - dt);
  p.dashCooldown = Math.max(0, p.dashCooldown - dt);
  p.dashTime = Math.max(0, p.dashTime - dt);

  forwardRight();
  readMove();

  // Arrow keys look around (keyboard-only play and no-pointer-lock fallback)
  const k = G.keys;
  const lookRate = 2.1 * dt * (G.settings.sensitivity || 1);
  if (k.ArrowLeft) addLook(lookRate, 0);
  if (k.ArrowRight) addLook(-lookRate, 0);
  if (k.ArrowUp) addLook(0, lookRate * (G.settings.invertY ? -1 : 1));
  if (k.ArrowDown) addLook(0, -lookRate * (G.settings.invertY ? -1 : 1));

  // Horizontal movement
  const accel = (p.onGround ? 70 : 54) * (od ? 1.5 : 1);
  p.vel.x += _move.x * accel * dt;
  p.vel.z += _move.z * accel * dt;
  const damp = Math.exp(-(p.dashTime > 0 ? 1.5 : 5.5) * dt);
  p.vel.x *= damp;
  p.vel.z *= damp;

  // Jetpack with fuel. Overdrive = infinite fuel and stronger thrust.
  const wantThrust = !!k.Space;
  if (p.overheated && p.fuel >= 0.3) p.overheated = false;
  p.thrusting = wantThrust && !p.overheated && p.fuel > 0;
  if (p.thrusting) {
    p.vel.y += (od ? 40 : 30) * dt;
    p.vel.y = Math.min(od ? 20 : 14, p.vel.y);
    p.onGround = false;
    if (!od) {
      p.fuel -= 0.07 * dt;
      if (p.fuel <= 0) {
        p.fuel = 0;
        p.overheated = true;
        audio.tone({ type: 'square', f0: 220, f1: 90, dur: 0.3, vol: 0.08, verb: 0 });
        emit('notify', { title: 'JETPACK OVERHEAT', sub: 'COOLING DOWN', color: 0xff5566, small: true });
      }
    }
  } else {
    p.fuel = Math.min(1, p.fuel + (p.onGround ? 0.34 : 0.1) * dt);
    if (!p.onGround) {
      if (p.vel.y > 0) p.vel.y -= 17 * dt;
      else p.vel.y = Math.max(-11, p.vel.y - 10 * dt);
    }
  }
  if (od) p.fuel = 1;

  // Integrate X / Z separately so the pilot slides along blocks.
  const nx = Math.max(MIN_X, Math.min(MAX_X, p.pos.x + p.vel.x * dt));
  if (!bodyBlocked(nx, p.pos.y, p.pos.z)) {
    if ((nx === MIN_X || nx === MAX_X) && Math.abs(p.vel.x) > 4) {
      wallHit(_tmp.set(nx, p.pos.y + 1, p.pos.z));
      p.vel.x *= -0.2;
    }
    p.pos.x = nx;
  } else {
    p.vel.x = 0;
  }
  const nz = Math.max(MIN_Z, Math.min(MAX_Z, p.pos.z + p.vel.z * dt));
  if (!bodyBlocked(p.pos.x, p.pos.y, nz)) {
    if (nz === MIN_Z && Math.abs(p.vel.z) > 4) {
      wallHit(_tmp.set(p.pos.x, p.pos.y + 1, nz));
      p.vel.z *= -0.2;
    }
    p.pos.z = nz;
  } else {
    p.vel.z = 0;
  }

  // Vertical
  const ny = p.pos.y + p.vel.y * dt;
  if (p.vel.y > 0 && bodyBlocked(p.pos.x, ny, p.pos.z)) {
    p.vel.y = 0; // bonk the underside of a block
  } else {
    p.pos.y = ny;
  }
  const support = supportHeight(p.pos.x, p.pos.y, p.pos.z);
  const wasGround = p.onGround;
  if (p.pos.y <= support) {
    const impact = -p.vel.y;
    p.pos.y = support;
    p.vel.y = 0;
    p.onGround = true;
    if (!wasGround && impact > 6.5) {
      const strength = Math.min(1, (impact - 6) / 8);
      _tmp.set(p.pos.x, p.pos.y + 0.1, p.pos.z);
      fx.particles.burst(_tmp, 14 + Math.round(strength * 20), { color: [GROUND_COLOR, 0xffffff, 0x9fb6d8], speed: [3, 9], life: [0.3, 0.7], size: [0.3, 0.8], flat: true, drag: 3 });
      if (support === 0) addRipple(p.pos.x, p.pos.z, 0.35 + strength * 0.5);
      audio.tone({ type: 'sine', f0: 140, f1: 45, dur: 0.22, vol: 0.12 + strength * 0.12, verb: 0.05 });
      addShake(0.08 + strength * 0.18);
      p.bob = -0.18 * (0.5 + strength);
    }
  } else {
    p.onGround = false;
  }
  if (p.pos.y > CEILING) {
    p.pos.y = CEILING;
    p.vel.y = Math.min(0, p.vel.y);
  }
  p.airTime = p.onGround ? 0 : p.airTime + dt;

  // Jetpack audio + thruster particles
  const jetLevel = p.thrusting ? 1 : p.onGround ? 0 : 0.18;
  audio.setJetpack(jetLevel, od ? 1 : p.dashTime > 0 ? 0.8 : 0);
  const thrustColor = od ? POWERUPS.overdrive.color : GROUND_COLOR;
  if (p.thrusting || (!p.onGround && Math.random() < 0.3)) {
    _tmp.set(0.11, 0.85, 0.26).applyAxisAngle(THREE.Object3D.DEFAULT_UP, p.yaw).add(p.pos);
    fxThruster(_tmp, thrustColor, p.thrusting ? 1 : 0.3);
    _tmp.set(-0.11, 0.85, 0.26).applyAxisAngle(THREE.Object3D.DEFAULT_UP, p.yaw).add(p.pos);
    fxThruster(_tmp, thrustColor, p.thrusting ? 1 : 0.3);
  }
  if (p.dashTime > 0 && Math.random() < 0.8) fxDash(p.pos, _move.lengthSq() ? _move : _fwd, thrustColor);

  updateAvatar(dt, time, thrustColor, jetLevel);
  updateMarker(support);
  updateCamera(dt, time);
}

function updateAvatar(dt, time, color, jetLevel) {
  const p = player;
  avatar.visible = !p.firstPerson;
  avatar.position.copy(p.pos);
  avatar.rotation.y = p.yaw;
  const speed = Math.hypot(p.vel.x, p.vel.z);
  // lean into motion
  const localVz = -(p.vel.x * -Math.sin(p.yaw) + p.vel.z * -Math.cos(p.yaw));
  avatar.rotation.x = THREE.MathUtils.clamp(localVz * 0.012, -0.25, 0.25);
  const stride = p.onGround ? Math.sin(time * 11) * Math.min(1, speed / 10) * 0.6 : 0.25;
  avatarParts.legL.rotation.x = stride;
  avatarParts.legR.rotation.x = p.onGround ? -stride : 0.1;
  avatarParts.armL.rotation.x = -stride * 0.7;
  const flame = jetLevel > 0.05;
  const fs = 0.45 + jetLevel * 1.1 + Math.sin(time * 47) * 0.15;
  avatarParts.flameL.visible = avatarParts.flameR.visible = flame;
  avatarParts.flameL.scale.set(1, fs, 1);
  avatarParts.flameR.scale.set(1, fs * (0.92 + Math.sin(time * 31) * 0.08), 1);
  avatarParts.flameMat.color.set(color).multiplyScalar(2.5);
  avatarParts.light.color.set(color);
  avatarParts.light.intensity = flame && !p.firstPerson ? 6 * fs : 0;
}

function updateMarker(support) {
  const p = player;
  const height = p.pos.y - support;
  const target = height > 1.2 ? Math.min(0.85, 0.3 + height / 60) : 0;
  markerMat.opacity += (target - markerMat.opacity) * 0.2;
  marker.visible = markerMat.opacity > 0.01;
  marker.position.set(p.pos.x, support + 0.08, p.pos.z);
  const s = 0.8 + Math.min(2.2, height / 25);
  marker.scale.setScalar(s);
  markerMat.color.set(G.effects.overdrive > 0 ? POWERUPS.overdrive.color : GROUND_COLOR).multiplyScalar(1.6);
}

function updateGun(dt, time) {
  const p = player;
  gun.visible = p.firstPerson;
  if (!p.firstPerson) return;
  p.gunRecoil = Math.max(0, p.gunRecoil - dt * 6);
  p.sway.multiplyScalar(Math.exp(-10 * dt));
  const speed = Math.hypot(p.vel.x, p.vel.z);
  const bobAmt = p.onGround ? Math.min(1, speed / 12) : 0.15;
  const bx = Math.cos(time * 7.5) * 0.012 * bobAmt;
  const by = Math.abs(Math.sin(time * 7.5)) * 0.014 * bobAmt;
  const r = p.gunRecoil;
  gun.position.set(
    0.3 + bx - THREE.MathUtils.clamp(p.sway.x, -0.06, 0.06),
    -0.28 + by + r * 0.02 + THREE.MathUtils.clamp(p.sway.y * 0.6, -0.05, 0.05) + p.bob * 0.15 - (p.thrusting ? 0.015 : 0),
    -0.5 + r * 0.09
  );
  gun.rotation.set(r * 0.16 + THREE.MathUtils.clamp(p.sway.y, -0.1, 0.1), THREE.MathUtils.clamp(p.sway.x * 1.5, -0.12, 0.12), THREE.MathUtils.clamp(-p.sway.x * 2, -0.15, 0.15));

  // Energy colour follows what the launcher is aimed at / armed with.
  let color = GROUND_COLOR;
  if (G.loadedWeapon) color = POWERUPS[G.loadedWeapon].color;
  else if (G.aim && G.aim.type === 'sky') color = SKY_COLOR;
  const pulse = G.loadedWeapon ? 1.5 + Math.sin(time * 12) * 0.6 : 1.5;
  gunParts.energy.color.set(color).multiplyScalar(pulse);
  gunParts.energyDim.color.set(color).multiplyScalar(pulse * 0.6);
  gunParts.coils.forEach((c, i) => {
    const phase = (time * (G.loadedWeapon ? 9 : 3) - i * 0.9) % (Math.PI * 2);
    c.material.color.set(color).multiplyScalar(0.6 + Math.max(0, Math.sin(phase)) * 1.4 + r * 1.5);
    c.scale.setScalar(1 + r * 0.25);
  });
  gunParts.light.intensity = Math.max(0, gunParts.light.intensity - dt * 60);
  const fm = gunParts.flash.material;
  fm.opacity = Math.max(0, fm.opacity - dt * 9);
  gunParts.flash.scale.setScalar(0.25 + fm.opacity * 0.5);
}

function updateCamera(dt, time) {
  const p = player;
  const cam = G.camera;
  p.bob += (0 - p.bob) * Math.min(1, dt * 8);
  p.fovKick = Math.max(0, p.fovKick - dt * 28);
  cam.rotation.order = 'YXZ';
  cam.rotation.set(p.pitch, p.yaw, 0);

  if (p.firstPerson) {
    const speed = Math.hypot(p.vel.x, p.vel.z);
    const bob = p.onGround ? Math.sin(time * 15) * 0.04 * Math.min(1, speed / 12) : 0;
    cam.position.set(p.pos.x, p.pos.y + PLAYER_EYE + bob + p.bob, p.pos.z);
  } else {
    // Chase cam pulled in when it would end up inside the stack.
    const dist = 6.2;
    _cam.set(0.9, 0, dist).applyAxisAngle(_right.set(1, 0, 0), p.pitch * 0.6).applyAxisAngle(THREE.Object3D.DEFAULT_UP, p.yaw);
    const head = _tmp.set(p.pos.x, p.pos.y + 1.7, p.pos.z);
    let t = 1;
    for (let s = 0.1; s <= 1.0001; s += 0.1) {
      if (solidAtWorld(head.x + _cam.x * s, head.y + _cam.y * s + 0.6, head.z + _cam.z * s)) {
        t = Math.max(0.12, s - 0.12);
        break;
      }
    }
    cam.position.set(head.x + _cam.x * t, Math.max(0.6, head.y + 0.6 + _cam.y * t), head.z + _cam.z * t);
  }
  const od = G.effects.overdrive > 0 ? 5 : 0;
  const targetFov = (G.settings.fov || 74) + p.fovKick + od + (p.thrusting ? 2 : 0);
  if (Math.abs(cam.fov - targetFov) > 0.01) {
    cam.fov += (targetFov - cam.fov) * Math.min(1, dt * 10);
    cam.updateProjectionMatrix();
  }
  updateGun(dt, time);
  applyCameraShake(cam, dt);
}

// Used by the title / game-over camera so the avatar and gun stay hidden.
export function hidePlayerVisuals() {
  if (gun) gun.visible = false;
  if (avatar) avatar.visible = false;
  if (marker) marker.visible = false;
  audio.setJetpack(0);
}

export function playerStatus() {
  return {
    fuel: player.fuel,
    overheated: player.overheated,
    dash: 1 - player.dashCooldown / DASH_COOLDOWN,
    altitude: player.pos.y,
    firstPerson: player.firstPerson,
  };
}
