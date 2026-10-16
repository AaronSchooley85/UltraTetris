// ============================================================================
// ULTRA TETRIS 3D — entry point: boot, input, pointer lock (with a drag-to-
// look fallback), screen flow and the main loop.
// ============================================================================
import * as THREE from 'three';
import { G } from './state.js';
import { PIECES, NANO_PIECE, PLAYER_EYE, THEMES } from './config.js';
import { loadSettings } from './settings.js';
import { on, emit } from './events.js';
import { initRenderer, setQuality, updatePost, renderFrame } from './gfx/renderer.js';
import { SkySystem } from './gfx/sky.js';
import { buildArena, updateArena } from './gfx/arena.js';
import { initFx, updateFx, clearFx } from './gfx/fx.js';
import { initTheme, setTheme, updateTheme } from './gfx/theme.js';
import { warmBlockMaterials, updateBlockMaterials, updateFlashes } from './gfx/blocks.js';
import * as board from './game/board.js';
import { initPieces, hardDrop, holdPiece, despawnPiece } from './game/piece.js';
import { initBeacons, updateAim, fireBeacon, fireTorque, fireNova, updateProjectiles, updateBeacons, clearBeacons, clearProjectiles } from './game/beacons.js';
import { initPowerups, resetPowerups, updateOrbs, activateSlot, updateEffects, fireLoadedWeapon, grantPowerup, debugSpawnOrb } from './game/powerups.js';
import { initGame, startGame, updateGame, endGame } from './game/game.js';
import { player, initPlayer, resetPlayer, updatePlayer, addLook, toggleCamera, tryDash, hidePlayerVisuals } from './game/player.js';
import { initHud, updateHud, setHudVisible, setThemeCss } from './ui/hud.js';
import { initMenu, show, hide, showGameOver, note, setPauseNote, currentScreen } from './ui/menu.js';
import { audio } from './audio/audio.js';
import { music } from './audio/music.js';

let sky;
let canvas;
let pendingAction = null; // { type: 'start', mode } | { type: 'resume' }
let pendingLock = false;
let lockUnavailable = false;
let lastUnlock = 0;
let audioStarted = false;
let drag = null;
let titleAngle = 0.6;

// ------------------------------------------------------------------- boot --
function boot() {
  loadSettings();
  const params = new URLSearchParams(location.search);
  G.debug = params.has('debug');

  try {
    initRenderer(document.getElementById('app'));
  } catch (e) {
    fatal('This game needs WebGL 2. Try a recent Chrome, Edge, Firefox or Safari with hardware acceleration enabled.');
    return;
  }
  canvas = G.renderer.domElement;
  sky = new SkySystem();
  buildArena();
  initFx();
  initTheme(sky);
  board.initBoard();
  initPieces();
  initBeacons();
  initPowerups();
  initGame();
  initPlayer();
  initHud();
  initMenu({
    onStart: (mode) => engage({ type: 'start', mode }),
    onResume: () => engage({ type: 'resume' }),
    onRestart: () => engage({ type: 'start', mode: G.mode }),
    onQuit: quitToTitle,
    onSettingsChanged,
  });
  setThemeCss(THEMES[0]);
  warmBlockMaterials([...PIECES, NANO_PIECE]);
  board.populateReferenceFormation();
  setHudVisible(false);
  show('title');
  bindInput();

  on('gameOver', (data) => {
    setTimeout(() => {
      if (G.phase !== 'gameover') return;
      releaseLock();
      setHudVisible(false);
      showGameOver(data);
    }, 1800);
    music.setIntensity(0.2);
  });
  on('levelUp', ({ themeIndex }) => setThemeCss(THEMES[themeIndex]));
  on('gameStarted', () => setThemeCss(THEMES[G.themeIndex]));

  if (G.debug) exposeDebug();

  requestAnimationFrame((t) => {
    last = t;
    requestAnimationFrame(frame);
    const loading = document.getElementById('loading');
    if (loading) {
      loading.classList.add('done');
      setTimeout(() => loading.remove(), 900);
    }
  });
}

function fatal(msg) {
  const loading = document.getElementById('loading');
  if (loading) {
    loading.classList.add('error');
    loading.querySelector('.loading-text').textContent = msg;
  }
}

