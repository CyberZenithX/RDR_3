/**
 * riding-pose.js — poses the player's skeleton into a seated riding position
 * while mounted: legs astride the barrel, feet hanging at the girth, hands
 * forward over the withers on the reins.
 *
 * There is no seated clip on this rig — player.glb ships 24 clips and every
 * one of them is standing or combat (see docs/ANIMATION.md), so a riding
 * pose has to be built by hand. It is applied *after* `mixer.update()` each
 * frame, which is the whole trick: the idle clip keeps playing underneath and
 * we overwrite the bones it just wrote.
 *
 * Which bones the clips actually own turned out to matter twice, and both are
 * measured facts, not assumptions — the idle clip's track list writes `Body`,
 * `Chest`, `Head`, the arms and the legs, and nothing else. `Torso` is absent,
 * so (a) a per-frame delta on it compounds instead of being reset, which folded
 * the rider over backwards a little more every frame, and (b) nothing puts it
 * back on dismount, so the pose has to release it by hand. See `_rest` and
 * `apply()`'s weight-0 branch.
 *
 * Two properties of this skeleton drive the implementation, both measured off
 * the live rig rather than assumed (see docs/ANIMATION.md's rig section):
 *
 *  1. Bone rest orientations are baked-IK arbitrary — `UpperLegL`'s local
 *     quaternion is nowhere near identity — so "rotate the thigh forward" is
 *     not expressible as a readable bone-local angle. Every angle here is
 *     therefore authored in the *character root's* frame (+X left, +Y up,
 *     +Z forward) and converted per-bone at runtime by `_rotate()`.
 *
 *  2. THE FEET ARE NOT ATTACHED TO THE LEGS. `FootL/R` are top-level children
 *     of `Root`, siblings of the whole leg chain, positioned in Root space.
 *     Bending a knee moves the shin and leaves the foot welded in place, and
 *     the skin between them smears into a long curved "boomerang boot" — a
 *     skinning stretch that looks like a rotation bug and isn't one. This cost
 *     the project a removed feature once already. So after posing the legs,
 *     `_placeFeet()` re-derives each foot's transform from its shin, using the
 *     shin-relative offset captured from the un-posed rig.
 */

import * as THREE from 'three';
import { RIDING_POSE } from './config-horse.js';

// Reused scratch — nothing in here allocates per frame.
const _qFrame = new THREE.Quaternion();
const _qWorld = new THREE.Quaternion();
const _qRoot = new THREE.Quaternion();
const _qRootInv = new THREE.Quaternion();
const _qParent = new THREE.Quaternion();
const _qBone = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _mWanted = new THREE.Matrix4();
const _mParentInv = new THREE.Matrix4();
const _scale = new THREE.Vector3();

const _axis = new THREE.Vector3();
const _pIndex = new THREE.Vector3();
const _pPinky = new THREE.Vector3();

/** Bones the pose drives. Anything missing degrades that part of the pose, not the whole thing. */
const BONE_NAMES = [
  'UpperLegL', 'UpperLegR', 'LowerLegL', 'LowerLegR', 'FootL', 'FootR',
  'UpperArmL', 'UpperArmR', 'LowerArmL', 'LowerArmR', 'Torso', 'Head',
];

/**
 * Finger joints, per hand, that close around the reins. The rig carries a full
 * hand (four fingers of four joints plus a thumb); the fourth joint of each
 * finger is the tip, which has nothing below it to bend.
 *
 * These matter more than they sound: the GLB's rest pose has the fingers
 * splayed flat, and the idle clip only curls the *left* hand's — so a rider
 * reset to rest sits there holding the reins with two open palms.
 */
const FINGERS = ['Index', 'Middle', 'Ring', 'Pinky'];
const FINGER_JOINTS = [1, 2, 3];
const GRIP_BONES = [];
for (const side of ['L', 'R']) {
  for (const finger of FINGERS) for (const j of FINGER_JOINTS) GRIP_BONES.push(`${finger}${j}${side}`);
  for (const j of [1, 2, 3]) GRIP_BONES.push(`Thumb${j}${side}`);
}

