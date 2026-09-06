/**
 * ambience.js — the four looping beds BUILD-PLAN.md's round 7 adds:
 *
 *   wind      — always on, flat on the listener.
 *   crickets  — night only; the day/night cycle's `nightFactor` fades it in.
 *   piano     — positional, at the saloon bar; three.js's distance model keeps
 *               it inside the building, so this file just starts it and leaves it.
 *   hoofbeats — only while mounted and moving; gain and playback rate both rise
 *               with the horse's speed.
 *
 * Every voice is a `Loop` handle from `audio.loop()`, which is inert when its
 * file is missing — so with an empty `audio/` this whole class is harmless
 * no-ops, exactly as the "runs silent" rule requires.
 */

import * as THREE from 'three';
import { AUDIO } from './config-combat.js';
import { HORSE } from './config-horse.js';

export class Ambience {
  /** @param {import('./audio.js').GameAudio} audio */
  constructor(audio) {
    this.audio = audio;
    const V = AUDIO.loopVolumes;

    this.wind = audio.loop('wind', { volume: V.wind });
    this.crickets = audio.loop('crickets', { volume: V.crickets });
    this.hoofbeats = audio.loop('hoofbeats', { volume: V.hoofbeats });
    this.piano = audio.loop('piano', {
      positional: true,
      position: new THREE.Vector3(AUDIO.pianoPosition.x, AUDIO.pianoPosition.y, AUDIO.pianoPosition.z),
      volume: V.piano,
      refDistance: AUDIO.pianoRefDistance,
      maxDistance: AUDIO.pianoMaxDistance,
      rolloff: AUDIO.pianoRolloff,
    });

    this.wind.setGain(1);
    this.piano.setGain(1);
    this._crk = 0; // eased crickets gain
    this._hoof = 0; // eased hoofbeats gain
  }

  /**
   * @param {number} dt
   * @param {object} s
   * @param {number} s.nightFactor  0 (day) .. 1 (deep night), from daynight.js
   * @param {boolean} s.mounted
   * @param {number} s.speed        the ridden horse's ground speed
   */
  update(dt, { nightFactor, mounted, speed }) {
    const k = 1 - Math.exp(-AUDIO.ambienceFadeRate * dt);

    const crkTarget = THREE.MathUtils.clamp((nightFactor - 0.15) / 0.6, 0, 1);
    this._crk += (crkTarget - this._crk) * k;
    this.crickets.setGain(this._crk);

    const ridingSpeed = mounted ? speed : 0;
    const pace = ridingSpeed / HORSE.gallopSpeed;
    const hoofTarget = ridingSpeed > 0.6 ? THREE.MathUtils.clamp(0.35 + pace, 0, 1) : 0;
    this._hoof += (hoofTarget - this._hoof) * k;
    this.hoofbeats.setGain(this._hoof);
    if (this._hoof > 0.001) {
      this.hoofbeats.setRate(AUDIO.hoofRateBase + pace * AUDIO.hoofRateGain);
    }
  }
}
