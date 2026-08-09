/**
 * character.js — the player's visual rig: loads player.glb, rescales it to
 * PLAYER.modelHeight, and wraps its idle/walk/run clips behind a small
 * uniform interface (`root`, `height`, `setLocomotion(state, speed)`,
 * `update(dt)`). Falls back to the procedural PlaceholderHuman (same
 * interface) if the GLB is missing or fails to load — the game must stay
 * playable either way.
 *
 * player.js owns *which* logical state ('idle' | 'walk' | 'run') to request
 * each frame; this file only knows how to play that state once told.
 */

import * as THREE from 'three';
import { loadGLTF, findClip, measureHeight, enableShadows } from './assets.js';
import { PlaceholderHuman } from './placeholder-human.js';
import { PLAYER, ANIM, CLIP_REFERENCE_SPEED, CLIP_CANDIDATES } from './config.js';

class PlayerCharacterRig {
  constructor(gltf) {
    this.root = gltf.scene;
    const measured = measureHeight(this.root);
    this.root.scale.setScalar(measured > 0 ? PLAYER.modelHeight / measured : 1);
    enableShadows(this.root);

    this.mixer = new THREE.AnimationMixer(this.root);
    this.actions = {};
    for (const [key, candidates] of Object.entries(CLIP_CANDIDATES)) {
      const clip = findClip(gltf, ...candidates);
      if (clip) {
        const action = this.mixer.clipAction(clip);
        action.loop = THREE.LoopRepeat;
        this.actions[key] = action;
      } else {
        console.warn(`[character] no "${key}" clip found on ${PLAYER.modelPath} (tried: ${candidates.join(', ')})`);
      }
    }
    if (!this.actions.idle && !this.actions.walk) {
      // Per BUILD-PLAN.md: Walk/Run cannot be faked. Surfacing this as a thrown
      // error lets createPlayerCharacter() below catch it and fall back to the
      // placeholder rather than shipping a character that can never animate.
      throw new Error(`${PLAYER.modelPath} has neither an idle nor a walk clip — cannot animate`);
    }

    this.isPlaceholder = false;
    this.height = PLAYER.modelHeight;
    this._active = null;
    this._activeName = null;
    this._activate(this.actions.idle ? 'idle' : 'walk');
  }

  /** Falls back to walk, then idle, if the requested clip doesn't exist on this model. */
  _resolveAvailable(name) {
    if (this.actions[name]) return name;
    if (this.actions.walk) return 'walk';
    if (this.actions.idle) return 'idle';
    return null;
  }

  _activate(name) {
    const next = this.actions[name];
    if (!next || next === this._active) return;
    if (this._active) this._active.fadeOut(ANIM.fadeTime);
    next.reset().fadeIn(ANIM.fadeTime).play();
    this._active = next;
    this._activeName = name;
  }

  setLocomotion(state, speed) {
    const target = this._resolveAvailable(state);
    if (target) this._activate(target);
    if (!this._active) return;
    const ref = CLIP_REFERENCE_SPEED[this._activeName] ?? 1;
    // No foot IK in this project — matching timeScale to real speed is the only
    // thing keeping the walk from sliding like it's on ice.
    this._active.timeScale = this._activeName === 'idle'
      ? 1
      : THREE.MathUtils.clamp(speed / ref, ANIM.minTimeScale, ANIM.maxTimeScale);
  }

  update(dt) {
    this.mixer.update(dt);
  }
}

/** Loads the player's GLB, or falls back to the procedural placeholder on any failure. */
export async function createPlayerCharacter() {
  try {
    const gltf = await loadGLTF(PLAYER.modelPath);
    return new PlayerCharacterRig(gltf);
  } catch (err) {
    console.warn(`[character] "${PLAYER.modelPath}" failed to load or animate — using capsule placeholder.`, err);
    return new PlaceholderHuman();
  }
}
