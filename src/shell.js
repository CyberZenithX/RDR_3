/**
 * shell.js — round 7's "around the game" layer: the day/night cycle, the four
 * looping ambiences, the corner minimap, the main/pause menu, the settings
 * panel and the localStorage checkpoint, wired together and handed back to
 * main.js as three per-frame hooks.
 *
 * Split out of main.js on the obvious seam: none of this is the simulation, it
 * is the shell the simulation runs inside. main.js keeps the load sequence and
 * the load-bearing per-frame order (docs/ARCHITECTURE.md); it calls
 * `shell.beforeFrame(raw)` right after computing the frame delta,
 * `shell.afterFrame(raw)` just before rendering, and `shell.isPaused()` to
 * decide whether to run a frame at all.
 */

import { RENDER, INPUT } from './config.js';
import { MENU } from './config-polish.js';
import { isKeyDown } from './input.js';
import { DayNight } from './daynight.js';
import { Ambience } from './ambience.js';
import { Minimap } from './minimap.js';
import { initMenu } from './menu.js';
import { saveCheckpoint, loadCheckpoint, clearCheckpoint, hasCheckpoint } from './checkpoint.js';

// The unmodified mouse-look sensitivity, captured before the settings slider
// (a multiplier on this) can touch it.
const SENS_BASE = INPUT.mouseSensitivity;

/**
 * @param {object} ctx  live references from main.js's load sequence.
 * @param {THREE.WebGLRenderer} ctx.renderer
 * @param {THREE.Scene} ctx.scene
 * @param {object} ctx.world   buildWorld() return
 * @param {import('./audio.js').GameAudio} ctx.audio
 * @param {import('./player.js').Player} ctx.player
 * @param {import('./horse.js').Horse} ctx.horse
 * @param {import('./camera.js').ThirdPersonCamera} ctx.tpCamera
 * @param {object} ctx.bandits
 * @param {object} ctx.bounties
 * @param {object} ctx.deputies
 * @param {object} ctx.town
 */
export function createShell({ renderer, scene, world, audio, player, horse, tpCamera, bandits, bounties, deputies, town }) {
  const dayNight = new DayNight({ scene, renderer, world, lamps: town.lamps });
  const ambience = new Ambience(audio);
  const minimap = new Minimap();

  // ---- settings ---------------------------------------------------------------
  function applySettings(s) {
    INPUT.mouseSensitivity = SENS_BASE * s.sensitivity;
    INPUT.invertY = !!s.invertY;

    const size = MENU.shadowSizes[s.shadowQuality] ?? MENU.shadowSizes.medium;
    const wantShadows = size > 0;
    if (renderer.shadowMap.enabled !== wantShadows) {
      renderer.shadowMap.enabled = wantShadows;
      renderer.shadowMap.needsUpdate = true;
      // Toggling shadowMap.enabled recompiles every standard material's program.
      scene.traverse((o) => {
        const m = o.material;
        if (!m) return;
        for (const mm of Array.isArray(m) ? m : [m]) mm.needsUpdate = true;
      });
    }
    if (wantShadows && world.sun.shadow.mapSize.width !== size) {
      world.sun.shadow.mapSize.set(size, size);
      world.sun.shadow.map?.dispose();
      world.sun.shadow.map = null; // three rebuilds it at the new size next frame
    }
    world.sun.shadow.bias = s.shadowQuality === 'high' ? MENU.shadowHighBias : RENDER.shadowBias;

    // Draw distance is a fog-density multiplier on top of the day/night cycle.
    dayNight.fogScale = MENU.drawDistanceFog[s.drawDistance] ?? 1;

    audio.setMasterVolume(s.masterVolume);
    audio.setEnabled(!s.muted);
  }

  // ---- checkpoint -----------------------------------------------------------
  function writeCheckpoint() {
    saveCheckpoint({
      x: player.position.x, z: player.position.z, yaw: player.meshYaw,
      money: bounties.money, health: player.health.current,
    });
    menu.refresh();
  }
  function applyCheckpoint(cp) {
    if (!cp) return;
    player.position.set(cp.x, world.groundHeightAt(cp.x, cp.z), cp.z);
    player.meshYaw = cp.yaw;
    player.velocityXZ.set(0, 0, 0);
    player.velocityY = 0;
    if (typeof cp.money === 'number') bounties.money = cp.money;
    tpCamera.yaw = cp.yaw;
    tpCamera.snap(player.position);
  }

  // ---- menu --------------------------------------------------------------------
  const menu = initMenu({
    hasCheckpoint,
    applySettings,
    onNewGame: () => { clearCheckpoint(); menu.refresh(); renderer.domElement.requestPointerLock(); },
    onContinue: () => { applyCheckpoint(loadCheckpoint()); renderer.domElement.requestPointerLock(); },
    onResume: () => renderer.domElement.requestPointerLock(),
    onSave: writeCheckpoint,
  });

  let mutePrev = false; // M is edge-triggered
  let prevInside = false; // checkpoint auto-saves on first stepping into the saloon
  let prevMoney = bounties.money; // ...and whenever a bounty pays out

  return {
    menu, dayNight, minimap,

    /** main.js's onPointerLockChanged handler delegates here. */
    onPointerLock(locked) {
      if (locked) { menu.hide(); audio.resume(); }
      else if (window.__ready && !menu.isOpen()) menu.showPause();
    },
    showMain: () => menu.showMain(),
    isPaused: () => menu.isPaused(),

    /** Right after the frame delta is known, before anything simulates. */
    beforeFrame(raw) {
      const m = isKeyDown('KeyM');
      if (m && !mutePrev) {
        audio.setEnabled(!audio.enabled);
        menu.settings.muted = !audio.enabled;
      }
      mutePrev = m;
      // The sun arc runs on REAL time — a duel's slow-motion must not stop the day.
      dayNight.update(raw);
    },

    /** Just before render: the ambiences, the minimap, and the checkpoint auto-saves. */
    afterFrame(raw) {
      ambience.update(raw, { nightFactor: dayNight.nightFactor, mounted: player.mounted, speed: horse.speed });
      minimap.update({
        player: player.position,
        playerYaw: player.meshYaw,
        horse,
        camps: bandits.camps,
        bountyCamp: bounties.markerVisible ? bounties.marker.position : null,
        deputies: (deputies.deputies ?? []).filter((d) => d.active).map((d) => d.position),
        nightFactor: dayNight.nightFactor,
      });
      if (town.inside && !prevInside) writeCheckpoint();
      prevInside = town.inside;
      if (bounties.money > prevMoney) writeCheckpoint();
      prevMoney = bounties.money;
    },

    /** Fold round-7 state into window.__debug (called from the same place the rest is set). */
    writeDebug(d) {
      d.timeOfDay = dayNight.t;
      d.sunElevation = dayNight.elevation;
      d.nightFactor = dayNight.nightFactor;
      d.lampsLit = town.lamps?.lit ?? null;
    },
  };
}
