/**
 * character.js — the player's visual rig: loads player.glb, rescales it to
 * PLAYER.modelHeight, and wraps its idle/walk/run clips behind a small
 * uniform interface (`root`, `height`, `setLocomotion(state, speed)`,
 * `setAirborne(bool)`, `update(dt)`). Falls back to the procedural
 * PlaceholderHuman (same interface) if the GLB is missing or fails to load —
 * the game must stay playable either way.
 *
 * player.js owns *which* logical state ('idle' | 'walk' | 'run') to request
 * each frame; this file only knows how to play that state once told.
 *
 * There is no dedicated jump clip. A retargeted real "Jump" clip (baked from
 * a second CC0 GLB onto this rig's own skeleton — see git history around
 * "retarget.js" if this is ever revisited) was built, tuned, and re-tuned
 * across several rounds and never read as right in real play, so it was
 * pulled out entirely rather than shipped broken. `setAirborne()` is now a
 * no-op on the real rig: player.js already halves locomotion playback speed
 * while airborne (`ANIM.airTimeScale`), so a jump just holds the current
 * idle/walk/run pose, slowed, for the flight — see CLAUDE.md's "Known rough
 * edges" for the removal writeup.
 */

import * as THREE from 'three';
import { loadGLTF, findClip, measureHeight, enableShadows } from './assets.js';
import { PlaceholderHuman } from './placeholder-human.js';
import { RidingPose } from './riding-pose.js';
import { PLAYER, ANIM, CLIP_REFERENCE_SPEED, CLIP_CANDIDATES } from './config.js';

const _hipWorld = new THREE.Vector3();
const _rootWorld = new THREE.Vector3();

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

    // Baseline captured before the mixer has ever run, so it is the GLB's own
    // authored rest pose. See riding-pose.js.
    this.pose = new RidingPose(this.root);
    this.pose.captureBaseline();
    this._ridingWeight = 0;
    this._ridingSway = 0;

    // How high the pelvis rides above the rig's own origin. horse.js's saddle
    // offset is a *seat* height, so player.js places the root this far below it
    // — a seated rider is positioned by their hips, not by feet they aren't
    // standing on. Measured off the live rig so a model swap re-derives it.
    this.hipHeight = this._measureHipHeight();
  }

  _measureHipHeight() {
    const hip = this.root.getObjectByName('Body') ?? this.root.getObjectByName('Hips');
    if (!hip) return PLAYER.modelHeight * 0.45; // sane fraction of stature if this rig names its pelvis something else
    this.root.updateMatrixWorld(true);
    hip.getWorldPosition(_hipWorld);
    this.root.getWorldPosition(_rootWorld);
    return _hipWorld.y - _rootWorld.y;
  }

  /**
   * @param {number} weight 0..1 — how much of the seated pose to blend in.
   * @param {number} sway   -1..1 — the horse's live gait bob, so the rider's
   *   hands and torso move with the stride. See riding-pose.js.
   */
  setRidingPose(weight, sway = 0) {
    this._ridingWeight = weight;
    this._ridingSway = sway;
  }

  /**
   * No dedicated jump clip on this rig (see file header) — airborne motion
   * is just whatever locomotion clip is already playing, slowed via
   * player.js's own ANIM.airTimeScale. Kept as a method (not dropped
   * entirely) so the shared character interface stays identical to
   * PlaceholderHuman, which still has its own simple procedural crouch-tuck
   * overlay for the no-GLTF-skeleton fallback case.
   */
  setAirborne(_airborne) {}

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
    // Strictly after the mixer: the seated pose works by overwriting the bones
    // the still-playing idle clip just wrote. Called unconditionally, including
    // at weight 0 — that is how the pose knows to let go of the bones no clip
    // will reclaim on its own. See riding-pose.js.
    this.pose.apply(this._ridingWeight, this._ridingSway);
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