// ------------------------------------------------------------ audio start --
function ensureAudio() {
  if (audioStarted) {
    audio.init();
    return;
  }
  audioStarted = true;
  audio.init();
  music.setIntensity(G.phase === 'playing' ? 0.5 : 0.3);
  music.start();
}

// ----------------------------------------------------------- pointer lock --
// Called from a user gesture. Runs the pending action once the mouse is
// captured, or straight away in drag-to-look mode where capture isn't allowed.
function engage(action) {
  ensureAudio();
  pendingAction = action;
  setPauseNote('');
  if (lockUnavailable || !canvas.requestPointerLock || G.debug) {
    G.freeLook = true;
    runPending();
    return;
  }
  if (document.pointerLockElement === canvas) {
    runPending();
    return;
  }
  pendingLock = true;
  try {
    const r = canvas.requestPointerLock();
    if (r && typeof r.catch === 'function') r.catch(() => lockFailed());
  } catch (e) {
    lockFailed();
  }
}

function lockFailed() {
  if (!pendingLock) return;
  pendingLock = false;
  const transient = performance.now() - lastUnlock < 1600;
  if (transient) {
    // Browsers refuse a re-lock right after Esc; just ask for another click.
    if (currentScreen() === 'pause') setPauseNote('Click RESUME again to re-engage the mouse.');
    else note('Click again to engage the mouse.');
    return;
  }
  lockUnavailable = true;
  G.freeLook = true;
  note('Mouse capture is blocked here, so drag to look and click to fire. Arrow keys look too.', 6000);
  runPending();
}

function runPending() {
  const a = pendingAction;
  pendingAction = null;
  if (!a) return;
  if (a.type === 'start') startRun(a.mode);
  else if (a.type === 'resume') resumeGame();
}

function releaseLock() {
  if (document.pointerLockElement && document.exitPointerLock) document.exitPointerLock();
}

function onLockChange() {
  const locked = document.pointerLockElement === canvas;
  G.pointerLocked = locked;
  if (locked) {
    G.freeLook = false;
    if (pendingLock) {
      pendingLock = false;
      runPending();
    }
  } else {
    lastUnlock = performance.now();
    if (G.phase === 'playing' && !G.freeLook) pauseGame();
  }
}

// ------------------------------------------------------------- game flow --
function startRun(mode) {
  hide();
  G.keys = {};
  drag = null;
  resetPlayer();
  startGame(mode);
  setHudVisible(true);
  ensureAudio();
}

function pauseGame() {
  if (G.phase !== 'playing') return;
  G.phase = 'paused';
  G.keys = {};
  drag = null;
  audio.silenceLoops();
  music.setIntensity(0.25);
  show('pause');
  releaseLock();
}

function resumeGame() {
  if (G.phase !== 'paused') return;
  hide();
  G.phase = 'playing';
  G.keys = {};
}

function quitToTitle() {
  releaseLock();
  G.phase = 'title';
  G.flow = 'idle';
  despawnPiece();
  clearBeacons(true);
  clearProjectiles();
  resetPowerups();
  clearFx();
  board.populateReferenceFormation();
  setTheme(0);
  setThemeCss(THEMES[0]);
  G.effects.chrono = 0;
  G.effects.overdrive = 0;
  G.danger = 0;
  audio.silenceLoops();
  music.setIntensity(0.3);
  setHudVisible(false);
  show('title');
}

function onSettingsChanged(key, value) {
  if (key === 'masterVolume' || key === 'musicVolume' || key === 'sfxVolume') audio.applyVolumes();
  if (key === 'quality') setQuality(value);
}

function fire() {
  if (G.phase !== 'playing') return;
  if (G.loadedWeapon) fireLoadedWeapon(fireNova);
  else fireBeacon();
}

// ------------------------------------------------------------------ input --
function isTyping(e) {
  const t = e.target;
  return t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA');
}

