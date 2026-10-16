// ============================================================================
// DUAL-BEACON LAUNCHER & PLASMA TETHER
// Aim raycasting, beacon / torque / nova projectiles, beacon emitters, the
// tether that drags the piece until the two beacons align vertically, and
// the landing-prediction hologram.
// ============================================================================
import * as THREE from 'three';
import { G } from '../state.js';
import { CELL, GRID_W, GRID_D, ARENA_MIN_X, ARENA_MIN_Z, ARENA_MAX_Z, POWERUPS } from '../config.js';
import { getRaycastTargets, worldToCellXZ, cellCenter, boardGroup } from './board.js';
import { tryMove, rotatePiece, canOccupyFloat, computeLanding, pieceGroup } from './piece.js';
import { arena, setHighlight } from '../gfx/arena.js';
import { EnergyBeam } from '../gfx/beam.js';
import { createGhostMaterial, createGhostEdgeMaterial, createGhostCell } from '../gfx/blocks.js';
import { softDotTexture } from '../gfx/textures.js';
import { audio } from '../audio/audio.js';
import { fx, fxSparks } from '../gfx/fx.js';
import { emit, on } from '../events.js';

const SKY_COLOR = 0xffae2b;
const GROUND_COLOR = 0x00f7ff;
const TORQUE_COLOR = 0xff2be2;

export const beacons = {
  sky: { active: false, seg: -1, mesh: null },
  ground: { active: false, gx: -1, gy: -1, gz: -1, pos: new THREE.Vector3(), mesh: null },
  projectiles: [],
  aligned: false,
  alignCooldown: 0,
  rotateCooldown: 0,
};

const raycaster = new THREE.Raycaster();
const CENTER = new THREE.Vector2(0, 0);
let highlightBox, highlightMat, tether, previewGroup, previewCells = [];

// The point light lives outside the toggled body so the scene's light count
// never changes (which would force every material to recompile).
function makeEmitter(color, isSky) {
  const root = new THREE.Group();
  const g = new THREE.Group();
  root.add(g);
  const baseMat = new THREE.MeshStandardMaterial({
    color: 0x1a2236,
    emissive: color,
    emissiveIntensity: 1.4,
    roughness: 0.25,
    metalness: 0.9,
  });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.35, 0.42, 32), baseMat);
  g.add(base);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.62, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffffff).multiplyScalar(3) }));
  dome.position.y = 0.2;
  g.add(dome);
  const ringMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(color).multiplyScalar(2.5),
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const ring1 = new THREE.Mesh(new THREE.TorusGeometry(1.7, 0.07, 8, 48), ringMat);
  ring1.rotation.x = Math.PI / 2;
  ring1.position.y = 0.3;
  const ring2 = new THREE.Mesh(new THREE.TorusGeometry(2.3, 0.05, 8, 48), ringMat);
  ring2.rotation.x = Math.PI / 2;
  ring2.position.y = 0.3;
  g.add(ring1, ring2);
  const glow = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: softDotTexture(), color: new THREE.Color(color).multiplyScalar(2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  glow.scale.setScalar(7);
  glow.position.y = 0.4;
  g.add(glow);
  const light = new THREE.PointLight(color, 0, 30, 1.6);
  light.position.y = isSky ? -1.4 : 1.4;
  root.add(light);
  if (isSky) g.rotation.x = Math.PI;
  g.visible = false;
  root.userData = { ring1, ring2, light, glow, body: g };
  Object.defineProperty(root, 'shown', {
    get: () => g.visible,
    set: (v) => {
      g.visible = v;
      if (!v) light.intensity = 0;
    },
  });
  G.scene.add(root);
  return root;
}

export function initBeacons() {
  beacons.sky.mesh = makeEmitter(SKY_COLOR, true);
  beacons.ground.mesh = makeEmitter(GROUND_COLOR, false);

  highlightMat = new THREE.LineBasicMaterial({ color: GROUND_COLOR, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
  highlightBox = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(CELL * 1.03, CELL * 1.03, CELL * 1.03)), highlightMat);
  highlightBox.visible = false;
  highlightBox.renderOrder = 20;
  G.scene.add(highlightBox);

  tether = new EnergyBeam(G.scene, { color: GROUND_COLOR, glowColor: 0x3fa0ff, coreRadius: 0.42, glowRadius: 1.5, strandColors: [GROUND_COLOR, SKY_COLOR, TORQUE_COLOR] });

  previewGroup = new THREE.Group();
  const pm = createGhostMaterial(0xffffff);
  pm.uniforms.uOpacity.value = 0.55;
  const pe = createGhostEdgeMaterial(0xffffff);
  pe.opacity = 0.45;
  for (let i = 0; i < 4; i++) {
    const c = createGhostCell(pm, pe);
    previewGroup.add(c);
    previewCells.push(c);
  }
  previewGroup.visible = false;
  previewGroup.userData.mat = pm;
  G.scene.add(previewGroup);

  on('pieceSpawned', () => clearBeacons(true));
  on('pieceMorphed', () => clearBeacons(true));
}