export class RidingPose {
  /** @param {THREE.Object3D} root the loaded character rig's scene root */
  constructor(root) {
    this.root = root;
    this.bones = {};
    // GLTFLoader strips dots from node names ('Wrist.R' -> 'WristR'), so these
    // are the runtime forms, not the source-file forms. See docs/ANIMATION.md.
    for (const name of BONE_NAMES) this.bones[name] = root.getObjectByName(name) ?? null;
    for (const name of GRIP_BONES) this.bones[name] = root.getObjectByName(name) ?? null;
    for (const side of ['L', 'R']) this.bones[`Wrist${side}`] = root.getObjectByName(`Wrist${side}`) ?? null;
    this.canGrip = false; // decided by _captureGripAxes() once the rig can be measured
    this._gripAxes = {};

    const legs = ['UpperLegL', 'UpperLegR', 'LowerLegL', 'LowerLegR', 'FootL', 'FootR'];
    this.available = legs.every((n) => this.bones[n]);
    if (!this.available) {
      const missing = legs.filter((n) => !this.bones[n]);
      console.warn(`[riding-pose] rig is missing ${missing.join(', ')} — riding falls back to the standing pose`);
    }

    // Each foot's transform relative to its own shin, so the foot can be made
    // to follow the shin it isn't parented to.
    this._footFromShin = { L: new THREE.Matrix4(), R: new THREE.Matrix4() };
    // Each posed bone's rest rotation. THE POSE MUST BE IDEMPOTENT: `_rotate()`
    // applies a *delta*, and a delta is only safe on a bone the mixer rewrites
    // every frame. `Torso` is not in the idle clip's track list (verified by
    // reading the clip's tracks — idle writes Body, Chest, Head, the arms and
    // the legs, and nothing else), so applying a delta to it compounds frame
    // after frame: the rider was slowly folded over backwards until they lay
    // flat. Restoring from this baseline first makes the result depend only on
    // the configured angles, never on how many frames have been ridden.
    this._rest = {};
    this._captured = false;
    this._posed = false; // was the pose applied last frame? drives the one-shot release
  }

  /**
   * Snapshots the rig's rest pose. Called once at construction, before the
   * mixer has ever run, so the baseline is the GLB's own authored pose — clean,
   * symmetric, and independent of wherever a clip happened to be when the
   * player swung into the saddle.
   */
  captureBaseline() {
    if (!this.available) return;
    for (const name of [...BONE_NAMES, ...GRIP_BONES]) {
      const bone = this.bones[name];
      if (bone) this._rest[name] = bone.quaternion.clone();
    }
    this.root.updateMatrixWorld(true);
    for (const side of ['L', 'R']) {
      const shin = this.bones[`LowerLeg${side}`];
      const foot = this.bones[`Foot${side}`];
      _mParentInv.copy(shin.matrixWorld).invert();
      this._footFromShin[side].multiplyMatrices(_mParentInv, foot.matrixWorld);
    }
    this._captureGripAxes();
    this._captured = true;
  }

  /**
   * Rotates one bone by an angle expressed in the character root's frame, on
   * top of whatever the mixer just wrote to it.
   *
   * Given a rotation Q authored in root space, the world-space equivalent is
   * R·Q·R⁻¹ (R = the root's world rotation); the bone's local value is then
   * parent⁻¹ · (that) · currentWorld. Parent world matrices must already be
   * current — `apply()` refreshes them between stages for exactly this reason.
   */
  _rotate(bone, x, y, z) {
    if (!bone) return;
    bone.parent.getWorldQuaternion(_qParent);
    _qBone.copy(_qParent).multiply(bone.quaternion); // the bone's current world rotation

    _euler.set(x, y, z, 'XYZ');
    _qFrame.setFromEuler(_euler);
    _qWorld.copy(_qRoot).multiply(_qFrame).multiply(_qRootInv);

    _qBone.premultiply(_qWorld);
    bone.quaternion.copy(_qParent.invert()).multiply(_qBone);
  }