function bindInput() {
  document.addEventListener('pointerlockchange', onLockChange);
  document.addEventListener('pointerlockerror', lockFailed);

  window.addEventListener('keydown', (e) => {
    if (isTyping(e)) return;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
    G.keys[e.code] = true;
    if (e.repeat) return;
    if (e.code === 'KeyM') {
      ensureAudio();
      audio.muted = !audio.muted;
      audio.applyVolumes();
      note(audio.muted ? 'Sound muted (M)' : 'Sound on', 1400);
      return;
    }
    if (G.phase === 'playing') {
      switch (e.code) {
        case 'Escape':
        case 'KeyP':
          pauseGame();
          break;
        case 'KeyR':
          fireTorque('yaw', -1);
          break;
        case 'KeyQ':
          fireTorque('pitch', 1);
          break;
        case 'KeyE':
          fireTorque('roll', 1);
          break;
        case 'KeyF':
          hardDrop();
          break;
        case 'KeyC':
          holdPiece();
          break;
        case 'KeyX':
          clearBeacons();
          break;
        case 'KeyV':
          toggleCamera();
          break;
        case 'ShiftLeft':
        case 'ShiftRight':
          tryDash();
          break;
        case 'Enter':
          fire();
          break;
        case 'Digit1':
        case 'Digit2':
        case 'Digit3':
          activateSlot(Number(e.code.slice(5)) - 1);
          break;
      }
    } else if (G.phase === 'paused' && e.code === 'KeyP' && currentScreen() === 'pause') {
      engage({ type: 'resume' });
    } else if (e.code === 'Escape' && (currentScreen() === 'settings' || currentScreen() === 'howto')) {
      show(G.phase === 'paused' ? 'pause' : 'title');
    }
  });
  window.addEventListener('keyup', (e) => {
    G.keys[e.code] = false;
  });
  window.addEventListener('blur', () => {
    G.keys = {};
    if (G.phase === 'playing' && G.freeLook && !G.debug) pauseGame();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && G.phase === 'playing' && !G.debug) pauseGame();
  });

  canvas.addEventListener('mousedown', (e) => {
    ensureAudio();
    if (G.phase !== 'playing') return;
    if (!G.pointerLocked && !G.freeLook) {
      engage({ type: 'none' });
      return;
    }
    if (G.freeLook) {
      if (e.button === 0) drag = { x: e.clientX, y: e.clientY, moved: 0 };
      else if (e.button === 2) fireTorque('yaw', -1);
      return;
    }
    if (e.button === 0) fire();
    else if (e.button === 2) fireTorque('yaw', -1);
  });
  window.addEventListener('mouseup', (e) => {
    if (drag && e.button === 0) {
      if (drag.moved < 6 && G.phase === 'playing') fire();
      drag = null;
    }
  });
  window.addEventListener('mousemove', (e) => {
    if (G.phase !== 'playing') return;
    const sens = 0.0022 * (G.settings.sensitivity || 1);
    const inv = G.settings.invertY ? -1 : 1;
    if (G.pointerLocked) {
      const mx = Math.max(-300, Math.min(300, e.movementX || 0));
      const my = Math.max(-300, Math.min(300, e.movementY || 0));
      addLook(-mx * sens, -my * sens * inv);
    } else if (drag) {
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      drag.moved += Math.abs(dx) + Math.abs(dy);
      drag.x = e.clientX;
      drag.y = e.clientY;
      addLook(-dx * sens * 1.3, -dy * sens * 1.3 * inv);
    }
  });
  canvas.addEventListener(
    'wheel',
    (e) => {
      if (G.phase !== 'playing') return;
      e.preventDefault();
      if (Math.abs(e.deltaY) < 4) return;
      fireTorque('yaw', e.deltaY > 0 ? -1 : 1);
    },
    { passive: false }
  );
  window.addEventListener('contextmenu', (e) => e.preventDefault());

  // Touch: drag to look so tablets can at least explore the arena.
  let touch = null;
  canvas.addEventListener('touchstart', (e) => {
    ensureAudio();
    const t = e.changedTouches[0];
    touch = { x: t.clientX, y: t.clientY, moved: 0 };
  });
  canvas.addEventListener('touchmove', (e) => {
    if (!touch || G.phase !== 'playing') return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touch.x;
    const dy = t.clientY - touch.y;
    touch.moved += Math.abs(dx) + Math.abs(dy);
    touch.x = t.clientX;
    touch.y = t.clientY;
    addLook(-dx * 0.004, -dy * 0.004);
    e.preventDefault();
  }, { passive: false });
  canvas.addEventListener('touchend', () => {
    if (touch && touch.moved < 8 && G.phase === 'playing') fire();
    touch = null;
  });
}

