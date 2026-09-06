/**
 * duel.js — the stand-and-draw. BUILD-PLAN.md round 6: "Approach a marked NPC,
 * press F to challenge. Camera cuts to a face-off shot, both draw stances,
 * tension builds over a randomised 2-5 seconds, then a signal. Timing window on
 * the draw: early = you lose, inside the window = clean kill, late = you take
 * the hit. Slow-motion on the winning shot."
 *
 * IT IS FULLY SCRIPTED — there is no duel AI (ADR-037). The opponent is a
 * `Townsperson` flagged `duelist` in config-townsfolk.js, marked to the player
 * only by openly carrying a revolver where every other citizen is unarmed. The
 * outcome is decided by the player's reaction time against `DUEL.window`, not
 * by a raycast; the muzzle flashes and the gunshot are played straight off
 * `vfx` / `audio` so a stray round can never hit a bystander and raise the
 * wanted level mid-duel.
 *
 * WHILE A DUEL RUNS the player is frozen: main.js calls `poseParticipants()`
 * in place of `horse.update()` / `player.update()`, and scales the whole
 * world's `dt` by `timeScale` for the slow-motion. The camera is handed a
 * third framing that COMPOSES the way aim and mounted do — see camera.js's
 * `setDuelShot()`.
 */

import * as THREE from 'three';
import { PLAYER } from './config.js';
import { TOWNSFOLK } from './config-townsfolk.js';
import { DUEL } from './config-bounty.js';
import { isKeyDown, isMouseDown, isPointerLocked } from './input.js';

export class Duel {
  /** @param {object} deps vfx, audio — the shared effect pools. */
  constructor({ vfx, audio }) {
    this.vfx = vfx;
    this.audio = audio;

    this.phase = 'idle'; // idle | faceoff | standoff | draw | resolved
    this.result = null; // 'win' | 'early' | 'late'
    this.timeScale = 1; // dt multiplier main.js applies to the world
    this.cameraWeight = 0; // 0..1, eased; camera.js lerps its framing by this
    this.prompt = false; // near a living duelist, not otherwise engaged
    this.opponent = null;
    this.opponentX = 0;
    this.opponentZ = 0;

    this._t = 0;
    this._drawAt = 0;
    this._cooldown = 0;
    this._playerAimW = 0;
    this._oppAimW = 0;
    this._playerRecoil = 0;
    this._prevFire = false;
    this._prevF = false;

    this._from = new THREE.Vector3();
    this._to = new THREE.Vector3();
  }

  /** True through every phase but idle — main.js freezes the player on this. */
  get freezesPlayer() {
    return this.phase !== 'idle';
  }

  get active() {
    return this.phase !== 'idle';
  }

  /** For ui.js: 'idle' | 'prompt' | 'faceoff' | 'standoff' | 'draw' | 'win' | 'lost'. */
  get hudState() {
    if (this.phase === 'idle') return this.prompt ? 'prompt' : 'idle';
    if (this.phase === 'resolved') return this.result === 'win' ? 'win' : 'lost';
    return this.phase;
  }

