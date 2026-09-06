/**
 * audio.js — the game's whole sound layer, and the one rule BUILD-PLAN.md
 * sets for it: A MISSING FILE LOGS A WARNING AND PLAYS SILENCE. Nothing in
 * here throws, nothing in here rejects, and no caller ever has to check
 * whether a sound loaded. `play('gunshot', pos)` on a game with an empty
 * `audio/` folder is a no-op, not a crash; `loop('wind')` returns an inert
 * handle whose methods do nothing.
 *
 * Round 3 owns the one-shots — gunshot / reload / hit. Round 7 adds the four
 * looping ambiences — wind / crickets / piano / hoofbeats — through `loop()`,
 * which is a separate path: a loop is one persistent voice with a live gain,
 * not a round-robin of restarts.
 *
 * Two browser facts drive the design:
 *
 *  1. An AudioContext starts suspended until a user gesture. The click that
 *     takes pointer lock is that gesture, so `resume()` is wired to it — and
 *     it also starts any loops that were requested before the gesture landed.
 *  2. A THREE.Audio owns one buffer source at a time: calling play() on one
 *     that is already playing restarts it and cuts the tail. Firing six shots
 *     in two seconds needs several one-shot voices per sound, round-robined.
 */

import * as THREE from 'three';
import { AUDIO } from './config-combat.js';

const _scratchPos = new THREE.Vector3();

