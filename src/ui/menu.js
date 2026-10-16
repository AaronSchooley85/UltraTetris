// ============================================================================
// MENUS: title screen with mode select, how-to-play, settings, pause and the
// game-over results screen with the local leaderboard.
// ============================================================================
import { G } from '../state.js';
import { MODES, POWERUPS, THEMES } from '../config.js';
import { getBestScore, getHighScores, saveSettings } from '../settings.js';
import { powerupIconURL } from '../gfx/textures.js';
import { audio } from '../audio/audio.js';

const css = (hex) => '#' + (hex >>> 0).toString(16).padStart(6, '0');
let root;
let handlers = {};
let current = null;
let backTo = 'title';

const CONTROLS = [
  ['Mouse', 'Look around'],
  ['W A S D', 'Move'],
  ['Space (hold)', 'Jetpack thrust'],
  ['Shift', 'Dash'],
  ['Left click', 'Fire beacon / armed weapon'],
  ['R · Right click · Wheel', 'Yaw the piece'],
  ['Q', 'Pitch the piece'],
  ['E', 'Roll the piece'],
  ['F', 'Slam the piece down'],
  ['C', 'Hold / swap piece'],
  ['X', 'Release beacons'],
  ['1 · 2 · 3', 'Use power-up slot'],
  ['V', 'First / third person'],
  ['Arrow keys', 'Look (keyboard)'],
  ['M', 'Mute'],
  ['Esc · P', 'Pause'],
];

function modeCards() {
  return Object.entries(MODES)
    .map(
      ([key, m], i) => `
      <button class="mode-card" data-mode="${key}" style="--i:${i}">
        <span class="mode-tag">${m.tag}</span>
        <span class="mode-name">${m.name}</span>
        <span class="mode-desc">${m.desc}</span>
        <span class="mode-best">BEST <b data-best="${key}">0</b></span>
        <span class="mode-play">PLAY <i>▶</i></span>
      </button>`
    )
    .join('');
}

function powerupList() {
  return Object.entries(POWERUPS)
    .map(
      ([k, p]) => `
      <div class="pu-item" style="--c:${css(p.color)}">
        <img src="${powerupIconURL(k, p.color)}" alt="" />
        <div><b>${p.name}</b><span>${p.desc}</span></div>
      </div>`
    )
    .join('');
}

