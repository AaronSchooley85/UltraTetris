// ============================================================================
// ULTRA TETRIS 3D — static configuration: world scale, pieces, themes,
// power-ups, game modes and scoring tables.
// ============================================================================

// Player = 1.8m tall human. Each tetromino cube = 6m x 6m x 6m (house-sized!)
export const CELL = 6.0;
export const GRID_W = 10; // X: 0..9 (60m wide)
export const GRID_D = 10; // Z: 0..9 (60m deep)
export const GRID_H = 24; // Y: 0..23 (144m vertical grid volume)
export const SPAWN_GY = 18.5; // ~111m up, plenty of time to tag the piece
export const MAX_STACK_GY = 13; // 78m top-out ceiling

export const ARENA_MIN_X = -(GRID_W * CELL) / 2; // -30m
export const ARENA_MIN_Z = -(GRID_D * CELL) / 2; // -30m
export const ARENA_MAX_X = -ARENA_MIN_X;
export const ARENA_MAX_Z = -ARENA_MIN_Z;
export const DECK_DEPTH = 14; // observation deck in front of the arena
export const DECK_MAX_Z = ARENA_MAX_Z + DECK_DEPTH;

export const PLAYER_HEIGHT = 1.8;
export const PLAYER_EYE = 1.64;
export const PLAYER_START = { x: 0, y: 0, z: 36 };

export const LINES_PER_LEVEL = 6;
export const LOCK_DELAY = 0.55;
export const MAX_LOCK_RESETS = 14;

// Cells per second for a given level (gentle exponential curve).
export function fallSpeedForLevel(level) {
  return Math.min(4.2, 0.42 * Math.pow(1.13, level - 1));
}

// --------------------------------------------------------------------------
// TETROMINOES — hand-tuned neon palette with strong hue separation.
// --------------------------------------------------------------------------
export const PIECES = [
  {
    key: 'L',
    name: 'L-HYPER',
    color: 0xff7a1a,
    // Matches the iconic orange L-piece in the reference art
    cells: [[-1, 0, 0], [0, 0, 0], [1, 0, 0], [1, -1, 0]],
  },
  {
    key: 'J',
    name: 'J-SOLAR',
    color: 0xffd21f,
    cells: [[-1, 0, 0], [0, 0, 0], [1, 0, 0], [-1, -1, 0]],
  },
  {
    key: 'I',
    name: 'I-NOVA',
    color: 0x19e8ff,
    cells: [[-1, 0, 0], [0, 0, 0], [1, 0, 0], [2, 0, 0]],
  },
  {
    key: 'T',
    name: 'T-PULSAR',
    color: 0xb04dff,
    cells: [[-1, 0, 0], [0, 0, 0], [1, 0, 0], [0, -1, 0]],
  },
  {
    key: 'O',
    name: 'O-CORE',
    color: 0x3dff6e,
    cells: [[0, 0, 0], [1, 0, 0], [0, 0, 1], [1, 0, 1]],
  },
  {
    key: 'Z',
    name: 'Z-COBALT',
    color: 0x2f6bff,
    cells: [[-1, 0, 0], [0, 0, 0], [0, 0, 1], [1, 0, 1]],
  },
  {
    key: 'S',
    name: 'S-CRIMSON',
    color: 0xff2d6f,
    cells: [[0, 0, 0], [1, 0, 0], [-1, 0, 1], [0, 0, 1]],
  },
  {
    key: 'P',
    name: 'TRIPOD-3D',
    color: 0xe6ecff,
    iridescent: true,
    cells: [[0, 0, 0], [1, 0, 0], [0, 0, 1], [0, 1, 0]],
  },
];

// Single-cube piece created by the NANO CUBE power-up.
export const NANO_PIECE = {
  key: 'N',
  name: 'NANO-CUBE',
  color: 0x48ff9b,
  cells: [[0, 0, 0]],
};

// --------------------------------------------------------------------------
// SECTOR THEMES — the arena, sky and lighting shift every level.
// --------------------------------------------------------------------------
export const THEMES = [
  {
    name: 'NEON GRID',
    primary: 0x00e5ff,
    secondary: 0xff2bd6,
    skyTop: 0x050819,
    skyBottom: 0x14052c,
    nebulaA: 0x2b6bff,
    nebulaB: 0xd13cff,
    fog: 0x070a20,
    sun: 0xff8ad8,
  },
  {
    name: 'SOLAR FLARE',
    primary: 0xffa31a,
    secondary: 0xff2e63,
    skyTop: 0x12050c,
    skyBottom: 0x2c0816,
    nebulaA: 0xff5a00,
    nebulaB: 0xff1f6b,
    fog: 0x16060d,
    sun: 0xffc067,
  },
  {
    name: 'TOXIC BLOOM',
    primary: 0x6dff3a,
    secondary: 0x00d9ff,
    skyTop: 0x03100c,
    skyBottom: 0x05201c,
    nebulaA: 0x17c26a,
    nebulaB: 0x00a6ff,
    fog: 0x04120f,
    sun: 0xb6ff7a,
  },
  {
    name: 'ABYSSAL TIDE',
    primary: 0x00a8ff,
    secondary: 0x7a3cff,
    skyTop: 0x020716,
    skyBottom: 0x070a33,
    nebulaA: 0x0060ff,
    nebulaB: 0x8a3cff,
    fog: 0x030a1c,
    sun: 0x7fc8ff,
  },
  {
    name: 'CRIMSON VOID',
    primary: 0xff2449,
    secondary: 0xffa000,
    skyTop: 0x0f0306,
    skyBottom: 0x26050d,
    nebulaA: 0xc4002b,
    nebulaB: 0xff7a00,
    fog: 0x130407,
    sun: 0xff6a4d,
  },
  {
    name: 'AURORA DRIFT',
    primary: 0x5effc8,
    secondary: 0xb18cff,
    skyTop: 0x030b14,
    skyBottom: 0x0c0a2a,
    nebulaA: 0x19d6a0,
    nebulaB: 0x9a5cff,
    fog: 0x050c18,
    sun: 0xc0ffe8,
  },
  {
    name: 'EVENT HORIZON',
    primary: 0xffd84a,
    secondary: 0xff4fa3,
    skyTop: 0x0c0806,
    skyBottom: 0x22081c,
    nebulaA: 0xffa31a,
    nebulaB: 0xe6338f,
    fog: 0x100808,
    sun: 0xffe7a3,
  },
];

