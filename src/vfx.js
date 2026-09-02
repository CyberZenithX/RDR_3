/**
 * vfx.js — everything a shot throws off: muzzle flash, tracer, impact spark,
 * impact decal, spent shells and target debris. Pure presentation — nothing
 * in here is read back by gameplay, and `update(dt)` is safe to skip.
 *
 * Every effect is a FIXED POOL allocated once at construction and recycled by
 * index. Nothing is created or disposed while the game is running, which is
 * what keeps the performance budget's "never allocate inside the render loop"
 * true even during a six-shot string, and keeps the draw-call count flat: the
 * whole file adds five draw calls whether nothing or everything is on screen.
 *
 * The muzzle flash and its light are PARENTED TO THE MUZZLE EMPTY, not
 * positioned at it each frame, so they follow the barrel through the aiming
 * pose, the recoil kick and the horse's bank without knowing about any of
 * them. That is the same empty the raycast starts from — see weapons.js.
 *
 * ROUND 4 ADDS A SECOND KIND OF SHOOTER, and it needs a different flash. The
 * player's is parented to ONE muzzle and cannot be at a bandit's barrel as
 * well, so `enemyFire()` uses a small ring of world-positioned flashes
 * instead — correct enough for something that lives 55ms, and deliberately
 * WITHOUT a point light: eleven bandits' worth of PointLights would push the
 * scene's light count around and recompile shaders mid-firefight, for a glow
 * nobody sees at forty metres. The tracer became a ring at the same time, so
 * a camp firing at once does not have four bandits stealing one mesh.
 */

import * as THREE from 'three';
import { VFX } from './config-combat.js';

const _dummy = new THREE.Object3D();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _forward = new THREE.Vector3(0, 0, 1);
const _q = new THREE.Quaternion();
const _hidden = new THREE.Matrix4().makeScale(0, 0, 0);

/** A pool of instanced boxes with ballistic per-instance motion. */
class DebrisPool {
  constructor(scene, count, size, color, life, gravity, opts = {}) {
    const geo = opts.geometry ?? new THREE.BoxGeometry(size, size, size);
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: opts.metalness ?? 0.2 });
    this.mesh = new THREE.InstancedMesh(geo, mat, count);
    this.mesh.castShadow = false; // dozens of tiny shadow casters cost more than they show
    this.mesh.frustumCulled = false; // instances move well outside the bind-time bounds
    scene.add(this.mesh);
    this.life = life;
    this.gravity = gravity;
    this.bounce = opts.bounce ?? 0;
    this.spin = opts.spin ?? 0;
    this.items = [];
    for (let i = 0; i < count; i++) {
      this.items.push({
        t: -1,
        pos: new THREE.Vector3(), vel: new THREE.Vector3(),
        spinAxis: new THREE.Vector3(0, 1, 0), angle: 0, groundY: 0,
      });
      this.mesh.setMatrixAt(i, _hidden);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.next = 0;
  }

  spawn(pos, vel, groundY) {
    const item = this.items[this.next];
    this.next = (this.next + 1) % this.items.length;
    item.t = 0;
    item.pos.copy(pos);
    item.vel.copy(vel);
    item.groundY = groundY;
    item.angle = 0;
    item.spinAxis.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1);
    if (item.spinAxis.lengthSq() < 1e-6) item.spinAxis.set(0, 1, 0);
    item.spinAxis.normalize();
    return item;
  }

  update(dt) {
    let dirty = false;
    for (let i = 0; i < this.items.length; i++) {
      const item = this.items[i];
      if (item.t < 0) continue;
      item.t += dt;
      if (item.t >= this.life) {
        item.t = -1;
        this.mesh.setMatrixAt(i, _hidden);
        dirty = true;
        continue;
      }
      item.vel.y += this.gravity * dt;
      item.pos.addScaledVector(item.vel, dt);
      if (item.pos.y <= item.groundY) {
        item.pos.y = item.groundY;
        if (this.bounce > 0 && item.vel.y < -0.4) {
          item.vel.y = -item.vel.y * this.bounce;
          item.vel.x *= this.bounce;
          item.vel.z *= this.bounce;
        } else {
          item.vel.set(0, 0, 0);
        }
      }
      item.angle += this.spin * dt;
      _q.setFromAxisAngle(item.spinAxis, item.angle);
      // Shrink to nothing over the last third of the life — an InstancedMesh
      // has no per-instance opacity, and scaling out reads as "gone" just as
      // well without a second, transparent material and its sorting cost.
      const fade = Math.min(1, (1 - item.t / this.life) * 3);
      _dummy.position.copy(item.pos);
      _dummy.quaternion.copy(_q);
      _dummy.scale.setScalar(fade);
      _dummy.updateMatrix();
      this.mesh.setMatrixAt(i, _dummy.matrix);
      dirty = true;
    }
    if (dirty) this.mesh.instanceMatrix.needsUpdate = true;
  }
}