const TEMPLATE = () => /* html */ `
  <section class="screen" id="scr-title">
    <div class="title-wrap">
      <div class="logo" aria-label="Ultra Tetris 3D">
        <span class="logo-ultra">ULTRA</span>
        <span class="logo-tetris">TETRIS</span>
        <span class="logo-3d">3D</span>
      </div>
      <p class="tagline">Tag it. Tether it. Slam it. Jetpack through a neon arena and steer house-sized tetrominoes into place.</p>
      <div class="mode-grid">${modeCards()}</div>
      <div class="title-actions">
        <button class="btn" data-act="howto">HOW TO PLAY</button>
        <button class="btn" data-act="settings">SETTINGS</button>
      </div>
      <p class="title-foot">Mouse + keyboard · headphones recommended · <span id="title-sector">7 sectors to conquer</span></p>
    </div>
  </section>

  <section class="screen panel-screen" id="scr-howto">
    <div class="panel wide">
      <h2>HOW TO PLAY</h2>
      <div class="howto-grid">
        <div>
          <h3>THE LOOP</h3>
          <ol class="steps">
            <li><b>Tag</b> — look up and <kbd>LMB</kbd> the falling mega-piece. An amber beacon sticks to that cube.</li>
            <li><b>Anchor</b> — <kbd>LMB</kbd> a floor cell or the top of a block. The plasma tether drags the piece until the tagged cube sits right above it.</li>
            <li><b>Rotate</b> — <kbd>R</kbd>/<kbd>RMB</kbd>/wheel yaw, <kbd>Q</kbd> pitch, <kbd>E</kbd> roll. Torque shots spin the piece around the tagged cube.</li>
            <li><b>Slam</b> — <kbd>F</kbd> drives it down for bonus points. Fill a complete row along X <i>or</i> Z to clear it.</li>
          </ol>
          <h3>SCORING</h3>
          <p>Multi-line clears, back-to-back big clears, combos on consecutive pieces and cascade chains all multiply your score. Every 6 lines you level up and warp to a new sector.</p>
          <h3>POWER-UPS</h3>
          <p>Fly into floating orbs, clear glowing power cores inside pieces, or land big clears to earn them. Use them with <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd>.</p>
          <div class="pu-list">${powerupList()}</div>
        </div>
        <div>
          <h3>CONTROLS</h3>
          <table class="controls">${CONTROLS.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</table>
        </div>
      </div>
      <div class="panel-actions"><button class="btn primary" data-act="back">BACK</button></div>
    </div>
  </section>

  <section class="screen panel-screen" id="scr-settings">
    <div class="panel">
      <h2>SETTINGS</h2>
      <div class="settings">
        <label>Master volume <input type="range" min="0" max="1" step="0.01" data-set="masterVolume" /></label>
        <label>Music volume <input type="range" min="0" max="1" step="0.01" data-set="musicVolume" /></label>
        <label>Effects volume <input type="range" min="0" max="1" step="0.01" data-set="sfxVolume" /></label>
        <label>Mouse sensitivity <input type="range" min="0.2" max="3" step="0.05" data-set="sensitivity" /></label>
        <label>Field of view <input type="range" min="60" max="100" step="1" data-set="fov" /><output data-out="fov"></output></label>
        <label>Graphics quality
          <select data-set="quality"><option value="high">High</option><option value="medium">Medium</option><option value="low">Low (fast)</option></select>
        </label>
        <label class="check"><input type="checkbox" data-set="invertY" /> Invert mouse Y</label>
        <label class="check"><input type="checkbox" data-set="screenShake" /> Screen shake</label>
        <label class="check"><input type="checkbox" data-set="showHints" /> Show hints</label>
      </div>
      <div class="panel-actions"><button class="btn primary" data-act="back">DONE</button></div>
    </div>
  </section>

  <section class="screen panel-screen" id="scr-pause">
    <div class="panel narrow">
      <h2>PAUSED</h2>
      <div class="pause-stats" id="pause-stats"></div>
      <div class="stack-buttons">
        <button class="btn primary" data-act="resume">RESUME</button>
        <button class="btn" data-act="restart">RESTART</button>
        <button class="btn" data-act="howto">HOW TO PLAY</button>
        <button class="btn" data-act="settings">SETTINGS</button>
        <button class="btn ghost" data-act="quit">QUIT TO TITLE</button>
      </div>
      <p class="pause-note" id="pause-note"></p>
    </div>
  </section>

  <section class="screen panel-screen" id="scr-gameover">
    <div class="panel go">
      <div class="go-kicker" id="go-kicker">GAME OVER</div>
      <h2 class="go-title" id="go-title">STACK OVERFLOW</h2>
      <div class="go-score"><span>FINAL SCORE</span><b id="go-score">0</b></div>
      <div class="go-record" id="go-record">★ NEW RECORD ★</div>
      <div class="go-stats" id="go-stats"></div>
      <div class="go-board">
        <h3 id="go-board-title">TOP SCORES</h3>
        <ol id="go-board"></ol>
      </div>
      <div class="panel-actions">
        <button class="btn primary" data-act="restart">PLAY AGAIN</button>
        <button class="btn" data-act="quit">MAIN MENU</button>
      </div>
    </div>
  </section>

  <div class="toast-center" id="ui-note"></div>
`;

