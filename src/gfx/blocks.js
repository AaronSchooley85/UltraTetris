// ============================================================================
// House-scale block visuals: beveled armored cubes with glowing seams,
// power-core variants, hologram ghosts, drop guides and flash overlays.
// ============================================================================
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { CELL, POWERUPS } from '../config.js';
import { G } from '../state.js';
import { getBlockTextures, getGlyphEmissive } from './textures.js';

export const BLOCK_SIZE = CELL * 0.965;
export const blockGeo = new RoundedBoxGeometry(BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE, 3, 0.48);
const overlayGeo = new RoundedBoxGeometry(BLOCK_SIZE * 1.015, BLOCK_SIZE * 1.015, BLOCK_SIZE * 1.015, 2, 0.5);
const ghostEdgeGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE));
const guideGeo = new THREE.CylinderGeometry(0.16, 0.16, 1, 8, 1, true);
guideGeo.translate(0, -0.5, 0); // origin at the top so scale.y extends downward

const placedMats = new Map();
const fallingMats = new Map();
const powerMats = new Set();

function materialParams(piece) {
  const tex = getBlockTextures();
  const p = {
    color: piece.color,
    map: tex.map,
    normalMap: tex.normalMap,
    normalScale: new THREE.Vector2(1.15, 1.15),
    roughnessMap: tex.roughnessMap,
    roughness: 1.0,
    metalness: 0.22,
    clearcoat: 0.9,
    clearcoatRoughness: 0.14,
    emissive: piece.color,
    emissiveMap: tex.emissiveMap,
    emissiveIntensity: 1.8,
    envMapIntensity: 1.0,
  };
  if (piece.iridescent) {
    Object.assign(p, {
      metalness: 0.65,
      roughness: 0.8,
      iridescence: 1.0,
      iridescenceIOR: 1.45,
      iridescenceThicknessRange: [180, 620],
      emissive: 0x9fd8ff,
    });
  }
  return p;
}

export function getBlockMaterial(piece, power = null, falling = false) {
  const cache = falling ? fallingMats : placedMats;
  const key = `${piece.key}|${power || ''}`;
  if (cache.has(key)) return cache.get(key);
  const params = materialParams(piece);
  if (power) {
    params.emissiveMap = getGlyphEmissive(power);
    params.emissive = POWERUPS[power].color;
    params.emissiveIntensity = 2.6;
  }
  if (falling) params.emissiveIntensity *= 1.35;
  const mat = new THREE.MeshPhysicalMaterial(params);
  mat.userData.baseEmissive = params.emissiveIntensity;
  mat.userData.falling = falling;
  mat.userData.power = power;
  if (power) powerMats.add(mat);
  cache.set(key, mat);
  return mat;
}

export function createBlockMesh(piece, power = null, falling = false) {
  const mesh = new THREE.Mesh(blockGeo, getBlockMaterial(piece, power, falling));
  mesh.castShadow = falling || G.settings.quality === 'high';
  mesh.receiveShadow = true;
  return mesh;
}

// Breathing glow for falling pieces and power cores.
export function updateBlockMaterials(time) {
  const odBoost = G.effects.overdrive > 0 ? 0.6 + 0.4 * Math.sin(time * 9) : 0;
  fallingMats.forEach((m) => {
    m.emissiveIntensity = m.userData.baseEmissive * (0.85 + 0.25 * Math.sin(time * 5.5)) + odBoost;
  });
  powerMats.forEach((m) => {
    m.emissiveIntensity = m.userData.baseEmissive * (0.75 + 0.45 * Math.sin(time * 4 + (m.userData.falling ? 1 : 0)));
  });
}

// Pre-compiles every material permutation so the first landing doesn't hitch.
export function warmBlockMaterials(pieces) {
  const group = new THREE.Group();
  pieces.forEach((p) => {
    group.add(new THREE.Mesh(blockGeo, getBlockMaterial(p, null, false)));
    group.add(new THREE.Mesh(blockGeo, getBlockMaterial(p, null, true)));
  });
  Object.keys(POWERUPS).forEach((k) => {
    group.add(new THREE.Mesh(blockGeo, getBlockMaterial(pieces[0], k, false)));
    group.add(new THREE.Mesh(blockGeo, getBlockMaterial(pieces[0], k, true)));
  });
  group.position.set(0, -500, 0);
  G.scene.add(group);
  try {
    G.renderer.compile(G.scene, G.camera);
  } catch (e) {
    /* compile is an optimization only */
  }
  G.scene.remove(group);
}

// ------------------------------------------------------------ flash overlays
const flashes = [];
export function flashBlock(mesh, color = 0xffffff, duration = 0.35, peak = 1.0) {
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: peak,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const ov = new THREE.Mesh(overlayGeo, mat);
  mesh.add(ov);
  flashes.push({ ov, mat, mesh, t: 0, duration, peak });
  return ov;
}

export function updateFlashes(dt) {
  for (let i = flashes.length - 1; i >= 0; i--) {
    const f = flashes[i];
    f.t += dt;
    const k = f.t / f.duration;
    if (k >= 1 || !f.mesh.parent) {
      f.mesh.remove(f.ov);
      f.mat.dispose();
      flashes.splice(i, 1);
      continue;
    }
    f.mat.opacity = f.peak * (1 - k) * (1 - k);
  }
}

// ------------------------------------------------------------ ghost hologram
const ghostVertex = /* glsl */ `
  varying vec3 vN;
  varying vec3 vWorld;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    vN = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;
const ghostFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uOpacity;
  varying vec3 vN;
  varying vec3 vWorld;
  void main() {
    vec3 v = normalize(cameraPosition - vWorld);
    float fres = pow(1.0 - abs(dot(normalize(vN), v)), 2.0);
    float scan = smoothstep(0.42, 0.5, fract(vWorld.y * 0.8 - uTime * 1.6)) * 0.35;
    float a = (0.06 + fres * 0.6 + scan * 0.4) * uOpacity;
    gl_FragColor = vec4(uColor * (1.4 + fres * 1.6), a);
  }`;

export function createGhostMaterial(color) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uTime: { value: 0 },
      uOpacity: { value: 1 },
    },
    vertexShader: ghostVertex,
    fragmentShader: ghostFragment,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

export function createGhostCell(ghostMat, edgeMat) {
  const g = new THREE.Group();
  const fill = new THREE.Mesh(blockGeo, ghostMat);
  fill.scale.setScalar(0.985);
  fill.renderOrder = 2;
  g.add(fill);
  g.add(new THREE.LineSegments(ghostEdgeGeo, edgeMat));
  return g;
}

export function createGhostEdgeMaterial(color) {
  return new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity: 0.8,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}

// ------------------------------------------------------- vertical drop guides
const guideFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uLen;
  varying vec2 vUv;
  void main() {
    float dash = 0.45 + 0.55 * step(0.5, fract(vUv.y * uLen * 0.22 + uTime * 2.5));
    float fade = smoothstep(0.0, 0.06, vUv.y) * smoothstep(1.0, 0.9, vUv.y);
    gl_FragColor = vec4(uColor * 2.2, 0.32 * dash * fade);
  }`;
const guideVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

export function createDropGuide(color) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uTime: { value: 0 },
      uLen: { value: 10 },
    },
    vertexShader: guideVertex,
    fragmentShader: guideFragment,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(guideGeo, mat);
  mesh.frustumCulled = false;
  return mesh;
}
