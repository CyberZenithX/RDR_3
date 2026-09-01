/**
 * aim-pose.js — the upper-body aiming pose: right arm up and out along the
 * sightline, elbow soft, fingers closed on the grip, spine turned into it,
 * plus the recoil kick and the reload dip.
 *
 * THIS IS THE PARTIAL-SKELETON BLEND BUILD-PLAN.md ASKS FOR, done as a pose
 * layer rather than a second clip. It runs immediately after riding-pose.js,
 * and the split is by bone: the riding pose owns the legs, feet, `Torso` and
 * (while mounted) the left rein arm; this owns `Chest`, `Head`, the right arm
 * and — on foot only — the left support arm. "Spine-up from one, hips-down
 * from the other", exactly as specified, with no cross-clip mixing.
 *
 * Why a pose and not the real Gun_Shoot / Idle_Gun_Pointing clips (which DO
 * exist on this rig — see docs/ANIMATION.md) — full reasoning in ADR-024:
 *
 *  - A clip points where it was authored. It cannot point where the crosshair
 *    points, and an over-the-shoulder aim mode whose gun ignores the camera's
 *    pitch is not aiming, it is posing.
 *  - A full-body shoot clip cannot coexist with the seated riding pose, which
 *    reclaims the arms every frame after the mixer runs. Mounted shooting is
 *    not optional (BUILD-PLAN.md), so a clip-only path would need a second,
 *    different implementation for the saddle. One layer that works in both
 *    places beats two that each work in one.
 *  - This project's single prior attempt at cross-clip blending was built,
 *    tuned and removed (docs/DEVELOPMENT-NOTES.md). Its single successful
 *    hand-authored pose is riding-pose.js. This follows the one that worked.
 *
 * The clips still carry the base: character.js selects Idle_Gun_Pointing /
 * Run_Shoot underneath while aiming on foot, so the legs and stance are real
 * animation and only the upper body is authored here.
 *
 * The four rules from docs/ANIMATION.md apply unchanged, and rule 1 is the
 * one that matters most: pose from a captured baseline, never a per-frame
 * delta. `Chest` and the arms are in the idle clip's tracks, but `WristR` is
 * not reliably, and a delta on a bone no clip rewrites compounds until the
 * rider folds up. Everything here is measured from `_rest`.
 */

import * as THREE from 'three';
import { AIM_POSE } from './config-combat.js';

// Reused scratch — nothing in here allocates per frame.
const _qFrame = new THREE.Quaternion();
const _qWorld = new THREE.Quaternion();
const _qRoot = new THREE.Quaternion();
const _qRootInv = new THREE.Quaternion();
const _qParent = new THREE.Quaternion();
const _qBone = new THREE.Quaternion();
const _euler = new THREE.Euler();

/** Bones this layer claims. Deliberately disjoint from riding-pose.js's legs/Torso. */
const ARM_R = ['UpperArmR', 'LowerArmR', 'WristR'];
const ARM_L = ['UpperArmL', 'LowerArmL'];
const SPINE = ['Chest', 'Head'];

/** Right-hand finger joints, built the same way riding-pose.js builds both hands'. */
const FINGERS = ['Index', 'Middle', 'Ring', 'Pinky'];
const GRIP_R = [];
for (const finger of FINGERS) for (const j of [1, 2, 3]) GRIP_R.push(`${finger}${j}R`);
for (const j of [1, 2, 3]) GRIP_R.push(`Thumb${j}R`);

const OWNED = [...SPINE, ...ARM_R, ...ARM_L];

export class AimPose {
  /**
   * @param {THREE.Object3D} root the loaded character rig's scene root
   * @param {import('./riding-pose.js').RidingPose} ridingPose the same rig's
   *   riding pose. Borrowed, not owned: its `_grip()` / `_captureGripAxes()`
   *   already solved closing this skeleton's hand (the naive knuckle axis is
   *   the zero vector here — docs/ANIMATION.md), and docs/ARCHITECTURE.md
   *   lists that machinery as reusable for exactly this.
   */
  constructor(root, ridingPose) {
    this.root = root;
    this.riding = ridingPose;
    this.bones = {};
    // Runtime names: GLTFLoader strips dots, so 'Wrist.R' is 'WristR'.
    for (const name of [...OWNED, ...GRIP_R]) this.bones[name] = root.getObjectByName(name) ?? null;

    this.available = ARM_R.every((n) => this.bones[n]) && !!this.bones.Chest;
    if (!this.available) {
      const missing = [...ARM_R, 'Chest'].filter((n) => !this.bones[n]);
      console.warn(`[aim-pose] rig is missing ${missing.join(', ')} — aiming falls back to the plain locomotion pose`);
    }

    this._rest = {};
    this._captured = false;
    this._posed = false; // drives the one-shot release, same as riding-pose.js
  }