class Voices {
  /** @param {THREE.Object3D} host what positional voices are parented to while idle */
  constructor(name, buffer, count, volume, host, listener, master) {
    this.name = name;
    this.volume = volume; // base mix level; master is applied on top, live
    this.pool = [];
    this.next = 0;
    for (let i = 0; i < count; i++) {
      const sound = new THREE.PositionalAudio(listener);
      sound.setBuffer(buffer);
      sound.setRefDistance(AUDIO.refDistance);
      sound.setRolloffFactor(AUDIO.rolloffFactor);
      sound.setMaxDistance(AUDIO.maxDistance);
      sound.setVolume(volume * master);
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

/**
 * One looping ambience. `node` is a THREE.Audio (global, e.g. wind) or a
 * THREE.PositionalAudio (e.g. the saloon piano). The handle is always returned
 * even when the buffer is missing — then it is inert and every method is a
 * no-op, so callers never branch on it.
 */
class Loop {
  constructor(node, baseVolume, audio) {
    this.node = node; // null = missing file
    this.baseVolume = baseVolume;
    this.gain = 1; // 0..1, set live by the ambience mixer
    this._audio = audio;
    this._wantPlaying = true;
    if (node) node.setLoop(true);
    this._applyVolume();
  }

  _applyVolume() {
    if (!this.node) return;
    this.node.setVolume(this.baseVolume * this.gain * this._audio.master);
  }

  /** 0..1 — the mixer's live level for this ambience (crickets fade with night, etc.). */
  setGain(g) {
    if (!this.node) return;
    this.gain = THREE.MathUtils.clamp(g, 0, 1);
    this._applyVolume();
  }

  /** Playback-rate multiplier — hoofbeats speed up with the gallop. */
  setRate(r) {
    if (this.node) this.node.setPlaybackRate(Math.max(0.05, r));
  }

  /** Starts the loop if it is wanted and the context is running. Called by resume() too. */
  start() {
    if (!this.node || !this._wantPlaying || !this._audio.enabled) return;
    const ctx = this.node.context;
    if (ctx && ctx.state !== 'running') return; // resume() will retry
    if (!this.node.isPlaying) this.node.play();
  }

  pause() {
    if (this.node && this.node.isPlaying) this.node.pause();
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
    this.master = AUDIO.masterVolume; // live; settings' volume slider moves it
    this.listener = new THREE.AudioListener();
    camera.add(this.listener);
    // One host so a hundred idle voices are one child of the scene, not a
    // hundred. Voices are repositioned in world space at play time.
    this.host = new THREE.Group();
    this.host.name = 'audioVoices';
    scene.add(this.host);
    this.sounds = {};
    this.loopBuffers = {};
    this.loops = [];
    this.missing = []; // round-3 one-shots — window.__debug.audioMissing reads this
    this.missingLoops = []; // round-7 ambiences — a separate list so the round-3 check stays honest
    this.loaded = false;
  }

  /**
   * Loads every configured clip — one-shots into round-robin `Voices`, loop
   * clips into raw buffers `loop()` draws on. NEVER REJECTS: a failed file is
   * recorded, warned about once, and simply has no voices / an inert handle.
   */
  async load() {
    const loader = new THREE.AudioLoader();
    const one = Object.entries(AUDIO.files).map(([name, file]) => new Promise((resolve) => {
      loader.load(
        AUDIO.basePath + file,
        (buffer) => {
          this.sounds[name] = new Voices(
            name, buffer, AUDIO.voices[name] ?? 1, AUDIO.volumes[name] ?? 1, this.host, this.listener, this.master,
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
    }));
    const loop = Object.entries(AUDIO.loopFiles ?? {}).map(([name, file]) => new Promise((resolve) => {
      loader.load(
        AUDIO.basePath + file,
        (buffer) => { this.loopBuffers[name] = buffer; resolve(); },
        undefined,
        () => {
          this.missingLoops.push(file);
          console.warn(`[audio] looping "${AUDIO.basePath}${file}" is missing — "${name}" ambience will be silent.`);
          resolve();
        },
      );
    }));
    await Promise.all([...one, ...loop]);
    this.loaded = true;
    return this;
  }

  /**
   * Browsers hold the AudioContext suspended until a real user gesture.
   * main.js calls this from the same pointer-lock click that starts play. It
   * also (re)starts every loop that could not begin while the context was
   * still suspended.
   */
  resume() {
    const ctx = this.listener?.context;
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
    for (const l of this.loops) l.start();
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

  /**
   * Starts a looping ambience and returns a `Loop` handle. ALWAYS returns a
   * handle — a missing file gives back an inert one whose methods no-op, so
   * `ambience.js` never has to null-check. `positional: true` places it in the
   * world (the saloon piano); otherwise it plays flat on the listener (wind).
   */
  loop(name, { positional = false, position = null, volume = 1, refDistance = AUDIO.refDistance, maxDistance = AUDIO.maxDistance, rolloff = AUDIO.rolloffFactor } = {}) {
    const buffer = this.loopBuffers[name];
    let node = null;
    if (buffer) {
      if (positional) {
        node = new THREE.PositionalAudio(this.listener);
        node.setRefDistance(refDistance);
        node.setRolloffFactor(rolloff);
        node.setMaxDistance(maxDistance);
        if (position) node.position.copy(position);
        this.host.add(node);
      } else {
        node = new THREE.Audio(this.listener);
      }
      node.setBuffer(buffer);
    }
    const handle = new Loop(node, volume, this);
    this.loops.push(handle);
    handle.start();
    return handle;
  }

  /** The settings volume slider. Reapplies to every voice and loop live. */
  setMasterVolume(v) {
    this.master = THREE.MathUtils.clamp(v, 0, 1);
    for (const voices of Object.values(this.sounds)) {
      for (const sound of voices.pool) sound.setVolume(voices.volume * this.master);
    }
    for (const l of this.loops) l._applyVolume();
  }

  /** The master mute (M, and the settings checkbox). Stops one-shots outright; loops pause and resume. */
  setEnabled(enabled) {
    this.enabled = enabled;
    if (enabled) {
      for (const l of this.loops) l.start();
    } else {
      for (const voices of Object.values(this.sounds)) {
        for (const sound of voices.pool) if (sound.isPlaying) sound.stop();
      }
      for (const l of this.loops) l.pause();
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