  /**
   * Eases one bone from whatever the clip left it at toward its rest rotation,
   * by the pose's current blend weight. Every configured angle is then measured
   * from that rest pose, so at full weight the result is exactly the authored
   * pose no matter what was playing underneath a moment ago.
   */
  _toRest(bone, name, w) {
    const rest = this._rest[name];
    if (bone && rest) bone.quaternion.slerp(rest, w);
  }

  /** Like `_rotate()`, but about an explicit world-space axis. */
  _rotateAxis(bone, axis, angle) {
    if (!bone || angle === 0) return;
    bone.parent.getWorldQuaternion(_qParent);
    _qBone.copy(_qParent).multiply(bone.quaternion);
    _qWorld.setFromAxisAngle(axis, angle);
    _qBone.premultiply(_qWorld);
    bone.quaternion.copy(_qParent.invert()).multiply(_qBone);
  }

  /**
   * Works out, once, which way each finger bends, and stores it in wrist space
   * so it stays valid however the arm is posed later.
   *
   * The obvious axis — the line across the knuckles — does not exist on this
   * rig: measured directly, `Index1L` and `Pinky1L` sit at *exactly* the same
   * world position (all four finger roots are zero-length hub bones at the
   * wrist, with the splay carried in their rotations), so that vector is the
   * zero vector and rotating about it does nothing at all.
   *
   * What is well defined is the fan the fingers make. Their directions span the
   * plane of the flat hand, so the normal of that fan is the palm's normal, and
   * each finger hinges about the axis perpendicular to itself *within* that
   * plane. The bend direction is then settled against the thumb, which sits on
   * the palm side by anatomy — that also gets the mirrored right hand right,
   * without hardcoding a per-hand sign.
   */
  _captureGripAxes() {
    this.canGrip = false;
    const dirIndex = new THREE.Vector3();
    const dirPinky = new THREE.Vector3();
    const palmNormal = new THREE.Vector3();
    const thumbDir = new THREE.Vector3();
    const hinge = new THREE.Vector3();
    const probe = new THREE.Vector3();
    const wristQuat = new THREE.Quaternion();
    const dir = new THREE.Vector3();

    const fingerDir = (side, finger, out) => {
      const a = this.bones[`${finger}1${side}`];
      const b = this.bones[`${finger}2${side}`];
      if (!a || !b) return null;
      b.getWorldPosition(_pPinky);
      a.getWorldPosition(_pIndex);
      out.subVectors(_pPinky, _pIndex);
      return out.lengthSq() > 1e-10 ? out.normalize() : null;
    };

    this._gripAxes = {};
    for (const side of ['L', 'R']) {
      const wrist = this.bones[`Wrist${side}`];
      const thumb = this.bones[`Thumb1${side}`];
      if (!wrist || !thumb) continue;
      if (!fingerDir(side, 'Index', dirIndex) || !fingerDir(side, 'Pinky', dirPinky)) continue;

      palmNormal.crossVectors(dirIndex, dirPinky);
      if (palmNormal.lengthSq() < 1e-10) continue; // fingers perfectly parallel: no fan to read
      palmNormal.normalize();

      // Which side of the fan plane is the palm on? The one the thumb tip is
      // held out toward. Measuring the *tip* rather than the thumb's root
      // matters: the roots of all five digits sit at the same point on this
      // rig, so a root-to-wrist vector says nothing about which way is palmward.
      const thumbTip = this.bones[`Thumb3${side}`] ?? this.bones[`Thumb2${side}`] ?? thumb;
      thumbTip.getWorldPosition(_pIndex);
      this.bones[`Index2${side}`].getWorldPosition(_pPinky);
      thumbDir.subVectors(_pIndex, _pPinky);
      const palmSide = thumbDir.dot(palmNormal);
      if (Math.abs(palmSide) < 1e-6) continue; // thumb lies in the fan plane: which way is palmward is unreadable

      // Does a positive turn about the hinge carry the fingertip to that side?
      // If not, this hand closes the other way.
      hinge.crossVectors(palmNormal, dirIndex).normalize();
      probe.copy(dirIndex).applyAxisAngle(hinge, 0.3).sub(dirIndex);
      const sign = probe.dot(palmNormal) * palmSide >= 0 ? 1 : -1;

      wrist.getWorldQuaternion(wristQuat);
      wristQuat.invert();
      const axes = {};
      for (const finger of FINGERS) {
        if (!fingerDir(side, finger, dir)) continue;
        axes[finger] = hinge.crossVectors(palmNormal, dir).normalize()
          .multiplyScalar(sign).applyQuaternion(wristQuat).clone();
      }
      if (fingerDir(side, 'Thumb', dir)) {
        axes.Thumb = hinge.crossVectors(palmNormal, dir).normalize()
          .multiplyScalar(sign).applyQuaternion(wristQuat).clone();
      }
      if (Object.keys(axes).length) {
        this._gripAxes[side] = axes;
        this.canGrip = true;
      }
    }
  }