// --------------------------------------------------------------------------
// POWER-UPS
// --------------------------------------------------------------------------
export const POWERUPS = {
  chrono: {
    name: 'CHRONO FIELD',
    color: 0x4fc3ff,
    desc: 'Slows the falling piece to a crawl',
    weight: 18,
    duration: 10,
  },
  nova: {
    name: 'NOVA BOMB',
    color: 0xff8a1f,
    desc: 'Next shot detonates a 3×3×3 blast',
    weight: 17,
    weapon: true,
  },
  laser: {
    name: 'LASER LANCE',
    color: 0xff3355,
    desc: 'Next shot vaporizes a whole row',
    weight: 15,
    weapon: true,
  },
  nano: {
    name: 'NANO CUBE',
    color: 0x48ff9b,
    desc: 'Shrinks the falling piece to one cube',
    weight: 15,
  },
  overdrive: {
    name: 'OVERDRIVE',
    color: 0xffd740,
    desc: '2× score, infinite fuel, turbo flight',
    weight: 14,
    duration: 20,
  },
  quake: {
    name: 'SEISMIC QUAKE',
    color: 0xb46bff,
    desc: 'Collapses every gap in the stack',
    weight: 9,
  },
  oracle: {
    name: 'ORACLE AI',
    color: 0x00f0ff,
    desc: 'Auto-pilots the piece to the best spot',
    weight: 9,
  },
};
export const POWERUP_KEYS = Object.keys(POWERUPS);

export function randomPowerupKey(rng = Math.random) {
  const total = POWERUP_KEYS.reduce((s, k) => s + POWERUPS[k].weight, 0);
  let r = rng() * total;
  for (const k of POWERUP_KEYS) {
    r -= POWERUPS[k].weight;
    if (r <= 0) return k;
  }
  return POWERUP_KEYS[0];
}

// --------------------------------------------------------------------------
// GAME MODES
// --------------------------------------------------------------------------
export const MODES = {
  marathon: {
    name: 'MARATHON',
    tag: 'CLASSIC',
    desc: 'Endless climb through seven sectors. Speed rises every 6 lines.',
    startLevel: 1,
    reference: false,
    timeLimit: 0,
    topOut: true,
    orbInterval: [20, 30],
  },
  sector4: {
    name: 'SECTOR 04',
    tag: 'ORIGINAL',
    desc: 'The original reference formation, dropped straight in at level 4.',
    startLevel: 4,
    reference: true,
    startScore: 4800,
    startLines: 12,
    timeLimit: 0,
    topOut: true,
    orbInterval: [20, 30],
  },
  blitz: {
    name: 'BLITZ',
    tag: '3 MINUTES',
    desc: 'Three minutes on the clock. Power-ups rain down. Score big.',
    startLevel: 3,
    reference: false,
    timeLimit: 180,
    topOut: true,
    orbInterval: [8, 13],
  },
  zen: {
    name: 'ZEN',
    tag: 'RELAX',
    desc: 'No speed-up and no game over. The top layers purge instead.',
    startLevel: 1,
    reference: false,
    timeLimit: 0,
    topOut: false,
    noSpeedup: true,
    orbInterval: [22, 32],
  },
};

// --------------------------------------------------------------------------
// SCORING
// --------------------------------------------------------------------------
export const SCORE = {
  lock: 25,
  hardDropPerCell: 3,
  lineBase: [0, 1000, 3000, 6000, 10000, 15000, 21000, 28000],
  comboStep: 600,
  chainStep: 2500,
  novaPerBlock: 120,
  orbBonusWhenFull: 2500,
};

export const CLEAR_NAMES = ['', 'SINGLE', 'DOUBLE', 'TRIPLE', 'QUAD', 'PENTA', 'HEXA', 'ULTRA'];

export const DEFAULT_SETTINGS = {
  masterVolume: 0.8,
  musicVolume: 0.6,
  sfxVolume: 0.85,
  sensitivity: 1.0,
  invertY: false,
  fov: 74,
  quality: 'high', // high | medium | low
  screenShake: true,
  showHints: true,
};