  /** Snapshots the rig's rest pose. Called once at load, before the mixer has ever run. */
  captureBaseline() {
    if (!this.available) return;
    for (const name of [...OWNED, ...GRIP_R]) {
      const bone = this.bones[name];
      if (bone) this._rest[name] = bone.quaternion.clone();
    }
    this._captured = true;
  }

  /**
   * Rotates one bone by an angle expressed in the character root's frame
   * (+X left, +Y up, +Z forward), on top of whatever is already there.
   *
   * Same derivation as riding-pose.js's `_rotate`: for a rotation Q authored
   * in root space the world equivalent is R·Q·R⁻¹, and the bone's local value
   * is parent⁻¹·(that)·currentWorld. Duplicated rather than shared per
   * ADR-010 — the two layers own different bones and different baselines, and
   * a shared base class would couple their lifecycles for ten lines of maths.
   */
  _rotate(bone, x, y, z) {
    if (!bone) return;
    bone.parent.getWorldQuaternion(_qParent);
    _qBone.copy(_qParent).multiply(bone.quaternion);

    _euler.set(x, y, z, 'XYZ');
    _qFrame.setFromEuler(_euler);
    _qWorld.copy(_qRoot).multiply(_qFrame).multiply(_qRootInv);

    _qBone.premultiply(_qWorld);
    bone.quaternion.copy(_qParent.invert()).multiply(_qBone);
  }

  /** Eases one bone toward its captured rest rotation by `w`. */
  _toRest(name, w) {
    const bone = this.bones[name];
    const rest = this._rest[name];
    if (bone && rest) bone.quaternion.slerp(rest, w);
  }

