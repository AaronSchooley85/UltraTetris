// ============================================================================
// THE ARENA: glossy reflective grid floor with ripples and cell highlights,
// observation deck, floating station slab, hex force-field walls, corner
// pylons with altitude ticks, danger ceiling and an infinite synthwave grid
// far below.
// ============================================================================
import * as THREE from 'three';
import { G } from '../state.js';
import {
  CELL,
  GRID_W,
  GRID_D,
  ARENA_MIN_X,
  ARENA_MIN_Z,
  ARENA_MAX_X,
  ARENA_MAX_Z,
  DECK_MAX_Z,
  MAX_STACK_GY,
  THEMES,
} from '../config.js';

const LIMIT_Y = MAX_STACK_GY * CELL;
const MAX_RIPPLES = 10;
const MAX_HIGHLIGHTS = 6;

export const arena = {
  floorUniforms: null,
  wallMats: [],
  themed: [], // { mat, prop, which: 'primary'|'secondary', intensity }
  rippleIndex: 0,
};

const shared = {
  uTime: { value: 0 },
  uPrimary: { value: new THREE.Color(THEMES[0].primary) },
  uSecondary: { value: new THREE.Color(THEMES[0].secondary) },
  uDanger: { value: 0 },
};

function buildFloor() {
  const depth = DECK_MAX_Z - ARENA_MIN_Z;
  const geo = new THREE.PlaneGeometry(GRID_W * CELL, depth, 1, 1);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, 0, ARENA_MIN_Z + depth / 2);

  const mat = new THREE.MeshStandardMaterial({
    color: 0x0a0f22,
    roughness: 0.42,
    metalness: 0.65,
    envMapIntensity: 0.28,
  });
  const ripples = [];
  const rippleColors = [];
  for (let i = 0; i < MAX_RIPPLES; i++) {
    ripples.push(new THREE.Vector4(0, 0, -100, 0));
    rippleColors.push(new THREE.Color(1, 1, 1));
  }
  const highlights = [];
  for (let i = 0; i < MAX_HIGHLIGHTS; i++) highlights.push(new THREE.Vector4(0, 0, 0, 0));
  const uniforms = {
    uTime: shared.uTime,
    uPrimary: shared.uPrimary,
    uSecondary: shared.uSecondary,
    uRipples: { value: ripples },
    uRippleColors: { value: rippleColors },
    uHighlights: { value: highlights },
    uHlColorA: { value: new THREE.Color(0x00f7ff) },
    uHlColorB: { value: new THREE.Color(0xffae2b) },
  };
  arena.floorUniforms = uniforms;

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorldPos;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        varying vec3 vWorldPos;
        uniform float uTime;
        uniform vec3 uPrimary, uSecondary, uHlColorA, uHlColorB;
        uniform vec4 uRipples[${MAX_RIPPLES}];
        uniform vec3 uRippleColors[${MAX_RIPPLES}];
        uniform vec4 uHighlights[${MAX_HIGHLIGHTS}];
        float tileHash(vec2 c) { return fract(sin(dot(c, vec2(12.9898, 78.233))) * 43758.5453); }`
      )
      .replace(
        '#include <map_fragment>',
        /* glsl */ `#include <map_fragment>
        {
          vec2 gq = (vWorldPos.xz + 30.0) / 6.0;
          float inA = step(-30.0, vWorldPos.x) * step(vWorldPos.x, 30.0) * step(-30.0, vWorldPos.z) * step(vWorldPos.z, 30.0);
          float tv = tileHash(floor(gq));
          diffuseColor.rgb *= mix(1.0, 0.75 + 0.5 * tv, inA);
        }`
      )
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `#include <emissivemap_fragment>
        {
          vec2 p = vWorldPos.xz;
          float inArena = step(-30.0, p.x) * step(p.x, 30.0) * step(-30.0, p.y) * step(p.y, 30.0);
          vec2 g = (p + 30.0) / 6.0;
          vec2 fw = fwidth(g);
          vec2 d = abs(fract(g + 0.5) - 0.5);
          vec2 lineAA = 1.0 - smoothstep(vec2(0.0), fw * 1.5 + 0.014, d);
          // fade lines out where they get thinner than a pixel (grazing angles)
          float far = 1.0 - smoothstep(0.08, 0.35, max(fw.x, fw.y));
          float line = max(lineAA.x, lineAA.y) * (0.25 + 0.75 * far);
          float halo = exp(-min(d.x, d.y) * 20.0) * far;
          float grad = clamp((p.x + 30.0) / 60.0 * 0.65 + (30.0 - p.y) / 60.0 * 0.35, 0.0, 1.0);
          vec3 gridCol = mix(uPrimary, uSecondary, grad);
          vec2 g2 = g * 3.0;
          vec2 d2 = abs(fract(g2 + 0.5) - 0.5);
          vec2 fine = 1.0 - smoothstep(vec2(0.0), fwidth(g2) * 1.2, d2);
          float fineLine = max(fine.x, fine.y) * 0.08;
          vec3 em = gridCol * (line * 1.25 + halo * 0.07 + fineLine * far) * inArena;

          // slow energy pulse travelling outward from the center
          float rc = length(p);
          float wave = 1.0 - clamp(abs(fract(rc * 0.018 - uTime * 0.22) - 0.5) * 7.0, 0.0, 1.0);
          em += gridCol * line * wave * 0.9 * inArena;

          for (int i = 0; i < ${MAX_RIPPLES}; i++) {
            vec4 r = uRipples[i];
            float age = uTime - r.z;
            if (age > 0.0 && age < 2.4) {
              float rad = age * 24.0;
              float dist = length(p - r.xy);
              float ring = exp(-pow((dist - rad) * 0.45, 2.0)) * (1.0 - age / 2.4);
              em += uRippleColors[i] * ring * r.w * (0.35 + line * 3.0);
            }
          }

          vec2 cell = floor(g);
          vec2 fc = fract(g) - 0.5;
          float edge = smoothstep(0.36, 0.47, max(abs(fc.x), abs(fc.y)));
          for (int i = 0; i < ${MAX_HIGHLIGHTS}; i++) {
            vec4 h = uHighlights[i];
            if (h.z > 0.0 && abs(cell.x - h.x) < 0.5 && abs(cell.y - h.y) < 0.5) {
              vec3 hc = h.w < 0.5 ? uHlColorA : uHlColorB;
              float pulse = 0.75 + 0.25 * sin(uTime * 8.0);
              em += hc * (edge * 3.0 + 0.22) * h.z * pulse * inArena;
            }
          }

          float deck = step(30.0, p.y) * step(abs(p.x), 30.0);
          float stripe = step(0.5, fract((p.x + p.y) * 0.5)) * step(p.y, 30.9);
          em += vec3(1.0, 0.62, 0.08) * stripe * 0.35 * deck;
          vec2 dg = p / 3.5;
          vec2 dd = abs(fract(dg + 0.5) - 0.5);
          vec2 dl = 1.0 - smoothstep(vec2(0.0), fwidth(dg) * 1.3, dd);
          em += gridCol * max(dl.x, dl.y) * 0.22 * deck;
          totalEmissiveRadiance += em;
        }`
      );
  };
  const floor = new THREE.Mesh(geo, mat);
  floor.receiveShadow = true;
  floor.userData.isFloor = true;
  arena.floor = floor;
  return floor;
}

function buildSlab(group) {
  const w = GRID_W * CELL + 4;
  const depth = DECK_MAX_Z - ARENA_MIN_Z + 4;
  const cz = ARENA_MIN_Z + (DECK_MAX_Z - ARENA_MIN_Z) / 2;
  const slab = new THREE.Mesh(
    new THREE.BoxGeometry(w, 5, depth),
    new THREE.MeshStandardMaterial({ color: 0x0b1020, roughness: 0.45, metalness: 0.85 })
  );
  slab.position.set(0, -2.56, cz);
  slab.receiveShadow = true;
  group.add(slab);

  // Lower tapered hull
  const hullGeo = new THREE.CylinderGeometry(1, 0.55, 14, 4, 1);
  hullGeo.rotateY(Math.PI / 4); // flat sides face the axes so scaling keeps a rectangle
  const hull = new THREE.Mesh(
    hullGeo,
    new THREE.MeshStandardMaterial({ color: 0x070a16, roughness: 0.6, metalness: 0.8, flatShading: true })
  );
  hull.scale.set(w * 0.45, 1, depth * 0.45);
  hull.position.set(0, -12, cz);
  group.add(hull);

  // Neon edge trims on the slab
  const trimMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(THEMES[0].primary).multiplyScalar(2.2) });
  arena.themed.push({ mat: trimMat, prop: 'color', which: 'primary', intensity: 2.2 });
  const trimGeoX = new THREE.BoxGeometry(w, 0.22, 0.22);
  const trimGeoZ = new THREE.BoxGeometry(0.22, 0.22, depth);
  [
    [0, -0.1, cz - depth / 2, trimGeoX],
    [0, -0.1, cz + depth / 2, trimGeoX],
    [-w / 2, -0.1, cz, trimGeoZ],
    [w / 2, -0.1, cz, trimGeoZ],
    [0, -5, cz - depth / 2, trimGeoX],
    [0, -5, cz + depth / 2, trimGeoX],
    [-w / 2, -5, cz, trimGeoZ],
    [w / 2, -5, cz, trimGeoZ],
  ].forEach(([x, y, z, g]) => {
    const m = new THREE.Mesh(g, trimMat);
    m.position.set(x, y, z);
    group.add(m);
  });

  // Thruster glows under the station
  const thrusterMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(THEMES[0].secondary).multiplyScalar(3) });
  arena.themed.push({ mat: thrusterMat, prop: 'color', which: 'secondary', intensity: 3 });
  const glowMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(THEMES[0].secondary),
    transparent: true,
    opacity: 0.35,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  arena.themed.push({ mat: glowMat, prop: 'color', which: 'secondary', intensity: 1 });
  const nozzle = new THREE.CylinderGeometry(3, 4, 2, 24, 1, true);
  const plume = new THREE.ConeGeometry(3.2, 26, 24, 1, true);
  plume.translate(0, -13, 0);
  [[-25, cz - 28], [25, cz - 28], [-25, cz + 28], [25, cz + 28]].forEach(([x, z]) => {
    const n = new THREE.Mesh(nozzle, thrusterMat);
    n.position.set(x, -6, z);
    group.add(n);
    const p = new THREE.Mesh(plume, glowMat);
    p.position.set(x, -7, z);
    group.add(p);
  });
}

function buildInfiniteGrid(group) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: shared.uTime,
      uPrimary: shared.uPrimary,
      uSecondary: shared.uSecondary,
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uPrimary, uSecondary;
      varying vec3 vWorld;
      void main() {
        vec2 p = vWorld.xz + vec2(0.0, uTime * 6.0);
        vec2 g = p / 16.0;
        vec2 d = abs(fract(g + 0.5) - 0.5);
        vec2 fw = fwidth(g);
        vec2 l = 1.0 - smoothstep(vec2(0.0), fw * 1.4, d);
        float line = max(l.x, l.y);
        float dist = length(vWorld.xz - cameraPosition.xz);
        float fade = exp(-dist * 0.0022) * smoothstep(0.0, 120.0, dist);
        vec3 col = mix(uSecondary, uPrimary, clamp(0.5 + vWorld.z / 1200.0, 0.0, 1.0));
        float a = line * fade * 0.9;
        gl_FragColor = vec4(col * 1.6, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), mat);
  plane.rotation.x = -Math.PI / 2;
  plane.position.y = -110;
  plane.renderOrder = -500;
  group.add(plane);
}

const hexWallFragment = /* glsl */ `
  uniform float uTime;
  uniform vec3 uPrimary, uSecondary;
  uniform float uDanger;
  uniform vec4 uHit;
  uniform float uLimit;
  varying vec2 vPlane;
  varying vec3 vWorld;
  float hexDist(vec2 p) {
    p = abs(p);
    return max(dot(p, normalize(vec2(1.0, 1.7320508))), p.x);
  }
  void main() {
    vec2 uv = vPlane / 3.2;
    vec2 r = vec2(1.0, 1.7320508);
    vec2 h = r * 0.5;
    vec2 a = mod(uv, r) - h;
    vec2 b = mod(uv - h, r) - h;
    vec2 gv = dot(a, a) < dot(b, b) ? a : b;
    float e = 1.0 - smoothstep(0.03, 0.09, 0.5 - hexDist(gv));
    float y = vWorld.y;
    float heightFade = smoothstep(0.0, 14.0, y) * (1.0 - smoothstep(uLimit - 4.0, uLimit, y));
    float bands = 0.5 + 0.5 * sin(y * 0.18 - uTime * 1.6);
    vec3 col = mix(uPrimary, uSecondary, clamp(y / uLimit, 0.0, 1.0));
    float alpha = (e * 0.1 * (0.4 + 0.6 * bands) + 0.006) * heightFade;
    // impact ripple
    float age = uTime - uHit.w;
    if (age > 0.0 && age < 1.2) {
      float dist = length(vWorld - uHit.xyz);
      float ring = exp(-pow((dist - age * 18.0) * 0.6, 2.0)) * (1.0 - age / 1.2);
      alpha += ring * (0.25 + e * 0.6);
      col = mix(col, vec3(1.0), ring * 0.4);
    }
    col = mix(col, vec3(1.0, 0.1, 0.2), uDanger * 0.7);
    alpha *= 1.0 + uDanger * 1.5;
    gl_FragColor = vec4(col * 1.5, alpha);
  }`;

function buildWalls(group) {
  const height = LIMIT_Y;
  const makeWall = (w, planeAxis) => {
    const uniforms = {
      uTime: shared.uTime,
      uPrimary: shared.uPrimary,
      uSecondary: shared.uSecondary,
      uDanger: shared.uDanger,
      uHit: { value: new THREE.Vector4(0, -100, 0, -100) },
      uLimit: { value: LIMIT_Y },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: /* glsl */ `
        varying vec2 vPlane;
        varying vec3 vWorld;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorld = wp.xyz;
          vPlane = ${planeAxis === 'z' ? 'vec2(wp.z, wp.y)' : 'vec2(wp.x, wp.y)'};
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: hexWallFragment,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    arena.wallMats.push(mat);
    return new THREE.Mesh(new THREE.PlaneGeometry(w, height), mat);
  };
  const left = makeWall(GRID_D * CELL, 'z');
  left.rotation.y = Math.PI / 2;
  left.position.set(ARENA_MIN_X, height / 2, 0);
  const right = makeWall(GRID_D * CELL, 'z');
  right.rotation.y = -Math.PI / 2;
  right.position.set(ARENA_MAX_X, height / 2, 0);
  const back = makeWall(GRID_W * CELL, 'x');
  back.position.set(0, height / 2, ARENA_MIN_Z);
  [left, right, back].forEach((w) => {
    w.renderOrder = 5;
    group.add(w);
  });
  arena.walls = { left, right, back };
}

