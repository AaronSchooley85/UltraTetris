// ============================================================================
// Energy beams: the plasma tether between beacons, laser lances and
// line-clear sweeps. Shader core + soft glow + spiralling lightning strands,
// travelling rings and endpoint flares.
// ============================================================================
import * as THREE from 'three';
import { SIMPLEX_3D } from './noise.glsl.js';
import { softDotTexture } from './textures.js';

const UP = new THREE.Vector3(0, 1, 0);

const beamVertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vN;
  varying vec3 vWorld;
  void main() {
    vUv = uv;
    vN = normalize(mat3(modelMatrix) * normal);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;

const coreFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime, uLen, uIntensity, uSoft;
  varying vec2 vUv;
  varying vec3 vN;
  varying vec3 vWorld;
  ${SIMPLEX_3D}
  void main() {
    vec3 v = normalize(cameraPosition - vWorld);
    float facing = abs(dot(normalize(vN), v));
    float core = pow(facing, mix(3.5, 1.2, uSoft));
    float n = snoise(vec3(vUv.x * 6.2831, vUv.y * uLen * 0.18 - uTime * 7.0, uTime * 0.6)) * 0.5 + 0.5;
    float n2 = snoise(vec3(vUv.x * 12.0, vUv.y * uLen * 0.5 - uTime * 13.0, 3.0)) * 0.5 + 0.5;
    float ends = smoothstep(0.0, 0.03, vUv.y) * smoothstep(1.0, 0.97, vUv.y);
    float a = (core * (0.65 + n * 0.5) + n2 * n * 0.25 * facing) * uIntensity * ends;
    vec3 col = mix(uColor, vec3(1.0), core * (1.0 - uSoft) * 0.45);
    gl_FragColor = vec4(col * a * mix(1.7, 0.8, uSoft), 1.0);
  }`;

function makeBeamMaterial(color, soft) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uTime: { value: 0 },
      uLen: { value: 10 },
      uIntensity: { value: 1 },
      uSoft: { value: soft },
    },
    vertexShader: beamVertex,
    fragmentShader: coreFragment,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 24, 1, true);

export class EnergyBeam {
  constructor(scene, opts = {}) {
    this.coreRadius = opts.coreRadius ?? 0.5;
    this.glowRadius = opts.glowRadius ?? 1.6;
    this.group = new THREE.Group();
    this.group.visible = false;
    this.group.renderOrder = 12;
    this.coreMat = makeBeamMaterial(opts.color ?? 0x00f7ff, 0);
    this.glowMat = makeBeamMaterial(opts.glowColor ?? opts.color ?? 0x00f7ff, 1);
    this.glowMat.uniforms.uIntensity.value = 0.55;
    this.core = new THREE.Mesh(cylGeo, this.coreMat);
    this.glow = new THREE.Mesh(cylGeo, this.glowMat);
    this.core.frustumCulled = false;
    this.glow.frustumCulled = false;
    this.group.add(this.glow, this.core);

    this.segments = opts.segments ?? 48;
    this.strands = [];
    const strandColors = opts.strandColors ?? [0x00f7ff, 0xffaa2b, 0xff2be2];
    strandColors.forEach((c, s) => {
      const positions = new Float32Array((this.segments + 1) * 3);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const mat = new THREE.LineBasicMaterial({
        color: new THREE.Color(c).multiplyScalar(2.2),
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const line = new THREE.Line(geo, mat);
      line.frustumCulled = false;
      this.group.add(line);
      this.strands.push({ line, positions, mat, phase: (s * Math.PI * 2) / strandColors.length });
    });

    this.rings = [];
    const ringCount = opts.rings ?? 5;
    const ringGeo = new THREE.TorusGeometry(1, 0.08, 8, 32);
    for (let r = 0; r < ringCount; r++) {
      const mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(r % 2 === 0 ? opts.color ?? 0x00f7ff : opts.ringAlt ?? 0xffbe3b).multiplyScalar(2),
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(ringGeo, mat);
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.rings.push({ mesh, mat, offset: r / ringCount });
    }

    const flareMat = new THREE.SpriteMaterial({
      map: softDotTexture(),
      color: new THREE.Color(opts.color ?? 0x00f7ff).multiplyScalar(2.5),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.flareA = new THREE.Sprite(flareMat);
    this.flareB = new THREE.Sprite(flareMat);
    this.flareMat = flareMat;
    this.flareA.scale.setScalar(6);
    this.flareB.scale.setScalar(6);
    this.group.add(this.flareA, this.flareB);

    this.a = new THREE.Vector3();
    this.b = new THREE.Vector3();
    this.intensity = 1;
    this.ringSpeed = 0.95;
    this.thickness = 1;
    scene.add(this.group);
  }

  setColor(color, glow = color) {
    this.coreMat.uniforms.uColor.value.set(color);
    this.glowMat.uniforms.uColor.value.set(glow);
    this.flareMat.color.set(color).multiplyScalar(2.5);
  }

  set visible(v) {
    this.group.visible = v;
  }

  get visible() {
    return this.group.visible;
  }

  setEndpoints(a, b) {
    this.a.copy(a);
    this.b.copy(b);
  }

  update(dt, time) {
    if (!this.group.visible) return;
    const delta = new THREE.Vector3().subVectors(this.b, this.a);
    const len = Math.max(0.1, delta.length());
    const mid = new THREE.Vector3().addVectors(this.a, this.b).multiplyScalar(0.5);
    const dir = delta.clone().divideScalar(len);
    const quat = new THREE.Quaternion().setFromUnitVectors(UP, dir);
    const th = this.thickness;

    const wob = 1 + Math.sin(time * 35) * 0.12;
    this.core.position.copy(mid);
    this.core.quaternion.copy(quat);
    this.core.scale.set(this.coreRadius * th * wob, len, this.coreRadius * th * wob);
    this.glow.position.copy(mid);
    this.glow.quaternion.copy(quat);
    this.glow.scale.set(this.glowRadius * th, len, this.glowRadius * th);
    [this.coreMat, this.glowMat].forEach((m) => {
      m.uniforms.uTime.value = time;
      m.uniforms.uLen.value = len;
    });
    this.coreMat.uniforms.uIntensity.value = this.intensity;
    this.glowMat.uniforms.uIntensity.value = this.intensity * 0.55;

    // perpendicular basis for the spiralling strands
    const perp1 = new THREE.Vector3(1, 0, 0);
    if (Math.abs(dir.x) > 0.9) perp1.set(0, 0, 1);
    perp1.cross(dir).normalize();
    const perp2 = new THREE.Vector3().crossVectors(dir, perp1).normalize();
    const p = new THREE.Vector3();
    this.strands.forEach((st, sIdx) => {
      const arr = st.positions;
      for (let i = 0; i <= this.segments; i++) {
        const t = i / this.segments;
        p.lerpVectors(this.a, this.b, t);
        const env = Math.sin(t * Math.PI);
        const radius = (this.coreRadius * 1.8 + Math.sin(time * 9 + sIdx) * 0.35) * env * th;
        const ang = t * len * 0.35 - time * (14 + sIdx * 3) + st.phase;
        const jitter = (Math.random() - 0.5) * 0.3 * env;
        const c = Math.cos(ang) * radius + jitter;
        const s = Math.sin(ang) * radius + jitter;
        arr[i * 3] = p.x + perp1.x * c + perp2.x * s;
        arr[i * 3 + 1] = p.y + perp1.y * c + perp2.y * s;
        arr[i * 3 + 2] = p.z + perp1.z * c + perp2.z * s;
      }
      st.line.geometry.attributes.position.needsUpdate = true;
      st.mat.opacity = Math.min(1, this.intensity);
    });

    this.rings.forEach((r) => {
      const t = (time * this.ringSpeed + r.offset) % 1;
      r.mesh.position.lerpVectors(this.a, this.b, t);
      r.mesh.quaternion.copy(quat);
      r.mesh.rotateX(Math.PI / 2);
      const s = (0.6 + Math.sin(t * Math.PI) * 0.9) * this.coreRadius * 2.6 * th;
      r.mesh.scale.setScalar(s);
      r.mat.opacity = 0.85 * Math.min(1, this.intensity) * Math.sin(t * Math.PI);
    });

    const fs = (5 + Math.sin(time * 20) * 0.8) * th;
    this.flareA.position.copy(this.a);
    this.flareB.position.copy(this.b);
    this.flareA.scale.setScalar(fs);
    this.flareB.scale.setScalar(fs);
    this.flareMat.opacity = Math.min(1, this.intensity);
  }
}

// One-shot beams (laser lance, line sweep) that flare and fade out.
export class BeamBursts {
  constructor(scene, pool = 6) {
    this.items = [];
    for (let i = 0; i < pool; i++) {
      const beam = new EnergyBeam(scene, {
        coreRadius: 0.8,
        glowRadius: 2.6,
        rings: 3,
        strandColors: [0xffffff, 0xffffff],
      });
      this.items.push({ beam, t: 0, life: 0.6, active: false, thick: 1 });
    }
  }

  fire(a, b, color, opts = {}) {
    const it = this.items.find((x) => !x.active) || this.items[0];
    it.active = true;
    it.t = 0;
    it.life = opts.life ?? 0.55;
    it.thick = opts.thickness ?? 1;
    it.beam.setEndpoints(a, b);
    it.beam.setColor(color, opts.glow ?? color);
    it.beam.ringSpeed = opts.ringSpeed ?? 2.5;
    it.beam.strands.forEach((s) => s.mat.color.set(opts.strand ?? color).multiplyScalar(2.5));
    it.beam.visible = true;
  }

  update(dt, time) {
    this.items.forEach((it) => {
      if (!it.active) return;
      it.t += dt;
      const k = it.t / it.life;
      if (k >= 1) {
        it.active = false;
        it.beam.visible = false;
        return;
      }
      it.beam.intensity = k < 0.15 ? 1.6 : 1.6 * (1 - (k - 0.15) / 0.85);
      it.beam.thickness = it.thick * (k < 0.12 ? k / 0.12 : 1 - (k - 0.12) * 0.6);
      it.beam.update(dt, time);
    });
  }

  clear() {
    this.items.forEach((it) => {
      it.active = false;
      it.beam.visible = false;
    });
  }
}