export function clearBeacons(silent = false) {
  const hadAny = beacons.sky.active || beacons.ground.active;
  beacons.sky.active = false;
  beacons.sky.seg = -1;
  beacons.sky.mesh.shown = false;
  beacons.ground.active = false;
  beacons.ground.mesh.shown = false;
  beacons.aligned = false;
  tether.visible = false;
  audio.setPlasma(false);
  if (hadAny && !silent) audio.tone({ type: 'sine', f0: 600, f1: 200, dur: 0.15, vol: 0.06 });
  emit('beaconsChanged');
}

export function clearProjectiles() {
  beacons.projectiles.forEach((p) => G.scene.remove(p.mesh));
  beacons.projectiles.length = 0;
}

function skyBeaconPos(out) {
  const P = G.piece;
  if (!beacons.sky.active || !P || !P.segs[beacons.sky.seg]) return null;
  const s = P.segs[beacons.sky.seg].position;
  return out.set(s.x, s.y - CELL * 0.49, s.z);
}

function attachSky(seg) {
  const wasLinked = beacons.sky.active && beacons.ground.active;
  beacons.sky.active = true;
  beacons.sky.seg = seg;
  beacons.sky.mesh.shown = true;
  audio.beaconStick(true);
  if (beacons.ground.active && !wasLinked) engage();
  emit('beaconsChanged');
}

function attachGround(gx, gy, gz) {
  const wasLinked = beacons.sky.active && beacons.ground.active;
  const g = beacons.ground;
  g.active = true;
  g.gx = gx;
  g.gy = gy;
  g.gz = gz;
  g.pos.set(ARENA_MIN_X + (gx + 0.5) * CELL, gy >= 0 ? (gy + 1) * CELL : 0.06, ARENA_MIN_Z + (gz + 0.5) * CELL);
  g.mesh.position.copy(g.pos);
  g.mesh.shown = true;
  audio.beaconStick(false);
  if (beacons.sky.active && !wasLinked) engage();
  emit('beaconsChanged');
}

function engage() {
  audio.plasmaEngage();
  emit('tetherEngaged');
}

// ------------------------------------------------------------------- aim --
// Updates G.aim with what the crosshair is over.
export function updateAim() {
  // Matrices normally refresh at render time; bring them up to date first so
  // the crosshair never tests against last frame's positions.
  G.camera.updateMatrixWorld();
  pieceGroup.updateMatrixWorld();
  boardGroup.updateMatrixWorld();
  raycaster.setFromCamera(CENTER, G.camera);
  raycaster.far = 500;
  const weapon = G.loadedWeapon;
  const targets = [...getRaycastTargets()];
  const P = G.piece;
  if (P && !weapon) P.segs.forEach((s) => targets.push(s));
  targets.push(arena.floor);
  const hits = raycaster.intersectObjects(targets, false);
  let aim = null;
  for (const hit of hits) {
    const d = hit.object.userData;
    if (d.isFalling && P) {
      aim = { type: 'sky', seg: d.segmentIndex, point: hit.point.clone() };
      break;
    }
    if (d.isPlaced) {
      aim = { type: 'ground', gx: d.gx, gy: d.gy, gz: d.gz, point: hit.point.clone(), normal: hit.face ? hit.face.normal.clone() : null };
      break;
    }
    if (d.isFloor) {
      const p = hit.point;
      if (Math.abs(p.x) <= 30 && p.z >= ARENA_MIN_Z && p.z <= ARENA_MAX_Z) {
        const { gx, gz } = worldToCellXZ(p.x, p.z);
        aim = { type: 'ground', gx, gy: -1, gz, point: p.clone() };
      }
      break;
    }
  }
  G.aim = aim;

  // Visual highlight
  if (aim && aim.type === 'sky') {
    const seg = P.segs[aim.seg];
    highlightBox.visible = true;
    highlightBox.position.copy(seg.position);
    highlightBox.quaternion.copy(seg.quaternion);
    highlightBox.scale.set(1, 1, 1);
    highlightMat.color.set(SKY_COLOR);
  } else if (aim && aim.type === 'ground') {
    highlightBox.visible = true;
    highlightBox.quaternion.identity();
    if (aim.gy >= 0) {
      cellCenter(aim.gx, aim.gy, aim.gz, highlightBox.position);
      highlightBox.scale.set(1, 1, 1);
    } else {
      cellCenter(aim.gx, 0, aim.gz, highlightBox.position);
      highlightBox.position.y = 0.2;
      highlightBox.scale.set(1, 0.05, 1);
    }
    highlightMat.color.set(weapon ? POWERUPS[weapon].color : GROUND_COLOR);
  } else {
    highlightBox.visible = false;
  }
  updatePreview();
}

