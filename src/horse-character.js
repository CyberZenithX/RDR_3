/**
 * horse-character.js — the horse's visual rig: loads horse.glb, rescales it
 * by the hardcoded HORSE.modelScale (see config.js for why this is NOT
 * measureHeight()-derived like the player), and wraps its idle/walk/gallop
 * clips behind the same small interface character.js uses for the player
 * (`root`, `height`, `setLocomotion(state, speed)`, `setAirborne(bool, airTime)`,
 * `update(dt)`). Falls back to the procedural PlaceholderHorse (same interface)
 * if the GLB is missing or fails to load.
 *
 * Unlike the player, this rig has a real jump clip — `Gallop_Jump` ships in
 * the GLB, so none of the retargeting that sank the player's jump applies. It
 * is played as a one-shot through setAirborne(), not as a locomotion state.
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
    this._airborne = false;
    this._activate(this.actions.idle ? 'idle' : 'walk');
  }

  /**
   * Plays the one-shot jump clip for the length of an actual jump.
   *
   * A jump is deliberately NOT a fourth locomotion state: `setLocomotion`
   * loops its action and rescales its timeScale by ground speed, both of which
   * are wrong here. This takes the rig over instead, and `setLocomotion` stands
   * aside until the horse lands (see its guard), at which point the next call
   * crossfades straight back into whatever gait the horse is now travelling at.
   *
   * @param {number} airTime how long the physics will keep the horse up. The
   *   clip is stretched to fit, so the tuck lands on the rise and the legs
   *   reach for the ground on the descent rather than the clip finishing early
   *   and clamping on its last frame for the rest of the arc.
   */
  setAirborne(airborne, airTime = 0) {
    if (airborne === this._airborne) return;
    this._airborne = airborne;
    const jump = this.actions.jump;
    if (!airborne || !jump) return;
    if (this._active && this._active !== jump) this._active.fadeOut(HORSE_ANIM.fadeTime);
    jump.reset();
    jump.setLoop(THREE.LoopOnce, 1);
    jump.clampWhenFinished = true;
    jump.timeScale = airTime > 0.05
      ? THREE.MathUtils.clamp(jump.getClip().duration / airTime, 0.4, 3)
      : 1;
    jump.fadeIn(HORSE_ANIM.fadeTime).play();
    this._active = jump;
    this._activeName = 'jump';
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
    if (this._airborne) return; // the jump one-shot owns the rig — see setAirborne()
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
