/**
 * camera.js — third-person spring-arm camera. Mouse-driven orbit (yaw/pitch)
 * around a pivot above the player, collision-aware distance (raycasts the
 * terrain and sweeps the prop collider list so the camera never clips through
 * a hillside or a rock), and light sway while walking/running.
 *
 * Convention shared with player.js: yaw 0 looks toward -Z. getForward() /
 * getRight() are what player.js uses to turn WASD into a world-space
 * direction, so camera and movement always agree with each other.
 */

import * as THREE from 'three';
import { CAMERA, INPUT, PLAYER } from './config.js';
import { HORSE } from './config-horse.js';
import { DUEL } from './config-bounty.js';
import { consumeMouseDelta } from './input.js';
import { colliders } from './collision.js';
import { heightAt } from './terrain.js';

const UP = new THREE.Vector3(0, 1, 0);
const _duelPos = new THREE.Vector3();
const _duelLook = new THREE.Vector3();

/**
 * Closest distance along a segment (px,pz)+(dx,dz)*[0,len] to a Y-rotated box,
 * or Infinity if it misses. XZ only, like the circle test below: a building's
 * collider is `top: Infinity` by the collision contract, so there is no over.
 *
 * Round 5's buildings are the first boxes in the collider array, and without
 * this the camera walks straight through the saloon's wall — which matters most
 * exactly where the interior is, since the pivot is then inside the room and the
 * camera outside it, framing the back of a wall.
 */
function segmentBoxHit(px, pz, dx, dz, len, c) {
  const cos = Math.cos(c.rot);
  const sin = Math.sin(c.rot);
  const ox = (px - c.x) * cos - (pz - c.z) * sin;
  const oz = (px - c.x) * sin + (pz - c.z) * cos;
  const rx = dx * cos - dz * sin;
  const rz = dx * sin + dz * cos;
  let tEnter = 0;
  let tExit = len;
  for (const [o, r, half] of [[ox, rx, c.w / 2], [oz, rz, c.d / 2]]) {
    if (Math.abs(r) < 1e-9) {
      if (Math.abs(o) > half) return Infinity;
      continue;
    }
    const inv = 1 / r;
    let t0 = (-half - o) * inv;
    let t1 = (half - o) * inv;
    if (t0 > t1) { const tmp = t0; t0 = t1; t1 = tmp; }
    if (t0 > tEnter) tEnter = t0;
    if (t1 < tExit) tExit = t1;
    if (tEnter > tExit) return Infinity;
  }
  // The pivot already inside the box (standing in a doorway) — snap tight, the
  // same answer segmentCircleHit gives for its own inside case.
  return tEnter;
}

/** Closest distance along a segment (px,pz)+(dx,dz)*[0,len] to a circle, or Infinity if it misses. */
function segmentCircleHit(px, pz, dx, dz, len, cx, cz, r) {
  const ox = px - cx, oz = pz - cz;
  const b = ox * dx + oz * dz;
  const c = ox * ox + oz * oz - r * r;
  const disc = b * b - c;
  if (disc < 0) return Infinity;
  const sq = Math.sqrt(disc);
  const t0 = -b - sq;
  if (t0 >= 0 && t0 <= len) return t0;
  const t1 = -b + sq;
  if (t1 >= 0 && t1 <= len && c < 0) return 0; // pivot already inside a collider — snap tight
  return Infinity;
}

export class ThirdPersonCamera {
  constructor(camera) {
    this.camera = camera;
    this.yaw = 0;
    this.pitch = 0.18;
    this.currentDistance = CAMERA.distance;
    this.mounted = false; // pulled back and raised while riding — see setMounted()
    // 0..1, eased by combat.js rather than here so the camera, the pose and
    // the crosshair all move on exactly the same curve. Aim and mounted
    // COMPOSE — every framing number below is picked as a mounted/on-foot
    // pair and then lerped toward its aimed counterpart, so aiming from the
    // saddle is its own framing rather than one mode silently winning.
    this.aim = 0;
    this.baseFov = camera.fov;
    this._shake = 0;
    // Round 6's face-off framing — composed by lerp, like aim and mounted.
    this._duelW = 0;
    this._duelA = new THREE.Vector3();
    this._duelB = new THREE.Vector3();

    this._pivot = new THREE.Vector3();
    this._forward = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._camOffset = new THREE.Vector3();
    this._desiredPos = new THREE.Vector3();
    this._lookTarget = new THREE.Vector3();
    this._swayTime = 0;
    this._pivotY = null; // damped; null until the first snap()/update() seeds it
  }