// Hologram of where the piece will land if anchored at the aimed cell.
function updatePreview() {
  const P = G.piece;
  const aim = G.aim;
  let show = false;
  if (P && beacons.sky.active && !G.loadedWeapon) {
    let gx = null, gz = null;
    if (aim && aim.type === 'ground') {
      gx = aim.gx;
      gz = aim.gz;
    } else if (beacons.ground.active && !beacons.aligned) {
      gx = beacons.ground.gx;
      gz = beacons.ground.gz;
    }
    const off = P.cells[beacons.sky.seg];
    if (gx !== null && off) {
      const tx = gx - off[0];
      const tz = gz - off[2];
      if (!(tx === P.gx && tz === P.gz) && canOccupyFloat(P.cells, tx, P.gy, tz)) {
        const land = computeLanding(P.cells, tx, P.gy, tz);
        P.cells.forEach(([ox, oy, oz], i) => {
          const c = previewCells[i];
          if (!c) return;
          c.visible = true;
          cellCenter(tx + ox, land + oy, tz + oz, c.position);
        });
        for (let i = P.cells.length; i < previewCells.length; i++) previewCells[i].visible = false;
        show = true;
      }
    }
  }
  previewGroup.visible = show;
  previewGroup.userData.mat.uniforms.uTime.value = G.time;
}

// ------------------------------------------------------------ projectiles --
const _fwdDir = new THREE.Vector3();
function muzzlePos() {
  const out = new THREE.Vector3();
  if (G.player && G.player.muzzle && G.player.firstPerson) G.player.muzzle.getWorldPosition(out);
  else out.copy(G.player.pos).add(new THREE.Vector3(0, 1.4, 0));
  // launch a little ahead of the lens so the bolt's glow doesn't blind the pilot
  _fwdDir.set(0, 0, -1).applyQuaternion(G.camera.quaternion);
  return out.addScaledVector(_fwdDir, 1.2);
}

function makeBolt(color, size = 0.35) {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.SphereGeometry(size, 12, 10), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffffff).multiplyScalar(4) })));
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDotTexture(), color: new THREE.Color(color).multiplyScalar(3), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  glow.scale.setScalar(size * 9);
  g.add(glow);
  G.scene.add(g);
  return g;
}

export function fireBeacon() {
  const aim = G.aim;
  if (!aim) {
    audio.rotateDenied();
    return false;
  }
  const isSky = aim.type === 'sky';
  audio.shootBeacon(isSky);
  emit('gunFired', { color: isSky ? SKY_COLOR : GROUND_COLOR, recoil: 1 });
  const start = muzzlePos();
  beacons.projectiles.push({
    kind: 'beacon',
    mesh: makeBolt(isSky ? SKY_COLOR : GROUND_COLOR),
    start,
    target: { ...aim },
    progress: 0,
    speed: 5.2,
    color: isSky ? SKY_COLOR : GROUND_COLOR,
  });
  return true;
}

