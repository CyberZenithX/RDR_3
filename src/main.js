/**
 * main.js — entry point: renderer/scene/camera setup, async load sequence,
 * and the render loop. No game logic lives here; it wires world.js,
 * character.js, player.js, camera.js, input.js and ui.js together.
 */

import * as THREE from 'three';
import { RENDER, SPAWN } from './config.js';
import { buildWorld } from './world.js';
import { createPlayerCharacter } from './character.js';
import { Player } from './player.js';
import { createHorseCharacter } from './horse-character.js';
import { Horse } from './horse.js';
import { Reins } from './reins.js';
import { ThirdPersonCamera } from './camera.js';
import { initInput, onPointerLockChanged } from './input.js';
import { initUI } from './ui.js';
import { buildTargets } from './targets.js';
import { Vfx } from './vfx.js';
import { createAudio } from './audio.js';
import { Combat } from './combat.js';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, RENDER.maxPixelRatio));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = RENDER.exposure;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(RENDER.fov, innerWidth / innerHeight, RENDER.near, RENDER.far);

const ui = initUI();

// scripts/smoke.mjs reads these — keep both alive in every round.
window.__frames = 0;
window.__ready = false;
window.__debug = { modelsLoaded: { player: false, horse: false }, playerY: null, grounded: null, propCounts: null };
// Debug hook, not read by gameplay code. `renderer.info.render.calls` is the
// draw-call budget BUILD-PLAN.md sets at ~120; round 7 owns the real
// performance pass, but every round from 3 on adds geometry, so it is worth
// being able to see the number without wiring it up again.
window.__debug.renderer = renderer;

const _scratchSaddlePos = new THREE.Vector3(); // reused every frame — see performance budget rule

