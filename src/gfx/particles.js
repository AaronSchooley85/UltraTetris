// ============================================================================
// VFX primitives: pooled GPU point particles, instanced shatter debris and
// soft shockwave rings.
// ============================================================================
import * as THREE from 'three';
import { G } from '../state.js';

const _c = new THREE.Color();

// ------------------------------------------------------------- particles --
export class ParticleSystem {
  constructor(max = 6000) {
    this.max = max;
    this.count = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.size0 = new Float32Array(max);
    this.mode = new Uint8Array(max); // 0 shrink, 1 constant, 2 grow

    const geo = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    this.aAlpha = new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.aPos);
    geo.setAttribute('aColor', this.aCol);
    geo.setAttribute('aSize', this.aSize);
    geo.setAttribute('aAlpha', this.aAlpha);
    geo.setDrawRange(0, 0);
    this.geo = geo;

    this.mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 600 } },
      vertexShader: /* glsl */ `
        attribute vec3 aColor;
        attribute float aSize;
        attribute float aAlpha;
        uniform float uScale;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vColor = aColor;
          vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = min(aSize * uScale / max(0.5, -mv.z), 320.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.0, d);
          a *= a;
          gl_FragColor = vec4(vColor * vAlpha * a, 1.0);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
    G.scene.add(this.points);
  }

  emit(x, y, z, vx, vy, vz, color, size, life, gravity = 0, drag = 0, mode = 0) {
    let i = this.count;
    if (i >= this.max) {
      i = Math.floor(Math.random() * this.max); // overwrite a random particle when saturated
    } else {
      this.count++;
    }
    const i3 = i * 3;
    this.pos[i3] = x;
    this.pos[i3 + 1] = y;
    this.pos[i3 + 2] = z;
    this.vel[i3] = vx;
    this.vel[i3 + 1] = vy;
    this.vel[i3 + 2] = vz;
    if (typeof color === 'number') _c.set(color);
    else _c.copy(color);
    this.col[i3] = _c.r;
    this.col[i3 + 1] = _c.g;
    this.col[i3 + 2] = _c.b;
    this.size0[i] = size;
    this.size[i] = size;
    this.alpha[i] = 1;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.grav[i] = gravity;
    this.drag[i] = drag;
    this.mode[i] = mode;
  }

  // Spherical burst. opts: color (hex or array of hex), speed [min,max],
  // life [min,max], size [min,max], gravity, drag, up (extra vy), mode, spread (pos jitter)
  burst(pos, count, opts = {}) {
    const brightness = opts.brightness || 1;
    const palette = (Array.isArray(opts.color) ? opts.color : [opts.color ?? 0xffffff]).map((h) =>
      new THREE.Color(h).multiplyScalar(brightness)
    );
    const [smin, smax] = opts.speed || [4, 14];
    const [lmin, lmax] = opts.life || [0.5, 1.1];
    const [zmin, zmax] = opts.size || [0.4, 1.0];
    const spread = opts.spread || 0;
    for (let n = 0; n < count; n++) {
      const u = Math.random() * 2 - 1;
      const th = Math.random() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      let dx = s * Math.cos(th);
      let dy = u;
      let dz = s * Math.sin(th);
      if (opts.flat) dy *= 0.15;
      if (opts.hemisphere) dy = Math.abs(dy);
      const sp = smin + Math.random() * (smax - smin);
      this.emit(
        pos.x + (Math.random() - 0.5) * spread,
        pos.y + (Math.random() - 0.5) * spread,
        pos.z + (Math.random() - 0.5) * spread,
        dx * sp,
        dy * sp + (opts.up || 0),
        dz * sp,
        palette[Math.floor(Math.random() * palette.length)],
        zmin + Math.random() * (zmax - zmin),
        lmin + Math.random() * (lmax - lmin),
        opts.gravity || 0,
        opts.drag ?? 1.2,
        opts.mode || 0
      );
    }
  }

  update(dt) {
    let i = 0;
    while (i < this.count) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this._kill(i);
        continue;
      }
      const i3 = i * 3;
      const dr = Math.exp(-this.drag[i] * dt);
      this.vel[i3] *= dr;
      this.vel[i3 + 1] = this.vel[i3 + 1] * dr - this.grav[i] * dt;
      this.vel[i3 + 2] *= dr;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      if (this.pos[i3 + 1] < 0.05 && this.vel[i3 + 1] < 0 && Math.abs(this.pos[i3]) < 30 && this.pos[i3 + 2] < 44 && this.pos[i3 + 2] > -30) {
        this.pos[i3 + 1] = 0.05;
        this.vel[i3 + 1] *= -0.3;
      }
      const k = this.life[i] / this.maxLife[i];
      this.alpha[i] = Math.min(1, k * 2.2);
      const m = this.mode[i];
      this.size[i] = m === 0 ? this.size0[i] * (0.3 + 0.7 * k) : m === 2 ? this.size0[i] * (1 + (1 - k) * 2.5) : this.size0[i];
      i++;
    }
    this.geo.setDrawRange(0, this.count);
    if (this.count > 0) {
      this.aPos.needsUpdate = true;
      this.aCol.needsUpdate = true;
      this.aSize.needsUpdate = true;
      this.aAlpha.needsUpdate = true;
    }
    const cam = G.camera;
    const h = G.renderer.getDrawingBufferSize(_v2).y;
    this.mat.uniforms.uScale.value = h / (2 * Math.tan((cam.fov * Math.PI) / 360));
  }

  _kill(i) {
    const last = --this.count;
    if (i === last) return;
    const i3 = i * 3;
    const l3 = last * 3;
    for (let k = 0; k < 3; k++) {
      this.pos[i3 + k] = this.pos[l3 + k];
      this.vel[i3 + k] = this.vel[l3 + k];
      this.col[i3 + k] = this.col[l3 + k];
    }
    this.size[i] = this.size[last];
    this.size0[i] = this.size0[last];
    this.alpha[i] = this.alpha[last];
    this.life[i] = this.life[last];
    this.maxLife[i] = this.maxLife[last];
    this.grav[i] = this.grav[last];
    this.drag[i] = this.drag[last];
    this.mode[i] = this.mode[last];
  }

  clear() {
    this.count = 0;
    this.geo.setDrawRange(0, 0);
  }
}
const _v2 = new THREE.Vector2();

// ---------------------------------------------------------------- debris --
export class Debris {
  constructor(max = 1200) {
    this.max = max;
    this.count = 0;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0.5 });
    mat.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n#ifdef USE_INSTANCING_COLOR\n totalEmissiveRadiance += vColor.rgb * 1.6;\n#endif'
      );
    };
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    // Initialise instanceColor so the shader compiles with instance colors
    for (let i = 0; i < max; i++) this.mesh.setColorAt(i, _c.set(0xffffff));
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    G.scene.add(this.mesh);

    this.p = new Float32Array(max * 3);
    this.v = new Float32Array(max * 3);
    this.axis = new Float32Array(max * 3);
    this.ang = new Float32Array(max);
    this.angVel = new Float32Array(max);
    this.scale = new Float32Array(max);
    this.life = new Float32Array(max);
    this.colors = new Float32Array(max * 3);
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._ax = new THREE.Vector3();
    this._pos = new THREE.Vector3();
    this._s = new THREE.Vector3();
  }

  spawn(pos, color, n = 10, opts = {}) {
    const speed = opts.speed || 16;
    const size = opts.size || 1.4;
    const box = opts.box || 2.6;
    _c.set(color);
    for (let k = 0; k < n; k++) {
      let i = this.count;
      if (i >= this.max) i = Math.floor(Math.random() * this.max);
      else this.count++;
      const i3 = i * 3;
      this.p[i3] = pos.x + (Math.random() - 0.5) * box;
      this.p[i3 + 1] = pos.y + (Math.random() - 0.5) * box;
      this.p[i3 + 2] = pos.z + (Math.random() - 0.5) * box;
      const dx = this.p[i3] - pos.x;
      const dy = this.p[i3 + 1] - pos.y;
      const dz = this.p[i3 + 2] - pos.z;
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      const sp = speed * (0.4 + Math.random() * 0.8);
      this.v[i3] = (dx / len) * sp + (opts.vx || 0);
      this.v[i3 + 1] = (dy / len) * sp + (opts.up ?? 8) * Math.random();
      this.v[i3 + 2] = (dz / len) * sp + (opts.vz || 0);
      this._ax.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      this.axis[i3] = this._ax.x;
      this.axis[i3 + 1] = this._ax.y;
      this.axis[i3 + 2] = this._ax.z;
      this.ang[i] = Math.random() * 6;
      this.angVel[i] = (Math.random() - 0.5) * 18;
      this.scale[i] = size * (0.35 + Math.random() * 0.9);
      this.life[i] = (opts.life || 1.8) * (0.6 + Math.random() * 0.6);
      const b = 0.6 + Math.random() * 0.6;
      this.colors[i3] = _c.r * b;
      this.colors[i3 + 1] = _c.g * b;
      this.colors[i3 + 2] = _c.b * b;
    }
  }

  update(dt) {
    let i = 0;
    const m = this._m;
    while (i < this.count) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this._kill(i);
        continue;
      }
      const i3 = i * 3;
      this.v[i3 + 1] -= 34 * dt;
      this.p[i3] += this.v[i3] * dt;
      this.p[i3 + 1] += this.v[i3 + 1] * dt;
      this.p[i3 + 2] += this.v[i3 + 2] * dt;
      if (this.p[i3 + 1] < 0.4 && Math.abs(this.p[i3]) < 32 && this.p[i3 + 2] < 46 && this.p[i3 + 2] > -32) {
        this.p[i3 + 1] = 0.4;
        if (this.v[i3 + 1] < 0) this.v[i3 + 1] *= -0.32;
        this.v[i3] *= 0.75;
        this.v[i3 + 2] *= 0.75;
        this.angVel[i] *= 0.8;
      }
      this.ang[i] += this.angVel[i] * dt;
      this._ax.set(this.axis[i3], this.axis[i3 + 1], this.axis[i3 + 2]);
      this._q.setFromAxisAngle(this._ax, this.ang[i]);
      const s = this.scale[i] * Math.min(1, this.life[i] / 0.5);
      this._s.set(s, s, s);
      this._pos.set(this.p[i3], this.p[i3 + 1], this.p[i3 + 2]);
      m.compose(this._pos, this._q, this._s);
      this.mesh.setMatrixAt(i, m);
      _c.setRGB(this.colors[i3], this.colors[i3 + 1], this.colors[i3 + 2]);
      this.mesh.setColorAt(i, _c);
      i++;
    }
    this.mesh.count = this.count;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  _kill(i) {
    const last = --this.count;
    if (i === last) return;
    const i3 = i * 3;
    const l3 = last * 3;
    for (let k = 0; k < 3; k++) {
      this.p[i3 + k] = this.p[l3 + k];
      this.v[i3 + k] = this.v[l3 + k];
      this.axis[i3 + k] = this.axis[l3 + k];
      this.colors[i3 + k] = this.colors[l3 + k];
    }
    this.ang[i] = this.ang[last];
    this.angVel[i] = this.angVel[last];
    this.scale[i] = this.scale[last];
    this.life[i] = this.life[last];
  }

  clear() {
    this.count = 0;
    this.mesh.count = 0;
  }
}

// ------------------------------------------------------------ shockwaves --
const ringFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uProgress;
  uniform float uThickness;
  varying vec2 vUv;
  void main() {
    float d = length(vUv * 2.0 - 1.0);
    float r = 0.15 + uProgress * 0.85;
    float ring = exp(-pow((d - r) / uThickness, 2.0));
    float a = ring * (1.0 - uProgress) * (1.0 - uProgress);
    if (d > 1.0) discard;
    gl_FragColor = vec4(uColor * a * 2.2, 1.0);
  }`;
const ringVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

export class Shockwaves {
  constructor(poolSize = 32) {
    this.pool = [];
    const geo = new THREE.PlaneGeometry(2, 2);
    for (let i = 0; i < poolSize; i++) {
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: new THREE.Color() },
          uProgress: { value: 0 },
          uThickness: { value: 0.08 },
        },
        vertexShader: ringVertex,
        fragmentShader: ringFragment,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      mesh.renderOrder = 11;
      mesh.frustumCulled = false;
      G.scene.add(mesh);
      this.pool.push({ mesh, mat, t: 0, life: 1, radius: 10, billboard: false, active: false });
    }
  }

  // opts: radius, life, thickness, horizontal (lies flat), billboard (faces camera)
  spawn(pos, color, opts = {}) {
    const r = this.pool.find((p) => !p.active) || this.pool[0];
    r.active = true;
    r.t = 0;
    r.life = opts.life || 0.7;
    r.radius = opts.radius || 12;
    r.billboard = !opts.horizontal;
    r.mesh.visible = true;
    r.mesh.position.copy(pos);
    r.mesh.rotation.set(opts.horizontal ? -Math.PI / 2 : 0, 0, 0);
    r.mat.uniforms.uColor.value.set(color).multiplyScalar(opts.brightness || 1);
    r.mat.uniforms.uThickness.value = opts.thickness || 0.08;
    r.mat.uniforms.uProgress.value = 0;
    r.mesh.scale.setScalar(r.radius);
  }

  update(dt) {
    const cam = G.camera;
    this.pool.forEach((r) => {
      if (!r.active) return;
      r.t += dt;
      const k = r.t / r.life;
      if (k >= 1) {
        r.active = false;
        r.mesh.visible = false;
        return;
      }
      r.mat.uniforms.uProgress.value = 1 - Math.pow(1 - k, 2.2);
      if (r.billboard) r.mesh.quaternion.copy(cam.quaternion);
    });
  }

  clear() {
    this.pool.forEach((r) => {
      r.active = false;
      r.mesh.visible = false;
    });
  }
}
