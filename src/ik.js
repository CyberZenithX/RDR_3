/**
 * ik.js — a two-bone IK solve, and the one primitive it is built on.
 *
 * Written for the support hand: the left arm was posed by three fixed angles
 * that put it *near* the revolver, so the gap between the hands opened and
 * closed as the gun's elevation changed and the off hand never actually
 * touched it. Fixed angles cannot track a moving target; this solves for it.
 *
 * WHY IT AIMS BONES RATHER THAN SETTING ANGLES. Every rest orientation on this
 * skeleton is baked-IK arbitrary (riding-pose.js's header has the measurements),
 * so "rotate the upper arm to 40 degrees" is not a thing that can be written
 * down. `aimBoneAt` sidesteps the whole question: it takes where a bone's child
 * currently is and where it should be, builds the world-space rotation between
 * those two directions, and converts that into whatever local value this
 * particular bone needs. It never needs to know the bone's rest pose.
 */

import * as THREE from 'three';

const _bonePos = new THREE.Vector3();
const _childPos = new THREE.Vector3();
const _from = new THREE.Vector3();
const _to = new THREE.Vector3();
const _qRot = new THREE.Quaternion();
const _qParent = new THREE.Quaternion();
const _qBone = new THREE.Quaternion();

const _root = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _tip = new THREE.Vector3();
const _target = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _perp = new THREE.Vector3();
const _elbow = new THREE.Vector3();

/**
 * Turns `bone` so the point currently at `childWorld` ends up pointing at
 * `targetWorld`. World matrices on `bone` and its ancestors must be current.
 */
export function aimBoneAt(bone, childWorld, targetWorld) {
  bone.getWorldPosition(_bonePos);
  _from.copy(childWorld).sub(_bonePos);
  _to.copy(targetWorld).sub(_bonePos);
  if (_from.lengthSq() < 1e-10 || _to.lengthSq() < 1e-10) return;
  _from.normalize();
  _to.normalize();
  _qRot.setFromUnitVectors(_from, _to);

  bone.parent.getWorldQuaternion(_qParent);
  _qBone.copy(_qParent).multiply(bone.quaternion); // current world rotation
  _qBone.premultiply(_qRot); // ...turned by the world-space correction
  bone.quaternion.copy(_qParent.invert()).multiply(_qBone);
  bone.updateWorldMatrix(false, true);
}

/**
 * Two-bone IK: bends `upper`/`lower` so `tip` reaches `targetWorld`.
 *
 * @param {THREE.Object3D} upper shoulder-side bone (its child is the elbow)
 * @param {THREE.Object3D} lower elbow bone (its child is the hand)
 * @param {THREE.Object3D} tip the hand itself, whose world position is the
 *   thing being driven onto the target
 * @param {THREE.Vector3} targetWorld where the hand should end up
 * @param {THREE.Vector3} poleWorld a hint for which way the elbow bends — the
 *   elbow is placed on the side of the shoulder-to-target line that this points
 *   to. Without it the solve is free to rotate the elbow anywhere on a cone and
 *   the arm rolls unpredictably as the target moves.
 * @param {number} weight 0..1, blended against wherever the arm already was.
 */
export function solveTwoBoneIK(upper, lower, tip, targetWorld, poleWorld, weight = 1) {
  if (!upper || !lower || !tip || weight <= 0.0001) return false;

  upper.getWorldPosition(_root);
  lower.getWorldPosition(_mid);
  tip.getWorldPosition(_tip);

  const l1 = _root.distanceTo(_mid);
  const l2 = _mid.distanceTo(_tip);
  if (l1 < 1e-6 || l2 < 1e-6) return false;

  // Blend the target itself rather than the result: partway through a blend the
  // arm then tracks a point partway to the gun, which reads as reaching for it.
  _target.copy(_tip).lerp(targetWorld, weight);

  _axis.copy(_target).sub(_root);
  let dist = _axis.length();
  if (dist < 1e-6) return false;
  // An arm cannot reach further than it is long, and folding it completely
  // flat is a singularity — keep a little short of both.
  const min = Math.abs(l1 - l2) + 1e-3;
  const max = l1 + l2 - 1e-3;
  if (dist > max) dist = max;
  if (dist < min) dist = min;
  _axis.normalize();
  _target.copy(_root).addScaledVector(_axis, dist);

  // Where the elbow sits: law of cosines along the shoulder-to-hand line, then
  // out along the pole direction, perpendicular to that line.
  const along = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist);
  const outSq = l1 * l1 - along * along;
  const out = outSq > 0 ? Math.sqrt(outSq) : 0;

  _pole.copy(poleWorld).sub(_root);
  _perp.copy(_pole).addScaledVector(_axis, -_pole.dot(_axis));
  if (_perp.lengthSq() < 1e-8) {
    // Pole parallel to the bone chain; any perpendicular will do.
    _perp.set(-_axis.y, _axis.x, 0);
    if (_perp.lengthSq() < 1e-8) _perp.set(0, 0, 1);
  }
  _perp.normalize();

  _elbow.copy(_root).addScaledVector(_axis, along).addScaledVector(_perp, out);

  aimBoneAt(upper, _mid, _elbow);
  // The elbow has moved, so the hand's position has to be re-read before the
  // forearm is aimed — using the stale one bends the second bone by the wrong
  // angle and the hand lands short.
  tip.getWorldPosition(_tip);
  lower.getWorldPosition(_mid);
  aimBoneAt(lower, _tip, _target);
  return true;
}