// --------------------------------------------------------------- cameras --
const _target = new THREE.Vector3();
const _dummy = new THREE.Object3D();
function titleCamera(dt, time) {
  const cam = G.camera;
  titleAngle += dt * 0.07;
  const R = 100;
  cam.position.set(Math.sin(titleAngle) * R, 44 + Math.sin(time * 0.23) * 8, Math.cos(titleAngle) * R);
  cam.lookAt(0, 24, 0);
  if (Math.abs(cam.fov - 58) > 0.01) {
    cam.fov = 58;
    cam.updateProjectionMatrix();
  }
}

function gameOverCamera(dt, time) {
  const cam = G.camera;
  titleAngle += dt * 0.05;
  const R = 92;
  _target.set(Math.sin(titleAngle) * R, 52, Math.cos(titleAngle) * R);
  const k = 1 - Math.exp(-dt * 0.9);
  cam.position.lerp(_target, k);
  _dummy.position.copy(cam.position);
  _dummy.lookAt(0, 22, 0);
  cam.quaternion.slerp(_dummy.quaternion, k * 1.5);
  const fov = cam.fov + (60 - cam.fov) * k;
  cam.fov = fov;
  cam.updateProjectionMatrix();
}

// -------------------------------------------------------------- main loop --
let last = 0;
let frameCount = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const realDt = Math.min(0.05, Math.max(0, (now - last) / 1000));
  last = now;
  update(realDt);
  renderFrame();
  frameCount++;
}

function update(realDt) {
  G.realTime += realDt;
  if (G.slowmo > 0) {
    G.slowmo -= realDt;
    G.timeScale += (G.slowmoScale - G.timeScale) * Math.min(1, realDt * 14);
  } else {
    G.timeScale += (1 - G.timeScale) * Math.min(1, realDt * 4);
  }
  const paused = G.phase === 'paused';
  const dt = paused ? 0 : realDt * G.timeScale;
  G.dt = dt;
  G.time += dt;

  if (G.phase === 'playing') {
    updatePlayer(dt, G.time);
    updateAim();
    updateGame(dt);
    updateBeacons(dt, G.time);
    updateProjectiles(dt);
    updateOrbs(dt, G.time);
    updateEffects(dt);
  } else if (G.phase === 'title') {
    hidePlayerVisuals();
    titleCamera(realDt, G.realTime);
  } else if (G.phase === 'gameover') {
    hidePlayerVisuals();
    gameOverCamera(realDt, G.realTime);
  }
  G.camera.updateMatrixWorld();

  if (!paused) {
    board.updateBoard(dt);
    updateFlashes(dt);
    updateFx(dt, G.time);
  }
  updateBlockMaterials(G.realTime);
  updateArena(realDt, G.realTime);
  sky.update(realDt, G.realTime);
  updateTheme(realDt);
  updatePost(realDt);
  updateHud(realDt);
}

// ------------------------------------------------------------- debug API --
function lookAtPoint(p) {
  const eye = player.pos.clone();
  eye.y += PLAYER_EYE;
  const d = p.clone().sub(eye);
  player.yaw = Math.atan2(-d.x, -d.z);
  player.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
}

function exposeDebug() {
  window.__ULTRA__ = {
    G,
    THREE,
    board,
    player,
    start: (mode = 'marathon') => engage({ type: 'start', mode }),
    pause: pauseGame,
    resume: () => engage({ type: 'resume' }),
    quit: quitToTitle,
    endGame,
    fire,
    torque: fireTorque,
    hardDrop,
    holdPiece,
    dash: tryDash,
    toggleCamera,
    grant: grantPowerup,
    activate: activateSlot,
    spawnOrb: debugSpawnOrb,
    lookAt: (x, y, z) => lookAtPoint(new THREE.Vector3(x, y, z)),
    lookAtSegment: (i = 0) => G.piece && lookAtPoint(G.piece.segs[i].position.clone()),
    lookAtCell: (gx, gz) => {
      const h = board.columnHeight(gx, gz);
      const c = board.cellCenter(gx, Math.max(0, h - 1), gz);
      c.y = h > 0 ? h * 6 : 0;
      lookAtPoint(c);
    },
    emit,
    frames: () => frameCount,
    // Fast-forward the simulation without rendering (software GL is slow).
    step: (seconds, dt = 1 / 30) => {
      for (let t = 0; t < seconds; t += dt) update(dt);
    },
  };
}

boot();
