/**
 * character.js — the humanoid visual rig: loads a GLB, rescales it to a
 * requested height, and wraps its clips behind a small uniform interface
 * (`root`, `height`, `setLocomotion(state, speed, aiming)`,
 * `setAirborne(bool)`, `setRidingPose(...)`, `setAimPose(...)`, `playHit()`,
 * `setDead(bool)`, `update(dt)`). Falls back to the procedural
 * PlaceholderHuman (same interface) if the GLB is missing or fails to load —
 * the game must stay playable either way.
 *
 * NOT PLAYER-ONLY SINCE ROUND 4. `bandit.glb` shares `player.glb`'s rig bone
 * for bone and clip for clip (docs/ANIMATION.md), so one class serves both:
 * `createPlayerCharacter()` loads and wraps the player's GLB,
 * `createRigFromGLTF(gltf, spec)` wraps an already-loaded one — which is how
 * bandits.js gives eleven bandits one download and one set of GPU buffers via
 * rig-clone.js.
 *
 * The caller owns *which* logical state ('idle' | 'walk' | 'run') to request
 * each frame; this file only knows how to play that state once told.
 *
 * Two clips are one-shots rather than states: `HitRecieve` (misspelled in the
 * asset — docs/ANIMATION.md) and `Death`. Both are real clips on this rig, so
 * BUILD-PLAN.md's substitution table does not apply here; it does apply to
 * PlaceholderHuman, which has no clips at all and tips the body over instead.
 * While either owns the rig, `setLocomotion` stands aside — the caller does
 * not have to know that, which is why the guard lives in here.
 *
 * There is no dedicated jump clip. A retargeted real "Jump" clip (baked from
 * a second CC0 GLB onto this rig's own skeleton — see git history around
 * "retarget.js" if this is ever revisited) was built, tuned, and re-tuned
 * across several rounds and never read as right in real play, so it was
 * pulled out entirely rather than shipped broken. `setAirborne()` is now a
 * no-op on the real rig: player.js already halves locomotion playback speed
 * while airborne (`ANIM.airTimeScale`), so a jump just holds the current
 * idle/walk/run pose, slowed, for the flight — see docs/DEVELOPMENT-NOTES.md
 * for the removal writeup.
 */

import * as THREE from 'three';
import { loadGLTF, findClip, measureHeight, enableShadows } from './assets.js';
import { PlaceholderHuman } from './placeholder-human.js';
import { RidingPose } from './riding-pose.js';
import { AimPose } from './aim-pose.js';
import { createRevolver } from './weapons.js';
import { PLAYER, ANIM, CLIP_REFERENCE_SPEED, CLIP_CANDIDATES } from './config.js';

/**
 * Clips played once and then handed back, rather than looped as a locomotion
 * state. `death` clamps on its last frame (the body stays down); `hit` does
 * not (the flinch releases back into whatever was playing).
 */
const ONE_SHOT = { death: true, hit: false };

/**
 * What each logical clip degrades to when a model does not ship it, best
 * first. Round 3's gun clips must fall back to their *unarmed* equivalent,
 * not to walk — an aiming idle that plays the walk cycle is worse than one
 * that plays the plain idle under the aim pose.
 */
const CLIP_FALLBACKS = {
  idle: ['idle', 'walk'],
  walk: ['walk', 'idle'],
  run: ['run', 'walk', 'idle'],
  idleGun: ['idleGun', 'idle', 'walk'],
  runGun: ['runGun', 'run', 'walk', 'idle'],
};

const _hipWorld = new THREE.Vector3();
const _rootWorld = new THREE.Vector3();