  /**
   * @param {number} raw the UNSCALED frame delta — the tension timer must run
   *   in real time, and this method is what decides `timeScale` for everyone
   *   else.
   */
  update(raw, player, tpCamera, deputies, townsfolk) {
    this._cooldown = Math.max(0, this._cooldown - raw);
    this._playerRecoil = Math.max(0, this._playerRecoil - raw * 6);

    const camTarget = this.active ? 1 : 0;
    this.cameraWeight += (camTarget - this.cameraWeight) * (1 - Math.exp(-DUEL.camBlendRate * raw));

    const fireDown = isPointerLocked() && isMouseDown(0);
    const fired = fireDown && !this._prevFire;
    this._prevFire = fireDown;
    const fDown = isPointerLocked() && isKeyDown('KeyF');
    const fEdge = fDown && !this._prevF;
    this._prevF = fDown;

    if (this.phase === 'idle') {
      this._idle(player, deputies, townsfolk, fEdge);
      return;
    }

    this._t += raw;
    if (this.opponent) {
      this.opponentX = this.opponent.position.x;
      this.opponentZ = this.opponent.position.z;
    }

    if (this.phase === 'faceoff') {
      this._playerAimW = Math.min(DUEL.readyAimWeight, this._playerAimW + (raw / DUEL.faceoffTime) * DUEL.readyAimWeight);
      this._oppAimW = this._playerAimW;
      if (this._t >= DUEL.faceoffTime) {
        this.phase = 'standoff';
        this._t = 0;
        this._drawAt = THREE.MathUtils.lerp(DUEL.tensionMin, DUEL.tensionMax, Math.random());
      }
    } else if (this.phase === 'standoff') {
      if (fired) { this._resolve('early', player, tpCamera); return; }
      if (this._t >= this._drawAt) { this.phase = 'draw'; this._t = 0; }
    } else if (this.phase === 'draw') {
      this._playerAimW = Math.min(1, this._playerAimW + raw * 8);
      this._oppAimW = Math.min(1, this._oppAimW + raw * 8);
      if (fired) {
        this._resolve(this._t <= DUEL.window ? 'win' : 'late', player, tpCamera);
        return;
      }
      if (this._t >= DUEL.opponentDrawTime) { this._resolve('late', player, tpCamera); return; }
    } else if (this.phase === 'resolved') {
      this.timeScale = this.result === 'win' && this._t < DUEL.slowMoTime
        ? DUEL.slowMoScale
        : (this.result === 'win'
          ? Math.min(1, DUEL.slowMoScale + (this._t - DUEL.slowMoTime) / DUEL.slowMoRamp)
          : 1);
      if (this._t >= DUEL.holdTime) this._end();
    }
  }

  _idle(player, deputies, townsfolk, fEdge) {
    this.prompt = false;
    this.opponent = null;
    this.timeScale = 1;
    if (player.dead || player.mounted || this._cooldown > 0) return;
    if ((deputies?.stars ?? 0) > 0) return; // not while the law is on you
    const list = townsfolk?.duelists ?? [];
    let best = null;
    let bestD = DUEL.challengeRange;
    for (const p of list) {
      if (!p.alive) continue;
      const d = Math.hypot(p.position.x - player.position.x, p.position.z - player.position.z);
      if (d < bestD) { bestD = d; best = p; }
    }
    if (!best) return;
    this.prompt = true;
    this.opponentX = best.position.x;
    this.opponentZ = best.position.z;
    if (fEdge) this._begin(best, player);
  }

  /**
   * Public test entry — smoke.mjs cannot produce a trusted `F` press headless,
   * the same reason horse.handleMountToggle() and combat.tryFire() are public
   * (ADR-011). Real play always goes through the `F` edge in `_idle()`.
   */
  beginDuel(player, opponent) {
    if (this.phase !== 'idle' || !opponent) return false;
    this._begin(opponent, player);
    return true;
  }

  /** Public test entry — acts as the player's trigger this instant. */
  pullTrigger(player, tpCamera) {
    if (this.phase === 'standoff') this._resolve('early', player, tpCamera);
    else if (this.phase === 'draw') this._resolve(this._t <= DUEL.window ? 'win' : 'late', player, tpCamera);
  }

  _begin(opp, player) {
    this.opponent = opp;
    this.opponentX = opp.position.x;
    this.opponentZ = opp.position.z;
    opp.inDuel = true;
    opp.character.weapon?.setVisible(true);
    opp.velocityXZ?.set(0, 0, 0);
    player.velocityXZ.set(0, 0, 0);
    this.phase = 'faceoff';
    this.result = null;
    this._t = 0;
    this._playerAimW = 0;
    this._oppAimW = 0;
  }

