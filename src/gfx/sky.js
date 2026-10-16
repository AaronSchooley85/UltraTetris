// ============================================================================
// DEEP SPACE: procedural nebula sky (baked to a cube map per sector theme and
// cross-faded), twinkling starfield, ringed gas giant, asteroid belt, drifting
// space dust and the occasional shooting star.
// ============================================================================
import * as THREE from 'three';
import { G } from '../state.js';
import { SIMPLEX_3D } from './noise.glsl.js';
import { planetRingTexture } from './textures.js';

const SUN_DIR = new THREE.Vector3(-0.55, 0.32, -0.77).normalize();

const nebulaFragment = /* glsl */ `
  uniform vec3 uTop, uBottom, uNebA, uNebB, uSun;
  uniform float uSeed;
  varying vec3 vDir;
  ${SIMPLEX_3D}
  void main() {
    vec3 d = normalize(vDir);
    float h = d.y * 0.5 + 0.5;
    vec3 col = mix(uBottom, uTop, smoothstep(0.05, 0.95, h));

    vec3 bandN = normalize(vec3(0.32, 1.0, 0.42));
    float bandDist = dot(d, bandN);
    float band = exp(-bandDist * bandDist * 9.0);

    vec3 q = d * 2.1 + uSeed;
    float warp = fbm3(q * 1.6);
    float n1 = fbm3(q + warp * 0.7);
    float n2 = fbm3(q * 2.3 + 7.3);
    float n3 = fbm3(q * 4.0 + 3.1);

    float neb = smoothstep(-0.15, 0.75, n1) * (0.28 + band * 1.0);
    vec3 nebCol = mix(uNebA, uNebB, smoothstep(-0.45, 0.55, n2));
    col += nebCol * neb * 0.75;
    col += mix(uNebB, vec3(1.0), 0.3) * pow(max(n1, 0.0), 3.0) * band * 0.9;
    // dark dust lanes cutting through the galactic band
    col *= 1.0 - smoothstep(0.15, 0.65, n3) * band * 0.55;
    // faint unresolved star haze along the band
    col += vec3(0.75, 0.8, 1.0) * band * 0.035 * (0.6 + 0.4 * n2);

    float sd = max(dot(d, normalize(vec3(-0.55, 0.32, -0.77))), 0.0);
    col += uSun * (pow(sd, 2400.0) * 2.2 + pow(sd, 120.0) * 0.14 + pow(sd, 12.0) * 0.05 + pow(sd, 2.0) * 0.025);
    gl_FragColor = vec4(col, 1.0);
  }`;

const dirVertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const blendFragment = /* glsl */ `
  uniform samplerCube uCubeA;
  uniform samplerCube uCubeB;
  uniform float uMix;
  varying vec3 vDir;
  void main() {
    vec3 d = normalize(vDir);
    vec3 a = textureCube(uCubeA, d).rgb;
    vec3 b = textureCube(uCubeB, d).rgb;
    gl_FragColor = vec4(mix(a, b, uMix), 1.0);
  }`;

const starVertex = /* glsl */ `
  attribute float aSize;
  attribute float aPhase;
  attribute vec3 aColor;
  uniform float uTime;
  uniform float uPixelRatio;
  varying vec3 vColor;
  varying float vTw;
  void main() {
    vColor = aColor;
    vTw = 0.65 + 0.35 * sin(uTime * (1.2 + aPhase * 2.5) + aPhase * 40.0);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uPixelRatio;
    gl_Position = projectionMatrix * mv;
  }`;
const starFragment = /* glsl */ `
  varying vec3 vColor;
  varying float vTw;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    float core = smoothstep(0.5, 0.0, d);
    float cross = max(smoothstep(0.08, 0.0, abs(c.x)), smoothstep(0.08, 0.0, abs(c.y))) * smoothstep(0.5, 0.1, d) * 0.5;
    float a = (core * core + cross) * vTw;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vColor * a * 2.2, 1.0);
  }`;

