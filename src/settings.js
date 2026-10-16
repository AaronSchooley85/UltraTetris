// ============================================================================
// Persistence: settings, high scores and one-time tutorial flags.
// Every storage access is wrapped so private windows / blocked storage work.
// ============================================================================
import { DEFAULT_SETTINGS } from './config.js';
import { G } from './state.js';

const KEY_SETTINGS = 'ultratetris.settings.v2';
const KEY_SCORES = 'ultratetris.scores.v2';
const KEY_FLAGS = 'ultratetris.flags.v2';

function readJSON(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch (e) {
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    /* storage unavailable — settings just won't persist */
  }
}

export function loadSettings() {
  const saved = readJSON(KEY_SETTINGS, {});
  G.settings = { ...DEFAULT_SETTINGS, ...saved };
  return G.settings;
}

export function saveSettings() {
  writeJSON(KEY_SETTINGS, G.settings);
}

export function getHighScores(mode) {
  const all = readJSON(KEY_SCORES, {});
  return Array.isArray(all[mode]) ? all[mode] : [];
}

export function getBestScore(mode) {
  const list = getHighScores(mode);
  return list.length ? list[0].score : 0;
}

// Returns the 0-based rank the score earned, or -1 if it missed the top 5.
export function submitHighScore(mode, entry) {
  const all = readJSON(KEY_SCORES, {});
  const list = Array.isArray(all[mode]) ? all[mode] : [];
  list.push(entry);
  list.sort((a, b) => b.score - a.score);
  const trimmed = list.slice(0, 5);
  all[mode] = trimmed;
  writeJSON(KEY_SCORES, all);
  return trimmed.indexOf(entry);
}

export function getFlag(name) {
  const flags = readJSON(KEY_FLAGS, {});
  return !!flags[name];
}

export function setFlag(name, value = true) {
  const flags = readJSON(KEY_FLAGS, {});
  flags[name] = value;
  writeJSON(KEY_FLAGS, flags);
}