  /**
   * The pivot's height, chased rather than copied straight from the player.
   * A horse jump moves the rider 1.5m vertically in under a second, and a
   * pivot welded to that drags the whole world down with it; lagging slightly
   * reads as the camera being left behind, which is what a jump should feel
   * like. Terrain undulation is far slower than `pivotFollowRate` and is
   * followed essentially exactly, so on-foot framing is unchanged.
   */
  _followPivotY(targetY, dt) {
    if (this._pivotY === null || Math.abs(targetY - this._pivotY) > CAMERA.pivotSnapDistance) {
      this._pivotY = targetY; // first frame, or a teleport — not motion to smooth
    } else {
      this._pivotY += (targetY - this._pivotY) * (1 - Math.exp(-CAMERA.pivotFollowRate * dt));
    }
    return this._pivotY;
  }

  /** Called by main.js whenever the player mounts/dismounts. Swaps distance/pivot height only — everything else (collision march, sway, damping) is shared. */
  setMounted(mounted) {
    this.mounted = mounted;
  }

  /** @param {number} weight 0..1 aim blend, from combat.js. See `this.aim`. */
  setAiming(weight) {
    this.aim = THREE.MathUtils.clamp(weight, 0, 1);
  }

  /**
   * The face-off framing. `weight` is duel.js's own 0..1 blend; `(ax,az)` and
   * `(bx,bz)` are the two duellists on the ground. While weight > 0 the camera
   * lerps from its ordinary damped position toward a shot square to the line
   * between them — the same compose-by-lerp pattern setMounted/setAiming use,
   * rather than a second camera object (ADR-037).
   */
  setDuelShot(weight, ax, az, bx, bz) {
    this._duelW = THREE.MathUtils.clamp(weight ?? 0, 0, 1);
    this._duelA.set(ax, 0, az);
    this._duelB.set(bx, 0, bz);
  }

  _applyDuelShot() {
    const dx = this._duelB.x - this._duelA.x;
    const dz = this._duelB.z - this._duelA.z;
    const len = Math.hypot(dx, dz) || 1;
    const fx = dx / len;
    const fz = dz / len;
    const midX = (this._duelA.x + this._duelB.x) * 0.5;
    const midZ = (this._duelA.z + this._duelB.z) * 0.5;
    const groundY = heightAt(midX, midZ);
    // Perpendicular to the line of fire, camera a touch behind the player end.
    _duelPos.set(
      midX + -fz * DUEL.camSide - fx * DUEL.camBack,
      groundY + DUEL.camHeight,
      midZ + fx * DUEL.camSide - fz * DUEL.camBack,
    );
    _duelLook.set(midX, groundY + DUEL.camLookHeight, midZ);
    this.camera.position.lerp(_duelPos, this._duelW);
    _duelLook.lerpVectors(this._lookTarget, _duelLook, this._duelW);
    this.camera.lookAt(_duelLook);
  }

  /**
   * A shot. `pitchKick` climbs the muzzle, `shake` is a positional jolt that
   * decays over the next few frames. Both are additive, so fanning the hammer
   * stacks — which is the point.
   */
  addRecoil(pitchKick, shake) {
    this.pitch = THREE.MathUtils.clamp(this.pitch - pitchKick, CAMERA.pitchMin, CAMERA.pitchMax);
    this._shake = Math.min(CAMERA.shakeMax, this._shake + shake);
  }

  /** How far back the camera sits, for whichever of the four mode combinations is live. */
  _baseDistance() {
    const hip = this.mounted ? CAMERA.mountedDistance : CAMERA.distance;
    const aimed = this.mounted ? CAMERA.mountedAimDistance : CAMERA.aimDistance;
    return THREE.MathUtils.lerp(hip, aimed, this.aim);
  }