export class Vfx {
  constructor(scene) {
    this.scene = scene;

    // ------------------------------------------------------------ flash ---
    // Two crossed quads so the flash reads from any angle without being a
    // billboard that has to be re-oriented every frame.
    const flashGeo = new THREE.PlaneGeometry(VFX.flashSize, VFX.flashSize);
    const flashMat = new THREE.MeshBasicMaterial({
      color: VFX.flashColor, transparent: true, opacity: 0.95,
      depthWrite: false, side: THREE.DoubleSide, fog: false,
    });
    this.flash = new THREE.Group();
    for (const rot of [0, Math.PI / 2]) {
      const plane = new THREE.Mesh(flashGeo, flashMat);
      plane.rotation.z = rot;
      this.flash.add(plane);
    }
    this.flashLight = new THREE.PointLight(VFX.flashColor, 0, VFX.flashLightDistance);
    this.flash.add(this.flashLight);
    this.flash.visible = false;
    this._flashT = -1;

    // ------------------------------------------------------ enemy flash ---
    // Same two crossed quads, but unparented and moved to the shooter each
    // time, and no point light. See the file header.
    this.enemyFlashes = [];
    for (let i = 0; i < VFX.enemyFlashCount; i++) {
      const group = new THREE.Group();
      for (const rot of [0, Math.PI / 2]) {
        const plane = new THREE.Mesh(flashGeo, flashMat);
        plane.rotation.z = rot;
        group.add(plane);
      }
      group.visible = false;
      group.frustumCulled = false;
      scene.add(group);
      this.enemyFlashes.push({ group, t: -1 });
    }
    this._nextEnemyFlash = 0;

    // ----------------------------------------------------------- tracer ---
    // A unit-length cylinder along +Z, scaled to the shot each time. A RING of
    // them, not one: the player's gun cannot outrun COMBAT.fireInterval, but a
    // camp of four bandits firing at once would otherwise hand one mesh back
    // and forth and show a single tracer.
    const tracerGeo = new THREE.CylinderGeometry(VFX.tracerRadius, VFX.tracerRadius, 1, 5, 1, true);
    tracerGeo.rotateX(Math.PI / 2);
    tracerGeo.translate(0, 0, 0.5);
    const tracerMat = new THREE.MeshBasicMaterial({
      color: VFX.tracerColor, transparent: true, opacity: 0.7, depthWrite: false, fog: false,
    });
    this.tracers = [];
    for (let i = 0; i < VFX.tracerCount; i++) {
      const mesh = new THREE.Mesh(tracerGeo, tracerMat.clone());
      mesh.visible = false;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.tracers.push({ mesh, t: -1 });
    }
    this._nextTracer = 0;

    // ----------------------------------------------------------- decals ---
    const decalGeo = new THREE.CircleGeometry(VFX.decalRadius, 8);
    this.decals = new THREE.InstancedMesh(decalGeo, new THREE.MeshBasicMaterial({
      color: VFX.decalColor, transparent: true, opacity: VFX.decalOpacity,
      depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, fog: true,
    }), VFX.decalCount);
    this.decals.frustumCulled = false;
    for (let i = 0; i < VFX.decalCount; i++) this.decals.setMatrixAt(i, _hidden);
    this.decals.instanceMatrix.needsUpdate = true;
    scene.add(this.decals);
    this._nextDecal = 0;

    // ------------------------------------------------- ballistic pools ---
    this.sparks = new DebrisPool(
      scene, VFX.sparkCount * 4, VFX.sparkSize, VFX.sparkColor,
      VFX.sparkDuration, VFX.sparkGravity, { metalness: 0.0, spin: 12 },
    );
    const shellGeo = new THREE.CylinderGeometry(VFX.shellRadius, VFX.shellRadius, VFX.shellLength, 6);
    this.shells = new DebrisPool(
      scene, VFX.shellCount, VFX.shellLength, VFX.shellColor,
      VFX.shellLife, VFX.shellGravity,
      { geometry: shellGeo, metalness: 0.8, bounce: VFX.shellBounce, spin: VFX.shellSpin },
    );
    this.debris = new DebrisPool(
      scene, VFX.debrisCount * 2, VFX.debrisSize, 0x6d4a2a,
      VFX.debrisLife, VFX.debrisGravity, { spin: 7 },
    );
  }

  /**
   * Parents the flash to the gun's muzzle empty. Called once, after the
   * revolver is attached — see the file header for why this is parenting and
   * not a per-frame position copy.
   */
  attachToMuzzle(muzzle) {
    muzzle.add(this.flash);
  }

  /** One shot: the flash at the barrel, and a tracer along the line it took. */
  fire(from, to) {
    this._flashT = 0;
    this.flash.visible = true;
    this.flash.rotation.z = Math.random() * Math.PI; // no two flashes the same shape
    this.flashLight.intensity = VFX.flashLightIntensity;
    this._tracer(from, to);
  }

