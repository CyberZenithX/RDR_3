/**
 * horse-seat.js — where the rider sits on this horse, and how the body
 * underneath them is moving. Split out of horse.js when the jump was added,
 * per BUILD-PLAN.md's 400-line cap: horse.js owns the animal's own motion
 * (AI, steering, mount state), this file owns the interface to whoever is
 * sitting on it.
 *
 * The seat is not a fixed height. It rides the horse's own spine bone, so it
 * stays with whatever clip is actually playing: measured by stepping each clip
 * through its cycle, that bone travels 0.006 through idle, 0.058 through walk
 * and 0.146 through gallop, and its mean height differs per gait too, so any
 * constant offset necessarily floats at one gait and sinks at another.
 *
 * Both readings are taken in the horse's OWN BODY FRAME rather than in world
 * axes, which is the whole reason this code stays correct through a turn and a
 * jump. See `_measure()`.
 */

import * as THREE from 'three';
import { HORSE } from './config-horse.js';
import { smoothstep } from './noise.js';

function lerpAngle(a, b, t) {
  let diff = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}

export class HorseSeat {
  /** @param {object} horse the Horse this seat belongs to */
  constructor(horse) {
    this.horse = horse;
    // Absent on the procedural fallback horse, which has no skeleton; `bob`
    // and `drift` then stay 0 and the fixed offset alone applies.
    this.bone = horse.character.root.getObjectByName(HORSE.saddleBone) ?? null;

    this.bob = 0; // metres the seat is currently above/below its rest height
    this.sway = 0; // the same, normalised to -1..1 for animation to key off
    this.drift = 0; // metres the spine has slid FORWARD of its rest position

    this._restUp = 0;
    this._restFwd = 0;
    this._lastUp = 0;
    this._lastFwd = 0;
    this._boneWorld = new THREE.Vector3();
    this._bodyUp = new THREE.Vector3();
    this._bodyFwd = new THREE.Vector3();
    this._local = new THREE.Vector3();
    this._pos = new THREE.Vector3();
  }

  /**
   * Rest reading of the saddle bone. Taken against the mesh root rather than
   * the horse's logical position — the two are equal in play, but the root must
   * already be placed for the reading to mean anything.
   */
  captureRest() {
    if (!this.bone) return;
    this.horse.character.root.updateMatrixWorld(true);
    this._measure();
    this._restUp = this._lastUp;
    this._restFwd = this._lastFwd;
  }

  /**
   * The saddle bone's offset from the mesh root, resolved onto the horse's own
   * up and forward axes rather than onto world Y and Z.
   *
   * Using the body frame is not a stylistic choice, it is the fix for two real
   * bugs. Banking tilts the up axis, so a world-Y reading books h*(1-cos lean)
   * of the bank as the back having dropped — measured 0.042 at the 0.32rad lean
   * limit, which sank the seat into the horse for the length of every turn and,
   * worse, pegged `sway` at -1 throughout. The forward axis matters just as much
   * once the horse jumps: measured straight off the GLB, `Gallop_Jump` carries
   * 1.146 world units of baked forward travel on the `Body` bone (against 0.100
   * for a plain `Gallop` stride), so a seat pinned to a constant
   * `saddleOffset.z` gets left behind over the horse's rump mid-arc.
   */
  _measure() {
    const root = this.horse.character.root;
    this.bone.getWorldPosition(this._boneWorld);
    this._boneWorld.sub(root.position);
    this._bodyUp.set(0, 1, 0).applyQuaternion(root.quaternion);
    // The rig's local +Z is the nose — see HORSE.meshYawOffset.
    this._bodyFwd.set(0, 0, 1).applyQuaternion(root.quaternion);
    this._lastUp = this._boneWorld.dot(this._bodyUp);
    this._lastFwd = this._boneWorld.dot(this._bodyFwd);
  }