  /**
   * Closes a hand around whatever it is holding, about the axes
   * `_captureGripAxes()` derived. Defaults to both hands (the reins).
   *
   * `sides` exists for round 3: while aiming, the right hand grips the
   * revolver and is posed by aim-pose.js, which calls this with `['R']`
   * rather than re-deriving a grip — the hard part here (the naive knuckle
   * axis is the zero vector on this rig) is already solved, and
   * docs/ARCHITECTURE.md lists this method as reusable for exactly that.
   */
  _grip(curl, thumbCurl, sides = ['L', 'R']) {
    if (!this.canGrip || curl === 0) return;
    for (const side of sides) {
      const axes = this._gripAxes[side];
      const wrist = this.bones[`Wrist${side}`];
      if (!axes || !wrist) continue;
      wrist.getWorldQuaternion(_qParent);
      for (const finger of FINGERS) {
        if (!axes[finger]) continue;
        _axis.copy(axes[finger]).applyQuaternion(_qParent);
        for (const j of FINGER_JOINTS) this._rotateAxis(this.bones[`${finger}${j}${side}`], _axis, curl);
      }
      if (axes.Thumb) {
        _axis.copy(axes.Thumb).applyQuaternion(_qParent);
        for (const j of [1, 2, 3]) this._rotateAxis(this.bones[`Thumb${j}${side}`], _axis, thumbCurl);
      }
    }
  }

  /**
   * Re-derives both feet from their (now posed) shins, as if the foot were the
   * shin's child. Without this the knees bend and the feet stay behind — see
   * the file header.
   */
  _placeFeet(ankle) {
    for (const side of ['L', 'R']) {
      const shin = this.bones[`LowerLeg${side}`];
      const foot = this.bones[`Foot${side}`];
      _mWanted.multiplyMatrices(shin.matrixWorld, this._footFromShin[side]);
      _mParentInv.copy(foot.parent.matrixWorld).invert();
      _mWanted.premultiply(_mParentInv);
      _mWanted.decompose(foot.position, foot.quaternion, _scale);
      foot.scale.copy(_scale);
      foot.updateWorldMatrix(false, false);
      // Heel down / toe up, the way a boot sits in a stirrup.
      if (ankle) this._rotate(foot, ankle, 0, 0);
    }
  }