// axis 'y' (yaw) or 'pitch' / 'roll' (camera-relative tilts)
export function fireTorque(mode, sign = 1) {
  const P = G.piece;
  if (!P) return false;
  if (beacons.rotateCooldown > 0) return false;
  beacons.rotateCooldown = 0.16;
  let seg = 1;
  if (G.aim && G.aim.type === 'sky') seg = G.aim.seg;
  else {
    raycaster.setFromCamera(CENTER, G.camera);
    let best = Infinity;
    P.segs.forEach((s, i) => {
      const d = raycaster.ray.distanceSqToPoint(s.position);
      if (d < best) {
        best = d;
        seg = i;
      }
    });
  }
  // Resolve camera-relative axes to the nearest world axis
  let axis = 'y';
  let axSign = sign;
  if (mode !== 'yaw') {
    const v = new THREE.Vector3();
    if (mode === 'pitch') v.set(1, 0, 0).applyQuaternion(G.camera.quaternion);
    else v.set(0, 0, -1).applyQuaternion(G.camera.quaternion);
    v.y = 0;
    if (Math.abs(v.x) >= Math.abs(v.z)) {
      axis = 'x';
      axSign = Math.sign(v.x || 1) * sign;
    } else {
      axis = 'z';
      axSign = Math.sign(v.z || 1) * sign;
    }
  }
  audio.torqueShoot();
  emit('gunFired', { color: TORQUE_COLOR, recoil: 1.4 });
  const mesh = makeBolt(TORQUE_COLOR, 0.45);
  const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x00f7ff).multiplyScalar(2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const r1 = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.1, 8, 24), ringMat);
  const r2 = r1.clone();
  r2.rotation.x = Math.PI / 2;
  mesh.add(r1, r2);
  beacons.projectiles.push({ kind: 'torque', mesh, start: muzzlePos(), seg, axis, sign: axSign, progress: 0, speed: 4.6, color: TORQUE_COLOR });
  return true;
}

export function fireNova() {
  const aim = G.aim;
  if (!aim || aim.type !== 'ground') {
    audio.rotateDenied();
    return false;
  }
  emit('gunFired', { color: POWERUPS.nova.color, recoil: 2 });
  audio.tone({ type: 'sawtooth', f0: 300, f1: 80, dur: 0.4, vol: 0.15, filter: { type: 'lowpass', f: 1500 } });
  beacons.projectiles.push({ kind: 'nova', mesh: makeBolt(POWERUPS.nova.color, 0.9), start: muzzlePos(), target: { ...aim }, progress: 0, speed: 2.4, color: POWERUPS.nova.color });
  return true;
}

export function updateProjectiles(dt) {
  const P = G.piece;
  const tmp = new THREE.Vector3();
  for (let i = beacons.projectiles.length - 1; i >= 0; i--) {
    const p = beacons.projectiles[i];
    p.progress += dt * p.speed;
    let end;
    if (p.kind === 'torque') {
      end = P && P.segs[p.seg] ? P.segs[p.seg].position : P && P.segs[0] ? P.segs[0].position : p.start;
    } else if (p.target.type === 'sky') {
      end = P && P.segs[p.target.seg] ? P.segs[p.target.seg].position : p.target.point;
    } else {
      end = p.target.point;
    }
    if (p.progress >= 1 || (p.kind === 'torque' && !P)) {
      G.scene.remove(p.mesh);
      beacons.projectiles.splice(i, 1);
      if (p.kind === 'beacon') {
        if (p.target.type === 'sky') {
          if (P && P.segs[p.target.seg]) {
            attachSky(p.target.seg);
            fxSparks(end, SKY_COLOR, 36, 16);
            fx.rings.spawn(end, SKY_COLOR, { radius: 6, life: 0.35, brightness: 2 });
          }
        } else {
          attachGround(p.target.gx, p.target.gy, p.target.gz);
          fxSparks(beacons.ground.pos, GROUND_COLOR, 36, 16);
          fx.rings.spawn(beacons.ground.pos, GROUND_COLOR, { radius: 7, life: 0.4, horizontal: true, brightness: 2 });
        }
      } else if (p.kind === 'torque') {
        if (P) {
          fx.rings.spawn(end, TORQUE_COLOR, { radius: 9, life: 0.4, brightness: 2 });
          fxSparks(end, 0x00f7ff, 30, 18);
          const pivot = beacons.sky.active ? beacons.sky.seg : p.seg;
          if (rotatePiece(p.axis, p.sign, pivot)) {
            audio.torqueImpact(end);
            emit('pieceRotated');
          } else {
            audio.rotateDenied();
            emit('rotateBlocked');
          }
        }
      } else if (p.kind === 'nova') {
        emit('novaImpact', p.target);
      }
      continue;
    }
    p.mesh.position.lerpVectors(p.start, end, Math.min(1, p.progress));
    if (p.kind === 'nova') p.mesh.position.y += Math.sin(p.progress * Math.PI) * 6;
    p.mesh.rotation.x += dt * 18;
    p.mesh.rotation.y += dt * 22;
    // trail
    tmp.copy(p.mesh.position);
    fx.particles.emit(tmp.x, tmp.y, tmp.z, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, p.color, p.kind === 'nova' ? 1.6 : 0.7, 0.35, 0, 2);
  }
}

