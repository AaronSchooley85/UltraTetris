// ============================================================================
// ULTRA TETRIS 3D — House-Scale Blocks, 3D Jetpack & Dual-Beacon Plasma Tether
// ============================================================================

(function () {
  const { THREE, EffectComposer, RenderPass, UnrealBloomPass } = window.__THREE_DEPS__;

  // --------------------------------------------------------------------------
  // WORLD SCALE & CONSTANTS
  // Player = 1.8m tall human. Each Tetromino cube = 6m x 6m x 6m (house-sized!)
  // --------------------------------------------------------------------------
  const CELL_SIZE = 6.0;
  const GRID_W = 10;       // X: 0..9 (60m wide)
  const GRID_D = 10;       // Z: 0..9 (60m deep)
  const GRID_H = 24;       // Y: 0..23 (144m vertical grid volume)
  const SPAWN_GY = 18.5;   // ~111m high in the sky so player has plenty of time!
  const MAX_STACK_GY = 13; // 78m top-out ceiling (stacking above this ends the game)

  const ARENA_MIN_X = -(GRID_W * CELL_SIZE) / 2; // -30m
  const ARENA_MIN_Z = -(GRID_D * CELL_SIZE) / 2; // -30m

  const PLAYER_HEIGHT = 1.8;
  const PLAYER_EYE_HEIGHT = 1.64;

  // Convert grid indices (gx, gy, gz) to world-space center of that 6x6x6 cube
  function gridToWorldCenter(gx, gy, gz) {
    return new THREE.Vector3(
      ARENA_MIN_X + (gx + 0.5) * CELL_SIZE,
      (gy + 0.5) * CELL_SIZE,
      ARENA_MIN_Z + (gz + 0.5) * CELL_SIZE
    );
  }

  function worldToGridXZ(wx, wz) {
    const gx = Math.floor((wx - ARENA_MIN_X) / CELL_SIZE);
    const gz = Math.floor((wz - ARENA_MIN_Z) / CELL_SIZE);
    return {
      gx: Math.max(0, Math.min(GRID_W - 1, gx)),
      gz: Math.max(0, Math.min(GRID_D - 1, gz)),
    };
  }

  // --------------------------------------------------------------------------
  // TETROMINO DEFINITIONS & VIBRANT CYBERPUNK PALETTE
  // --------------------------------------------------------------------------
  const TETROMINO_TYPES = [
    {
      name: 'L-HYPER',
      color: 0xff7b1c,
      emissive: 0xff4500,
      // Matches the iconic orange L-piece in ReferenceImage.jpg & PlayerPerspective.jpg
      cells: [
        [-1, 0, 0],
        [0, 0, 0],
        [1, 0, 0],
        [1, -1, 0],
      ],
    },
    {
      name: 'J-SOLAR',
      color: 0xffcc11,
      emissive: 0xd48800,
      cells: [
        [-1, 0, 0],
        [0, 0, 0],
        [1, 0, 0],
        [-1, -1, 0],
      ],
    },
    {
      name: 'I-NOVA',
      color: 0x00f0ff,
      emissive: 0x0088ff,
      cells: [
        [-1, 0, 0],
        [0, 0, 0],
        [1, 0, 0],
        [2, 0, 0],
      ],
    },
    {
      name: 'T-PULSAR',
      color: 0xd938ff,
      emissive: 0x8a00d4,
      cells: [
        [-1, 0, 0],
        [0, 0, 0],
        [1, 0, 0],
        [0, -1, 0],
      ],
    },
    {
      name: 'O-CORE',
      color: 0x22ff66,
      emissive: 0x00aa33,
      cells: [
        [0, 0, 0],
        [1, 0, 0],
        [0, 0, 1],
        [1, 0, 1],
      ],
    },
    {
      name: 'Z-COBALT',
      color: 0x1e6cff,
      emissive: 0x0036cc,
      cells: [
        [-1, 0, 0],
        [0, 0, 0],
        [0, 0, 1],
        [1, 0, 1],
      ],
    },
    {
      name: 'S-CRIMSON',
      color: 0xff2266,
      emissive: 0xcc0033,
      cells: [
        [0, 0, 0],
        [1, 0, 0],
        [-1, 0, 1],
        [0, 0, 1],
      ],
    },
    {
      name: 'TRIPOD-3D',
      color: 0x00ffaa,
      emissive: 0x009966,
      cells: [
        [0, 0, 0],
        [1, 0, 0],
        [0, 0, 1],
        [0, 1, 0],
      ],
    },
  ];

  // --------------------------------------------------------------------------
  // PROCEDURAL WEBAUDIO SYNTHESIZER (Zero External Assets Required)
  // --------------------------------------------------------------------------
  class SoundEngine {
    constructor() {
      this.ctx = null;
      this.jetpackGain = null;
      this.plasmaGain = null;
    }

    init() {
      if (this.ctx) {
        if (this.ctx.state === 'suspended') this.ctx.resume();
        return;
      }
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      this.ctx = new AudioCtx();

      // Continuous Jetpack thruster synth loop (modulated by thrust)
      const bufferSize = this.ctx.sampleRate * 2;
      const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const output = noiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
      }
      const whiteNoise = this.ctx.createBufferSource();
      whiteNoise.buffer = noiseBuffer;
      whiteNoise.loop = true;

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 260;
      filter.Q.value = 1.8;

      this.jetpackFilter = filter;
      this.jetpackGain = this.ctx.createGain();
      this.jetpackGain.gain.value = 0.0;

      whiteNoise.connect(filter);
      filter.connect(this.jetpackGain);
      this.jetpackGain.connect(this.ctx.destination);
      whiteNoise.start();

      // Continuous Plasma Tether harmonic hum (modulated when both beacons linked)
      const osc1 = this.ctx.createOscillator();
      const osc2 = this.ctx.createOscillator();
      osc1.type = 'sawtooth';
      osc2.type = 'triangle';
      osc1.frequency.value = 110;
      osc2.frequency.value = 165;

      const plasmaFilter = this.ctx.createBiquadFilter();
      plasmaFilter.type = 'lowpass';
      plasmaFilter.frequency.value = 540;

      this.plasmaGain = this.ctx.createGain();
      this.plasmaGain.gain.value = 0.0;

      osc1.connect(plasmaFilter);
      osc2.connect(plasmaFilter);
      plasmaFilter.connect(this.plasmaGain);
      this.plasmaGain.connect(this.ctx.destination);
      osc1.start();
      osc2.start();
      this.plasmaOsc1 = osc1;
      this.plasmaOsc2 = osc2;
    }

    setJetpackIntensity(level, time) {
      if (!this.ctx || !this.jetpackGain) return;
      const clamped = Math.max(0, Math.min(1, level));
      this.jetpackGain.gain.setTargetAtTime(clamped * 0.14, this.ctx.currentTime, 0.05);
      this.jetpackFilter.frequency.setTargetAtTime(180 + clamped * 420 + Math.sin(time * 18) * 25, this.ctx.currentTime, 0.05);
    }

    setPlasmaLinkActive(active, tension = 0) {
      if (!this.ctx || !this.plasmaGain) return;
      const targetGain = active ? 0.09 : 0.0;
      this.plasmaGain.gain.setTargetAtTime(targetGain, this.ctx.currentTime, 0.08);
      if (active && this.plasmaOsc1) {
        this.plasmaOsc1.frequency.setTargetAtTime(110 + tension * 35, this.ctx.currentTime, 0.06);
        this.plasmaOsc2.frequency.setTargetAtTime(220 + tension * 70, this.ctx.currentTime, 0.06);
      }
    }

    playShootBeacon(isSky) {
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      const startFreq = isSky ? 1150 : 780;
      const endFreq = isSky ? 340 : 210;
      osc.frequency.setValueAtTime(startFreq, now);
      osc.frequency.exponentialRampToValueAtTime(endFreq, now + 0.18);

      gain.gain.setValueAtTime(0.22, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.19);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.2);
    }

    playShootTorqueBlast() {
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(520, now);
      osc.frequency.exponentialRampToValueAtTime(130, now + 0.24);

      gain.gain.setValueAtTime(0.24, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.26);
    }

    playTorqueImpact() {
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      const osc1 = this.ctx.createOscillator();
      const gain1 = this.ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(160, now);
      osc1.frequency.exponentialRampToValueAtTime(42, now + 0.48);
      gain1.gain.setValueAtTime(0.32, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
      osc1.connect(gain1);
      gain1.connect(this.ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.52);

      const osc2 = this.ctx.createOscillator();
      const gain2 = this.ctx.createGain();
      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(95, now + 0.05);
      osc2.frequency.linearRampToValueAtTime(145, now + 0.35);
      osc2.frequency.exponentialRampToValueAtTime(65, now + 0.62);
      gain2.gain.setValueAtTime(0.14, now + 0.05);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.64);
      osc2.connect(gain2);
      gain2.connect(this.ctx.destination);
      osc2.start(now + 0.05);
      osc2.stop(now + 0.65);
    }

    playBeaconStick(isSky) {
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      const freqs = isSky ? [587.33, 880, 1174.66] : [440, 659.25, 880];
      freqs.forEach((f, idx) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(f, now + idx * 0.035);
        gain.gain.setValueAtTime(0.12, now + idx * 0.035);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.035 + 0.22);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(now + idx * 0.035);
        osc.stop(now + idx * 0.035 + 0.24);
      });
    }

    playPlasmaEngage() {
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(140, now);
      osc.frequency.exponentialRampToValueAtTime(660, now + 0.28);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.36);
    }

    playHeavyLand() {
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(115, now);
      osc.frequency.exponentialRampToValueAtTime(28, now + 0.45);
      gain.gain.setValueAtTime(0.38, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.48);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.5);
    }

    playLineClear(count) {
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      const chord = [523.25, 659.25, 783.99, 1046.5, 1318.5];
      chord.forEach((f, i) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(f * (1 + (count - 1) * 0.1), now + i * 0.055);
        gain.gain.setValueAtTime(0.18, now + i * 0.055);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.055 + 0.55);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(now + i * 0.055);
        osc.stop(now + i * 0.055 + 0.58);
      });
    }

    playGameOver() {
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      const notes = [392.0, 349.23, 311.13, 261.63];
      notes.forEach((f, i) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(f, now + i * 0.16);
        osc.frequency.exponentialRampToValueAtTime(f * 0.85, now + i * 0.16 + 0.35);
        gain.gain.setValueAtTime(0.18, now + i * 0.16);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.16 + 0.38);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(now + i * 0.16);
        osc.stop(now + i * 0.16 + 0.4);
      });
    }
  }

  const sound = new SoundEngine();

  // --------------------------------------------------------------------------
  // SCENE, CAMERA, RENDERER & BLOOM POST-PROCESSING
  // --------------------------------------------------------------------------
  const container = document.getElementById('game-canvas-container');
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x030511);
  scene.fog = new THREE.FogExp2(0x05081c, 0.0022); // Lighter fog so high-altitude blocks at 111m are crystal clear

  const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 700);

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.18;
  container.appendChild(renderer.domElement);

  const composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.78, // strength
    0.45, // radius
    0.24  // threshold
  );
  composer.addPass(bloomPass);

  // --------------------------------------------------------------------------
  // LIGHTING
  // --------------------------------------------------------------------------
  const ambientLight = new THREE.AmbientLight(0x283c66, 1.35);
  scene.add(ambientLight);

  const hemiLight = new THREE.HemisphereLight(0x70d6ff, 0x2b0938, 1.1);
  hemiLight.position.set(0, 150, 0);
  scene.add(hemiLight);

  const dirLight = new THREE.DirectionalLight(0xfff0dd, 1.8);
  dirLight.position.set(45, 160, 55);
  scene.add(dirLight);

  const backRimLight = new THREE.DirectionalLight(0x00e5ff, 1.0);
  backRimLight.position.set(-45, 80, -65);
  scene.add(backRimLight);

  // --------------------------------------------------------------------------
  // DEEP SPACE COSMOS, NEBULA & STARFIELD (Matching Reference Images)
  // --------------------------------------------------------------------------
  function createCosmosEnvironment() {
    const cosmosGroup = new THREE.Group();

    // 1. Multi-color Starfield
    const starCount = 3200;
    const starPositions = new Float32Array(starCount * 3);
    const starColors = new Float32Array(starCount * 3);

    const palette = [
      new THREE.Color(0xffffff),
      new THREE.Color(0x9beeff),
      new THREE.Color(0xffbe76),
      new THREE.Color(0xd980fa),
      new THREE.Color(0x70a1ff),
    ];

    for (let i = 0; i < starCount; i++) {
      const r = 180 + Math.random() * 280;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      starPositions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      starPositions[i * 3 + 1] = Math.abs(r * Math.cos(phi)) * 0.85 - 25;
      starPositions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);

      const c = palette[Math.floor(Math.random() * palette.length)];
      starColors[i * 3] = c.r;
      starColors[i * 3 + 1] = c.g;
      starColors[i * 3 + 2] = c.b;
    }

    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    starGeo.setAttribute('color', new THREE.BufferAttribute(starColors, 3));

    const starMat = new THREE.PointsMaterial({
      size: 1.35,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    cosmosGroup.add(new THREE.Points(starGeo, starMat));

    // 2. Distant Galaxy / Nebula cluster in upper-right sky
    const nebulaCount = 160;
    const nebGeo = new THREE.BufferGeometry();
    const nebPos = new Float32Array(nebulaCount * 3);
    const nebCol = new Float32Array(nebulaCount * 3);
    for (let i = 0; i < nebulaCount; i++) {
      const spread = Math.pow(Math.random(), 1.5) * 45;
      const angle = Math.random() * Math.PI * 2;
      nebPos[i * 3] = 95 + Math.cos(angle) * spread * 1.4;
      nebPos[i * 3 + 1] = 105 + Math.sin(angle) * spread * 0.7;
      nebPos[i * 3 + 2] = -140 + (Math.random() - 0.5) * 30;

      const c = i % 2 === 0 ? new THREE.Color(0xffaaee) : new THREE.Color(0x88ccff);
      nebCol[i * 3] = c.r;
      nebCol[i * 3 + 1] = c.g;
      nebCol[i * 3 + 2] = c.b;
    }
    nebGeo.setAttribute('position', new THREE.BufferAttribute(nebPos, 3));
    nebGeo.setAttribute('color', new THREE.BufferAttribute(nebCol, 3));
    const nebMat = new THREE.PointsMaterial({
      size: 4.2,
      vertexColors: true,
      transparent: true,
      opacity: 0.45,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    cosmosGroup.add(new THREE.Points(nebGeo, nebMat));

    scene.add(cosmosGroup);
  }
  createCosmosEnvironment();

  // --------------------------------------------------------------------------
  // BEVELED GLOSSY BLOCK TEXTURE GENERATOR
  // --------------------------------------------------------------------------
  function createBlockPanelTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');

    const grad = ctx.createLinearGradient(0, 0, 256, 256);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.5, '#d8d8d8');
    grad.addColorStop(1, '#999999');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 256);

    ctx.strokeStyle = '#333333';
    ctx.lineWidth = 10;
    ctx.strokeRect(18, 18, 220, 220);

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 4;
    ctx.strokeRect(24, 24, 208, 208);

    const innerGrad = ctx.createRadialGradient(128, 128, 10, 128, 128, 130);
    innerGrad.addColorStop(0, '#ffffff');
    innerGrad.addColorStop(1, '#bbbbbb');
    ctx.fillStyle = innerGrad;
    ctx.fillRect(28, 28, 200, 200);

    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(128, 28);
    ctx.lineTo(128, 228);
    ctx.moveTo(28, 128);
    ctx.lineTo(228, 128);
    ctx.stroke();

    const tex = new THREE.CanvasTexture(canvas);
    tex.anisotropy = 4;
    return tex;
  }

  const blockPanelTexture = createBlockPanelTexture();
  const unitBlockGeo = new THREE.BoxGeometry(CELL_SIZE * 0.97, CELL_SIZE * 0.97, CELL_SIZE * 0.97);
  const unitEdgeGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(CELL_SIZE * 0.975, CELL_SIZE * 0.975, CELL_SIZE * 0.975));

  function createHouseBlockMesh(colorHex, emissiveHex, metadata = {}) {
    const group = new THREE.Group();

    const mat = new THREE.MeshStandardMaterial({
      color: colorHex,
      emissive: emissiveHex,
      emissiveIntensity: 0.38,
      map: blockPanelTexture,
      roughness: 0.18,
      metalness: 0.25,
    });

    const mesh = new THREE.Mesh(unitBlockGeo, mat);
    mesh.userData = { ...metadata };
    group.add(mesh);

    const edgeMat = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
    });
    const edges = new THREE.LineSegments(unitEdgeGeo, edgeMat);
    group.add(edges);

    group.userData = { mesh, mat, edgeMat, ...metadata };
    return group;
  }

  // --------------------------------------------------------------------------
  // NEON SYNTHWAVE ARENA (10x10 Floor Grid + Glowing Side Walls + Ceiling Limit Line)
  // --------------------------------------------------------------------------
  const floorTileMeshes = [];
  const arenaGroup = new THREE.Group();
  scene.add(arenaGroup);

  function buildNeonArena() {
    const totalW = GRID_W * CELL_SIZE; // 60m
    const totalD = GRID_D * CELL_SIZE; // 60m
    const wallH = 6 * CELL_SIZE;       // 36m side walls

    const baseGeo = new THREE.PlaneGeometry(totalW + 0.6, totalD + 0.6);
    const baseMat = new THREE.MeshStandardMaterial({
      color: 0x05091a,
      roughness: 0.15,
      metalness: 0.75,
    });
    const baseMesh = new THREE.Mesh(baseGeo, baseMat);
    baseMesh.rotation.x = -Math.PI / 2;
    baseMesh.position.y = -0.05;
    arenaGroup.add(baseMesh);

    const tileGeo = new THREE.PlaneGeometry(CELL_SIZE * 0.94, CELL_SIZE * 0.94);
    for (let gx = 0; gx < GRID_W; gx++) {
      for (let gz = 0; gz < GRID_D; gz++) {
        const tX = gx / (GRID_W - 1);
        const tZ = gz / (GRID_D - 1);
        const tileColor = new THREE.Color().lerpColors(
          new THREE.Color(0x00e5ff),
          new THREE.Color(0xd400ff),
          tX * 0.65 + (1 - tZ) * 0.35
        );

        const tileMat = new THREE.MeshBasicMaterial({
          color: tileColor,
          transparent: true,
          opacity: 0.11,
          side: THREE.DoubleSide,
        });

        const tile = new THREE.Mesh(tileGeo, tileMat);
        tile.rotation.x = -Math.PI / 2;
        tile.position.set(
          ARENA_MIN_X + (gx + 0.5) * CELL_SIZE,
          0.02,
          ARENA_MIN_Z + (gz + 0.5) * CELL_SIZE
        );
        tile.userData = {
          isFloorTile: true,
          gx,
          gy: -1,
          gz,
          baseOpacity: 0.11,
        };
        arenaGroup.add(tile);
        floorTileMeshes.push(tile);
      }
    }

    const linePositions = [];
    const lineColors = [];
    const cCyan = new THREE.Color(0x00f7ff);
    const cMagenta = new THREE.Color(0xff00e6);
    const cDanger = new THREE.Color(0xff2255);

    function pushColoredSegment(x1, y1, z1, x2, y2, z2, c1, c2) {
      linePositions.push(x1, y1, z1, x2, y2, z2);
      lineColors.push(c1.r, c1.g, c1.b, c2.r, c2.g, c2.b);
    }

    // Floor X lines
    for (let i = 0; i <= GRID_W; i++) {
      const x = ARENA_MIN_X + i * CELL_SIZE;
      const col = cCyan.clone().lerp(cMagenta, i / GRID_W);
      pushColoredSegment(x, 0.05, ARENA_MIN_Z, x, 0.05, -ARENA_MIN_Z, col, col);
    }
    // Floor Z lines
    for (let k = 0; k <= GRID_D; k++) {
      const z = ARENA_MIN_Z + k * CELL_SIZE;
      pushColoredSegment(ARENA_MIN_X, 0.05, z, -ARENA_MIN_X, 0.05, z, cCyan, cMagenta);
    }

    // Subtle Red/Magenta Top-Out Danger Perimeter Laser at MAX_STACK_GY * CELL_SIZE (78m)
    const limitY = MAX_STACK_GY * CELL_SIZE;
    pushColoredSegment(ARENA_MIN_X, limitY, ARENA_MIN_Z, -ARENA_MIN_X, limitY, ARENA_MIN_Z, cDanger, cDanger);
    pushColoredSegment(-ARENA_MIN_X, limitY, ARENA_MIN_Z, -ARENA_MIN_X, limitY, -ARENA_MIN_Z, cDanger, cDanger);
    pushColoredSegment(-ARENA_MIN_X, limitY, -ARENA_MIN_Z, ARENA_MIN_X, limitY, -ARENA_MIN_Z, cDanger, cDanger);
    pushColoredSegment(ARENA_MIN_X, limitY, -ARENA_MIN_Z, ARENA_MIN_X, limitY, ARENA_MIN_Z, cDanger, cDanger);

    // Left & Right Glowing Side Walls
    const wallCellsH = 6;
    const wallThickness = CELL_SIZE * 0.55;
    [-1, 1].forEach((side) => {
      const innerX = side * (totalW / 2);
      const outerX = side * (totalW / 2 + wallThickness);
      const wallCol = side < 0 ? cCyan : new THREE.Color(0x7066ff);

      const wallBoxGeo = new THREE.BoxGeometry(wallThickness, wallH, totalD);
      const wallBoxMat = new THREE.MeshPhysicalMaterial({
        color: side < 0 ? 0x004477 : 0x331166,
        emissive: side < 0 ? 0x0088cc : 0x6600cc,
        emissiveIntensity: 0.22,
        transparent: true,
        opacity: 0.24,
        roughness: 0.1,
      });
      const wallMesh = new THREE.Mesh(wallBoxGeo, wallBoxMat);
      wallMesh.position.set(side * (totalW / 2 + wallThickness / 2), wallH / 2, 0);
      arenaGroup.add(wallMesh);

      for (let yIdx = 0; yIdx <= wallCellsH; yIdx++) {
        const y = yIdx * CELL_SIZE;
        pushColoredSegment(innerX, y, ARENA_MIN_Z, innerX, y, -ARENA_MIN_Z, cCyan, cMagenta);
        pushColoredSegment(outerX, y, ARENA_MIN_Z, outerX, y, -ARENA_MIN_Z, wallCol, cMagenta);
      }
      for (let zIdx = 0; zIdx <= GRID_D; zIdx++) {
        const z = ARENA_MIN_Z + zIdx * CELL_SIZE;
        const zCol = cCyan.clone().lerp(cMagenta, zIdx / GRID_D);
        pushColoredSegment(innerX, 0, z, innerX, wallH, z, zCol, cCyan);
        pushColoredSegment(outerX, 0, z, outerX, wallH, z, zCol, cCyan);
        pushColoredSegment(innerX, wallH, z, outerX, wallH, z, cCyan, cCyan);
      }
    });

    const gridLineGeo = new THREE.BufferGeometry();
    gridLineGeo.setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3));
    gridLineGeo.setAttribute('color', new THREE.Float32BufferAttribute(lineColors, 3));
    const gridLineMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
    });
    arenaGroup.add(new THREE.LineSegments(gridLineGeo, gridLineMat));
  }
  buildNeonArena();

  // --------------------------------------------------------------------------
  // FLOATING 3D HOLOGRAPHIC SCORE / NEXT / LEVEL BILLBOARDS IN SPACE
  // --------------------------------------------------------------------------
  let holoScoreCtx = null;
  let holoScoreTex = null;
  let holoLevelCtx = null;
  let holoLevelTex = null;
  const nextPiecePreviewGroup = new THREE.Group();

  function buildFloating3DHolograms() {
    function createHoloPanel(widthWorld, heightWorld, pos) {
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 256;
      const ctx = canvas.getContext('2d');
      const tex = new THREE.CanvasTexture(canvas);

      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(widthWorld, heightWorld), mat);
      mesh.position.copy(pos);
      scene.add(mesh);
      return { ctx, tex, mesh };
    }

    const scoreHolo = createHoloPanel(24, 12, new THREE.Vector3(-48, 36, -12));
    scoreHolo.mesh.rotation.y = 0.22;
    holoScoreCtx = scoreHolo.ctx;
    holoScoreTex = scoreHolo.tex;

    const levelHolo = createHoloPanel(22, 11, new THREE.Vector3(48, 28, -4));
    levelHolo.mesh.rotation.y = -0.22;
    holoLevelCtx = levelHolo.ctx;
    holoLevelTex = levelHolo.tex;

    const nextHolo = createHoloPanel(22, 11, new THREE.Vector3(48, 42, -14));
    nextHolo.mesh.rotation.y = -0.22;
    const nctx = nextHolo.ctx;
    nctx.clearRect(0, 0, 512, 256);
    drawHoloBrackets(nctx, 'NEXT');
    nextHolo.tex.needsUpdate = true;

    nextPiecePreviewGroup.position.set(47, 41, -12.5);
    nextPiecePreviewGroup.rotation.set(0.35, -0.35, 0);
    scene.add(nextPiecePreviewGroup);
  }

  function drawHoloBrackets(ctx, title, bigValue = '') {
    ctx.clearRect(0, 0, 512, 256);
    ctx.strokeStyle = '#00f3ff';
    ctx.shadowColor = '#00f3ff';
    ctx.shadowBlur = 16;
    ctx.lineWidth = 5;

    ctx.beginPath();
    ctx.moveTo(70, 40);
    ctx.lineTo(30, 40);
    ctx.lineTo(30, 216);
    ctx.lineTo(70, 216);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(442, 40);
    ctx.lineTo(482, 40);
    ctx.lineTo(482, 216);
    ctx.lineTo(442, 216);
    ctx.stroke();

    ctx.fillStyle = '#8ef6ff';
    ctx.font = 'bold 38px Orbitron, Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(title, 256, 92);

    if (bigValue) {
      ctx.fillStyle = '#c8ff80';
      ctx.font = '900 78px Orbitron, Segoe UI, sans-serif';
      ctx.fillText(bigValue, 256, 185);
    }
  }

  function updateFloating3DHolograms(score, level, nextType) {
    if (holoScoreCtx && holoScoreTex) {
      drawHoloBrackets(holoScoreCtx, 'SCORE', score.toLocaleString());
      holoScoreTex.needsUpdate = true;
    }
    if (holoLevelCtx && holoLevelTex) {
      drawHoloBrackets(holoLevelCtx, 'LEVEL', String(level).padStart(2, '0'));
      holoLevelTex.needsUpdate = true;
    }
    if (nextType) {
      while (nextPiecePreviewGroup.children.length > 0) {
        nextPiecePreviewGroup.remove(nextPiecePreviewGroup.children[0]);
      }
      const miniScale = 0.34;
      nextType.cells.forEach(([cx, cy, cz]) => {
        const b = createHouseBlockMesh(nextType.color, nextType.emissive);
        b.scale.setScalar(miniScale);
        b.position.set(cx * CELL_SIZE * miniScale, cy * CELL_SIZE * miniScale, cz * CELL_SIZE * miniScale);
        nextPiecePreviewGroup.add(b);
      });
    }
  }

  buildFloating3DHolograms();

  // --------------------------------------------------------------------------
  // GAME STATE: PLACED BLOCKS GRID [gx][gy][gz] & GAME OVER STATE
  // --------------------------------------------------------------------------
  const placedGrid = Array.from({ length: GRID_W }, () =>
    Array.from({ length: GRID_H }, () => Array(GRID_D).fill(null))
  );
  const placedBlocksGroup = new THREE.Group();
  scene.add(placedBlocksGroup);

  let score = 4800;
  let level = 4;
  let linesCleared = 12;
  let gameRunning = false;
  let isGameOver = false;

  function clearAllPlacedBlocks() {
    for (let x = 0; x < GRID_W; x++) {
      for (let y = 0; y < GRID_H; y++) {
        for (let z = 0; z < GRID_D; z++) {
          if (placedGrid[x][y][z]) {
            placedBlocksGroup.remove(placedGrid[x][y][z].group);
            placedGrid[x][y][z] = null;
          }
        }
      }
    }
  }

  function placeSingleBlockCell(gx, gy, gz, colorHex, emissiveHex) {
    if (gx < 0 || gx >= GRID_W || gy < 0 || gy >= GRID_H || gz < 0 || gz >= GRID_D) return;
    if (placedGrid[gx][gy][gz]) {
      placedBlocksGroup.remove(placedGrid[gx][gy][gz].group);
    }
    const group = createHouseBlockMesh(colorHex, emissiveHex, {
      isPlacedBlock: true,
      gx,
      gy,
      gz,
    });
    group.position.copy(gridToWorldCenter(gx, gy, gz));
    placedBlocksGroup.add(group);
    placedGrid[gx][gy][gz] = { group, color: colorHex, emissive: emissiveHex };
  }

  function populateReferenceFormation() {
    clearAllPlacedBlocks();

    const yellow = { c: 0xffcc11, e: 0xd48800 };
    const blue = { c: 0x1e6cff, e: 0x0036cc };
    const green = { c: 0x22ff66, e: 0x00aa33 };

    const yellowCoords = [
      [1, 0, 3], [2, 0, 3], [3, 0, 3], [4, 0, 3],
      [1, 0, 4], [2, 0, 4],
      [1, 1, 3], [2, 1, 3],
      [1, 1, 4], [2, 1, 4],
      [1, 2, 3], [2, 2, 3],
    ];
    yellowCoords.forEach(([x, y, z]) => placeSingleBlockCell(x, y, z, yellow.c, yellow.e));

    const blueCoords = [
      [5, 0, 3], [6, 0, 3],
      [5, 0, 4], [6, 0, 4],
      [6, 1, 3], [6, 1, 4],
    ];
    blueCoords.forEach(([x, y, z]) => placeSingleBlockCell(x, y, z, blue.c, blue.e));

    const greenCoords = [
      [7, 0, 3], [8, 0, 3],
      [7, 0, 4], [8, 0, 4],
      [7, 1, 3], [8, 1, 3],
      [7, 1, 4], [8, 1, 4],
      [7, 2, 3], [7, 2, 4],
    ];
    greenCoords.forEach(([x, y, z]) => placeSingleBlockCell(x, y, z, green.c, green.e));
  }

  // --------------------------------------------------------------------------
  // FALLING TETROMINO PIECE & END-GAME DETECTION
  // --------------------------------------------------------------------------
  const fallingPieceGroup = new THREE.Group();
  scene.add(fallingPieceGroup);

  const ghostPieceGroup = new THREE.Group();
  scene.add(ghostPieceGroup);

  let currentPiece = null;
  let nextPieceType = TETROMINO_TYPES[1];

  function canPieceOccupy(cells, gx, gy, gz) {
    for (let i = 0; i < cells.length; i++) {
      const cx = gx + cells[i][0];
      const cy = gy + cells[i][1];
      const cz = gz + cells[i][2];
      if (cx < 0 || cx >= GRID_W || cz < 0 || cz >= GRID_D || cy < 0) {
        return false;
      }
      if (cy < GRID_H && placedGrid[cx][cy][cz] !== null) {
        return false;
      }
    }
    return true;
  }

  function computeDropY(cells, gx, startGy, gz) {
    let gy = Math.floor(startGy);
    while (canPieceOccupy(cells, gx, gy - 1, gz)) {
      gy--;
    }
    return gy;
  }

  function triggerGameOver() {
    isGameOver = true;
    gameRunning = false;
    currentPiece = null;

    while (fallingPieceGroup.children.length > 0) {
      fallingPieceGroup.remove(fallingPieceGroup.children[0]);
    }
    while (ghostPieceGroup.children.length > 0) {
      ghostPieceGroup.remove(ghostPieceGroup.children[0]);
    }
    clearBeacons();
    sound.setJetpackIntensity(0, 0);
    sound.setPlasmaLinkActive(false);
    sound.playGameOver();

    showBanner('GAME OVER // STACK OVERFLOW', `FINAL SCORE: ${score.toLocaleString()}`);

    const titleEl = document.getElementById('modal-title');
    const subEl = document.getElementById('modal-subtitle');
    if (titleEl) titleEl.textContent = 'GAME OVER // STACK OVERFLOW';
    if (subEl) {
      subEl.textContent = `FINAL SCORE: ${score.toLocaleString()} • LEVEL ${String(level).padStart(2, '0')} • ${linesCleared} LINES CLEARED`;
    }

    const modal = document.getElementById('modal-overlay');
    if (modal) modal.classList.remove('hidden');

    if (document.pointerLockElement) {
      document.exitPointerLock();
    }
  }

  function spawnFallingPiece(forcedType = null) {
    if (isGameOver) return;

    while (fallingPieceGroup.children.length > 0) {
      fallingPieceGroup.remove(fallingPieceGroup.children[0]);
    }
    while (ghostPieceGroup.children.length > 0) {
      ghostPieceGroup.remove(ghostPieceGroup.children[0]);
    }

    clearBeacons();

    const type = forcedType || nextPieceType;
    nextPieceType = TETROMINO_TYPES[Math.floor(Math.random() * TETROMINO_TYPES.length)];

    const cells = type.cells.map((c) => [...c]);
    const spawnGx = 4;
    const spawnGz = 3;
    const spawnGy = SPAWN_GY; // ~111m high in the sky!

    // End-Game Check: if spawn zone is blocked or landingGy is at/above the top-out limit
    const spawnFloorGy = Math.floor(spawnGy);
    if (!canPieceOccupy(cells, spawnGx, spawnFloorGy, spawnGz)) {
      triggerGameOver();
      return;
    }
    const initialLandingGy = computeDropY(cells, spawnGx, spawnFloorGy, spawnGz);
    if (initialLandingGy >= MAX_STACK_GY) {
      triggerGameOver();
      return;
    }

    const segmentGroups = [];
    const ghostMeshes = [];

    cells.forEach((offset, index) => {
      const segGroup = createHouseBlockMesh(type.color, type.emissive, {
        isFallingSegment: true,
        segmentIndex: index,
      });

      fallingPieceGroup.add(segGroup);
      segmentGroups.push(segGroup);

      const ghostGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(CELL_SIZE * 0.96, CELL_SIZE * 0.96, CELL_SIZE * 0.96));
      const ghostMat = new THREE.LineBasicMaterial({
        color: type.color,
        transparent: true,
        opacity: 0.36,
        blending: THREE.AdditiveBlending,
      });
      const ghostWire = new THREE.LineSegments(ghostGeo, ghostMat);
      ghostPieceGroup.add(ghostWire);
      ghostMeshes.push(ghostWire);
    });

    currentPiece = {
      type,
      cells,
      gx: spawnGx,
      gz: spawnGz,
      gyFloat: spawnGy,
      visualX: spawnGx,
      visualZ: spawnGz,
      segmentGroups,
      ghostMeshes,
      fallSpeed: 0.40 + level * 0.032,
      warpDropping: false,
      alignCooldown: 0,
      rotRemainingAngle: 0,
      rotAngVel: 0,
      rotAxis3D: new THREE.Vector3(0, 1, 0),
      rotPivotCell: [0, 0, 0],
    };

    updateFallingPieceVisuals(0);
    updateHUD();
    updateFloating3DHolograms(score, level, nextPieceType);
  }

  function updateFallingPieceVisuals(dt) {
    if (!currentPiece) return;

    const lerpSpeed = Math.min(1, dt * 8.5);
    currentPiece.visualX += (currentPiece.gx - currentPiece.visualX) * (dt > 0 ? lerpSpeed : 1);
    currentPiece.visualZ += (currentPiece.gz - currentPiece.visualZ) * (dt > 0 ? lerpSpeed : 1);

    if (
      dt > 0 &&
      (Math.abs(currentPiece.rotRemainingAngle) > 0.0008 || Math.abs(currentPiece.rotAngVel) > 0.0008)
    ) {
      const stiffness = 36.0;
      const damping = 8.4;
      const angAccel = -stiffness * currentPiece.rotRemainingAngle - damping * currentPiece.rotAngVel;
      currentPiece.rotAngVel += angAccel * dt;
      currentPiece.rotRemainingAngle += currentPiece.rotAngVel * dt;

      if (
        Math.abs(currentPiece.rotRemainingAngle) < 0.001 &&
        Math.abs(currentPiece.rotAngVel) < 0.008
      ) {
        currentPiece.rotRemainingAngle = 0;
        currentPiece.rotAngVel = 0;
      }
    }

    const qOffset = new THREE.Quaternion();
    if (Math.abs(currentPiece.rotRemainingAngle) > 0.0005) {
      qOffset.setFromAxisAngle(currentPiece.rotAxis3D, -currentPiece.rotRemainingAngle);
    }

    const [px, py, pz] = currentPiece.rotPivotCell;

    const dropGy = computeDropY(
      currentPiece.cells,
      currentPiece.gx,
      Math.ceil(currentPiece.gyFloat),
      currentPiece.gz
    );

    currentPiece.cells.forEach(([ox, oy, oz], idx) => {
      const relVec = new THREE.Vector3(ox - px, oy - py, oz - pz);
      relVec.applyQuaternion(qOffset);

      const wx = ARENA_MIN_X + (currentPiece.visualX + px + relVec.x + 0.5) * CELL_SIZE;
      const wy = (currentPiece.gyFloat + py + relVec.y + 0.5) * CELL_SIZE;
      const wz = ARENA_MIN_Z + (currentPiece.visualZ + pz + relVec.z + 0.5) * CELL_SIZE;

      const segGroup = currentPiece.segmentGroups[idx];
      segGroup.position.set(wx, wy, wz);
      segGroup.quaternion.copy(qOffset);

      const gPos = gridToWorldCenter(currentPiece.gx + ox, dropGy + oy, currentPiece.gz + oz);
      currentPiece.ghostMeshes[idx].position.copy(gPos);
    });
  }

  function applyInertialRotationToFallingPiece(axis = 'y', dir = 1, hitSegmentIdx = -1) {
    if (!currentPiece) return;

    const pivotIdx = skyBeacon.active
      ? skyBeacon.segmentIndex
      : hitSegmentIdx >= 0
      ? hitSegmentIdx
      : 1;
    const pivot = [...(currentPiece.cells[pivotIdx] || [0, 0, 0])];

    const rotatedCells = currentPiece.cells.map(([x, y, z]) => {
      const rx = x - pivot[0];
      const ry = y - pivot[1];
      const rz = z - pivot[2];
      let nx = rx, ny = ry, nz = rz;
      if (axis === 'y') {
        nx = -rz * dir;
        nz = rx * dir;
      } else if (axis === 'x') {
        ny = -rz * dir;
        nz = ry * dir;
      } else if (axis === 'z') {
        nx = -ry * dir;
        ny = rx * dir;
      }
      return [nx + pivot[0], ny + pivot[1], nz + pivot[2]];
    });

    const testGy = Math.floor(currentPiece.gyFloat);
    const kicks = [
      [0, 0],
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [2, 0],
      [-2, 0],
    ];

    for (const [kx, kz] of kicks) {
      if (canPieceOccupy(rotatedCells, currentPiece.gx + kx, testGy, currentPiece.gz + kz)) {
        currentPiece.cells = rotatedCells;
        currentPiece.gx += kx;
        currentPiece.gz += kz;

        if (axis === 'y') {
          currentPiece.rotAxis3D.set(0, -dir, 0);
        } else if (axis === 'x') {
          currentPiece.rotAxis3D.set(dir, 0, 0);
        } else {
          currentPiece.rotAxis3D.set(0, 0, dir);
        }
        currentPiece.rotPivotCell = pivot;
        currentPiece.rotRemainingAngle = Math.PI / 2;
        currentPiece.rotAngVel = -1.65;

        sound.playTorqueImpact();
        updateFallingPieceVisuals(0);
        return;
      }
    }
  }

  // --------------------------------------------------------------------------
  // DUAL-BEACON LAUNCHER, KINETIC ROTATION BLAST & PLASMA BEAM ALIGNMENT
  // --------------------------------------------------------------------------
  const skyBeacon = {
    active: false,
    segmentIndex: -1,
    meshGroup: null,
  };

  const groundBeacon = {
    active: false,
    gx: -1,
    gy: -1,
    gz: -1,
    worldPos: new THREE.Vector3(),
    meshGroup: null,
  };

  const activeProjectiles = [];
  const impactBursts = [];

  function createBeaconEmitterMesh(isSky) {
    const group = new THREE.Group();
    const mainColor = isSky ? 0xffae2b : 0x00f7ff;
    const coreColor = 0xffffff;

    const baseGeo = new THREE.CylinderGeometry(0.95, 1.25, 0.36, 24);
    const baseMat = new THREE.MeshStandardMaterial({
      color: mainColor,
      emissive: mainColor,
      emissiveIntensity: 1.5,
      roughness: 0.2,
      metalness: 0.8,
    });
    const baseMesh = new THREE.Mesh(baseGeo, baseMat);
    group.add(baseMesh);

    const domeGeo = new THREE.SphereGeometry(0.62, 20, 20);
    const domeMat = new THREE.MeshBasicMaterial({
      color: coreColor,
    });
    const dome = new THREE.Mesh(domeGeo, domeMat);
    dome.position.y = 0.25;
    group.add(dome);

    const ringGeo = new THREE.RingGeometry(1.15, 1.45, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: mainColor,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.22;
    group.add(ring);

    const light = new THREE.PointLight(mainColor, 3.5, 26);
    light.position.y = 1.2;
    group.add(light);

    group.userData = { ring, dome, light };
    scene.add(group);
    group.visible = false;
    return group;
  }

  skyBeacon.meshGroup = createBeaconEmitterMesh(true);
  skyBeacon.meshGroup.rotation.x = Math.PI;
  groundBeacon.meshGroup = createBeaconEmitterMesh(false);

  const plasmaBeamGroup = new THREE.Group();
  scene.add(plasmaBeamGroup);
  plasmaBeamGroup.visible = false;

  const PLASMA_SEGMENTS = 44;
  const plasmaCoreMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.95,
    blending: THREE.AdditiveBlending,
  });
  const plasmaOuterMat = new THREE.MeshBasicMaterial({
    color: 0x00f7ff,
    transparent: true,
    opacity: 0.45,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  const plasmaCoreMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 1, 16, 1, true), plasmaCoreMat);
  const plasmaOuterMesh = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.15, 1, 20, 1, true), plasmaOuterMat);
  plasmaBeamGroup.add(plasmaCoreMesh);
  plasmaBeamGroup.add(plasmaOuterMesh);

  const plasmaStrands = [];
  const strandColors = [0x00f7ff, 0xffaa2b, 0xff2be2];
  for (let s = 0; s < 3; s++) {
    const positions = new Float32Array((PLASMA_SEGMENTS + 1) * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.LineBasicMaterial({
      color: strandColors[s],
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
    });
    const line = new THREE.Line(geo, mat);
    plasmaBeamGroup.add(line);
    plasmaStrands.push({ line, positions, phaseOffset: (s * Math.PI * 2) / 3 });
  }

  const plasmaRings = [];
  for (let r = 0; r < 5; r++) {
    const rGeo = new THREE.TorusGeometry(1.35, 0.11, 12, 28);
    const rMat = new THREE.MeshBasicMaterial({
      color: r % 2 === 0 ? 0x00f7ff : 0xffbe3b,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
    });
    const rMesh = new THREE.Mesh(rGeo, rMat);
    rMesh.rotation.x = Math.PI / 2;
    plasmaBeamGroup.add(rMesh);
    plasmaRings.push({ mesh: rMesh, offset: r / 5 });
  }

  function clearBeacons() {
    skyBeacon.active = false;
    skyBeacon.segmentIndex = -1;
    skyBeacon.meshGroup.visible = false;

    groundBeacon.active = false;
    groundBeacon.gx = -1;
    groundBeacon.gy = -1;
    groundBeacon.gz = -1;
    groundBeacon.meshGroup.visible = false;

    plasmaBeamGroup.visible = false;
    sound.setPlasmaLinkActive(false);
    updateHUD();
  }

  function getSkyBeaconWorldPos() {
    if (!skyBeacon.active || !currentPiece) return null;
    const seg = currentPiece.segmentGroups[skyBeacon.segmentIndex];
    if (!seg) return null;
    return new THREE.Vector3(
      seg.position.x,
      seg.position.y - CELL_SIZE * 0.49,
      seg.position.z
    );
  }

  function attachSkyBeacon(segmentIndex) {
    const wasLinked = skyBeacon.active && groundBeacon.active;
    skyBeacon.active = true;
    skyBeacon.segmentIndex = segmentIndex;
    skyBeacon.meshGroup.visible = true;
    sound.playBeaconStick(true);

    if (groundBeacon.active && !wasLinked) {
      sound.playPlasmaEngage();
      showBanner('PLASMA TETHER ENGAGED', 'ALIGNING BEACONS VERTICALLY');
    }
    updateHUD();
  }

  function attachGroundBeacon(gx, gy, gz) {
    const wasLinked = skyBeacon.active && groundBeacon.active;
    groundBeacon.active = true;
    groundBeacon.gx = gx;
    groundBeacon.gy = gy;
    groundBeacon.gz = gz;

    let topY = 0;
    if (gy >= 0) {
      topY = (gy + 1) * CELL_SIZE;
    } else {
      topY = 0.05;
    }

    groundBeacon.worldPos.set(
      ARENA_MIN_X + (gx + 0.5) * CELL_SIZE,
      topY,
      ARENA_MIN_Z + (gz + 0.5) * CELL_SIZE
    );
    groundBeacon.meshGroup.position.copy(groundBeacon.worldPos);
    groundBeacon.meshGroup.visible = true;
    sound.playBeaconStick(false);

    if (skyBeacon.active && !wasLinked) {
      sound.playPlasmaEngage();
      showBanner('PLASMA TETHER ENGAGED', 'ALIGNING BEACONS VERTICALLY');
    }
    updateHUD();
  }

  function updateBeaconsAndPlasmaBeam(dt, elapsedTime) {
    const skyPos = getSkyBeaconWorldPos();
    if (skyBeacon.active && skyPos) {
      skyBeacon.meshGroup.position.copy(skyPos);
      const pulse = 1 + Math.sin(elapsedTime * 10) * 0.18;
      skyBeacon.meshGroup.userData.ring.scale.setScalar(pulse);
    }

    if (groundBeacon.active) {
      const pulse = 1 + Math.cos(elapsedTime * 10) * 0.18;
      groundBeacon.meshGroup.userData.ring.scale.setScalar(pulse);
    }

    if (skyBeacon.active && groundBeacon.active && currentPiece && skyPos) {
      plasmaBeamGroup.visible = true;

      const startPos = groundBeacon.worldPos;
      const endPos = skyPos;

      const segOffset = currentPiece.cells[skyBeacon.segmentIndex];
      if (segOffset) {
        const targetGx = groundBeacon.gx - segOffset[0];
        const targetGz = groundBeacon.gz - segOffset[2];

        currentPiece.alignCooldown -= dt;
        if (
          currentPiece.alignCooldown <= 0 &&
          (currentPiece.gx !== targetGx || currentPiece.gz !== targetGz)
        ) {
          const stepX = Math.sign(targetGx - currentPiece.gx);
          const stepZ = Math.sign(targetGz - currentPiece.gz);
          const testGy = Math.floor(currentPiece.gyFloat);

          let moved = false;
          if (
            stepX !== 0 &&
            stepZ !== 0 &&
            canPieceOccupy(currentPiece.cells, currentPiece.gx + stepX, testGy, currentPiece.gz + stepZ)
          ) {
            currentPiece.gx += stepX;
            currentPiece.gz += stepZ;
            moved = true;
          } else if (
            stepX !== 0 &&
            canPieceOccupy(currentPiece.cells, currentPiece.gx + stepX, testGy, currentPiece.gz)
          ) {
            currentPiece.gx += stepX;
            moved = true;
          } else if (
            stepZ !== 0 &&
            canPieceOccupy(currentPiece.cells, currentPiece.gx, testGy, currentPiece.gz + stepZ)
          ) {
            currentPiece.gz += stepZ;
            moved = true;
          }

          if (moved) {
            currentPiece.alignCooldown = 0.065;
          }
        }
      }

      const delta = new THREE.Vector3().subVectors(endPos, startPos);
      const dist = Math.max(0.1, delta.length());
      const mid = new THREE.Vector3().addVectors(startPos, endPos).multiplyScalar(0.5);
      const upVec = new THREE.Vector3(0, 1, 0);
      const dirNorm = delta.clone().normalize();
      const quat = new THREE.Quaternion().setFromUnitVectors(upVec, dirNorm);

      plasmaCoreMesh.position.copy(mid);
      plasmaCoreMesh.quaternion.copy(quat);
      const coreThickness = currentPiece.warpDropping ? 1.85 : 1.0 + Math.sin(elapsedTime * 35) * 0.22;
      plasmaCoreMesh.scale.set(coreThickness, dist, coreThickness);

      plasmaOuterMesh.position.copy(mid);
      plasmaOuterMesh.quaternion.copy(quat);
      const outerThickness = currentPiece.warpDropping ? 2.1 : 1.0 + Math.cos(elapsedTime * 22) * 0.25;
      plasmaOuterMesh.scale.set(outerThickness, dist, outerThickness);
      plasmaOuterMat.color.setHex(currentPiece.warpDropping ? 0xff44ff : 0x00f7ff);

      const horizTension = Math.hypot(endPos.x - startPos.x, endPos.z - startPos.z);
      sound.setPlasmaLinkActive(true, Math.min(3, horizTension * 0.1));

      plasmaStrands.forEach((strand, sIdx) => {
        const posArr = strand.positions;
        for (let i = 0; i <= PLASMA_SEGMENTS; i++) {
          const t = i / PLASMA_SEGMENTS;
          const basePoint = new THREE.Vector3().lerpVectors(startPos, endPos, t);
          const envelope = Math.sin(t * Math.PI);
          const radius = (0.85 + Math.sin(elapsedTime * 9 + sIdx) * 0.35) * envelope;
          const angle = t * 18.0 - elapsedTime * (14 + sIdx * 3) + strand.phaseOffset;
          const jitter = (Math.random() - 0.5) * 0.26 * envelope;

          posArr[i * 3] = basePoint.x + Math.cos(angle) * radius + jitter;
          posArr[i * 3 + 1] = basePoint.y;
          posArr[i * 3 + 2] = basePoint.z + Math.sin(angle) * radius + jitter;
        }
        strand.line.geometry.attributes.position.needsUpdate = true;
      });

      plasmaRings.forEach((rObj) => {
        const t = (elapsedTime * (currentPiece.warpDropping ? 2.6 : 0.95) + rObj.offset) % 1;
        rObj.mesh.position.lerpVectors(startPos, endPos, t);
        rObj.mesh.quaternion.copy(quat);
        rObj.mesh.rotateX(Math.PI / 2);
        const s = 0.65 + Math.sin(t * Math.PI) * 0.85;
        rObj.mesh.scale.setScalar(s);
      });
    } else {
      plasmaBeamGroup.visible = false;
      sound.setPlasmaLinkActive(false);
    }
  }

  // --------------------------------------------------------------------------
  // RAYCAST TARGETING & 3D HOLOGRAPHIC SEGMENT HIGHLIGHTER
  // --------------------------------------------------------------------------
  const raycaster = new THREE.Raycaster();
  const highlightBoxGeo = new THREE.EdgesGeometry(
    new THREE.BoxGeometry(CELL_SIZE * 1.02, CELL_SIZE * 1.02, CELL_SIZE * 1.02)
  );
  const highlightBoxMat = new THREE.LineBasicMaterial({
    color: 0x00f7ff,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
  });
  const highlightBox = new THREE.LineSegments(highlightBoxGeo, highlightBoxMat);
  scene.add(highlightBox);
  highlightBox.visible = false;

  let currentAimTarget = null;

  function updateAimRaycast() {
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);

    const candidates = [...floorTileMeshes];

    for (let x = 0; x < GRID_W; x++) {
      for (let y = 0; y < GRID_H; y++) {
        for (let z = 0; z < GRID_D; z++) {
          if (placedGrid[x][y][z]) {
            candidates.push(placedGrid[x][y][z].group.userData.mesh);
          }
        }
      }
    }

    if (currentPiece) {
      currentPiece.segmentGroups.forEach((seg) => {
        candidates.push(seg.userData.mesh);
      });
    }

    const hits = raycaster.intersectObjects(candidates, false);
    const reticleEl = document.getElementById('reticle-container');
    const reticleLabel = document.getElementById('reticle-label');

    if (hits.length > 0) {
      const hit = hits[0];
      const data = hit.object.userData;

      if (data.isFallingSegment && currentPiece) {
        const segGroup = currentPiece.segmentGroups[data.segmentIndex];
        currentAimTarget = {
          type: 'sky',
          segmentIndex: data.segmentIndex,
          point: hit.point.clone(),
          worldCenter: segGroup.position.clone(),
        };
        highlightBox.visible = true;
        highlightBox.position.copy(currentAimTarget.worldCenter);
        highlightBox.quaternion.copy(segGroup.quaternion);
        highlightBox.scale.set(1, 1, 1);
        highlightBoxMat.color.setHex(0xffae2b);

        reticleEl.className = 'target-sky';
        reticleLabel.textContent = `LMB: SKY BEACON // RMB: ROTATE BLAST [#${data.segmentIndex + 1}]`;
        return;
      }

      if (data.isPlacedBlock) {
        currentAimTarget = {
          type: 'ground',
          gx: data.gx,
          gy: data.gy,
          gz: data.gz,
          point: hit.point.clone(),
          worldCenter: gridToWorldCenter(data.gx, data.gy, data.gz),
        };
        highlightBox.visible = true;
        highlightBox.position.copy(currentAimTarget.worldCenter);
        highlightBox.quaternion.identity();
        highlightBox.scale.set(1, 1, 1);
        highlightBoxMat.color.setHex(0x00f7ff);

        reticleEl.className = 'target-ground';
        reticleLabel.textContent = `LOCK BLOCK SURFACE [${data.gx}, ${data.gz}]`;
        return;
      }

      if (data.isFloorTile) {
        currentAimTarget = {
          type: 'ground',
          gx: data.gx,
          gy: -1,
          gz: data.gz,
          point: hit.point.clone(),
          worldCenter: new THREE.Vector3(
            ARENA_MIN_X + (data.gx + 0.5) * CELL_SIZE,
            0.25,
            ARENA_MIN_Z + (data.gz + 0.5) * CELL_SIZE
          ),
        };
        highlightBox.visible = true;
        highlightBox.position.copy(currentAimTarget.worldCenter);
        highlightBox.quaternion.identity();
        highlightBox.scale.set(1, 0.08, 1);
        highlightBoxMat.color.setHex(0x00f7ff);

        reticleEl.className = 'target-ground';
        reticleLabel.textContent = `LOCK FLOOR GRID [${data.gx}, ${data.gz}]`;
        return;
      }
    }

    currentAimTarget = null;
    highlightBox.visible = false;
    reticleEl.className = '';
    reticleLabel.textContent = 'AIM AT SKY PIECE OR BLOCK SURFACE';
  }

  // --------------------------------------------------------------------------
  // PLAYER AVATAR (3rd-Person Character + Jetpack Plumes + 1st-Person Beacon Gun)
  // --------------------------------------------------------------------------
  const player = {
    pos: new THREE.Vector3(0, 0, 23.5),
    vel: new THREE.Vector3(0, 0, 0),
    yaw: 0,
    pitch: 0.22,
    onGround: true,
    firstPerson: true,
    gunRecoil: 0,
  };

  const fpGunGroup = new THREE.Group();
  camera.add(fpGunGroup);
  scene.add(camera);

  let gunCoreMat = null;
  let gunMuzzleLight = null;

  function buildFirstPersonBeaconGun() {
    const bodyGeo = new THREE.BoxGeometry(0.14, 0.16, 0.58);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x162238,
      roughness: 0.25,
      metalness: 0.85,
    });
    const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
    fpGunGroup.add(bodyMesh);

    const railGeo = new THREE.BoxGeometry(0.165, 0.035, 0.52);
    gunCoreMat = new THREE.MeshBasicMaterial({
      color: 0x00f7ff,
    });
    const railMesh = new THREE.Mesh(railGeo, gunCoreMat);
    railMesh.position.y = 0.03;
    fpGunGroup.add(railMesh);

    const muzzleGeo = new THREE.TorusGeometry(0.065, 0.016, 12, 24);
    const muzzleMesh = new THREE.Mesh(muzzleGeo, gunCoreMat);
    muzzleMesh.position.z = -0.31;
    fpGunGroup.add(muzzleMesh);

    gunMuzzleLight = new THREE.PointLight(0x00f7ff, 0, 6);
    gunMuzzleLight.position.set(0, 0, -0.4);
    fpGunGroup.add(gunMuzzleLight);

    fpGunGroup.position.set(0.32, -0.26, -0.52);
  }
  buildFirstPersonBeaconGun();

  const tpPlayerGroup = new THREE.Group();
  scene.add(tpPlayerGroup);
  let jetpackFlameL = null;
  let jetpackFlameR = null;
  let jetpackLight = null;

  function buildThirdPersonAvatar() {
    const suitMat = new THREE.MeshStandardMaterial({
      color: 0x1a2436,
      roughness: 0.4,
      metalness: 0.6,
    });
    const neonTrimMat = new THREE.MeshBasicMaterial({ color: 0x00f7ff });

    const legGeo = new THREE.CapsuleGeometry(0.11, 0.55, 8, 12);
    const legL = new THREE.Mesh(legGeo, suitMat);
    legL.position.set(-0.14, 0.42, 0);
    const legR = new THREE.Mesh(legGeo, suitMat);
    legR.position.set(0.14, 0.42, 0);
    tpPlayerGroup.add(legL, legR);

    const torsoGeo = new THREE.CapsuleGeometry(0.22, 0.42, 8, 16);
    const torso = new THREE.Mesh(torsoGeo, suitMat);
    torso.position.set(0, 1.16, 0);
    tpPlayerGroup.add(torso);

    const headGeo = new THREE.SphereGeometry(0.16, 16, 16);
    const head = new THREE.Mesh(headGeo, suitMat);
    head.position.set(0, 1.64, 0);
    tpPlayerGroup.add(head);

    const visorGeo = new THREE.BoxGeometry(0.22, 0.08, 0.14);
    const visor = new THREE.Mesh(visorGeo, neonTrimMat);
    visor.position.set(0, 1.65, -0.11);
    tpPlayerGroup.add(visor);

    const armGeo = new THREE.CapsuleGeometry(0.08, 0.42, 8, 12);
    const armL = new THREE.Mesh(armGeo, suitMat);
    armL.position.set(-0.31, 1.15, 0);
    const armR = new THREE.Mesh(armGeo, suitMat);
    armR.position.set(0.31, 1.18, -0.14);
    armR.rotation.x = Math.PI / 4;
    tpPlayerGroup.add(armL, armR);

    const packGeo = new THREE.BoxGeometry(0.34, 0.44, 0.18);
    const pack = new THREE.Mesh(packGeo, suitMat);
    pack.position.set(0, 1.18, 0.22);
    tpPlayerGroup.add(pack);

    const flameGeo = new THREE.ConeGeometry(0.09, 0.65, 12);
    flameGeo.translate(0, -0.32, 0);
    const flameMat = new THREE.MeshBasicMaterial({
      color: 0x00f7ff,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
    });
    jetpackFlameL = new THREE.Mesh(flameGeo, flameMat);
    jetpackFlameL.position.set(-0.11, 0.96, 0.24);
    jetpackFlameR = new THREE.Mesh(flameGeo, flameMat);
    jetpackFlameR.position.set(0.11, 0.96, 0.24);
    tpPlayerGroup.add(jetpackFlameL, jetpackFlameR);

    jetpackLight = new THREE.PointLight(0x00e5ff, 0, 8);
    jetpackLight.position.set(0, 0.7, 0.35);
    tpPlayerGroup.add(jetpackLight);
  }
  buildThirdPersonAvatar();

  function getGunMuzzleWorldPos() {
    const muzzleWorld = new THREE.Vector3();
    if (player.firstPerson) {
      fpGunGroup.getWorldPosition(muzzleWorld);
    } else {
      muzzleWorld.copy(player.pos).add(new THREE.Vector3(0, 1.35, 0));
    }
    return muzzleWorld;
  }

  function shootBeaconFromGun() {
    sound.init();
    updateAimRaycast();
    if (!currentAimTarget) return;

    const isSky = currentAimTarget.type === 'sky';
    sound.playShootBeacon(isSky);

    player.gunRecoil = 1.0;
    if (gunMuzzleLight) {
      gunMuzzleLight.color.setHex(isSky ? 0xffae2b : 0x00f7ff);
      gunMuzzleLight.intensity = 5.0;
    }

    const muzzleWorld = getGunMuzzleWorldPos();
    const colorHex = isSky ? 0xffae2b : 0x00f7ff;
    const boltGeo = new THREE.SphereGeometry(0.32, 12, 12);
    const boltMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const boltMesh = new THREE.Mesh(boltGeo, boltMat);

    const glowGeo = new THREE.SphereGeometry(0.68, 12, 12);
    const glowMat = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.65,
      blending: THREE.AdditiveBlending,
    });
    boltMesh.add(new THREE.Mesh(glowGeo, glowMat));
    boltMesh.position.copy(muzzleWorld);
    scene.add(boltMesh);

    activeProjectiles.push({
      kind: 'beacon',
      mesh: boltMesh,
      start: muzzleWorld.clone(),
      target: { ...currentAimTarget },
      progress: 0,
      speed: 5.5,
    });
  }

  function shootRotationBlastFromGun(axis = 'y') {
    if (!currentPiece) return;
    sound.init();
    updateAimRaycast();

    let targetSegmentIdx = 1;
    if (currentAimTarget && currentAimTarget.type === 'sky') {
      targetSegmentIdx = currentAimTarget.segmentIndex;
    } else {
      raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
      let bestDistSq = Infinity;
      currentPiece.segmentGroups.forEach((seg, idx) => {
        const dSq = raycaster.ray.distanceSqToPoint(seg.position);
        if (dSq < bestDistSq) {
          bestDistSq = dSq;
          targetSegmentIdx = idx;
        }
      });
    }

    sound.playShootTorqueBlast();
    player.gunRecoil = 1.45;
    if (gunMuzzleLight) {
      gunMuzzleLight.color.setHex(0xff2be2);
      gunMuzzleLight.intensity = 6.5;
    }

    const muzzleWorld = getGunMuzzleWorldPos();

    const blastGroup = new THREE.Group();
    const coreMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.45, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0xffffff })
    );
    blastGroup.add(coreMesh);

    const outerGlow = new THREE.Mesh(
      new THREE.SphereGeometry(0.95, 16, 16),
      new THREE.MeshBasicMaterial({
        color: 0xff2be2,
        transparent: true,
        opacity: 0.7,
        blending: THREE.AdditiveBlending,
      })
    );
    blastGroup.add(outerGlow);

    const ringGeo = new THREE.TorusGeometry(1.15, 0.12, 10, 24);
    const ring1 = new THREE.Mesh(
      ringGeo,
      new THREE.MeshBasicMaterial({
        color: 0x00f7ff,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
      })
    );
    const ring2 = new THREE.Mesh(
      ringGeo,
      new THREE.MeshBasicMaterial({
        color: 0xffae2b,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
      })
    );
    ring2.rotation.x = Math.PI / 2;
    blastGroup.add(ring1, ring2);

    blastGroup.position.copy(muzzleWorld);
    scene.add(blastGroup);

    activeProjectiles.push({
      kind: 'torqueBlast',
      axis,
      mesh: blastGroup,
      start: muzzleWorld.clone(),
      segmentIndex: targetSegmentIdx,
      progress: 0,
      speed: 3.4,
    });
  }

  function spawnImpactBurst(pos, colorHex, scaleMultiplier = 1.0) {
    const ringGeo = new THREE.RingGeometry(0.35 * scaleMultiplier, 0.75 * scaleMultiplier, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: colorHex,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.copy(pos);
    ring.lookAt(camera.position);
    scene.add(ring);
    impactBursts.push({ mesh: ring, mat: ringMat, age: 0, scaleMultiplier });
  }

  function updateProjectilesAndBursts(dt) {
    for (let i = activeProjectiles.length - 1; i >= 0; i--) {
      const p = activeProjectiles[i];
      p.progress += dt * p.speed;

      if (p.kind === 'torqueBlast') {
        p.mesh.rotation.x += dt * 18;
        p.mesh.rotation.y += dt * 22;

        let endPos = p.start;
        if (currentPiece) {
          const seg = currentPiece.segmentGroups[p.segmentIndex] || currentPiece.segmentGroups[0];
          if (seg) endPos = seg.position;
        }

        if (p.progress >= 1) {
          scene.remove(p.mesh);
          activeProjectiles.splice(i, 1);

          spawnImpactBurst(endPos, 0xff2be2, 1.8);
          spawnImpactBurst(endPos, 0x00f7ff, 1.2);
          applyInertialRotationToFallingPiece(p.axis, 1, p.segmentIndex);
        } else {
          p.mesh.position.lerpVectors(p.start, endPos, p.progress);
        }
        continue;
      }

      let endPos = p.target.point;
      if (p.target.type === 'sky' && currentPiece) {
        const seg = currentPiece.segmentGroups[p.target.segmentIndex];
        if (seg) endPos = seg.position;
      }

      if (p.progress >= 1) {
        scene.remove(p.mesh);
        activeProjectiles.splice(i, 1);

        if (p.target.type === 'sky') {
          attachSkyBeacon(p.target.segmentIndex);
          spawnImpactBurst(endPos, 0xffae2b, 1.0);
        } else if (p.target.type === 'ground') {
          attachGroundBeacon(p.target.gx, p.target.gy, p.target.gz);
          spawnImpactBurst(groundBeacon.worldPos, 0x00f7ff, 1.0);
        }
      } else {
        p.mesh.position.lerpVectors(p.start, endPos, p.progress);
      }
    }

    for (let i = impactBursts.length - 1; i >= 0; i--) {
      const b = impactBursts[i];
      b.age += dt * 3.0;
      if (b.age >= 1) {
        scene.remove(b.mesh);
        impactBursts.splice(i, 1);
      } else {
        b.mesh.scale.setScalar(1 + b.age * 8.0 * (b.scaleMultiplier || 1));
        b.mat.opacity = 1 - b.age;
      }
    }
  }

  // --------------------------------------------------------------------------
  // LINE / ROW CLEARING & END-GAME TOP-OUT CHECK
  // --------------------------------------------------------------------------
  function lockFallingPieceAndCheckLines() {
    if (!currentPiece) return;

    const finalGy = computeDropY(
      currentPiece.cells,
      currentPiece.gx,
      Math.ceil(currentPiece.gyFloat),
      currentPiece.gz
    );

    let maxLockedGy = 0;
    currentPiece.cells.forEach(([ox, oy, oz]) => {
      const gx = currentPiece.gx + ox;
      const gy = finalGy + oy;
      const gz = currentPiece.gz + oz;
      maxLockedGy = Math.max(maxLockedGy, gy);
      placeSingleBlockCell(gx, gy, gz, currentPiece.type.color, currentPiece.type.emissive);
    });

    sound.playHeavyLand();
    score += 120 * level;

    let clearedCount = 0;

    for (let y = 0; y < GRID_H; y++) {
      // Check X-lines at depth z
      for (let z = 0; z < GRID_D; z++) {
        let fullX = true;
        for (let x = 0; x < GRID_W; x++) {
          if (!placedGrid[x][y][z]) {
            fullX = false;
            break;
          }
        }
        if (fullX) {
          clearedCount++;
          for (let x = 0; x < GRID_W; x++) {
            spawnImpactBurst(gridToWorldCenter(x, y, z), 0x00f7ff);
            placedBlocksGroup.remove(placedGrid[x][y][z].group);
            for (let yy = y; yy < GRID_H - 1; yy++) {
              placedGrid[x][yy][z] = placedGrid[x][yy + 1][z];
              if (placedGrid[x][yy][z]) {
                placedGrid[x][yy][z].group.position.copy(gridToWorldCenter(x, yy, z));
                placedGrid[x][yy][z].group.userData.mesh.userData.gy = yy;
              }
            }
            placedGrid[x][GRID_H - 1][z] = null;
          }
          z--;
        }
      }

      // Check Z-lines at column x
      for (let x = 0; x < GRID_W; x++) {
        let fullZ = true;
        for (let z = 0; z < GRID_D; z++) {
          if (!placedGrid[x][y][z]) {
            fullZ = false;
            break;
          }
        }
        if (fullZ) {
          clearedCount++;
          for (let z = 0; z < GRID_D; z++) {
            spawnImpactBurst(gridToWorldCenter(x, y, z), 0xff2be2);
            placedBlocksGroup.remove(placedGrid[x][y][z].group);
            for (let yy = y; yy < GRID_H - 1; yy++) {
              placedGrid[x][yy][z] = placedGrid[x][yy + 1][z];
              if (placedGrid[x][yy][z]) {
                placedGrid[x][yy][z].group.position.copy(gridToWorldCenter(x, yy, z));
                placedGrid[x][yy][z].group.userData.mesh.userData.gy = yy;
              }
            }
            placedGrid[x][GRID_H - 1][z] = null;
          }
          x--;
        }
      }
    }

    if (clearedCount > 0) {
      linesCleared += clearedCount;
      score += clearedCount * clearedCount * 1000 * level;
      level = Math.max(4, Math.floor(linesCleared / 4) + 1);
      sound.playLineClear(clearedCount);
      showBanner(
        `${clearedCount} MEGA-ROW${clearedCount > 1 ? 'S' : ''} VAPORIZED!`,
        `+${(clearedCount * clearedCount * 1000 * level).toLocaleString()} PTS`
      );
    }

    ensurePlayerNotInsideBlock();

    // Check if any remaining block in the stack has reached or exceeded MAX_STACK_GY
    for (let x = 0; x < GRID_W; x++) {
      for (let y = MAX_STACK_GY; y < GRID_H; y++) {
        for (let z = 0; z < GRID_D; z++) {
          if (placedGrid[x][y][z]) {
            triggerGameOver();
            return;
          }
        }
      }
    }

    spawnFallingPiece();
  }

  function ensurePlayerNotInsideBlock() {
    const { gx, gz } = worldToGridXZ(player.pos.x, player.pos.z);
    const gy = Math.floor(player.pos.y / CELL_SIZE);
    if (gy >= 0 && gy < GRID_H && placedGrid[gx]?.[gy]?.[gz]) {
      let safeY = gy + 1;
      while (safeY < GRID_H && placedGrid[gx][safeY][gz]) {
        safeY++;
      }
      player.pos.y = safeY * CELL_SIZE + 0.1;
      player.vel.y = 6;
    }
  }

  // --------------------------------------------------------------------------
  // PLAYER INPUT, POINTER LOCK & 3D JETPACK PHYSICS
  // --------------------------------------------------------------------------
  const keys = {};

  window.addEventListener('keydown', (e) => {
    keys[e.code] = true;
    if (!gameRunning) return;

    if (
      e.code === 'Space' ||
      e.code === 'Enter' ||
      e.code.startsWith('Arrow')
    ) {
      e.preventDefault();
    }

    if (e.code === 'KeyR') {
      shootRotationBlastFromGun('y');
    } else if (e.code === 'KeyQ') {
      shootRotationBlastFromGun('x');
    } else if (e.code === 'KeyE') {
      shootRotationBlastFromGun('z');
    } else if (e.code === 'KeyF') {
      if (currentPiece) {
        currentPiece.warpDropping = true;
        sound.playPlasmaEngage();
        showBanner('PLASMA WARP DROP', 'MAXIMUM GRAVITY SURGE');
      }
    } else if (e.code === 'KeyX') {
      clearBeacons();
    } else if (e.code === 'KeyV') {
      player.firstPerson = !player.firstPerson;
      updateHUD();
    }
  });

  window.addEventListener('keyup', (e) => {
    keys[e.code] = false;
    if (gameRunning && (e.code === 'Space' || e.code === 'Enter')) {
      e.preventDefault();
    }
  });

  window.addEventListener('mousemove', (e) => {
    if (document.pointerLockElement !== renderer.domElement) return;
    const sensitivity = 0.0022;
    player.yaw -= e.movementX * sensitivity;
    player.pitch -= e.movementY * sensitivity;
    const maxPitch = Math.PI / 2 - 0.04;
    player.pitch = Math.max(-maxPitch, Math.min(maxPitch, player.pitch));
  });

  window.addEventListener('mousedown', (e) => {
    if (!gameRunning || isGameOver) return;
    if (document.pointerLockElement !== renderer.domElement) {
      renderer.domElement.requestPointerLock();
      return;
    }
    if (e.button === 0) {
      shootBeaconFromGun();
    } else if (e.button === 2) {
      shootRotationBlastFromGun('y');
    }
  });

  window.addEventListener('contextmenu', (e) => e.preventDefault());

  document.addEventListener('pointerlockchange', () => {
    const modal = document.getElementById('modal-overlay');
    if (document.pointerLockElement === renderer.domElement) {
      if (document.activeElement && typeof document.activeElement.blur === 'function') {
        document.activeElement.blur();
      }
      modal.classList.add('hidden');
      gameRunning = true;
      sound.init();
    } else if (gameRunning) {
      modal.classList.remove('hidden');
      gameRunning = false;
      keys['Space'] = false;
      sound.setJetpackIntensity(0, 0);
      sound.setPlasmaLinkActive(false);
    }
  });

  function getHighestSurfaceBelow(wx, wy, wz) {
    const { gx, gz } = worldToGridXZ(wx, wz);
    let floorY = 0;
    for (let y = 0; y < GRID_H; y++) {
      if (placedGrid[gx]?.[y]?.[gz]) {
        const blockTop = (y + 1) * CELL_SIZE;
        if (blockTop <= wy + 0.65) {
          floorY = Math.max(floorY, blockTop);
        }
      }
    }
    return floorY;
  }

  function updatePlayerPhysics(dt, elapsedTime) {
    const forward = new THREE.Vector3(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
    const right = new THREE.Vector3(Math.cos(player.yaw), 0, -Math.sin(player.yaw));

    const moveInput = new THREE.Vector3();
    if (keys['KeyW'] || keys['ArrowUp']) moveInput.add(forward);
    if (keys['KeyS'] || keys['ArrowDown']) moveInput.sub(forward);
    if (keys['KeyD'] || keys['ArrowRight']) moveInput.add(right);
    if (keys['KeyA'] || keys['ArrowLeft']) moveInput.sub(right);
    if (moveInput.lengthSq() > 0) moveInput.normalize();

    const moveAccel = player.onGround ? 68.0 : 52.0;
    player.vel.x += moveInput.x * moveAccel * dt;
    player.vel.z += moveInput.z * moveAccel * dt;

    const damping = Math.exp(-5.5 * dt);
    player.vel.x *= damping;
    player.vel.z *= damping;

    // Hold SPACE to fly up; release SPACE to fall back down automatically at a gentle speed!
    const thrustUp = keys['Space'];

    let jetpackIntensity = 0;
    if (thrustUp) {
      player.vel.y += 28.0 * dt;
      player.vel.y = Math.min(13.5, player.vel.y);
      player.onGround = false;
      jetpackIntensity = 1.0;
    } else if (!player.onGround) {
      if (player.vel.y > 0) {
        player.vel.y -= 15.5 * dt;
      } else {
        player.vel.y -= 7.2 * dt;
        player.vel.y = Math.max(-5.2, player.vel.y);
      }
      jetpackIntensity = 0.2;
    }

    sound.setJetpackIntensity(jetpackIntensity, elapsedTime);

    const nextX = player.pos.x + player.vel.x * dt;
    const nextZ = player.pos.z + player.vel.z * dt;
    const footGy = Math.floor((player.pos.y + 0.25) / CELL_SIZE);
    const headGy = Math.floor((player.pos.y + PLAYER_HEIGHT - 0.1) / CELL_SIZE);

    const checkX = worldToGridXZ(nextX, player.pos.z);
    let blockedX = false;
    for (let y = Math.max(0, footGy); y <= Math.min(GRID_H - 1, headGy); y++) {
      if (placedGrid[checkX.gx]?.[y]?.[checkX.gz]) blockedX = true;
    }
    if (!blockedX) {
      player.pos.x = Math.max(ARENA_MIN_X + 1.2, Math.min(-ARENA_MIN_X - 1.2, nextX));
    } else {
      player.vel.x = 0;
    }

    const checkZ = worldToGridXZ(player.pos.x, nextZ);
    let blockedZ = false;
    for (let y = Math.max(0, footGy); y <= Math.min(GRID_H - 1, headGy); y++) {
      if (placedGrid[checkZ.gx]?.[y]?.[checkZ.gz]) blockedZ = true;
    }
    if (!blockedZ) {
      player.pos.z = Math.max(ARENA_MIN_Z + 1.2, Math.min(-ARENA_MIN_Z + 6.0, nextZ));
    } else {
      player.vel.z = 0;
    }

    player.pos.y += player.vel.y * dt;
    const supportY = getHighestSurfaceBelow(player.pos.x, player.pos.y, player.pos.z);
    if (player.pos.y <= supportY) {
      player.pos.y = supportY;
      player.vel.y = 0;
      player.onGround = true;
    } else {
      player.onGround = false;
    }
    player.pos.y = Math.min(GRID_H * CELL_SIZE + 12, player.pos.y);

    tpPlayerGroup.position.copy(player.pos);
    tpPlayerGroup.rotation.y = player.yaw;
    tpPlayerGroup.visible = !player.firstPerson;

    if (jetpackFlameL && jetpackFlameR) {
      const showFlames = !player.onGround || thrustUp;
      jetpackFlameL.visible = showFlames;
      jetpackFlameR.visible = showFlames;
      const flameScale = 0.5 + jetpackIntensity * 0.95 + Math.sin(elapsedTime * 45) * 0.18;
      jetpackFlameL.scale.set(1, flameScale, 1);
      jetpackFlameR.scale.set(1, flameScale, 1);
      jetpackLight.intensity = showFlames ? 2.5 * flameScale : 0;
    }

    camera.rotation.order = 'YXZ';
    camera.rotation.y = player.yaw;
    camera.rotation.x = player.pitch;

    if (player.firstPerson) {
      fpGunGroup.visible = true;
      camera.position.set(player.pos.x, player.pos.y + PLAYER_EYE_HEIGHT, player.pos.z);

      player.gunRecoil = Math.max(0, player.gunRecoil - dt * 6.5);
      if (gunMuzzleLight) {
        gunMuzzleLight.intensity = Math.max(0, gunMuzzleLight.intensity - dt * 25);
      }
      const speedHoriz = Math.hypot(player.vel.x, player.vel.z);
      const bobX = Math.cos(elapsedTime * 7) * 0.008 * Math.min(1, speedHoriz * 0.15);
      const bobY = Math.sin(elapsedTime * 14) * 0.008 * Math.min(1, speedHoriz * 0.15);
      fpGunGroup.position.set(
        0.32 + bobX,
        -0.26 + bobY + player.gunRecoil * 0.03,
        -0.52 + player.gunRecoil * 0.09
      );
      if (gunCoreMat) {
        gunCoreMat.color.setHex(
          currentAimTarget?.type === 'sky' ? 0xffae2b : 0x00f7ff
        );
      }
    } else {
      fpGunGroup.visible = false;
      const camBackOffset = new THREE.Vector3(0, 0, 5.2).applyAxisAngle(
        new THREE.Vector3(1, 0, 0),
        player.pitch * 0.45
      );
      camBackOffset.applyAxisAngle(new THREE.Vector3(0, 1, 0), player.yaw);
      camera.position.set(
        player.pos.x + camBackOffset.x,
        Math.max(0.8, player.pos.y + 2.25 + camBackOffset.y),
        player.pos.z + camBackOffset.z
      );
    }
  }

  // --------------------------------------------------------------------------
  // HUD & EVENT BANNER UPDATES
  // --------------------------------------------------------------------------
  let bannerTimeout = null;
  function showBanner(mainText, subText) {
    const banner = document.getElementById('event-banner');
    document.getElementById('banner-main').textContent = mainText;
    document.getElementById('banner-sub').textContent = subText;
    banner.classList.add('visible');
    if (bannerTimeout) clearTimeout(bannerTimeout);
    bannerTimeout = setTimeout(() => {
      banner.classList.remove('visible');
    }, 2200);
  }

  function updateHUD() {
    document.getElementById('hud-score').textContent = score.toLocaleString().padStart(7, '0');
    document.getElementById('hud-level').textContent = String(level).padStart(2, '0');
    document.getElementById('hud-lines').textContent = String(linesCleared).padStart(2, '0');

    if (nextPieceType) {
      document.getElementById('hud-next-piece').textContent = nextPieceType.name;
    }
    if (currentPiece) {
      const altMeters = Math.max(0, Math.round(currentPiece.gyFloat * CELL_SIZE));
      document.getElementById('hud-piece-alt').textContent = `${altMeters}m`;
    }

    const skySlot = document.getElementById('slot-sky-beacon');
    const skyText = document.getElementById('sky-beacon-text');
    if (skyBeacon.active) {
      skySlot.classList.add('active-sky');
      skyText.textContent = `CUBE SEGMENT #${skyBeacon.segmentIndex + 1}`;
    } else {
      skySlot.classList.remove('active-sky');
      skyText.textContent = 'SHOOT SKY PIECE';
    }

    const groundSlot = document.getElementById('slot-ground-beacon');
    const groundText = document.getElementById('ground-beacon-text');
    if (groundBeacon.active) {
      groundSlot.classList.add('active-ground');
      groundText.textContent = `CELL [${groundBeacon.gx}, ${groundBeacon.gz}]`;
    } else {
      groundSlot.classList.remove('active-ground');
      groundText.textContent = 'SHOOT BLOCK / FLOOR';
    }

    const bridgeEl = document.getElementById('plasma-bridge-status');
    if (skyBeacon.active && groundBeacon.active) {
      bridgeEl.classList.add('linked');
      const segOffset = currentPiece?.cells?.[skyBeacon.segmentIndex];
      const isAligned =
        segOffset &&
        currentPiece.gx + segOffset[0] === groundBeacon.gx &&
        currentPiece.gz + segOffset[2] === groundBeacon.gz;
      bridgeEl.textContent = isAligned
        ? '⚡ VERTICAL PLASMA LOCK ⚡'
        : '⚡ PULLING TO ALIGNMENT ⚡';
    } else {
      bridgeEl.classList.remove('linked');
      bridgeEl.textContent = 'AWAITING BOTH BEACONS';
    }

    document.getElementById('jetpack-mode-label').textContent = keys['Space']
      ? 'ASCENDING [SPACE]'
      : player.onGround
      ? 'GROUNDED'
      : 'GENTLE GLIDE DESCENT';
    document.getElementById('player-alt-label').textContent = `PLAYER ALT: ${player.pos.y.toFixed(1)}m`;
    document.getElementById('camera-mode-label').textContent = player.firstPerson
      ? 'VIEW: 1ST PERSON [V]'
      : 'VIEW: 3RD PERSON [V]';
  }

  // --------------------------------------------------------------------------
  // INITIALIZATION & MAIN ANIMATION LOOP
  // --------------------------------------------------------------------------
  function resetModalHeaders() {
    const titleEl = document.getElementById('modal-title');
    const subEl = document.getElementById('modal-subtitle');
    if (titleEl) titleEl.textContent = 'ULTRA TETRIS 3D';
    if (subEl) {
      subEl.textContent = 'House-Scale Blocks • 3D Jetpack Flight • Plasma Beacon Alignment';
    }
  }

  populateReferenceFormation();
  spawnFallingPiece(TETROMINO_TYPES[0]);
  updatePlayerPhysics(0.016, 0);

  document.getElementById('btn-start-reference').addEventListener('click', (e) => {
    if (e.currentTarget && typeof e.currentTarget.blur === 'function') {
      e.currentTarget.blur();
    }
    if (gameRunning || document.pointerLockElement === renderer.domElement) return;
    sound.init();
    if (isGameOver) {
      isGameOver = false;
      score = 4800;
      level = 4;
      linesCleared = 12;
      player.pos.set(0, 0, 23.5);
      player.vel.set(0, 0, 0);
      resetModalHeaders();
      populateReferenceFormation();
      spawnFallingPiece(TETROMINO_TYPES[0]);
    }
    renderer.domElement.requestPointerLock();
  });

  document.getElementById('btn-start-clean').addEventListener('click', (e) => {
    if (e.currentTarget && typeof e.currentTarget.blur === 'function') {
      e.currentTarget.blur();
    }
    if (gameRunning || document.pointerLockElement === renderer.domElement) return;
    sound.init();
    isGameOver = false;
    score = 0;
    level = 1;
    linesCleared = 0;
    player.pos.set(0, 0, 23.5);
    player.vel.set(0, 0, 0);
    resetModalHeaders();
    clearAllPlacedBlocks();
    spawnFallingPiece(TETROMINO_TYPES[0]);
    renderer.domElement.requestPointerLock();
  });

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
  });

  const clock = new THREE.Clock();

  function animate() {
    requestAnimationFrame(animate);

    const dt = Math.min(0.05, clock.getDelta());
    const elapsedTime = clock.getElapsedTime();

    nextPiecePreviewGroup.rotation.y = -0.35 + Math.sin(elapsedTime * 1.2) * 0.25;

    if (gameRunning && !isGameOver) {
      updatePlayerPhysics(dt, elapsedTime);
      updateAimRaycast();
      updateProjectilesAndBursts(dt);
      updateBeaconsAndPlasmaBeam(dt, elapsedTime);

      if (currentPiece) {
        const dropRate = currentPiece.warpDropping
          ? 14.5
          : currentPiece.fallSpeed;

        const nextGyFloat = currentPiece.gyFloat - dropRate * dt;
        const landingGy = computeDropY(
          currentPiece.cells,
          currentPiece.gx,
          Math.ceil(currentPiece.gyFloat),
          currentPiece.gz
        );

        if (nextGyFloat <= landingGy) {
          currentPiece.gyFloat = landingGy;
          updateFallingPieceVisuals(dt);
          lockFallingPieceAndCheckLines();
        } else {
          currentPiece.gyFloat = nextGyFloat;
          updateFallingPieceVisuals(dt);
        }
      }

      updateHUD();
    } else {
      camera.rotation.order = 'YXZ';
      camera.rotation.y = player.yaw + Math.sin(elapsedTime * 0.35) * 0.04;
      camera.rotation.x = player.pitch + Math.cos(elapsedTime * 0.45) * 0.02;
      camera.position.set(player.pos.x, player.pos.y + PLAYER_EYE_HEIGHT, player.pos.z);
      updateFallingPieceVisuals(0);
    }

    composer.render();
  }

  animate();
})();