  /** How high above the player the pivot sits, same four combinations. */
  _pivotHeight() {
    const hip = this.mounted ? CAMERA.mountedPivotHeight : CAMERA.pivotHeight;
    const aimed = this.mounted ? CAMERA.mountedAimPivotHeight : CAMERA.aimPivotHeight;
    return THREE.MathUtils.lerp(hip, aimed, this.aim);
  }

  /** Reads accumulated mouse movement and applies it to yaw/pitch. Call once per frame before update(). */
  handleLook() {
    const d = consumeMouseDelta();
    this.yaw -= d.x * INPUT.mouseSensitivity;
    const dy = INPUT.invertY ? -d.y : d.y;
    this.pitch = THREE.MathUtils.clamp(this.pitch + dy * INPUT.mouseSensitivity, CAMERA.pitchMin, CAMERA.pitchMax);
  }

  /** Flattened (Y=0), normalized look direction — what player.js treats as "forward" for WASD. */
  getForward(out = this._forward) {
    out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    return out;
  }

  getRight(out = this._right) {
    this.getForward(out);
    out.cross(UP).normalize();
    return out;
  }

  /**
   * Furthest the camera can sit from the pivot before it clips terrain or a
   * prop. `ignoreCollider` skips one specific collider — while mounted, the
   * rider's own pivot sits right on/inside the horse's own circle collider,
   * so without this every direction sweep immediately "hits" the horse
   * itself (segmentCircleHit's pivot-already-inside case) and the camera
   * collapses to CAMERA.minDistance. Confirmed directly via screenshot: the
   * mounted camera was inside the player's head before this fix.
   */
  _maxUnobstructedDistance(pivot, dirX, dirY, dirZ, ignoreCollider) {
    const baseDistance = this._baseDistance();
    let maxDist = baseDistance;

    // March the analytic heightfield rather than raycasting the rendered mesh
    // (131k triangles with no spatial index — see the note in terrain.js).
    const steps = CAMERA.collisionSteps;
    for (let i = 1; i <= steps; i++) {
      const t = (i / steps) * baseDistance;
      const y = pivot.y + dirY * t;
      const groundY = heightAt(pivot.x + dirX * t, pivot.z + dirZ * t);
      if (y <= groundY) {
        maxDist = ((i - 1) / steps) * baseDistance;
        break;
      }
    }

    for (const c of colliders) {
      if (c === ignoreCollider) continue;
      const dx = c.x - pivot.x, dz = c.z - pivot.z;
      let hitLen = Infinity;
      if (c.type === 'circle') {
        if (dx * dx + dz * dz > (baseDistance + c.r) * (baseDistance + c.r)) continue;
        hitLen = segmentCircleHit(pivot.x, pivot.z, dirX, dirZ, baseDistance, c.x, c.z, c.r);
      } else {
        const reach = baseDistance + Math.hypot(c.w, c.d) * 0.5;
        if (dx * dx + dz * dz > reach * reach) continue;
        hitLen = segmentBoxHit(pivot.x, pivot.z, dirX, dirZ, baseDistance, c);
      }
      if (hitLen < maxDist) maxDist = hitLen;
    }

    return Math.max(CAMERA.minDistance, maxDist - CAMERA.collisionMargin);
  }

  /** Places the camera at its target position immediately, no damping — call once after spawning. */
  snap(playerPos, ignoreCollider) {
    const pivotHeight = this._pivotHeight();
    this._pivotY = playerPos.y + pivotHeight;
    this._pivot.set(playerPos.x, this._pivotY, playerPos.z);
    const cosPitch = Math.cos(this.pitch);
    const dirX = Math.sin(this.yaw) * cosPitch;
    const dirY = Math.sin(this.pitch);
    const dirZ = Math.cos(this.yaw) * cosPitch;
    this.currentDistance = this._maxUnobstructedDistance(this._pivot, dirX, dirY, dirZ, ignoreCollider);
    this._camOffset.set(dirX, dirY, dirZ).multiplyScalar(this.currentDistance);
    this.camera.position.copy(this._pivot).add(this._camOffset);
    this.camera.lookAt(this._pivot);
  }