  /**
   * A bandit's shot. Same tracer, a world-positioned flash instead of the
   * parented one — see the file header for why they are not the same object.
   */
  enemyFire(from, to) {
    const slot = this.enemyFlashes[this._nextEnemyFlash];
    this._nextEnemyFlash = (this._nextEnemyFlash + 1) % this.enemyFlashes.length;
    slot.t = 0;
    slot.group.position.copy(from);
    slot.group.rotation.z = Math.random() * Math.PI;
    slot.group.scale.setScalar(1);
    slot.group.visible = true;
    this._tracer(from, to);
  }

  _tracer(from, to) {
    _v.subVectors(to, from);
    const len = _v.length();
    if (len <= 1e-4) return;
    const slot = this.tracers[this._nextTracer];
    this._nextTracer = (this._nextTracer + 1) % this.tracers.length;
    slot.mesh.position.copy(from);
    slot.mesh.quaternion.setFromUnitVectors(_forward, _v.divideScalar(len));
    slot.mesh.scale.set(1, 1, len);
    slot.mesh.material.opacity = 0.7;
    slot.mesh.visible = true;
    slot.t = 0;
  }

  /** Impact: a spray of sparks and a decal lying on the surface that was hit. */
  impact(point, normal, groundY) {
    for (let i = 0; i < VFX.sparkCount; i++) {
      // Cone around the surface normal, so sparks come off the wall rather
      // than out of the ground under it.
      _v.set(
        normal.x + (Math.random() * 2 - 1) * 0.85,
        normal.y + (Math.random() * 2 - 1) * 0.85 + 0.3,
        normal.z + (Math.random() * 2 - 1) * 0.85,
      ).normalize().multiplyScalar(VFX.sparkSpeed * (0.4 + Math.random() * 0.8));
      this.sparks.spawn(point, _v, groundY);
    }
    this._placeDecal(point, normal);
  }

  _placeDecal(point, normal) {
    const i = this._nextDecal;
    this._nextDecal = (this._nextDecal + 1) % VFX.decalCount;
    // A CircleGeometry faces +Z, so turning +Z onto the surface normal lays it
    // flat on whatever was hit — floor, cliff face or barrel stave alike.
    _q.setFromUnitVectors(_forward, _v.copy(normal).normalize());
    _dummy.position.copy(point).addScaledVector(normal, VFX.decalLift);
    _dummy.quaternion.copy(_q);
    _dummy.rotateZ(Math.random() * Math.PI * 2);
    _dummy.scale.setScalar(0.7 + Math.random() * 0.6);
    _dummy.updateMatrix();
    this.decals.setMatrixAt(i, _dummy.matrix);
    this.decals.instanceMatrix.needsUpdate = true;
  }

  /**
   * A full cylinder of brass hitting the dirt. A single-action revolver ejects
   * on reload, not per shot — see VFX.shellCount's comment in config-combat.js.
   */
  ejectShells(from, right, count, groundY) {
    for (let i = 0; i < count; i++) {
      _v2.copy(_up).multiplyScalar(VFX.shellSpeed * (0.15 + Math.random() * 0.35));
      _v.copy(right).multiplyScalar(VFX.shellSpeed * (0.6 + Math.random() * 0.7)).add(_v2);
      _v.x += (Math.random() * 2 - 1) * 0.35;
      _v.z += (Math.random() * 2 - 1) * 0.35;
      this.shells.spawn(from, _v, groundY);
    }
  }

  /** A target coming apart. `color` lets a bottle throw glass and a barrel throw staves. */
  burst(point, color, groundY) {
    if (color !== undefined) this.debris.mesh.material.color.setHex(color);
    for (let i = 0; i < VFX.debrisCount; i++) {
      _v.set(Math.random() * 2 - 1, Math.random() * 0.9 + 0.25, Math.random() * 2 - 1)
        .normalize().multiplyScalar(VFX.debrisSpeed * (0.4 + Math.random() * 0.9));
      this.debris.spawn(point, _v, groundY);
    }
  }

  update(dt) {
    if (this._flashT >= 0) {
      this._flashT += dt;
      const k = 1 - this._flashT / VFX.flashDuration;
      if (k <= 0) {
        this._flashT = -1;
        this.flash.visible = false;
        this.flashLight.intensity = 0;
      } else {
        this.flash.scale.setScalar(0.6 + k * 0.7);
        this.flashLight.intensity = VFX.flashLightIntensity * k;
      }
    }
    for (const slot of this.enemyFlashes) {
      if (slot.t < 0) continue;
      slot.t += dt;
      const k = 1 - slot.t / VFX.flashDuration;
      if (k <= 0) {
        slot.t = -1;
        slot.group.visible = false;
      } else {
        slot.group.scale.setScalar(0.6 + k * 0.7);
      }
    }
    for (const slot of this.tracers) {
      if (slot.t < 0) continue;
      slot.t += dt;
      const k = 1 - slot.t / VFX.tracerDuration;
      if (k <= 0) {
        slot.t = -1;
        slot.mesh.visible = false;
      } else {
        slot.mesh.material.opacity = 0.7 * k;
      }
    }
    this.sparks.update(dt);
    this.shells.update(dt);
    this.debris.update(dt);
  }
}