function buildPylons(group) {
  const h = LIMIT_Y + 8;
  const pylonMat = new THREE.MeshStandardMaterial({ color: 0x121a30, roughness: 0.35, metalness: 0.9 });
  const stripMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(THEMES[0].primary).multiplyScalar(2.5) });
  arena.themed.push({ mat: stripMat, prop: 'color', which: 'primary', intensity: 2.5 });
  const tickMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(THEMES[0].secondary).multiplyScalar(2.0) });
  arena.themed.push({ mat: tickMat, prop: 'color', which: 'secondary', intensity: 2.0 });
  const dangerMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff1e4a).multiplyScalar(3) });
  arena.dangerMat = dangerMat;

  const body = new THREE.BoxGeometry(2.2, h, 2.2);
  const strip = new THREE.BoxGeometry(0.3, h - 2, 0.3);
  const tick = new THREE.BoxGeometry(1.2, 0.18, 1.2);
  const cap = new THREE.OctahedronGeometry(1.6, 0);
  [
    [ARENA_MIN_X, ARENA_MIN_Z, 1, 1],
    [ARENA_MAX_X, ARENA_MIN_Z, -1, 1],
    [ARENA_MIN_X, ARENA_MAX_Z, 1, -1],
    [ARENA_MAX_X, ARENA_MAX_Z, -1, -1],
  ].forEach(([x, z, sx, sz]) => {
    const p = new THREE.Mesh(body, pylonMat);
    p.position.set(x - sx * 1.1, h / 2, z - sz * 1.1);
    p.castShadow = false;
    p.receiveShadow = true;
    group.add(p);
    const s = new THREE.Mesh(strip, stripMat);
    s.position.set(x - sx * 0.05, h / 2, z - sz * 0.05);
    group.add(s);
    for (let i = 1; i <= MAX_STACK_GY; i++) {
      const t = new THREE.Mesh(tick, i === MAX_STACK_GY ? dangerMat : tickMat);
      t.position.set(x - sx * 1.1, i * CELL, z - sz * 1.1);
      t.scale.set(i % 5 === 0 ? 2.4 : 2.05, 1, i % 5 === 0 ? 2.4 : 2.05);
      group.add(t);
    }
    const c = new THREE.Mesh(cap, stripMat);
    c.position.set(x - sx * 1.1, h + 1.8, z - sz * 1.1);
    group.add(c);
    arena.caps = arena.caps || [];
    arena.caps.push(c);
  });
}

