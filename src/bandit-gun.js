/**
 * bandit-gun.js — one bandit's firing path.
 *
 * Split out of bandit.js when the aim lead and the riderless-horse test pushed
 * that file past BUILD-PLAN.md's 400-line cap. It is deliberately NOT
 * combat.js: that is the *player's* gun, and it resolves its aim through the
 * third-person camera, drives the crosshair, the screen shake and the ammo
 * pips, none of which a bandit has (docs/DECISIONS.md ADR-028). What the two
 * share is everything below the trigger — weapons.js, combat-ray.js, vfx.js
 * and audio.js.
 */

import * as THREE from 'three';
import { PLAYER, ANIM } from './config.js';
import { BANDIT, HEALTH } from './config-ai.js';
import { COMBAT } from './config-combat.js';
import { resetHit, raycastCylinder, raycastColliders, raycastTerrain } from './combat-ray.js';

const _muzzle = new THREE.Vector3();
const _to = new THREE.Vector3();
const _shot = new THREE.Vector3();
const _end = new THREE.Vector3();
const _side = new THREE.Vector3();
const _perp = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

/**
 * Nudges the aim point toward where the target is going.
 *
 * A mounted player's own velocity is zero — horse.js carries them, and
 * player.js's physics do not run while riding — so the horse's velocity is
 * the one that matters, and reading the wrong one is why a galloping rider
 * was effectively un-led. Partial by design: see BANDIT.aimLead.
 */
function leadTarget(bandit, target, player) {
  const lead = BANDIT.aimLead;
  if (!(lead > 0)) return;
  const vel = player.mounted ? bandit.group.horse?.velocityXZ : player.velocityXZ;
  if (!vel) return;
  const flight = Math.hypot(target.x - bandit.position.x, target.z - bandit.position.z) / BANDIT.aimLeadBulletSpeed;
  target.x += vel.x * flight * lead;
  target.z += vel.z * flight * lead;
}

export function fireAt(bandit, player) {
  bandit.ammo--;
  bandit._fireTimer = BANDIT.fireInterval + Math.random() * BANDIT.fireIntervalJitter;
  bandit._recoil = COMBAT.recoilPoseKick;

  // The muzzle empty, refreshed from the skeleton up — the same rule the
  // player's shot obeys, and for the same reason (weapons.js).
  const weapon = bandit.character.weapon;
  weapon.syncWorld();
  weapon.muzzleWorldPosition(_muzzle);

  _to.set(player.position.x, player.position.y + BANDIT.chestHeight, player.position.z);
  leadTarget(bandit, _to, player);
  _shot.subVectors(_to, _muzzle);
  if (_shot.lengthSq() < 1e-8) return;
  _shot.normalize();
  const spread = BANDIT.spread * (bandit.speed > ANIM.idleThreshold ? BANDIT.movingSpreadFactor : 1);
  applySpread(_shot, spread);

  resetHit(bandit._hit);
  // The player first and explicitly, as a cylinder from their feet to the
  // top of their head — see the file header for why not via the collider list.
  if (raycastCylinder(
    _muzzle, _shot, BANDIT.fireRange,
    player.position.x, player.position.z,
    player.position.y, player.position.y + PLAYER.modelHeight,
    BANDIT.playerHitRadius, bandit._hit,
  )) {
    bandit._hit.kind = 'player';
    bandit._hit.ref = player;
  }
  // The horse, but only with nobody on it. Its collider is in rayIgnore for
  // good reason (a mounted rider would otherwise be shielded by the animal
  // they are sitting on), so this is an explicit cylinder, the same shape and
  // for the same reason as the player test above. See HEALTH.horseMax.
  const horse = bandit.group.horse;
  if (horse && !player.mounted && raycastCylinder(
    _muzzle, _shot, BANDIT.fireRange,
    horse.position.x, horse.position.z,
    horse.position.y, horse.position.y + BANDIT.horseHitHeight,
    BANDIT.horseHitRadius, bandit._hit,
  )) {
    bandit._hit.kind = 'horse';
    bandit._hit.ref = horse;
  }
  bandit.group.targets?.raycast(_muzzle, _shot, BANDIT.fireRange, bandit._hit);
  raycastColliders(_muzzle, _shot, BANDIT.fireRange, bandit.group.rayIgnore, bandit._hit);
  raycastTerrain(_muzzle, _shot, BANDIT.fireRange, bandit._hit);

  if (bandit._hit.hit) _end.copy(bandit._hit.point);
  else _end.copy(_muzzle).addScaledVector(_shot, BANDIT.fireRange);
  bandit.group.vfx?.enemyFire(_muzzle, _end);
  bandit.group.audio?.play('gunshot', _muzzle);
  // Gunfire wakes the camp — and what it tells the others is where the
  // ENEMY is, not where the shooter is standing. Broadcasting the muzzle
  // would send four men running toward their own friend; measured, without
  // this only the two bandits who happened to be facing the player ever
  // joined the fight while the other two patrolled through it.
  bandit.group.hearShot(player.position.x, player.position.z);

  if (!bandit._hit.hit) return;
  if (bandit._hit.kind === 'horse') {
    bandit._hit.ref?.damage?.(HEALTH.horseDamage, bandit.position.x, bandit.position.z);
    bandit.group.audio?.play('hit', bandit._hit.point);
    return;
  }
  if (bandit._hit.kind === 'player') {
    player.damage(HEALTH.banditDamage);
    bandit.group.audio?.play('hit', bandit._hit.point);
    return;
  }
  const groundY = bandit.world.groundHeightAt(bandit._hit.point.x, bandit._hit.point.z);
  bandit.group.vfx?.impact(bandit._hit.point, bandit._hit.normal, groundY);
  const outcome = bandit.group.targets?.hit(bandit._hit.ref) ?? null;
  if (outcome === 'destroyed') {
    bandit.group.vfx?.burst(bandit._hit.point, bandit._hit.kind === 'bottle' ? 0x2f5e3a : 0x6d4a2a, groundY);
  }
}

/** Scatters `dir` into a random cone. Same disc-uniform sampling combat.js uses. */
function applySpread(dir, spread) {
  if (spread <= 0) return;
  _side.crossVectors(dir, _up);
  if (_side.lengthSq() < 1e-6) _side.set(1, 0, 0);
  _side.normalize();
  _perp.crossVectors(dir, _side).normalize();
  const angle = Math.random() * Math.PI * 2;
  const radius = Math.tan(spread) * Math.sqrt(Math.random());
  dir.addScaledVector(_side, Math.cos(angle) * radius)
    .addScaledVector(_perp, Math.sin(angle) * radius)
    .normalize();
}
