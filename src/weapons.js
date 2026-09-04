/**
 * weapons.js — the revolver: its geometry, its attachment to a character's
 * hand bone, and the one empty Object3D everything about a shot comes from.
 *
 * Split out of combat.js under BUILD-PLAN.md's 400-line cap; combat.js owns
 * the state machine and the shot, this file owns the object in the hand.
 *
 * THE GUN IS PARENTED TO THE HAND BONE, NOT FLOATED NEAR THE PLAYER — that is
 * a BUILD-PLAN.md requirement, and it brings two traps with it:
 *
 *  1. `Wrist.R` in the source file is `WristR` at runtime. GLTFLoader strips
 *     dots from node names. See docs/ANIMATION.md; this has cost this project
 *     a round already.
 *  2. THE ARMATURE CARRIES A LARGE BAKED SCALE. Anything parented into this
 *     skeleton inherits it — reins.js sidesteps the same trap by refusing to
 *     parent at all. Here we do have to parent (the gun must follow the fist
 *     exactly), so the bone's live world scale is measured at attach time and
 *     divided straight back out, which is what lets GUN.holdPosition and
 *     GUN.muzzleOffset be written in plain metres.
 *
 * Written generically against *any* loaded skeleton, not against the player:
 * bandit.glb shares player.glb's rig bone for bone, so round 4 arms a bandit
 * with the same call.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GUN } from './config-combat.js';

const _boneScale = new THREE.Vector3();
const _partMatrix = new THREE.Matrix4();
const _partEuler = new THREE.Euler();
const _partPos = new THREE.Vector3();
const _partQuat = new THREE.Quaternion();
const _partScale = new THREE.Vector3(1, 1, 1);

/**
 * Builds the revolver's geometry, origin at the back of the frame, barrel down
 * +Z.
 *
 * THE SEVEN PARTS ARE MERGED INTO ONE MESH PER MATERIAL — three, not seven.
 * Round 4 is what made that matter: a gun in every hand means eleven of these,
 * and each part is a draw call in the main pass AND again in the shadow pass.
 * Measured with four bandits, the player and the horse on screen at a camp,
 * merging took the frame from 126 draw calls to well under BUILD-PLAN.md's
 * ~120 budget. Baking each part's transform into its geometry leaves the
 * group's own origin and axes untouched, so GUN.holdPosition / holdRotation —
 * both solved numerically off the live skeleton — stay valid.
 */
function buildRevolverMesh() {
  const g = GUN;
  const steel = new THREE.MeshStandardMaterial({
    color: g.colorSteel, roughness: g.roughnessMetal, metalness: g.metalness,
  });
  const blued = new THREE.MeshStandardMaterial({
    color: g.colorBlued, roughness: g.roughnessMetal * 1.2, metalness: g.metalness,
  });
  const wood = new THREE.MeshStandardMaterial({ color: g.colorWood, roughness: 0.75, metalness: 0.05 });

  const group = new THREE.Group();
  const parts = new Map([[steel, []], [blued, []], [wood, []]]);
  const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
    _partEuler.set(rx, ry, rz);
    _partQuat.setFromEuler(_partEuler);
    _partPos.set(x, y, z);
    _partMatrix.compose(_partPos, _partQuat, _partScale);
    geo.applyMatrix4(_partMatrix);
    parts.get(mat).push(geo);
  };

  // Frame: the block the whole gun hangs off, origin at its back face.
  add(new THREE.BoxGeometry(g.frameWidth, g.frameHeight, g.frameLength), blued,
    0, 0, g.frameLength / 2);

  // Cylinder, lying along the barrel axis.
  add(new THREE.CylinderGeometry(g.cylinderRadius, g.cylinderRadius, g.cylinderLength, g.radialSegments), steel,
    0, 0, g.frameLength + g.cylinderLength / 2, Math.PI / 2, 0, 0);

  // Barrel, plus the ejector rod slung under it.
  const barrelZ = g.frameLength + g.cylinderLength;
  add(new THREE.CylinderGeometry(g.barrelRadius, g.barrelRadius, g.barrelLength, g.radialSegments), blued,
    0, 0, barrelZ + g.barrelLength / 2, Math.PI / 2, 0, 0);
  add(new THREE.CylinderGeometry(g.barrelRadius * 0.45, g.barrelRadius * 0.45, g.barrelLength * 0.72, 6), steel,
    0, -g.barrelRadius * 1.5, barrelZ + g.barrelLength * 0.38, Math.PI / 2, 0, 0);

  // Hammer spur, standing up off the back of the frame.
  add(new THREE.BoxGeometry(g.hammerSize * 0.6, g.hammerSize, g.hammerSize), steel,
    0, g.frameHeight * 0.5 + g.hammerSize * 0.35, g.hammerSize * 0.6, -0.35, 0, 0);

  // Grip, raked back and down from under the frame.
  add(new THREE.CylinderGeometry(g.gripRadius * 0.85, g.gripRadius, g.gripLength, g.radialSegments), wood,
    0,
    -g.frameHeight / 2 - Math.cos(g.gripRake) * g.gripLength / 2,
    g.frameLength * 0.18 - Math.sin(g.gripRake) * g.gripLength / 2,
    g.gripRake, 0, 0);

  // Trigger guard: a flattened torus under the frame's front half.
  add(new THREE.TorusGeometry(g.frameHeight * 0.42, g.barrelRadius * 0.35, 6, 12), steel,
    0, -g.frameHeight * 0.5, g.frameLength * 0.72, 0, Math.PI / 2, 0);

  for (const [material, geometries] of parts) {
    if (geometries.length === 0) continue;
    const merged = mergeGeometries(geometries, false);
    for (const geo of geometries) geo.dispose();
    const mesh = new THREE.Mesh(merged, material);
    mesh.castShadow = true;
    group.add(mesh);
  }
  return group;
}