function buildDangerCeiling(group) {
  // Laser frame at the top-out height
  const frameMat = arena.dangerMat;
  const w = GRID_W * CELL;
  const d = GRID_D * CELL;
  const bx = new THREE.BoxGeometry(w, 0.25, 0.25);
  const bz = new THREE.BoxGeometry(0.25, 0.25, d);
  [
    [0, ARENA_MIN_Z, bx],
    [0, ARENA_MAX_Z, bx],
    [ARENA_MIN_X, 0, bz],
    [ARENA_MAX_X, 0, bz],
  ].forEach(([x, z, g]) => {
    const m = new THREE.Mesh(g, frameMat);
    m.position.set(x, LIMIT_Y, z);
    group.add(m);
  });

  const ceilMat = new THREE.ShaderMaterial({
    uniforms: { uTime: shared.uTime, uDanger: shared.uDanger },
    vertexShader: /* glsl */ `
      varying vec2 vP;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vP = wp.xz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uDanger;
      varying vec2 vP;
      void main() {
        vec2 g = (vP + 30.0) / 6.0;
        vec2 d = abs(fract(g + 0.5) - 0.5);
        vec2 l = 1.0 - smoothstep(vec2(0.0), fwidth(g) * 1.5 + 0.01, d);
        float line = max(l.x, l.y);
        float scan = 0.5 + 0.5 * sin((vP.x + vP.y) * 0.15 - uTime * 4.0);
        float a = (line * 0.5 + 0.04 + scan * 0.05) * (0.08 + uDanger * 0.92);
        gl_FragColor = vec4(vec3(1.0, 0.08, 0.2) * 2.0, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(w, d), ceilMat);
  ceil.rotation.x = -Math.PI / 2;
  ceil.position.y = LIMIT_Y;
  ceil.renderOrder = 6;
  group.add(ceil);
}

export function buildArena() {
  const group = new THREE.Group();
  group.add(buildFloor());
  buildSlab(group);
  buildInfiniteGrid(group);
  buildWalls(group);
  buildPylons(group);
  buildDangerCeiling(group);
  G.scene.add(group);
  arena.group = group;
  return group;
}

// ----------------------------------------------------------------- runtime --
export function addRipple(x, z, strength = 1, color = null) {
  const u = arena.floorUniforms;
  const i = arena.rippleIndex++ % MAX_RIPPLES;
  u.uRipples.value[i].set(x, z, shared.uTime.value, strength);
  u.uRippleColors.value[i].copy(color ? new THREE.Color(color) : shared.uPrimary.value);
}

export function setHighlight(i, gx, gz, strength, colorIndex = 0) {
  const h = arena.floorUniforms.uHighlights.value[i];
  if (!h) return;
  h.set(gx, gz, strength, colorIndex);
}

export function clearHighlights() {
  arena.floorUniforms.uHighlights.value.forEach((h) => h.set(0, 0, 0, 0));
}

export function wallHit(pos) {
  const { left, right, back } = arena.walls;
  let wall = null;
  if (pos.x <= ARENA_MIN_X + 2) wall = left;
  else if (pos.x >= ARENA_MAX_X - 2) wall = right;
  else if (pos.z <= ARENA_MIN_Z + 2) wall = back;
  if (!wall) return;
  const u = wall.material.uniforms.uHit.value;
  if (shared.uTime.value - u.w < 0.35) return;
  u.set(pos.x, pos.y, pos.z, shared.uTime.value);
}

const _from = { p: new THREE.Color(), s: new THREE.Color() };
export function applyThemeToArena(from, to, t) {
  shared.uPrimary.value.set(from.primary).lerp(_from.p.set(to.primary), t);
  shared.uSecondary.value.set(from.secondary).lerp(_from.s.set(to.secondary), t);
  arena.themed.forEach(({ mat, prop, which, intensity }) => {
    const src = which === 'primary' ? shared.uPrimary.value : shared.uSecondary.value;
    mat[prop].copy(src).multiplyScalar(intensity);
  });
  arena.floorUniforms.uHlColorA.value.copy(shared.uPrimary.value).lerp(new THREE.Color(1, 1, 1), 0.2);
}

export function updateArena(dt, time) {
  shared.uTime.value = time;
  const target = G.phase === 'playing' || G.phase === 'paused' ? Math.max(0, (G.danger - 0.55) / 0.45) : 0;
  shared.uDanger.value += (target - shared.uDanger.value) * Math.min(1, dt * 2.5);
  const pulse = 2 + shared.uDanger.value * (2 + 2 * Math.sin(time * 9));
  arena.dangerMat.color.setRGB(1, 0.12, 0.29).multiplyScalar(pulse);
  if (arena.caps) arena.caps.forEach((c, i) => (c.rotation.y = time * 0.8 + i));
}

export function getThemeColor(which) {
  return which === 'primary' ? shared.uPrimary.value : shared.uSecondary.value;
}