  /**
   * @param {number} weight 0..1 — how far into the aiming pose. Eased by
   *   combat.js, not stepped, so lowering the gun is not a snap.
   * @param {number} elevation radians the shot is angled above horizontal
   *   (positive = aiming up). Comes straight off the camera's pitch, which is
   *   what makes the gun point where the crosshair does.
   * @param {number} recoil 0..1 — decaying kick left by the last shot.
   * @param {number} reload 0..1 — how far into the dip that stands in for the
   *   Reload clip this rig does not have.
   * @param {number} support 0..1 — how much the LEFT arm comes up to support
   *   the gun. Zero while mounted: the left hand is holding the reins, and
   *   riding-pose.js owns it. This is the whole of the mounted/on-foot
   *   difference in this layer.
   * @param {number} hold 0..1 — the right hand is closed around the revolver's
   *   grip. Applied INDEPENDENTLY of `weight`, because the gun is in the fist
   *   whether or not it is raised, and this rig's rest pose is flat-splayed:
   *   without it the revolver sits in an open palm any time the arm is down.
   */
  apply(weight, elevation = 0, recoil = 0, reload = 0, support = 1, hold = 0) {
    if (!this.available || !this._captured) return;
    const h = THREE.MathUtils.clamp(hold, 0, 1);

    if (weight <= 0.0001) {
      // Release exactly once, then stay out of the mixer's way — the same
      // one-shot riding-pose.js uses, and for the same reason: nothing puts
      // back a bone no clip owns. Restoring bones the riding pose also drives
      // is harmless, because it re-poses them from its own baseline every
      // frame anyway.
      if (this._posed) {
        for (const name of OWNED) this._toRest(name, 1);
        this._posed = false;
      }
      // ...but the hand keeps its grip on the gun with the arm down. Reset
      // first so the curl is measured from rest every frame and cannot
      // compound (docs/ANIMATION.md's rule 4).
      if (h > 0.0001 && this.riding?.canGrip) {
        for (const name of GRIP_R) this._toRest(name, h);
        this.root.updateMatrixWorld(true);
        this.riding._grip(AIM_POSE.gripCurl * h, AIM_POSE.thumbCurl * h, ['R']);
      }
      return;
    }
    this._posed = true;

    const p = AIM_POSE;
    const w = Math.min(1, weight);
    const r = THREE.MathUtils.clamp(reload, 0, 1) * w;
    const kick = THREE.MathUtils.clamp(recoil, 0, 1) * w;
    const sup = THREE.MathUtils.clamp(support, 0, 1) * w;
    const elev = THREE.MathUtils.clamp(elevation, p.elevationMin, p.elevationMax) * p.elevationFollow;

    // Back to rest first, then every angle below is measured from a known
    // pose — see the file header. At full weight this also erases whatever
    // the riding pose just wrote to these bones, which is the handover.
    for (const name of SPINE) this._toRest(name, w);
    for (const name of ARM_R) this._toRest(name, w);
    // The grip is reset at whatever weight it will be re-applied at. A PARTIAL
    // reset under a full curl is the compounding bug from docs/ANIMATION.md's
    // rule 4 in miniature: `_grip()` is a delta, so anything it is not walked
    // all the way back from accumulates a little more curl every frame.
    const gripW = Math.max(w, h);
    for (const name of GRIP_R) this._toRest(name, gripW);
    // The left arm is only claimed when it is actually being used as support.
    // While mounted it belongs to the reins and must not be touched at all.
    if (sup > 0.0001) for (const name of ARM_L) this._toRest(name, sup);

    // The mixer and the riding pose have both just written local transforms;
    // world matrices are stale until this runs.
    this.root.updateMatrixWorld(true);
    this.root.getWorldQuaternion(_qRoot);
    _qRootInv.copy(_qRoot).invert();

    // Spine first: it carries the arms, so its world matrix has to be settled
    // before the arm rotations are converted into local space.
    this._rotate(this.bones.Chest, (p.chestPitch + p.recoilChestPitch * kick) * w, p.chestYaw * w, 0);
    this._rotate(this.bones.Head, p.headPitch * w, 0, 0);
    this.root.updateMatrixWorld(true);

    // Right arm. A hanging limb swings forward on NEGATIVE X (the spine, which
    // points up, is the opposite sense) — same convention riding-pose.js uses
    // for the thighs. Elevation and recoil both add to that; the reload dip
    // subtracts, dropping the gun below frame.
    const armX = -(p.armPitch + elev) * w + p.recoilArmPitch * kick + p.reloadArmDrop * r;
    const armZ = (p.armIn + p.reloadArmIn * r) * w; // +Z turns the RIGHT arm inward
    this._rotate(this.bones.UpperArmR, armX, 0, armZ);
    if (sup > 0.0001) {
      // Mirrored in Z, and it carries the SAME elevation as the gun arm. It
      // used to take half, which looked fine level and visibly wrong aiming
      // up — the two hands drifted apart exactly when the pose is most
      // exposed. There is no IK here to close a gap, so the cheapest way to
      // keep the support hand near the gun is to swing both arms together.
      this._rotate(this.bones.UpperArmL, -(p.supportArmPitch + elev) * sup + p.reloadArmDrop * r * sup, 0, -p.supportArmIn * sup);
    }
    this.root.updateMatrixWorld(true);

    // Elbows. The forearm now points roughly forward, so a negative X turn
    // folds it back up toward the shoulder.
    this._rotate(this.bones.LowerArmR, -(p.elbowBend * w + p.reloadElbowBend * r), 0, 0);
    if (sup > 0.0001) this._rotate(this.bones.LowerArmL, -p.supportElbowBend * sup, 0, 0);
    this._rotate(this.bones.WristR, -p.wristPitch * w, 0, 0);
    this.root.updateMatrixWorld(true);

    // Close the gun hand. Borrowed wholesale from the riding pose — see the
    // constructor. Driven by `hold`, not `weight`: a lowered gun is still held.
    if (this.riding?.canGrip) this.riding._grip(p.gripCurl * Math.max(w, h), p.thumbCurl * Math.max(w, h), ['R']);
  }
}