class CharacterRig {
  /**
   * @param {object} gltf a loaded GLTF, or any `{scene, animations}` — bandits
   *   pass a `cloneRig()`ed scene alongside the ORIGINAL clip array, which is
   *   safe because AnimationMixer binds tracks to nodes by name (rig-clone.js).
   * @param {{height:number, label:string, path:string}} spec how tall to make
   *   it and what to call it in warnings.
   */
  constructor(gltf, spec) {
    this.spec = spec;
    this.root = gltf.scene;
    const measured = measureHeight(this.root);
    this.root.scale.setScalar(measured > 0 ? spec.height / measured : 1);
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
        console.warn(`[character] no "${key}" clip found on ${spec.path} (tried: ${candidates.join(', ')})`);
      }
    }
    if (!this.actions.idle && !this.actions.walk) {
      // Per BUILD-PLAN.md: Walk/Run cannot be faked. Surfacing this as a thrown
      // error lets createPlayerCharacter() below catch it and fall back to the
      // placeholder rather than shipping a character that can never animate.
      throw new Error(`${spec.path} has neither an idle nor a walk clip — cannot animate`);
    }

    this.isPlaceholder = false;
    this.height = spec.height;
    this._active = null;
    this._activeName = null;
    // Round 4: a flinch or a death owns the rig outright while it plays, and
    // setLocomotion stands aside until `_oneShotT` runs out.
    this._oneShotT = 0;
    this._dead = false;
    this._activate(this.actions.idle ? 'idle' : 'walk');

    // Baseline captured before the mixer has ever run, so it is the GLB's own
    // authored rest pose. See riding-pose.js.
    this.pose = new RidingPose(this.root);
    this.pose.captureBaseline();
    this._ridingWeight = 0;
    this._ridingSway = 0;
    this._ridingJump = 0;

    // Round 3's aiming layer. It runs immediately after the riding pose and
    // claims a disjoint set of bones — see aim-pose.js's header for the split
    // and for why it borrows the riding pose's grip machinery rather than
    // re-deriving it. Its baseline is captured here, at the same moment and
    // for the same reason: before the mixer has ever run.
    this.aim = new AimPose(this.root, this.pose);
    this.aim.captureBaseline();
    this._aim = { weight: 0, elevation: 0, recoil: 0, reload: 0, support: 1 };

    // The revolver is parented into the hand bone, so it lives with the rig
    // rather than with combat.js — which owns when it fires, not where it is.
    this.weapon = createRevolver(this.root);

    // How high the pelvis rides above the rig's own origin. horse.js's saddle
    // offset is a *seat* height, so player.js places the root this far below it
    // — a seated rider is positioned by their hips, not by feet they aren't
    // standing on. Measured off the live rig so a model swap re-derives it.
    this.hipHeight = this._measureHipHeight();
  }

  _measureHipHeight() {
    const hip = this.root.getObjectByName('Body') ?? this.root.getObjectByName('Hips');
    if (!hip) return this.spec.height * 0.45; // sane fraction of stature if this rig names its pelvis something else
    this.root.updateMatrixWorld(true);
    hip.getWorldPosition(_hipWorld);
    this.root.getWorldPosition(_rootWorld);
    return _hipWorld.y - _rootWorld.y;
  }

  /**
   * @param {number} weight 0..1 — how much of the seated pose to blend in.
   * @param {number} sway   -1..1 — the horse's live gait bob, so the rider's
   *   hands and torso move with the stride. See riding-pose.js.
   * @param {number} jump   0..1 — how far into the two-point jumping seat the
   *   rider is, while the horse is over an obstacle.
   */
  setRidingPose(weight, sway = 0, jump = 0) {
    this._ridingWeight = weight;
    this._ridingSway = sway;
    this._ridingJump = jump;
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

  /**
   * The aiming pose this frame — the same shape setRidingPose has, and read
   * from combat.js's `poseState()` by player.js. See aim-pose.js for what
   * each number does to the skeleton.
   */
  setAimPose({ weight = 0, elevation = 0, recoil = 0, reload = 0, support = 1 } = {}) {
    this._aim.weight = weight;
    this._aim.elevation = elevation;
    this._aim.recoil = recoil;
    this._aim.reload = reload;
    this._aim.support = support;
  }

  /** Walks this clip's fallback chain (see CLIP_FALLBACKS) to the first one the model actually ships. */
  _resolveAvailable(name) {
    for (const candidate of CLIP_FALLBACKS[name] ?? [name, 'walk', 'idle']) {
      if (this.actions[candidate]) return candidate;
    }
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

  /**
   * @param {'idle'|'walk'|'run'} state the logical gait player.js decided on.
   * @param {number} speed real horizontal speed, for the clip's timeScale.
   * @param {boolean} aiming swaps in this rig's real gun clips underneath the
   *   aim pose, so the legs and stance are animation rather than something
   *   aim-pose.js has to author. Walk and run share one gun clip — Run_Shoot
   *   is the only moving armed clip on this rig (docs/ANIMATION.md), and its
   *   timeScale already tracks real speed, so a walking aim is the same clip
   *   played slower rather than a second one that does not exist.
   */
  setLocomotion(state, speed, aiming = false) {
    // A death or a flinch owns the whole body while it plays. The guard lives
    // here rather than in every caller: player.js and bandit.js both drive
    // locomotion unconditionally every frame, and neither should have to know
    // that this rig is currently falling over.
    if (this._dead || this._oneShotT > 0) return;
    const wanted = aiming ? (state === 'idle' ? 'idleGun' : 'runGun') : state;
    const target = this._resolveAvailable(wanted);
    if (target) this._activate(target);
    if (!this._active) return;
    const ref = CLIP_REFERENCE_SPEED[this._activeName] ?? 1;
    // No foot IK in this project — matching timeScale to real speed is the only
    // thing keeping the walk from sliding like it's on ice.
    const stationary = this._activeName === 'idle' || this._activeName === 'idleGun';
    this._active.timeScale = stationary
      ? 1
      : THREE.MathUtils.clamp(speed / ref, ANIM.minTimeScale, ANIM.maxTimeScale);
  }

  /**
   * Crossfades into a clip that plays once. `clamp` holds its last frame
   * forever (a body stays down); without it the action releases and the next
   * `setLocomotion` fades the gait back in.
   *
   * @returns {number} the clip's duration, or 0 if this rig does not ship it.
   */
  _playOneShot(name, clamp) {
    const action = this.actions[name];
    if (!action) return 0;
    action.reset();
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = clamp;
    action.timeScale = 1;
    if (this._active && this._active !== action) this._active.fadeOut(ANIM.fadeTime);
    action.fadeIn(ANIM.fadeTime).play();
    this._active = action;
    this._activeName = name;
    return action.getClip().duration;
  }

  /**
   * The hit reaction. `HitRecieve` is a real clip on this rig, so this is the
   * clip rather than BUILD-PLAN.md's spine-flinch substitution — and it is
   * deliberately NOT a material colour flash, because every bandit shares one
   * material by reference (rig-clone.js) and they would all light up together.
   *
   * @returns {number} how long the flinch lasts, 0 if the rig has no such clip.
   *   The caller uses this as the stagger, so the animation defines the beat.
   */
  playHit() {
    if (this._dead) return 0;
    const duration = this._playOneShot('hit', ONE_SHOT.hit);
    // Hand the body back a fade early, so the gait is already blending in as
    // the flinch ends rather than after a frame of nothing.
    this._oneShotT = duration > 0 ? Math.max(0.05, duration - ANIM.fadeTime) : 0;
    return this._oneShotT;
  }

  /**
   * Dead or alive. Idempotent, and reversible — the player comes back
   * (BUILD-PLAN.md's respawn), so this cannot be a one-way latch.
   */
  setDead(dead) {
    if (dead === this._dead) return;
    this._dead = dead;
    this._oneShotT = 0;
    if (dead) {
      this._playOneShot('death', ONE_SHOT.death);
      return;
    }
    // Back on your feet: the death action is clamped on its last frame, so it
    // has to be stopped outright rather than faded, and `_active` cleared so
    // `_activate` does not short-circuit on "already playing".
    this.actions.death?.stop();
    this._active = null;
    this._activeName = null;
    this._activate(this.actions.idle ? 'idle' : 'walk');
  }

  update(dt) {
    if (this._oneShotT > 0) this._oneShotT = Math.max(0, this._oneShotT - dt);
    this.mixer.update(dt);
    // Strictly after the mixer: the seated pose works by overwriting the bones
    // the still-playing idle clip just wrote. Called unconditionally, including
    // at weight 0 — that is how the pose knows to let go of the bones no clip
    // will reclaim on its own. See riding-pose.js.
    this.pose.apply(this._ridingWeight, this._ridingSway, this._ridingJump);
    // ...and strictly after that: the aiming layer takes the arms and chest
    // back off the riding pose while the gun is up, which is the partial
    // blend BUILD-PLAN.md asks for. `hold` is 1 unconditionally — the
    // revolver is in the fist whether or not it is raised, and this rig's
    // rest pose is a flat open palm.
    this.aim.apply(this._aim.weight, this._aim.elevation, this._aim.recoil, this._aim.reload, this._aim.support, 1);
  }
}

/**
 * Wraps an ALREADY-LOADED gltf (or `{scene, animations}`) as a rig. Throws on
 * a rig it cannot animate — the caller decides whether that means a
 * placeholder or a hard failure. bandits.js is the other caller.
 */
export function createRigFromGLTF(gltf, spec) {
  return new CharacterRig(gltf, spec);
}

/** Loads the player's GLB, or falls back to the procedural placeholder on any failure. */
export async function createPlayerCharacter() {
  const spec = { height: PLAYER.modelHeight, label: 'player', path: PLAYER.modelPath };
  try {
    const gltf = await loadGLTF(PLAYER.modelPath);
    return createRigFromGLTF(gltf, spec);
  } catch (err) {
    console.warn(`[character] "${PLAYER.modelPath}" failed to load or animate — using capsule placeholder.`, err);
    return new PlaceholderHuman();
  }
}