// ---------------------------------------------------------------- tether --
const _sky = new THREE.Vector3();
export function updateBeacons(dt, time) {
  beacons.rotateCooldown = Math.max(0, beacons.rotateCooldown - dt);
  const P = G.piece;
  const skyPos = skyBeaconPos(_sky);
  if (beacons.sky.active && skyPos) {
    beacons.sky.mesh.position.copy(skyPos);
    const u = beacons.sky.mesh.userData;
    u.ring1.scale.setScalar(1 + Math.sin(time * 10) * 0.15);
    u.ring2.rotation.z = time * 2;
    u.light.intensity = 40;
  }
  if (beacons.ground.active) {
    const u = beacons.ground.mesh.userData;
    u.ring1.scale.setScalar(1 + Math.cos(time * 10) * 0.15);
    u.ring2.rotation.z = -time * 2;
    u.light.intensity = 40;
    setHighlight(0, beacons.ground.gx, beacons.ground.gz, 1, 0);
  } else {
    setHighlight(0, 0, 0, 0, 0);
  }

  if (beacons.sky.active && beacons.ground.active && P && skyPos) {
    tether.visible = true;
    const off = P.cells[beacons.sky.seg];
    if (off) {
      const tx = beacons.ground.gx - off[0];
      const tz = beacons.ground.gz - off[2];
      beacons.alignCooldown -= dt;
      const wasAligned = beacons.aligned;
      beacons.aligned = P.gx === tx && P.gz === tz;
      if (!beacons.aligned && beacons.alignCooldown <= 0 && !P.hardDropping) {
        const sx = Math.sign(tx - P.gx);
        const sz = Math.sign(tz - P.gz);
        let moved = false;
        if (sx && sz) moved = tryMove(sx, sz);
        if (!moved && sx) moved = tryMove(sx, 0);
        if (!moved && sz) moved = tryMove(0, sz);
        if (moved) {
          beacons.alignCooldown = G.effects.overdrive > 0 ? 0.04 : 0.065;
          audio.tone({ type: 'sine', f0: 320 + Math.random() * 40, dur: 0.05, vol: 0.03, verb: 0 });
        }
      }
      if (beacons.aligned && !wasAligned) emit('tetherAligned');
    }
    tether.setEndpoints(beacons.ground.pos, skyPos);
    tether.thickness = P.hardDropping ? 1.8 : beacons.aligned ? 1.15 : 1;
    tether.setColor(P.hardDropping ? 0xff44ff : beacons.aligned ? 0x7dffb0 : GROUND_COLOR, P.hardDropping ? 0xff00aa : 0x3fa0ff);
    tether.ringSpeed = P.hardDropping ? 2.6 : 0.95;
    tether.intensity = 1;
    tether.update(dt, time);
    const tension = Math.hypot(skyPos.x - beacons.ground.pos.x, skyPos.z - beacons.ground.pos.z);
    audio.setPlasma(true, Math.min(3, tension * 0.08));
    // energy motes flowing up the tether
    if (Math.random() < 0.8) {
      const t = Math.random();
      const p = new THREE.Vector3().lerpVectors(beacons.ground.pos, skyPos, t);
      const dir = new THREE.Vector3().subVectors(skyPos, beacons.ground.pos).normalize().multiplyScalar(14);
      fx.particles.emit(p.x, p.y, p.z, dir.x, dir.y, dir.z, Math.random() < 0.5 ? GROUND_COLOR : SKY_COLOR, 0.6, 0.5, 0, 0);
    }
  } else {
    if (tether.visible) audio.setPlasma(false);
    tether.visible = false;
    beacons.aligned = false;
  }
}

export function beaconStatus() {
  return {
    sky: beacons.sky.active ? beacons.sky.seg : -1,
    ground: beacons.ground.active ? [beacons.ground.gx, beacons.ground.gz] : null,
    linked: beacons.sky.active && beacons.ground.active,
    aligned: beacons.aligned,
  };
}
