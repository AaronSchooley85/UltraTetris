// ============================================================================
// FX hub: one place for gameplay code to request juicy feedback without
// knowing about particle pools, debris or beams.
// ============================================================================
import * as THREE from 'three';
import { G } from '../state.js';
import { CELL } from '../config.js';
import { ParticleSystem, Debris, Shockwaves } from './particles.js';
import { BeamBursts } from './beam.js';
import { addRipple } from './arena.js';
import { addShake, pulseAberration, screenFlash } from './renderer.js';

export const fx = {
  particles: null,
  debris: null,
  rings: null,
  beams: null,
};

export function initFx() {
  fx.particles = new ParticleSystem(7000);
  fx.debris = new Debris(1400);
  fx.rings = new Shockwaves(36);
  fx.beams = new BeamBursts(G.scene, 8);
}

export function updateFx(dt, time) {
  fx.particles.update(dt);
  fx.debris.update(dt);
  fx.rings.update(dt);
  fx.beams.update(dt, time);
}

export function clearFx() {
  fx.particles.clear();
  fx.debris.clear();
  fx.rings.clear();
  fx.beams.clear();
}

const _v = new THREE.Vector3();

// A heavy piece slams down: dust skirt, floor ripple, shake by proximity.
export function fxLanding(worldCells, color, power = 1) {
  let minY = Infinity;
  const center = new THREE.Vector3();
  worldCells.forEach((p) => {
    center.add(p);
    minY = Math.min(minY, p.y);
  });
  center.divideScalar(worldCells.length);
  worldCells.forEach((p) => {
    if (p.y - minY > 0.1) return;
    _v.set(p.x, p.y - CELL / 2 + 0.2, p.z);
    fx.particles.burst(_v, 22, {
      color: [color, 0xffffff, 0x9fb6d8],
      speed: [6, 18],
      life: [0.5, 1.1],
      size: [0.6, 1.6],
      flat: true,
      drag: 3,
      spread: CELL * 0.8,
      brightness: 0.8,
    });
  });
  _v.set(center.x, minY - CELL / 2 + 0.3, center.z);
  fx.rings.spawn(_v, color, { radius: 14 * power, life: 0.6, horizontal: true, thickness: 0.07, brightness: 1.4 });
  addRipple(center.x, center.z, 0.9 * power, color);
  const dist = G.camera.position.distanceTo(center);
  addShake(Math.min(0.55, (0.35 * power * 40) / Math.max(20, dist)));
}

// One cell of a cleared line: shatter into debris + sparks.
export function fxShatterCell(pos, color, strength = 1) {
  fx.debris.spawn(pos, color, Math.round(7 * strength), { speed: 18 * strength, size: 1.5, life: 1.7, box: CELL * 0.8 });
  fx.particles.burst(pos, Math.round(26 * strength), {
    color: [color, 0xffffff],
    speed: [8, 26],
    life: [0.4, 1.0],
    size: [0.5, 1.3],
    gravity: 8,
    drag: 1.6,
    spread: CELL * 0.7,
    brightness: 1.6,
  });
}

export function fxLineSweep(a, b, color) {
  fx.beams.fire(a, b, color, { life: 0.42, thickness: 1.2, strand: 0xffffff });
}

export function fxClearImpact(center, lines) {
  fx.rings.spawn(center, 0xffffff, { radius: 26 + lines * 6, life: 0.75, thickness: 0.06, brightness: 1.5 });
  pulseAberration(0.006 + lines * 0.003);
  screenFlash(0.08 + lines * 0.05);
  addShake(0.25 + lines * 0.12);
  addRipple(center.x, center.z, 1.2 + lines * 0.3, 0xffffff);
}

export function fxExplosion(pos, color, size = 1) {
  fx.particles.burst(pos, Math.round(160 * size), {
    color: [color, 0xffe1a6, 0xffffff, 0xff4400],
    speed: [10, 46 * size],
    life: [0.5, 1.5],
    size: [1.0, 3.2],
    gravity: 6,
    drag: 1.4,
    spread: 3,
    brightness: 1.5,
    mode: 2,
  });
  fx.particles.burst(pos, 60, { color: [0x554466, 0x332233], speed: [4, 14], life: [1.2, 2.4], size: [3, 6], drag: 1.2, up: 4, brightness: 0.4, mode: 2 });
  fx.rings.spawn(pos, color, { radius: 34 * size, life: 0.8, thickness: 0.09, brightness: 1.5 });
  _v.copy(pos);
  _v.y = Math.max(0.3, pos.y - 6);
  fx.rings.spawn(_v, 0xffffff, { radius: 40 * size, life: 1.0, horizontal: true, thickness: 0.05, brightness: 1.4 });
  addRipple(pos.x, pos.z, 2.2, color);
  addShake(0.85);
  screenFlash(0.2, color);
  pulseAberration(0.02);
}

export function fxSparks(pos, color, count = 30, speed = 14) {
  fx.particles.burst(pos, count, { color: [color, 0xffffff], speed: [speed * 0.3, speed], life: [0.25, 0.6], size: [0.25, 0.7], drag: 2.5, brightness: 2 });
}

export function fxPickup(pos, color) {
  fx.particles.burst(pos, 70, { color: [color, 0xffffff], speed: [6, 22], life: [0.4, 0.9], size: [0.5, 1.4], drag: 2, brightness: 2.2 });
  fx.rings.spawn(pos, color, { radius: 10, life: 0.5, thickness: 0.1, brightness: 2 });
  screenFlash(0.12, color);
}

export function fxPowerCore(pos, color) {
  fx.particles.burst(pos, 90, { color: [color, 0xffffff], speed: [10, 30], life: [0.6, 1.3], size: [0.6, 1.8], drag: 1.6, up: 6, brightness: 2.4 });
  fx.rings.spawn(pos, color, { radius: 18, life: 0.7, thickness: 0.08, brightness: 2.2 });
}

export function fxDash(pos, dir, color) {
  for (let i = 0; i < 26; i++) {
    const s = 6 + Math.random() * 10;
    fx.particles.emit(
      pos.x + (Math.random() - 0.5) * 0.8,
      pos.y + 0.6 + Math.random() * 0.8,
      pos.z + (Math.random() - 0.5) * 0.8,
      -dir.x * s + (Math.random() - 0.5) * 3,
      (Math.random() - 0.5) * 3,
      -dir.z * s + (Math.random() - 0.5) * 3,
      color,
      0.35 + Math.random() * 0.4,
      0.35 + Math.random() * 0.3,
      0,
      3
    );
  }
}

export function fxThruster(pos, color, intensity) {
  const n = Math.ceil(intensity * 2);
  for (let i = 0; i < n; i++) {
    fx.particles.emit(
      pos.x + (Math.random() - 0.5) * 0.25,
      pos.y,
      pos.z + (Math.random() - 0.5) * 0.25,
      (Math.random() - 0.5) * 1.5,
      -8 - Math.random() * 6 * intensity,
      (Math.random() - 0.5) * 1.5,
      color,
      0.25 + Math.random() * 0.25,
      0.25 + Math.random() * 0.2,
      0,
      2
    );
  }
}
