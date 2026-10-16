// ============================================================================
// Renderer, camera, lighting, environment reflections and post-processing.
// Pipeline: RenderPass (MSAA, HDR) → UnrealBloom → FinalPass (chromatic
// aberration, grading, vignette, grain, status tints) → OutputPass (ACES+sRGB)
// ============================================================================
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { G } from '../state.js';
import { THEMES } from '../config.js';

const QUALITY = {
  high: { pixelRatio: 2, shadows: true, shadowSize: 2048, samples: 4, bloomScale: 1 },
  medium: { pixelRatio: 1.5, shadows: true, shadowSize: 1024, samples: 2, bloomScale: 0.75 },
  low: { pixelRatio: 1, shadows: false, shadowSize: 512, samples: 0, bloomScale: 0.5 },
};

const FinalShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uAberration: { value: 0.0015 },
    uVignette: { value: 0.55 },
    uGrain: { value: 0.025 },
    uSaturation: { value: 1.08 },
    uDanger: { value: 0 },
    uChrono: { value: 0 },
    uOverdrive: { value: 0 },
    uFlash: { value: 0 },
    uFlashColor: { value: new THREE.Color(1, 1, 1) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uAberration, uVignette, uGrain, uSaturation;
    uniform float uDanger, uChrono, uOverdrive, uFlash;
    uniform vec3 uFlashColor;
    uniform vec2 uResolution;
    varying vec2 vUv;

    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

    void main() {
      vec2 uv = vUv;
      vec2 c = uv - 0.5;
      float r2 = dot(c, c);

      // Chrono field: gentle lens warp
      uv -= c * uChrono * 0.03 * sin(uTime * 2.0 + r2 * 20.0);

      float ab = uAberration * (0.35 + r2 * 3.0);
      vec3 col;
      col.r = texture2D(tDiffuse, uv - c * ab).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv + c * ab).b;

      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSaturation);
      col = mix(col, vec3(l) * vec3(0.5, 0.85, 1.4), uChrono * 0.35);

      float edge = smoothstep(0.08, 0.5, r2 * 2.0);
      float pulse = 0.55 + 0.45 * sin(uTime * 6.5);
      col += vec3(1.0, 0.04, 0.1) * uDanger * edge * pulse * 0.55;
      col += vec3(1.0, 0.72, 0.18) * uOverdrive * edge * (0.6 + 0.4 * sin(uTime * 3.0)) * 0.07;
      col += vec3(0.25, 0.65, 1.0) * uChrono * edge * 0.06;
      col += uFlashColor * uFlash;

      col *= 1.0 - uVignette * smoothstep(0.25, 1.1, r2 * 2.4);

      float n = hash(uv * uResolution + fract(uTime * 7.31) * 100.0);
      col += (n - 0.5) * uGrain * (0.4 + l);

      gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
    }`,
};

let renderPass, bloomPass, finalPass, outputPass, msaaTarget;
let pmrem = null;
let envTarget = null;

export const lights = {};
const shake = { trauma: 0, seed: Math.random() * 100 };
const flash = { value: 0, color: new THREE.Color(1, 1, 1) };

export function initRenderer(container) {
  G.THREE = THREE;
  const q = QUALITY[G.settings.quality] || QUALITY.high;

  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatio));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.shadowMap.enabled = q.shadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);
  G.renderer = renderer;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(THEMES[0].fog, 0.0014);
  scene.background = new THREE.Color(0x000000);
  G.scene = scene;

  const camera = new THREE.PerspectiveCamera(G.settings.fov, window.innerWidth / window.innerHeight, 0.1, 2600);
  camera.rotation.order = 'YXZ';
  scene.add(camera);
  G.camera = camera;

  buildComposer(q);
  initLights(q);

  pmrem = new THREE.PMREMGenerator(renderer);
  rebuildEnvironment(THEMES[0]);

  window.addEventListener('resize', onResize);
  return renderer;
}

function buildComposer(q) {
  const { renderer, scene, camera } = G;
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  if (msaaTarget) msaaTarget.dispose();
  msaaTarget = new THREE.WebGLRenderTarget(size.x, size.y, {
    type: THREE.HalfFloatType,
    samples: q.samples,
  });
  const composer = new EffectComposer(renderer, msaaTarget);
  renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth * q.bloomScale, window.innerHeight * q.bloomScale),
    0.72,
    0.5,
    0.68
  );
  composer.addPass(bloomPass);

  finalPass = new ShaderPass(FinalShader);
  finalPass.uniforms.uResolution.value.set(size.x, size.y);
  composer.addPass(finalPass);

  outputPass = new OutputPass();
  composer.addPass(outputPass);
  G.composer = composer;
  G.bloomPass = bloomPass;
  G.finalPass = finalPass;
}

function initLights(q) {
  const { scene } = G;
  lights.ambient = new THREE.AmbientLight(0x30405f, 0.55);
  scene.add(lights.ambient);

  lights.hemi = new THREE.HemisphereLight(0x7fdcff, 0x3a0d4a, 0.9);
  scene.add(lights.hemi);

  // Near-vertical key light: shadows fall straight down so the falling
  // piece's shadow shows exactly which columns it will land on.
  const key = new THREE.DirectionalLight(0xfff1e0, 2.1);
  key.position.set(14, 230, 22);
  key.target.position.set(0, 0, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(q.shadowSize, q.shadowSize);
  const sc = key.shadow.camera;
  sc.left = -48;
  sc.right = 48;
  sc.top = 52;
  sc.bottom = -52;
  sc.near = 40;
  sc.far = 320;
  key.shadow.bias = -0.0006;
  key.shadow.normalBias = 0.06;
  key.shadow.radius = 3;
  scene.add(key);
  scene.add(key.target);
  lights.key = key;

  lights.rim = new THREE.DirectionalLight(0x00e5ff, 1.1);
  lights.rim.position.set(-60, 70, -90);
  scene.add(lights.rim);

  lights.fill = new THREE.DirectionalLight(0xff4fd8, 0.55);
  lights.fill.position.set(80, 40, 60);
  scene.add(lights.fill);
}

// Builds a tiny neon "room" and pre-filters it into an environment map so
// glossy blocks pick up colorful reflections that match the sector theme.
export function rebuildEnvironment(theme) {
  if (!pmrem) return;
  const envScene = new THREE.Scene();
  const skyGeo = new THREE.SphereGeometry(50, 32, 16);
  const top = new THREE.Color(theme.skyTop).multiplyScalar(1.6);
  const bottom = new THREE.Color(theme.skyBottom).multiplyScalar(1.4);
  const colors = [];
  const pos = skyGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) / 50) * 0.5 + 0.5;
    const c = bottom.clone().lerp(top, t);
    colors.push(c.r, c.g, c.b);
  }
  skyGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  envScene.add(new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));

  const panel = new THREE.PlaneGeometry(1, 1);
  const addPanel = (color, intensity, pos, scale, lookAt = new THREE.Vector3()) => {
    const m = new THREE.Mesh(panel, new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide }));
    m.position.copy(pos);
    m.scale.set(scale[0], scale[1], 1);
    m.lookAt(lookAt);
    envScene.add(m);
  };
  // Big soft key panel overhead, neon strips around the horizon
  addPanel(0xfff4e8, 2.2, new THREE.Vector3(0, 40, 0), [40, 40]);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const c = i % 2 === 0 ? theme.primary : theme.secondary;
    addPanel(c, 2.8, new THREE.Vector3(Math.cos(a) * 42, 6 + (i % 3) * 5, Math.sin(a) * 42), [16, 3]);
  }
  addPanel(theme.secondary, 2.0, new THREE.Vector3(0, -30, 0), [60, 60]);

  const rt = pmrem.fromScene(envScene, 0.035);
  if (envTarget) envTarget.dispose();
  envTarget = rt;
  G.scene.environment = rt.texture;
  envScene.traverse((o) => {
    if (o.geometry && o.geometry !== panel) o.geometry.dispose();
    if (o.material) o.material.dispose();
  });
  panel.dispose();
}

const _c1 = new THREE.Color();
const _c2 = new THREE.Color();
export function applyThemeToLights(from, to, t) {
  _c1.set(from.primary).lerp(_c2.set(to.primary), t);
  lights.hemi.color.copy(_c1).lerp(new THREE.Color(0xffffff), 0.45);
  lights.rim.color.copy(_c1);
  _c1.set(from.secondary).lerp(_c2.set(to.secondary), t);
  lights.hemi.groundColor.copy(_c1).multiplyScalar(0.45);
  lights.fill.color.copy(_c1);
  _c1.set(from.fog).lerp(_c2.set(to.fog), t);
  G.scene.fog.color.copy(_c1);
}

export function setQuality(name) {
  const q = QUALITY[name] || QUALITY.high;
  const { renderer, scene } = G;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatio));
  renderer.setSize(window.innerWidth, window.innerHeight);
  const shadowsChanged = renderer.shadowMap.enabled !== q.shadows;
  renderer.shadowMap.enabled = q.shadows;
  if (lights.key.shadow.mapSize.x !== q.shadowSize) {
    lights.key.shadow.mapSize.set(q.shadowSize, q.shadowSize);
    if (lights.key.shadow.map) {
      lights.key.shadow.map.dispose();
      lights.key.shadow.map = null;
    }
  }
  if (shadowsChanged) {
    scene.traverse((o) => {
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => (m.needsUpdate = true));
      }
    });
  }
  buildComposer(q);
  onResize();
}

function onResize() {
  const { renderer, camera, composer } = G;
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  composer.setSize(w, h);
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  finalPass.uniforms.uResolution.value.set(size.x, size.y);
}

// ------------------------------------------------------------- screen fx --
export function addShake(amount) {
  if (!G.settings.screenShake) return;
  shake.trauma = Math.min(1, shake.trauma + amount);
}

export function screenFlash(intensity, color = 0xffffff) {
  flash.value = Math.max(flash.value, intensity);
  flash.color.set(color);
}

export function pulseAberration(amount) {
  finalPass.uniforms.uAberration.value = Math.max(finalPass.uniforms.uAberration.value, amount);
}

// Offsets the camera after the player has positioned it for this frame.
export function applyCameraShake(camera, dt) {
  shake.trauma = Math.max(0, shake.trauma - dt * 1.4);
  const s = shake.trauma * shake.trauma;
  if (s <= 0.0001) return;
  const t = G.realTime * 22 + shake.seed;
  const n1 = Math.sin(t * 1.0) * 0.6 + Math.sin(t * 2.3 + 1.7) * 0.4;
  const n2 = Math.sin(t * 1.3 + 4.1) * 0.6 + Math.sin(t * 2.9 + 0.3) * 0.4;
  const n3 = Math.sin(t * 0.9 + 2.2) * 0.6 + Math.sin(t * 3.1 + 5.1) * 0.4;
  camera.position.x += n1 * s * 0.9;
  camera.position.y += n2 * s * 0.7;
  camera.position.z += n3 * s * 0.9;
  camera.rotation.z += n3 * s * 0.035;
  camera.rotation.x += n2 * s * 0.02;
}

export function updatePost(dt) {
  const u = finalPass.uniforms;
  u.uTime.value = G.realTime;
  u.uAberration.value += (0.0015 - u.uAberration.value) * Math.min(1, dt * 4);
  flash.value = Math.max(0, flash.value - dt * 2.8);
  u.uFlash.value = flash.value;
  u.uFlashColor.value.copy(flash.color);
  const chronoTarget = G.effects.chrono > 0 ? 1 : 0;
  u.uChrono.value += (chronoTarget - u.uChrono.value) * Math.min(1, dt * 3);
  const odTarget = G.effects.overdrive > 0 ? 1 : 0;
  u.uOverdrive.value += (odTarget - u.uOverdrive.value) * Math.min(1, dt * 3);
  const dangerTarget = G.phase === 'playing' ? Math.max(0, (G.danger - 0.6) / 0.4) : 0;
  u.uDanger.value += (dangerTarget - u.uDanger.value) * Math.min(1, dt * 2);
}

export function renderFrame() {
  G.composer.render();
}