  /**
   * Reads how far the horse's back has risen, fallen and slid this frame.
   * Called after the horse's own mixer has advanced and its transform is
   * written, so the value is exactly in phase with the gait actually on screen
   * — no guessed sine wave, and it stays in phase automatically when the clip's
   * timeScale changes with speed.
   *
   * @param {boolean} airborne swaps in the jump's own follow fraction and bob
   *   clamp. `saddleFollow` (0.72) and `saddleBobLimit` are gait numbers: the
   *   28% the rider does not take is hip and knee flex absorbing a few
   *   centimetres of stride. `Gallop_Jump` moves this same bone 1.157 in the
   *   horse's own body frame — measured by stepping the clip, against 0.144
   *   for `Gallop` — and no amount of hip flex absorbs three quarters of a
   *   metre. Anything less than following it outright is the horse's back
   *   rising straight through the rider at the top of the arc.
   */
  sample(airborne) {
    if (!this.bone) {
      this.bob = 0;
      this.sway = 0;
      this.drift = 0;
      return;
    }
    this.horse.character.root.updateMatrixWorld(true);
    this._measure();
    const raw = this._lastUp - this._restUp;
    const limit = airborne ? HORSE.jumpBobLimit : HORSE.saddleBobLimit;
    const follow = airborne ? HORSE.jumpSaddleFollow : HORSE.saddleFollow;
    this.bob = THREE.MathUtils.clamp(raw * follow, -limit, limit);
    this.sway = THREE.MathUtils.clamp(raw / HORSE.saddleBobLimit, -1, 1);
    this.drift = THREE.MathUtils.clamp(
      this._lastFwd - this._restFwd, -HORSE.saddleDriftLimit, HORSE.saddleDriftLimit,
    );
  }

  /**
   * Everything the rider needs to sit on this horse this frame: where their
   * hips go, which way they face, and how the body underneath them is moving.
   * During the post-mount blend window position and yaw ease from wherever the
   * player stood at mount time onto the true saddle point, per BUILD-PLAN.md's
   * "lerp onto the saddle point over 0.4s, no clip" fake for Mount/Dismount —
   * and `blend` hands that same 0..1 curve to the seated pose so the rider
   * folds into the saddle over the ride up instead of snapping into it.
   *
   * `position.y` is the seat height (where the rider's *hips* belong), not
   * ground level — player.js drops the rig's own measured hip height off it.
   */
  transform(outPos) {
    const h = this.horse;
    // The seat is a point ON THE HORSE, so it is built in the horse's own frame
    // and turned by the horse's own rotation — the whole of it, in one step:
    // yaw, the bank, and the jump pitch. The mesh rotates about its root, which
    // is at *ground level*, so every one of those angles sweeps a point
    // `saddleOffset.y` up that axis a long way. Bank was learned the hard way in
    // round 2c: a seat left on the vertical is y*sin(lean) — 0.64 at the 0.32rad
    // limit — out from under the rider, and mid-bank the horse's back had moved
    // 0.44 to the side against the rider's 0.21. Pitch is the same error one
    // axis over, and was live until this fix: at the apex the horse is 0.27rad
    // nose-up, which slides the true saddle point ~0.35 forward along the back
    // and drops it ~0.09, i.e. up the withers toward the neck.
    //
    // Offsets are therefore in the RIG's local axes rather than the game's:
    // HORSE.meshYawOffset is a half turn, so the rig's +Z is the nose where the
    // game's forward is -Z, and its +X is the mirror of the game's. That is also
    // the frame `drift` is measured in (see `_measure()`), so it is added here
    // rather than subtracted.
    const seatUp = HORSE.saddleOffset.y + this.bob + HORSE.jumpSeatRise * h.jump.weight;
    this._local
      .set(-HORSE.saddleOffset.x, seatUp, this.drift - HORSE.saddleOffset.z)
      .applyQuaternion(h.character.root.quaternion);
    this._pos.copy(h.position).add(this._local);

    const t = smoothstep(0, HORSE.mountLerpTime, h._mountBlendT);
    outPos.lerpVectors(h._premountPos, this._pos, t);
    const yaw = lerpAngle(h._premountYaw, h.yaw, t);
    return {
      position: outPos,
      yaw,
      blend: t,
      roll: h.lean * HORSE.riderLean * t,
      // The rider shares most of the horse's own jump pitch — back on the way
      // up, forward over the landing — on top of their gallop carriage.
      pitch: (h.riderPitch + h.jump.pitch * HORSE.riderJumpFollow) * t,
      sway: this.sway * HORSE.riderBobSway,
      jump: h.jump.weight * t,
    };
  }
}