async function init() {
  ui.setLoadingText('building world…');
  const world = buildWorld(scene);
  window.__debug.propCounts = world.propCounts;
  window.__debug.scene = scene; // debug hook, not read by gameplay code

  ui.setLoadingText('loading player…');
  const character = await createPlayerCharacter();
  window.__debug.modelsLoaded.player = !character.isPlaceholder;
  scene.add(character.root);
  window.__debug.characterScale = character.root.scale.x;
  character.root.updateMatrixWorld(true);
  window.__debug.characterWorldBBoxHeight = new THREE.Box3().setFromObject(character.root).getSize(new THREE.Vector3()).y;

  const player = new Player(character, world);
  const tpCamera = new ThirdPersonCamera(camera);
  tpCamera.yaw = SPAWN.yaw;
  tpCamera.snap(player.position);
  window.__debug.tpCamera = tpCamera; // debug hook, not read by gameplay code
  window.__debug.player = player; // debug hook, not read by gameplay code

  ui.setLoadingText('loading horse…');
  const horseCharacter = await createHorseCharacter();
  window.__debug.modelsLoaded.horse = !horseCharacter.isPlaceholder;
  scene.add(horseCharacter.root);
  const horse = new Horse(horseCharacter, world);
  // Spans both skeletons, so it is built after both and updated after both —
  // see reins.js for why it is not parented into either one.
  const reins = new Reins(scene, horseCharacter, character);
  window.__debug.horse = horse; // debug hook, not read by gameplay code
  window.__debug.reins = reins; // debug hook, not read by gameplay code

  ui.setLoadingText('setting out the targets…');
  const targets = buildTargets(scene);
  window.__debug.targetCounts = targets.counts;
  window.__debug.targets = targets; // debug hook, not read by gameplay code

  const vfx = new Vfx(scene);
  // The flash and its light are parented to the same muzzle empty every shot
  // is raycast from, so both track the barrel through the aim pose, the
  // recoil and the horse's bank. See weapons.js and vfx.js.
  //
  // Guarded, even though both rigs are armed: an unarmed character used to
  // throw here, which took the whole boot sequence down and left the game on
  // "failed to start" — the exact crash BUILD-PLAN.md's "must stay playable"
  // rule exists to prevent. A future rig that cannot hold a gun should lose
  // the muzzle flash, not the game.
  if (character.weapon) vfx.attachToMuzzle(character.weapon.muzzle);
  else console.warn('[main] the player rig has no weapon — combat is disabled for this session.');

  ui.setLoadingText('loading sound…');
  // Never rejects: a missing .ogg is one warning and silence, per BUILD-PLAN.md.
  const audio = await createAudio(camera, scene);
  window.__debug.audioMissing = audio.missing;

  const combat = new Combat({
    player, horse, camera, tpCamera, world, targets, vfx, audio,
    weapon: character.weapon,
  });
  window.__debug.combat = combat; // debug hook, not read by gameplay code

  initInput(renderer.domElement);
  onPointerLockChanged((locked) => {
    ui.setPointerLocked(locked);
    // The click that takes pointer lock is the user gesture browsers require
    // before an AudioContext may start. Without this the first gunshot is
    // silent and the console carries an autoplay warning.
    if (locked) audio.resume();
  });

  ui.hideLoading();
  window.__ready = true;

  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), RENDER.maxDeltaTime);

    tpCamera.handleLook();

    // Combat's frame is split in two, and the split is load-bearing (see
    // combat.js's header). This half reads the mouse and R and moves the aim
    // blend; it must run BEFORE horse.update(), which needs to know whether
    // the rider is aiming before it decides how to steer.
    combat.pollInput(dt);

    // horse.js reads H (whistle) and E (mount/dismount) itself, and drives
    // player.mounted via player.mount()/dismount() — see horse.js's header.
    // `aiming` is passed in rather than reached for: horse.js has no combat
    // awareness beyond this one flag.
    horse.update(dt, tpCamera, player, combat.aiming);
    if (player.mounted) {
      // Read player.mounted fresh, *after* horse.update() — a same-frame
      // dismount already wrote the drop-off position and must not be
      // overwritten by a stale saddle sync. See docs/DECISIONS.md ADR-016.
      player.setSaddle(horse.getSaddleTransform(_scratchSaddlePos));
    }
    player.update(dt, tpCamera, combat);

    // After both rigs have been posed for this frame, so the straps land on
    // this frame's mouth and fists rather than last frame's.
    reins.update(player.mounted);

    // The other half of combat's frame: the rig is now posed, so the muzzle is
    // where it will be rendered and a shot can be fired from it. Firing in
    // pollInput() would aim every shot from last frame's hand position.
    combat.update(dt);

    tpCamera.setMounted(player.mounted);
    tpCamera.setAiming(combat.aimWeight);
    ui.setMounted(player.mounted);
    ui.setAiming(combat.aimWeight);
    ui.updateAmmo(combat.ammo, combat.reloading);
    // While mounted, ignore the horse's own collider in the camera's
    // occlusion sweep — the rider's pivot sits right on/inside it, which
    // otherwise collapses the camera to CAMERA.minDistance every frame.
    tpCamera.update(dt, player.position, player.mounted ? horse.speed : player.speed, player.mounted ? horse.collider : null);
    world.update(player.position);
    ui.updateBoundaryWarning(dt, player.boundaryProximity);
    ui.updateStamina(horse.staminaFraction, horse.staminaExhausted);

    renderer.render(scene, camera);
    window.__frames++;
    window.__debug.playerY = player.position.y;
    window.__debug.grounded = player.grounded;
    window.__debug.playerPos = { x: player.position.x, y: player.position.y, z: player.position.z };
    window.__debug.cameraPos = { x: camera.position.x, y: camera.position.y, z: camera.position.z };
    window.__debug.cameraDistanceToPlayer = camera.position.distanceTo(player.position);
    window.__debug.cameraCurrentDistance = tpCamera.currentDistance;
    window.__debug.cameraFov = camera.fov;
    window.__debug.characterRotationY = character.root.rotation.y;
    window.__debug.horsePos = { x: horse.position.x, y: horse.position.y, z: horse.position.z };
    window.__debug.horseStamina = horse.stamina;
    window.__debug.mounted = player.mounted;
    window.__debug.horseAirborne = horse.jump.airborne;
    window.__debug.horseVelocityY = horse.jump.velocityY;
    window.__debug.horseJumpWeight = horse.jump.weight;
    window.__debug.aiming = combat.aiming;
    window.__debug.aimWeight = combat.aimWeight;
    window.__debug.ammo = combat.ammo;
    window.__debug.reloading = combat.reloading;
    window.__debug.shotsFired = combat.shotsFired;
    window.__debug.targetsAlive = targets.aliveCount;
  });
}

init().catch((err) => {
  console.error('[main] fatal error during startup:', err);
  ui.setLoadingText('failed to start — see console');
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