export function initMenu(h) {
  handlers = h;
  root = document.getElementById('ui');
  root.innerHTML = TEMPLATE();

  root.addEventListener('click', (e) => {
    const card = e.target.closest('.mode-card');
    if (card) {
      audio.uiClick();
      handlers.onStart(card.dataset.mode);
      return;
    }
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    audio.uiClick();
    const act = btn.dataset.act;
    if (act === 'howto' || act === 'settings') {
      backTo = current === 'pause' ? 'pause' : 'title';
      show(act);
    } else if (act === 'back') show(backTo);
    else if (act === 'resume') handlers.onResume();
    else if (act === 'restart') handlers.onRestart();
    else if (act === 'quit') handlers.onQuit();
  });
  root.addEventListener(
    'mouseover',
    (e) => {
      const b = e.target.closest('.btn, .mode-card');
      if (b && !b.contains(e.relatedTarget)) audio.uiHover();
    },
    true
  );
  root.addEventListener('mousedown', (e) => e.stopPropagation());

  // Settings binding
  root.querySelectorAll('[data-set]').forEach((input) => {
    const key = input.dataset.set;
    const sync = () => {
      if (input.type === 'checkbox') input.checked = !!G.settings[key];
      else input.value = G.settings[key];
      const out = root.querySelector(`[data-out="${key}"]`);
      if (out) out.textContent = G.settings[key];
    };
    sync();
    input.addEventListener('input', () => {
      let v;
      if (input.type === 'checkbox') v = input.checked;
      else if (input.type === 'range') v = parseFloat(input.value);
      else v = input.value;
      G.settings[key] = v;
      const out = root.querySelector(`[data-out="${key}"]`);
      if (out) out.textContent = v;
      saveSettings();
      handlers.onSettingsChanged(key, v);
    });
    input.addEventListener('keydown', (e) => e.stopPropagation());
  });
}

export function show(name) {
  current = name;
  root.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === `scr-${name}`));
  root.classList.toggle('open', !!name);
  if (name === 'title') refreshBest();
  if (name === 'pause') refreshPause();
}

export function hide() {
  show(null);
}

export function currentScreen() {
  return current;
}

function refreshBest() {
  root.querySelectorAll('[data-best]').forEach((b) => {
    b.textContent = getBestScore(b.dataset.best).toLocaleString();
  });
}

function refreshPause() {
  const m = G.modeCfg;
  root.querySelector('#pause-stats').innerHTML = m
    ? `<span>${m.name}</span><span>SCORE <b>${G.score.toLocaleString()}</b></span><span>LEVEL <b>${G.level}</b></span><span>LINES <b>${G.lines}</b></span>`
    : '';
}

export function setPauseNote(text) {
  root.querySelector('#pause-note').textContent = text || '';
}

export function note(text, ms = 3200) {
  const n = root.querySelector('#ui-note');
  n.textContent = text;
  n.classList.add('show');
  clearTimeout(n._t);
  n._t = setTimeout(() => n.classList.remove('show'), ms);
}

function fmtTime(t) {
  const s = Math.floor(t);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function showGameOver({ reason, stats, rank }) {
  const q = (s) => root.querySelector(s);
  const isTime = reason === 'time';
  q('#go-kicker').textContent = isTime ? 'TIME UP' : 'GAME OVER';
  q('#go-title').textContent = isTime ? 'BLITZ COMPLETE' : 'STACK OVERFLOW';
  q('#go-score').textContent = '0';
  q('#go-record').style.display = rank === 0 ? 'block' : 'none';
  const items = [
    ['LEVEL', stats.level],
    ['LINES', stats.lines],
    ['BEST CLEAR', ['—', 'SINGLE', 'DOUBLE', 'TRIPLE', 'QUAD', 'PENTA', 'HEXA', 'ULTRA'][Math.min(7, stats.bestClear)] || stats.bestClear],
    ['MAX COMBO', stats.maxCombo],
    ['PIECES', stats.pieces],
    ['POWER-UPS', stats.powerups],
    ['TIME', fmtTime(stats.time)],
    ['SECTOR', THEMES[(Math.max(1, stats.level) - 1) % THEMES.length].name],
  ];
  q('#go-stats').innerHTML = items.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
  q('#go-board-title').textContent = `TOP SCORES · ${MODES[G.mode].name}`;
  const list = getHighScores(G.mode);
  q('#go-board').innerHTML = list.length
    ? list
        .map(
          (e, i) =>
            `<li class="${i === rank ? 'me' : ''}"><span>${i + 1}</span><b>${e.score.toLocaleString()}</b><em>L${e.level} · ${e.lines} lines</em><time>${new Date(e.date).toLocaleDateString()}</time></li>`
        )
        .join('')
    : '<li class="empty">No scores yet</li>';
  show('gameover');
  // Count the final score up for drama
  const target = stats.score;
  const start = performance.now();
  const el = q('#go-score');
  const step = (now) => {
    const k = Math.min(1, (now - start) / 1400);
    const e = 1 - Math.pow(1 - k, 3);
    el.textContent = Math.round(target * e).toLocaleString();
    if (k < 1 && current === 'gameover') requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