  _resolve(kind, player, tpCamera) {
    this.result = kind;
    this.phase = 'resolved';
    this._t = 0;
    const opp = this.opponent;
    this._muzzleShot(player.character?.weapon, this._chest(this._to, opp), tpCamera, false);
    if (kind === 'win') {
      opp?.damage?.(999, player.position.x, player.position.z); // Townsperson.damage — no crime tally
      this._playerAimW = 1;
      this._oppAimW = 0;
      this.timeScale = DUEL.slowMoScale; // slow-mo starts the instant the shot lands
    } else {
      // early or late — the opponent is faster
      this._muzzleShot(opp?.character?.weapon, this._chest(this._to, player), null, true);
      player.damage?.(DUEL.penaltyDamage);
      this._oppAimW = 1;
    }
  }

  _chest(out, ref) {
    return out.set(ref.position.x, ref.position.y + 1.3, ref.position.z);
  }

  _muzzleShot(weapon, target, tpCamera, enemy) {
    if (weapon) {
      weapon.syncWorld();
      weapon.muzzleWorldPosition(this._from);
      if (enemy) this.vfx?.enemyFire(this._from, target);
      else this.vfx?.fire(this._from, target);
      this.audio?.play('gunshot', this._from);
    } else {
      this.audio?.play('gunshot', target);
    }
    if (tpCamera && !enemy) tpCamera.addRecoil(DUEL.recoilPitch, DUEL.recoilShake);
    if (!enemy) this._playerRecoil = 1;
  }

  _end() {
    const opp = this.opponent;
    if (opp) {
      opp.inDuel = false;
      if (opp.alive) opp.character.weapon?.setVisible(true); // a live duelist keeps the gun out
    }
    this.opponent = null;
    this.phase = 'idle';
    this.result = null;
    this.timeScale = 1;
    this._playerAimW = 0;
    this._oppAimW = 0;
    this._cooldown = DUEL.cooldown;
  }

  /**
   * Drives BOTH rigs while the player is frozen — main.js calls this in place
   * of horse.update()/player.update(). Turns the two figures to face each
   * other, poses idle legs under a rising gun arm, and writes the transforms.
   */
  poseParticipants(dt, player) {
    const opp = this.opponent;
    if (!opp) return;
    const px = player.position.x;
    const pz = player.position.z;
    const ox = opp.position.x;
    const oz = opp.position.z;
    player.meshYaw = this._turn(player.meshYaw, Math.atan2(-(ox - px), -(oz - pz)), dt);
    opp.yaw = this._turn(opp.yaw, Math.atan2(-(px - ox), -(pz - oz)), dt);

    const pr = player.character;
    pr.setLocomotion('idle', 0, true);
    pr.setAirborne(false);
    pr.setRidingPose(0, 0, 0);
    pr.setAimPose({ weight: this._playerAimW, elevation: 0, recoil: this._playerRecoil, support: 1 });
    pr.update(dt);
    player.position.y = player.world.groundHeightAt(px, pz);
    pr.root.position.copy(player.position);
    pr.root.rotation.set(0, player.meshYaw + PLAYER.meshYawOffset, 0);

    const or = opp.character;
    if (opp.alive) {
      or.setLocomotion('idle', 0, true);
      or.setAirborne(false);
      or.setRidingPose(0, 0, 0);
      or.setAimPose({ weight: this._oppAimW, elevation: 0, recoil: 0, support: 1 });
    }
    or.update(dt); // a dead opponent's clamped Death clip settles the body during the slow-mo
    opp.position.y = opp.world.groundHeightAt(ox, oz);
    or.root.position.copy(opp.position);
    or.root.rotation.set(0, opp.yaw + TOWNSFOLK.meshYawOffset, 0);
  }

  _turn(from, to, dt) {
    let diff = ((to - from + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (diff < -Math.PI) diff += Math.PI * 2;
    return from + diff * Math.min(1, DUEL.turnRate * dt);
  }
}
