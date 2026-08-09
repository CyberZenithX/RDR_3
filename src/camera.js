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
import { consumeMouseDelta } from './input.js';
import { colliders } from './collision.js';
import { heightAt } from './terrain.js';

const UP = new THREE.Vector3(0, 1, 0);

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

    this._pivot = new THREE.Vector3();
    this._forward = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._camOffset = new THREE.Vector3();
    this._desiredPos = new THREE.Vector3();
    this._lookTarget = new THREE.Vector3();
    this._swayTime = 0;
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

  /** Furthest the camera can sit from the pivot before it clips terrain or a prop. */
  _maxUnobstructedDistance(pivot, dirX, dirY, dirZ) {
    let maxDist = CAMERA.distance;

    // March the analytic heightfield rather than raycasting the rendered mesh
    // (131k triangles with no spatial index — see the note in terrain.js).
    const steps = CAMERA.collisionSteps;
    for (let i = 1; i <= steps; i++) {
      const t = (i / steps) * CAMERA.distance;
      const y = pivot.y + dirY * t;
      const groundY = heightAt(pivot.x + dirX * t, pivot.z + dirZ * t);
      if (y <= groundY) {
        maxDist = ((i - 1) / steps) * CAMERA.distance;
        break;
      }
    }

    for (const c of colliders) {
      if (c.type !== 'circle') continue;
      const dx = c.x - pivot.x, dz = c.z - pivot.z;
      if (dx * dx + dz * dz > (CAMERA.distance + c.r) * (CAMERA.distance + c.r)) continue;
      const hitLen = segmentCircleHit(pivot.x, pivot.z, dirX, dirZ, CAMERA.distance, c.x, c.z, c.r);
      if (hitLen < maxDist) maxDist = hitLen;
    }

    return Math.max(CAMERA.minDistance, maxDist - CAMERA.collisionMargin);
  }

  /** Places the camera at its target position immediately, no damping — call once after spawning. */
  snap(playerPos) {
    this._pivot.set(playerPos.x, playerPos.y + CAMERA.pivotHeight, playerPos.z);
    const cosPitch = Math.cos(this.pitch);
    const dirX = Math.sin(this.yaw) * cosPitch;
    const dirY = Math.sin(this.pitch);
    const dirZ = Math.cos(this.yaw) * cosPitch;
    this.currentDistance = this._maxUnobstructedDistance(this._pivot, dirX, dirY, dirZ);
    this._camOffset.set(dirX, dirY, dirZ).multiplyScalar(this.currentDistance);
    this.camera.position.copy(this._pivot).add(this._camOffset);
    this.camera.lookAt(this._pivot);
  }

  update(dt, playerPos, speed) {
    this._pivot.set(playerPos.x, playerPos.y + CAMERA.pivotHeight, playerPos.z);

    const cosPitch = Math.cos(this.pitch);
    const dirX = Math.sin(this.yaw) * cosPitch;
    const dirY = Math.sin(this.pitch);
    const dirZ = Math.cos(this.yaw) * cosPitch;

    const targetDistance = this._maxUnobstructedDistance(this._pivot, dirX, dirY, dirZ);
    const zoomSpeed = targetDistance < this.currentDistance ? CAMERA.zoomInSpeed : CAMERA.zoomOutSpeed;
    // three@0.160 has no MathUtils.damp yet — exponential smoothing by hand.
    this.currentDistance += (targetDistance - this.currentDistance) * (1 - Math.exp(-zoomSpeed * dt));

    this._camOffset.set(dirX, dirY, dirZ).multiplyScalar(this.currentDistance);
    this._desiredPos.copy(this._pivot).add(this._camOffset);

    // Subtle handheld sway while moving — stronger at a run, per BUILD-PLAN.md.
    const movingT = THREE.MathUtils.clamp(speed / PLAYER.sprintSpeed, 0, 1);
    const swayAmp = THREE.MathUtils.lerp(CAMERA.swayWalk, CAMERA.swayRun, movingT);
    this._swayTime += dt * (speed > 0.1 ? CAMERA.swayFrequency : 0);
    const sway = Math.sin(this._swayTime) * swayAmp * (speed > 0.1 ? 1 : 0);
    this._desiredPos.x += Math.cos(this.yaw) * sway;
    this._desiredPos.y += Math.abs(Math.sin(this._swayTime * 0.5)) * swayAmp * CAMERA.swayRollFactor;

    const posDamp = 1 - Math.exp(-CAMERA.positionDamping * dt);
    this.camera.position.lerp(this._desiredPos, posDamp);

    this._lookTarget.copy(this._pivot);
    this._lookTarget.y += CAMERA.lookAheadHeight;
    this.getForward(this._forward);
    this._lookTarget.addScaledVector(this._forward, CAMERA.shoulderOffset);
    this.camera.lookAt(this._lookTarget);
  }
}
