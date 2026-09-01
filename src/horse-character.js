/**
 * horse-character.js — the horse's visual rig: loads horse.glb, rescales it
 * by the hardcoded HORSE.modelScale (see config.js for why this is NOT
 * measureHeight()-derived like the player), and wraps its idle/walk/gallop
 * clips behind the same small interface character.js uses for the player
 * (`root`, `height`, `setLocomotion(state, speed)`, `update(dt)`). Falls
 * back to the procedural PlaceholderHorse (same interface) if the GLB is
 * missing or fails to load.
 *
 * horse.js owns *which* logical state ('idle' | 'walk' | 'gallop') to
 * request each frame and all movement/position/rotation; this file only
 * knows how to play a state once told, exactly like character.js/player.js.
 */

import * as THREE from 'three';
import { loadGLTF, findClip, enableShadows } from './assets.js';
import { PlaceholderHorse } from './placeholder-horse.js';
import { HORSE, HORSE_ANIM, HORSE_CLIP_REFERENCE_SPEED, HORSE_CLIP_CANDIDATES } from './config-horse.js';

class HorseCharacterRig {
  constructor(gltf) {
    this.root = gltf.scene;
    this.root.scale.setScalar(HORSE.modelScale);
    enableShadows(this.root);

    this.mixer = new THREE.AnimationMixer(this.root);
    this.actions = {};
    for (const [key, candidates] of Object.entries(HORSE_CLIP_CANDIDATES)) {
      const clip = findClip(gltf, ...candidates);
      if (clip) {
        const action = this.mixer.clipAction(clip);
        action.loop = THREE.LoopRepeat;
        this.actions[key] = action;
      } else {
        console.warn(`[horse-character] no "${key}" clip found on ${HORSE.modelPath} (tried: ${candidates.join(', ')})`);
      }
    }
    if (!this.actions.idle && !this.actions.walk) {
      throw new Error(`${HORSE.modelPath} has neither an idle nor a walk clip — cannot animate`);
    }

    this.isPlaceholder = false;
    this._active = null;
    this._activeName = null;
    this._activate(this.actions.idle ? 'idle' : 'walk');
  }

  _resolveAvailable(name) {
    if (this.actions[name]) return name;
    if (this.actions.walk) return 'walk';
    if (this.actions.idle) return 'idle';
    return null;
  }

  _activate(name) {
    const next = this.actions[name];
    if (!next || next === this._active) return;
    if (this._active) this._active.fadeOut(HORSE_ANIM.fadeTime);
    next.reset().fadeIn(HORSE_ANIM.fadeTime).play();
    this._active = next;
    this._activeName = name;
  }

  setLocomotion(state, speed) {
    const target = this._resolveAvailable(state);
    if (target) this._activate(target);
    if (!this._active) return;
    const ref = HORSE_CLIP_REFERENCE_SPEED[this._activeName] ?? 1;
    this._active.timeScale = this._activeName === 'idle'
      ? 1
      : THREE.MathUtils.clamp(speed / ref, HORSE_ANIM.minTimeScale, HORSE_ANIM.maxTimeScale);
  }

  update(dt) {
    this.mixer.update(dt);
  }
}

/** Loads the horse's GLB, or falls back to the procedural placeholder on any failure. */
export async function createHorseCharacter() {
  try {
    const gltf = await loadGLTF(HORSE.modelPath);
    return new HorseCharacterRig(gltf);
  } catch (err) {
    console.warn(`[horse-character] "${HORSE.modelPath}" failed to load or animate — using capsule placeholder.`, err);
    return new PlaceholderHorse();
  }
}