/**
 * A revolver held in `rig`'s right hand.
 *
 * `muzzle` is the empty BUILD-PLAN.md requires: the muzzle flash is parented
 * to it and every shot's raycast starts at its world position, so both track
 * the barrel tip through the aiming pose, the recoil kick and the horse's
 * bank without any of them knowing about each other.
 */
export class Revolver {
  /** @param {THREE.Object3D} rig a loaded character root (player or, in round 4, a bandit) */
  constructor(rig) {
    this.group = buildRevolverMesh();
    this.muzzle = new THREE.Object3D();
    this.muzzle.position.set(GUN.muzzleOffset.x, GUN.muzzleOffset.y, GUN.muzzleOffset.z);
    this.group.add(this.muzzle);

    // Where the support hand is solved onto — see ik.js and aim-pose.js. An
    // empty for the same reason the muzzle is one: it rides the gun through the
    // aim pose, the recoil and the horse's bank without any of those knowing
    // about it.
    this.support = new THREE.Object3D();
    this.support.position.set(GUN.supportOffset.x, GUN.supportOffset.y, GUN.supportOffset.z);
    this.group.add(this.support);

    this.handBone = null;
    for (const name of GUN.handBoneCandidates) {
      const bone = rig.getObjectByName(name);
      if (bone) { this.handBone = bone; break; }
    }

    if (this.handBone) {
      this.handBone.add(this.group);
    } else {
      // BUILD-PLAN.md: loud warning, fall back to the player root rather than
      // shipping an invisible gun. It will float at the hip; it will still fire.
      console.warn(
        `[weapons] no hand bone found on this rig (tried: ${GUN.handBoneCandidates.join(', ')})`
        + ' — attaching the revolver to the character root instead. It will not follow the hand.',
      );
      rig.add(this.group);
      this.handBone = rig;
    }
    this.attachedToHand = this.handBone !== rig;

    this._applyHoldOffsets();
  }

  /**
   * Places the gun in the fist in real metres, by dividing the bone's own
   * world scale back out. See the file header — without this the revolver
   * renders at whatever multiple of life size the armature happens to carry.
   */
  _applyHoldOffsets() {
    this.handBone.updateWorldMatrix(true, false);
    this.handBone.getWorldScale(_boneScale);
    // A degenerate scale would divide by ~0 and fling the gun to infinity.
    const sx = Math.abs(_boneScale.x) > 1e-6 ? _boneScale.x : 1;
    const sy = Math.abs(_boneScale.y) > 1e-6 ? _boneScale.y : 1;
    const sz = Math.abs(_boneScale.z) > 1e-6 ? _boneScale.z : 1;
    this.boneWorldScale = { x: sx, y: sy, z: sz };

    this.group.position.set(GUN.holdPosition.x / sx, GUN.holdPosition.y / sy, GUN.holdPosition.z / sz);
    this.group.rotation.set(GUN.holdRotation.x, GUN.holdRotation.y, GUN.holdRotation.z);
    // One uniform divisor: a non-uniform bone scale would shear the gun, and
    // the mean is the least-wrong single number to undo it by.
    this.group.scale.setScalar(3 / (Math.abs(sx) + Math.abs(sy) + Math.abs(sz)));
  }

  /**
   * Refreshes the muzzle's world matrix from the skeleton up. Call before
   * reading `muzzleWorldPosition()`/`muzzleWorldDirection()` — the renderer
   * does not update matrices until render time, so without this a shot fired
   * mid-frame is aimed from where the hand was last frame.
   */
  syncWorld() {
    this.muzzle.updateWorldMatrix(true, false);
  }

  muzzleWorldPosition(out) {
    return out.setFromMatrixPosition(this.muzzle.matrixWorld);
  }

  /** The barrel's own forward axis (+Z), in world space. */
  muzzleWorldDirection(out) {
    const e = this.muzzle.matrixWorld.elements;
    return out.set(e[8], e[9], e[10]).normalize();
  }

  setVisible(visible) {
    this.group.visible = visible;
  }
}

/** Arms a character rig with a revolver. Generic: the player now, a bandit in round 4. */
export function createRevolver(rig) {
  return new Revolver(rig);
}