const planetVertex = /* glsl */ `
  varying vec3 vN;
  varying vec3 vPos;
  varying vec3 vWorld;
  void main() {
    vPos = position;
    vN = normalize(mat3(modelMatrix) * normal);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;
const planetFragment = /* glsl */ `
  uniform vec3 uSunDir;
  uniform vec3 uColA, uColB, uAtmo;
  uniform float uTime;
  varying vec3 vN;
  varying vec3 vPos;
  varying vec3 vWorld;
  ${SIMPLEX_3D}
  void main() {
    vec3 n = normalize(vN);
    vec3 p = normalize(vPos);
    float lat = p.y;
    float turb = fbm3(vec3(p.x * 3.0 + uTime * 0.01, p.y * 14.0, p.z * 3.0)) * 0.35;
    float bands = 0.5 + 0.5 * sin((lat + turb) * 26.0);
    float bands2 = 0.5 + 0.5 * sin((lat + turb * 1.6) * 61.0);
    vec3 base = mix(uColA, uColB, bands);
    base = mix(base, vec3(1.0, 0.95, 0.9), bands2 * 0.12);
    // storm spot
    vec2 sp = vec2(atan(p.z, p.x), lat) - vec2(1.2, -0.25);
    float storm = smoothstep(0.18, 0.0, length(sp * vec2(0.7, 2.2)));
    base = mix(base, uColB * 1.6, storm * 0.7);
    float diff = max(dot(n, uSunDir), 0.0);
    float terminator = smoothstep(-0.05, 0.25, dot(n, uSunDir));
    vec3 col = base * (0.04 + diff * 1.15) * (0.3 + terminator * 0.7);
    vec3 v = normalize(cameraPosition - vWorld);
    float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0);
    col += uAtmo * rim * (0.25 + terminator * 1.4);
    gl_FragColor = vec4(col, 1.0);
  }`;

const ringVertex = /* glsl */ `
  varying vec3 vLocal;
  varying vec3 vWorld;
  void main() {
    vLocal = position;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;
const ringFragment = /* glsl */ `
  uniform sampler2D uTex;
  uniform float uInner, uOuter;
  uniform vec3 uTint;
  uniform vec3 uPlanetCenter;
  uniform float uPlanetRadius;
  uniform vec3 uSunDir;
  varying vec3 vLocal;
  varying vec3 vWorld;
  void main() {
    float r = length(vLocal.xy);
    float t = (r - uInner) / (uOuter - uInner);
    if (t < 0.0 || t > 1.0) discard;
    vec4 tex = texture2D(uTex, vec2(t, 0.5));
    // planet shadow on the rings
    vec3 toP = uPlanetCenter - vWorld;
    float along = dot(toP, uSunDir);
    float shadow = 1.0;
    if (along < 0.0) {
      vec3 closest = vWorld + uSunDir * along;
      float dd = length(closest - uPlanetCenter);
      shadow = smoothstep(uPlanetRadius * 0.92, uPlanetRadius * 1.05, dd);
    }
    gl_FragColor = vec4(tex.rgb * uTint * (0.15 + 0.95 * shadow), tex.a * 0.85);
  }`;

export class SkySystem {
  constructor() {
    const { scene, renderer } = G;
    // Bake scene for the nebula cube maps
    this.bakeScene = new THREE.Scene();
    this.nebulaMat = new THREE.ShaderMaterial({
      uniforms: {
        uTop: { value: new THREE.Color() },
        uBottom: { value: new THREE.Color() },
        uNebA: { value: new THREE.Color() },
        uNebB: { value: new THREE.Color() },
        uSun: { value: new THREE.Color() },
        uSeed: { value: 0 },
      },
      vertexShader: dirVertex,
      fragmentShader: nebulaFragment,
      side: THREE.BackSide,
      depthWrite: false,
    });
    this.bakeScene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 64, 32), this.nebulaMat));
    const res = G.settings.quality === 'low' ? 384 : 768;
    this.cubeRTs = [0, 1].map(
      () => new THREE.WebGLCubeRenderTarget(res, { type: THREE.HalfFloatType, generateMipmaps: false })
    );
    this.cubeCam = new THREE.CubeCamera(0.1, 100, this.cubeRTs[0]);
    this.active = 0;

    // Background sphere that cross-fades between the two baked cubes
    this.blendMat = new THREE.ShaderMaterial({
      uniforms: {
        uCubeA: { value: this.cubeRTs[0].texture },
        uCubeB: { value: this.cubeRTs[1].texture },
        uMix: { value: 0 },
      },
      vertexShader: dirVertex,
      fragmentShader: blendFragment,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
    });
    this.skyGroup = new THREE.Group(); // follows the camera (objects at infinity)
    scene.add(this.skyGroup);
    const bg = new THREE.Mesh(new THREE.SphereGeometry(1500, 48, 24), this.blendMat);
    bg.renderOrder = -1000;
    bg.frustumCulled = false;
    this.skyGroup.add(bg);
    this.fade = 1; // 1 = fully on the active cube

    this._buildStars();
    this._buildPlanet();
    this._buildAsteroids();
    this._buildDust();
    this._buildShootingStars();
    this.renderer = renderer;
  }

  // Bake a theme's nebula into the inactive cube and start a cross-fade.
  setTheme(theme, instant = false) {
    const u = this.nebulaMat.uniforms;
    u.uTop.value.set(theme.skyTop);
    u.uBottom.value.set(theme.skyBottom);
    u.uNebA.value.set(theme.nebulaA);
    u.uNebB.value.set(theme.nebulaB);
    u.uSun.value.set(theme.sun);
    u.uSeed.value = (theme.name.length * 3.17) % 10;
    const target = instant ? this.active : 1 - this.active;
    this.cubeCam.renderTarget = this.cubeRTs[target];
    this.cubeCam.update(G.renderer, this.bakeScene);
    if (instant) {
      this.blendMat.uniforms.uCubeA.value = this.cubeRTs[target].texture;
      this.blendMat.uniforms.uCubeB.value = this.cubeRTs[target].texture;
      this.blendMat.uniforms.uMix.value = 0;
      this.fade = 1;
    } else {
      this.blendMat.uniforms.uCubeA.value = this.cubeRTs[this.active].texture;
      this.blendMat.uniforms.uCubeB.value = this.cubeRTs[target].texture;
      this.blendMat.uniforms.uMix.value = 0;
      this.active = target;
      this.fade = 0;
    }
    this.planetMat.uniforms.uAtmo.value.set(theme.primary).lerp(new THREE.Color(0xffffff), 0.25);
    this.dustMat.color.set(theme.primary);
  }

  _buildStars() {
    const count = 4200;
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const size = new Float32Array(count);
    const phase = new Float32Array(count);
    const palette = [0xffffff, 0xcfe8ff, 0x9fd0ff, 0xffd9a8, 0xffb3e6, 0xb8fff2].map((h) => new THREE.Color(h));
    for (let i = 0; i < count; i++) {
      const u = Math.random() * 2 - 1;
      const th = Math.random() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      const r = 1200;
      pos[i * 3] = s * Math.cos(th) * r;
      pos[i * 3 + 1] = u * r;
      pos[i * 3 + 2] = s * Math.sin(th) * r;
      const c = palette[Math.floor(Math.random() * palette.length)];
      const bright = 0.4 + Math.pow(Math.random(), 3) * 1.6;
      col[i * 3] = c.r * bright;
      col[i * 3 + 1] = c.g * bright;
      col[i * 3 + 2] = c.b * bright;
      size[i] = 1.5 + Math.pow(Math.random(), 6) * 7;
      phase[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    this.starMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uPixelRatio: { value: G.renderer.getPixelRatio() } },
      vertexShader: starVertex,
      fragmentShader: starFragment,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    const stars = new THREE.Points(geo, this.starMat);
    stars.frustumCulled = false;
    stars.renderOrder = -900;
    this.skyGroup.add(stars);
  }

  _buildPlanet() {
    this.planetMat = new THREE.ShaderMaterial({
      uniforms: {
        uSunDir: { value: SUN_DIR.clone() },
        uColA: { value: new THREE.Color(0x3a1d5c) },
        uColB: { value: new THREE.Color(0xd77a4a) },
        uAtmo: { value: new THREE.Color(0x7fd6ff) },
        uTime: { value: 0 },
      },
      vertexShader: planetVertex,
      fragmentShader: planetFragment,
      fog: false,
    });
    const planetPos = new THREE.Vector3(420, 260, -900);
    const radius = 150;
    const planet = new THREE.Mesh(new THREE.SphereGeometry(radius, 96, 48), this.planetMat);
    planet.position.copy(planetPos);
    planet.rotation.z = 0.35;
    planet.renderOrder = -800;
    this.skyGroup.add(planet);
    this.planet = planet;

    const ringMat = new THREE.ShaderMaterial({
      uniforms: {
        uTex: { value: planetRingTexture() },
        uInner: { value: radius * 1.35 },
        uOuter: { value: radius * 2.35 },
        uTint: { value: new THREE.Color(1.0, 0.9, 0.85) },
        uPlanetCenter: { value: new THREE.Vector3() },
        uPlanetRadius: { value: radius },
        uSunDir: { value: SUN_DIR.clone() },
      },
      vertexShader: ringVertex,
      fragmentShader: ringFragment,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      fog: false,
    });
    const ring = new THREE.Mesh(new THREE.RingGeometry(radius * 1.35, radius * 2.35, 160, 1), ringMat);
    ring.position.copy(planetPos);
    ring.rotation.set(-Math.PI / 2 + 0.42, 0.2, 0.35);
    ring.renderOrder = -799;
    this.skyGroup.add(ring);
    this.ringMat = ringMat;

    // a small moon
    const moon = new THREE.Mesh(
      new THREE.SphereGeometry(22, 48, 24),
      new THREE.MeshStandardMaterial({ color: 0x8a8fa8, roughness: 0.95, metalness: 0, fog: false })
    );
    moon.position.set(-560, 180, -700);
    this.skyGroup.add(moon);
  }

  _buildAsteroids() {
    const base = new THREE.IcosahedronGeometry(1, 2);
    const p = base.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const n = 1 + 0.28 * Math.sin(v.x * 4.1 + v.y * 2.3) * Math.cos(v.z * 3.7 - v.x * 1.3) + (Math.random() - 0.5) * 0.12;
      v.multiplyScalar(n);
      p.setXYZ(i, v.x, v.y, v.z);
    }
    base.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: 0x5a5866, roughness: 0.92, metalness: 0.1, flatShading: true });
    const count = 150;
    const mesh = new THREE.InstancedMesh(base, mat, count);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const e = new THREE.Euler();
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 200 + Math.random() * 260;
      const y = -70 + Math.random() * 160 + Math.sin(a * 3) * 20;
      e.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      q.setFromEuler(e);
      const sc = 1.5 + Math.pow(Math.random(), 3) * 14;
      s.set(sc, sc * (0.6 + Math.random() * 0.5), sc * (0.7 + Math.random() * 0.4));
      m.compose(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r), q, s);
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
    this.asteroids = new THREE.Group();
    this.asteroids.add(mesh);
    G.scene.add(this.asteroids);
  }

  _buildDust() {
    const count = 700;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 260;
      pos[i * 3 + 1] = Math.random() * 160 - 10;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 260;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.dustMat = new THREE.PointsMaterial({
      color: 0x00e5ff,
      size: 0.35,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });
    this.dust = new THREE.Points(geo, this.dustMat);
    this.dust.frustumCulled = false;
    G.scene.add(this.dust);
  }

  _buildShootingStars() {
    this.shooting = [];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array([3, 3, 3, 0, 0, 0]), 3));
    const mat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    for (let i = 0; i < 3; i++) {
      const line = new THREE.Line(geo.clone(), mat);
      line.visible = false;
      line.frustumCulled = false;
      this.skyGroup.add(line);
      this.shooting.push({ line, t: 0, life: 0, from: new THREE.Vector3(), dir: new THREE.Vector3() });
    }
    this.nextShoot = 4;
  }

  update(dt, time) {
    const cam = G.camera;
    this.skyGroup.position.copy(cam.position);
    this.starMat.uniforms.uTime.value = time;
    this.planetMat.uniforms.uTime.value = time;
    this.planet.rotation.y = time * 0.01;
    this.ringMat.uniforms.uPlanetCenter.value.copy(this.planet.position).add(this.skyGroup.position);
    this.asteroids.rotation.y = time * 0.006;

    if (this.fade < 1) {
      this.fade = Math.min(1, this.fade + dt / 2.8);
      const k = this.fade * this.fade * (3 - 2 * this.fade);
      this.blendMat.uniforms.uMix.value = k;
    }

    // Space dust drifts slowly upward and wraps around
    const dp = this.dust.geometry.attributes.position;
    for (let i = 0; i < dp.count; i++) {
      let y = dp.getY(i) + dt * 0.8;
      if (y > 150) y = -10;
      dp.setY(i, y);
    }
    dp.needsUpdate = true;

    this.nextShoot -= dt;
    if (this.nextShoot <= 0) {
      this.nextShoot = 5 + Math.random() * 10;
      const s = this.shooting.find((x) => !x.line.visible);
      if (s) {
        const a = Math.random() * Math.PI * 2;
        s.from.set(Math.cos(a) * 900, 300 + Math.random() * 500, Math.sin(a) * 900);
        s.dir.set(-Math.cos(a) + (Math.random() - 0.5), -0.35 - Math.random() * 0.3, -Math.sin(a) + (Math.random() - 0.5)).normalize();
        s.t = 0;
        s.life = 0.9 + Math.random() * 0.6;
        s.line.visible = true;
      }
    }
    this.shooting.forEach((s) => {
      if (!s.line.visible) return;
      s.t += dt;
      if (s.t >= s.life) {
        s.line.visible = false;
        return;
      }
      const head = s.from.clone().addScaledVector(s.dir, s.t * 900);
      const tail = head.clone().addScaledVector(s.dir, -120);
      const arr = s.line.geometry.attributes.position.array;
      arr[0] = head.x;
      arr[1] = head.y;
      arr[2] = head.z;
      arr[3] = tail.x;
      arr[4] = tail.y;
      arr[5] = tail.z;
      s.line.geometry.attributes.position.needsUpdate = true;
      const fade = Math.sin((s.t / s.life) * Math.PI) * 3;
      const c = s.line.geometry.attributes.color.array;
      c[0] = c[1] = c[2] = fade;
      s.line.geometry.attributes.color.needsUpdate = true;
    });
  }
}
