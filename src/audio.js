/**
 * audio.js — the game's whole sound layer, and the one rule BUILD-PLAN.md
 * sets for it: A MISSING FILE LOGS A WARNING AND PLAYS SILENCE. Nothing in
 * here throws, nothing in here rejects, and no caller ever has to check
 * whether a sound loaded. `play('gunshot', pos)` on a game with an empty
 * `audio/` folder is a no-op, not a crash.
 *
 * Round 3 owns gunshot / reload / hit. Round 7 adds wind, crickets, piano and
 * hoofbeats, which are looping and mostly ambient — this file's `play()` is
 * one-shot only, so that round will add a `loop()` alongside rather than
 * reshaping this.
 *
 * Two browser facts drive the design:
 *
 *  1. An AudioContext starts suspended until a user gesture. The click that
 *     takes pointer lock is that gesture, so `resume()` is wired to it — but
 *     the context is created up front regardless, so nothing has to be
 *     lazily built at the moment of the first shot.
 *  2. A THREE.Audio owns one buffer source at a time: calling play() on one
 *     that is already playing restarts it and cuts the tail. Firing six shots
 *     in two seconds needs several voices per sound, round-robined.
 */

import * as THREE from 'three';
import { AUDIO } from './config-combat.js';

const _scratchPos = new THREE.Vector3();

class Voices {
  /** @param {THREE.Object3D} host what positional voices are parented to while idle */
  constructor(name, buffer, count, volume, host, listener) {
    this.name = name;
    this.pool = [];
    this.next = 0;
    for (let i = 0; i < count; i++) {
      const sound = new THREE.PositionalAudio(listener);
      sound.setBuffer(buffer);
      sound.setRefDistance(AUDIO.refDistance);
      sound.setRolloffFactor(AUDIO.rolloffFactor);
      sound.setMaxDistance(AUDIO.maxDistance);
      sound.setVolume(volume * AUDIO.masterVolume);
      host.add(sound);
      this.pool.push(sound);
    }
  }

  /** Round-robins so a new shot never cuts the tail off the previous one. */
  take() {
    const sound = this.pool[this.next];
    this.next = (this.next + 1) % this.pool.length;
    return sound;
  }
}

export class GameAudio {
  /**
   * @param {THREE.Camera} camera the listener rides the camera, so panning
   *   follows what the player is looking at.
   * @param {THREE.Scene} scene positional voices are moved to the world
   *   position of each event and live under this.
   */
  constructor(camera, scene) {
    this.enabled = true;
    this.listener = new THREE.AudioListener();
    camera.add(this.listener);
    // One host so a hundred idle voices are one child of the scene, not a
    // hundred. Voices are repositioned in world space at play time.
    this.host = new THREE.Group();
    this.host.name = 'audioVoices';
    scene.add(this.host);
    this.sounds = {};
    this.missing = [];
    this.loaded = false;
  }

  /**
   * Loads every configured clip. NEVER REJECTS — a failed file is recorded in
   * `missing`, warned about once, and simply has no voices, which makes every
   * later play() of it a silent no-op.
   */
  async load() {
    const loader = new THREE.AudioLoader();
    const entries = Object.entries(AUDIO.files);
    await Promise.all(entries.map(([name, file]) => new Promise((resolve) => {
      loader.load(
        AUDIO.basePath + file,
        (buffer) => {
          this.sounds[name] = new Voices(
            name, buffer, AUDIO.voices[name] ?? 1, AUDIO.volumes[name] ?? 1, this.host, this.listener,
          );
          resolve();
        },
        undefined,
        () => {
          this.missing.push(file);
          console.warn(`[audio] "${AUDIO.basePath}${file}" is missing or failed to decode — "${name}" will be silent.`);
          resolve();
        },
      );
    })));
    this.loaded = true;
    return this;
  }

  /**
   * Browsers hold the AudioContext suspended until a real user gesture.
   * main.js calls this from the same pointer-lock click that starts play.
   */
  resume() {
    const ctx = this.listener?.context;
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
  }

  /**
   * Fires a one-shot at a world position. Unknown or unloaded name: silence,
   * no throw. `detune` is a multiplier on playback rate — AUDIO.pitchJitter
   * is applied on top so a string of six shots is not a loop.
   */
  play(name, position, detune = 1) {
    if (!this.enabled) return null;
    const voices = this.sounds[name];
    if (!voices) return null;
    const sound = voices.take();
    if (sound.isPlaying) sound.stop();
    if (position) {
      // Voices live under one host at the scene root, so a world position is
      // just a local position — no matrix juggling, and no per-shot parenting.
      sound.position.copy(position);
    } else {
      sound.position.set(0, 0, 0);
    }
    const jitter = 1 + (Math.random() * 2 - 1) * AUDIO.pitchJitter;
    sound.setPlaybackRate(Math.max(0.05, detune * jitter));
    sound.play();
    return sound;
  }

  /** Convenience for "at the player/camera", used by non-diegetic cues. */
  playAtListener(name, detune = 1) {
    this.listener.getWorldPosition(_scratchPos);
    return this.play(name, _scratchPos, detune);
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (!enabled) {
      for (const voices of Object.values(this.sounds)) {
        for (const sound of voices.pool) if (sound.isPlaying) sound.stop();
      }
    }
  }
}

/**
 * Builds the audio layer and loads what it can. Awaiting this is safe even
 * with an entirely empty audio/ folder — that is the point.
 */
export async function createAudio(camera, scene) {
  return new GameAudio(camera, scene).load();
}
