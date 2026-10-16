// Sector theme transitions: sky bake + cross-fade, arena neon, lights, fog
// and environment reflections all glide to the new palette together.
import { THEMES } from '../config.js';
import { G } from '../state.js';
import { applyThemeToArena } from './arena.js';
import { applyThemeToLights, rebuildEnvironment } from './renderer.js';

let from = THEMES[0];
let to = THEMES[0];
let t = 1;
let sky = null;

export function initTheme(skySystem) {
  sky = skySystem;
  setTheme(0, true);
}

export function themeForLevel(level) {
  return (Math.max(1, level) - 1) % THEMES.length;
}

export function setTheme(index, instant = false) {
  const th = THEMES[index % THEMES.length];
  G.themeIndex = index % THEMES.length;
  if (th === to && !instant) return;
  from = instant ? th : to;
  to = th;
  t = instant ? 1 : 0;
  if (sky) sky.setTheme(th, instant);
  rebuildEnvironment(th);
  if (instant) apply(1);
}

export function currentTheme() {
  return to;
}

function apply(k) {
  applyThemeToArena(from, to, k);
  applyThemeToLights(from, to, k);
}

export function updateTheme(dt) {
  if (t >= 1) return;
  t = Math.min(1, t + dt / 2.8);
  apply(t * t * (3 - 2 * t));
}