  update(dt, playerPos, speed, ignoreCollider) {
    const pivotHeight = this._pivotHeight();
    this._pivot.set(playerPos.x, this._followPivotY(playerPos.y + pivotHeight, dt), playerPos.z);

    // Over-the-shoulder: slide the whole pivot sideways so the character sits
    // off-centre and the crosshair looks down a clear lane. Shifting the pivot
    // (rather than only the look target) keeps the occlusion sweep honest —
    // it marches from where the camera actually is.
    if (this.aim > 0.001) {
      this.getRight(this._right);
      const shift = CAMERA.aimShoulderShift * this.aim;
      this._pivot.x += this._right.x * shift;
      this._pivot.z += this._right.z * shift;
    }

    // Narrower FOV while aiming, eased rather than snapped — three@0.160 has
    // no MathUtils.damp, so this is the same hand-rolled smoothing used below.
    const targetFov = THREE.MathUtils.lerp(this.baseFov, CAMERA.aimFov, this.aim);
    if (Math.abs(this.camera.fov - targetFov) > 0.01) {
      this.camera.fov += (targetFov - this.camera.fov) * (1 - Math.exp(-CAMERA.fovLerpRate * dt));
      this.camera.updateProjectionMatrix();
    }

    const cosPitch = Math.cos(this.pitch);
    const dirX = Math.sin(this.yaw) * cosPitch;
    const dirY = Math.sin(this.pitch);
    const dirZ = Math.cos(this.yaw) * cosPitch;

    const targetDistance = this._maxUnobstructedDistance(this._pivot, dirX, dirY, dirZ, ignoreCollider);
    const zoomSpeed = targetDistance < this.currentDistance ? CAMERA.zoomInSpeed : CAMERA.zoomOutSpeed;
    // three@0.160 has no MathUtils.damp yet — exponential smoothing by hand.
    this.currentDistance += (targetDistance - this.currentDistance) * (1 - Math.exp(-zoomSpeed * dt));

    this._camOffset.set(dirX, dirY, dirZ).multiplyScalar(this.currentDistance);
    this._desiredPos.copy(this._pivot).add(this._camOffset);

    // Subtle handheld sway while moving — stronger at a run/gallop, per BUILD-PLAN.md.
    const maxRefSpeed = this.mounted ? HORSE.gallopSpeed : PLAYER.sprintSpeed;
    const runSway = this.mounted ? CAMERA.mountedSwayRun : CAMERA.swayRun;
    const movingT = THREE.MathUtils.clamp(speed / maxRefSpeed, 0, 1);
    const swayAmp = THREE.MathUtils.lerp(CAMERA.swayWalk, runSway, movingT);
    this._swayTime += dt * (speed > 0.1 ? CAMERA.swayFrequency : 0);
    const sway = Math.sin(this._swayTime) * swayAmp * (speed > 0.1 ? 1 : 0);
    this._desiredPos.x += Math.cos(this.yaw) * sway;
    this._desiredPos.y += Math.abs(Math.sin(this._swayTime * 0.5)) * swayAmp * CAMERA.swayRollFactor;

    const posDamp = 1 - Math.exp(-CAMERA.positionDamping * dt);
    this.camera.position.lerp(this._desiredPos, posDamp);

    // Screen shake, applied after the damped move so it is a jolt rather than
    // something the damping smooths away into a slow drift.
    if (this._shake > 0.0001) {
      this.camera.position.x += (Math.random() * 2 - 1) * this._shake;
      this.camera.position.y += (Math.random() * 2 - 1) * this._shake;
      this.camera.position.z += (Math.random() * 2 - 1) * this._shake;
      this._shake *= Math.exp(-CAMERA.shakeDecay * dt);
    } else {
      this._shake = 0;
    }

    this._lookTarget.copy(this._pivot);
    this._lookTarget.y += CAMERA.lookAheadHeight;
    this.getForward(this._forward);
    this._lookTarget.addScaledVector(this._forward, CAMERA.shoulderOffset);
    this.camera.lookAt(this._lookTarget);

    // Round 6: swing toward the face-off shot last, over whatever the ordinary
    // rig just produced, so entering and leaving a duel is a lerp not a cut.
    if (this._duelW > 0.001) this._applyDuelShot();
  }
}