  /**
   * @param {number} weight 0..1 — how much of the pose to apply. Ramps in over
   *   the mount blend so the rider eases into the saddle instead of snapping.
   * @param {number} sway -1..1 — the horse's current gait bob, so the rein
   *   hands and torso move in phase with the stride rather than on a guessed
   *   sine of their own.
   * @param {number} jump 0..1 — how far into the two-point (jumping) seat the
   *   rider is: forward at the hip, knee closed, hands pushed up the neck. The
   *   vertical half of coming up out of the saddle is not an angle at all —
   *   it is HORSE.jumpSeatRise, applied to the seat itself in horse-seat.js.
   */
  apply(weight, sway = 0, jump = 0) {
    if (!this.available || !this._captured) return;
    if (weight <= 0.0001) {
      // Releasing the pose has to put the un-animated bones back by hand. The
      // mixer restores everything it owns on its next update, but `Torso` is
      // in no idle-clip track (see `_rest`), so a dismounted rider would go on
      // standing there with a rider's forward lean until they happened to walk
      // — walk and run *do* animate it. One restore at the transition, then
      // hands off, so a clip that does own the bone is never fought.
      if (this._posed) {
        for (const name of [...BONE_NAMES, ...GRIP_BONES]) this._toRest(this.bones[name], name, 1);
        this._posed = false;
      }
      return;
    }
    this._posed = true;
    const p = RIDING_POSE;
    const w = Math.min(1, weight);
    const s = sway * w;
    const j = THREE.MathUtils.clamp(jump, 0, 1) * w;

    // Back to rest first — see `_rest`'s comment for why a bare delta is not
    // safe here — then every angle below is measured from that known pose.
    for (const name of BONE_NAMES) this._toRest(this.bones[name], name, w);
    for (const name of GRIP_BONES) this._toRest(this.bones[name], name, w);

    // The mixer has just written new local transforms; world matrices are a
    // frame stale until this runs.
    this.root.updateMatrixWorld(true);
    this.root.getWorldQuaternion(_qRoot);
    _qRootInv.copy(_qRoot).invert();

    // Torso and head first: they carry the arms, so the arms' parent chain has
    // to be settled before the arm rotations are converted into local space.
    // The spine points *up*, so a positive X rotation carries it forward —
    // the opposite sense to the limbs below, which hang down.
    this._rotate(this.bones.Torso, (p.torsoPitch + p.swayTorso * s + p.jumpTorsoPitch * j) * w, 0, 0);
    this._rotate(this.bones.Head, (p.headPitch + p.jumpHeadPitch * j) * w, 0, 0);
    this.root.updateMatrixWorld(true);

    // Thighs: forward to sit astride (-X is forward for a hanging limb), and
    // outward around the barrel — mirrored in Z between the two sides.
    const thighPitch = -(p.thighPitch + p.swayThigh * s + p.jumpThighPitch * j) * w;
    const spread = p.thighSpread * w;
    this._rotate(this.bones.UpperLegL, thighPitch, 0, spread);
    // The right leg carries a trim: this rig's legs are not mirror images of
    // each other at rest, so a mirrored angle does not give a mirrored leg.
    this._rotate(this.bones.UpperLegR, thighPitch - p.rightPitchTrim * w, 0, -(spread + p.rightSpreadTrim * w));

    // Upper arms: forward toward the reins, tucked in toward the centreline.
    const armPitch = -(p.armPitch + p.jumpArmPitch * j) * w;
    const armIn = p.armIn * w;
    this._rotate(this.bones.UpperArmL, armPitch, 0, -armIn);
    this._rotate(this.bones.UpperArmR, armPitch, 0, armIn);
    this.root.updateMatrixWorld(true);

    // Knees fold the shin back down, elbows carry the hands forward to the reins.
    const knee = p.kneeBend + p.jumpKneeBend * j;
    this._rotate(this.bones.LowerLegL, knee * w, 0, 0);
    this._rotate(this.bones.LowerLegR, (knee + p.rightKneeTrim) * w, 0, 0);
    const elbow = -(p.elbowBend + p.swayElbow * s + p.jumpElbowBend * j) * w;
    this._rotate(this.bones.LowerArmL, elbow, 0, 0);
    this._rotate(this.bones.LowerArmR, elbow, 0, 0);
    this.root.updateMatrixWorld(true);

    this._grip(p.gripCurl * w, p.thumbCurl * w);

    // Toe up, heel down: the foot points forward, so that is a negative X turn.
    this._placeFeet(-p.anklePitch * w);
  }
}
