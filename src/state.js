// ============================================================================
// Shared runtime state. Every module reads and writes through `G` so the game
// loop, HUD and effects all agree on one source of truth.
// ============================================================================
import { DEFAULT_SETTINGS } from './config.js';

export const G = {
  // Engine handles (filled in by gfx/renderer.js)
  THREE: null,
  renderer: null,
  scene: null,
  camera: null,
  composer: null,

  // Timing
  time: 0, // scaled game time (seconds)
  realTime: 0, // unscaled time
  dt: 0,
  timeScale: 1,
  slowmo: 0, // remaining real-seconds of slow motion
  slowmoScale: 1,

  // Settings / persistence
  settings: { ...DEFAULT_SETTINGS },
  debug: false,

  // Flow: 'title' | 'playing' | 'paused' | 'gameover'
  phase: 'title',
  mode: 'marathon',
  modeCfg: null,
  pointerLocked: false,
  freeLook: false, // fallback when pointer lock is unavailable

  // Score & progression
  score: 0,
  displayScore: 0,
  level: 1,
  lines: 0,
  combo: -1,
  maxCombo: 0,
  backToBack: false,
  piecesPlaced: 0,
  powerupsUsed: 0,
  bestClear: 0,
  elapsed: 0, // seconds of active play
  timeLeft: 0, // blitz countdown
  themeIndex: 0,

  // Board / piece flow: 'falling' | 'clearing' | 'spawnDelay' | 'idle'
  flow: 'idle',
  flowTimer: 0,
  chain: 0,
  pendingSpawn: false,

  // Effects
  effects: { chrono: 0, overdrive: 0 },
  loadedWeapon: null, // 'nova' | 'laser' | null
  inventory: [null, null, null],
  danger: 0, // 0..1 how close the stack is to the ceiling

  // Input
  keys: {},
  mouse: { lmb: false, rmb: false },
};

export function scaledDt(realDt) {
  return realDt * G.timeScale;
}
