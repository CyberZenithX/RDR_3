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
import { ThirdPersonCamera } from './camera.js';
import { initInput, onPointerLockChanged } from './input.js';
import { initUI } from './ui.js';

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
  window.__debug.horse = horse; // debug hook, not read by gameplay code

  initInput(renderer.domElement);
  onPointerLockChanged((locked) => ui.setPointerLocked(locked));

  ui.hideLoading();
  window.__ready = true;

  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), RENDER.maxDeltaTime);

    tpCamera.handleLook();

    // horse.js reads H (whistle) and E (mount/dismount) itself, and drives
    // player.mounted via player.mount()/dismount() — see horse.js's header.
    horse.update(dt, tpCamera, player);
    if (player.mounted) {
      // Read player.mounted fresh, *after* horse.update() — a same-frame
      // dismount already wrote the drop-off position and must not be
      // overwritten by a stale saddle sync. See CLAUDE.md.
      player.setSaddle(horse.getSaddleTransform(_scratchSaddlePos));
    }
    player.update(dt, tpCamera);

    tpCamera.setMounted(player.mounted);
    ui.setMounted(player.mounted);
    // While mounted, ignore the horse's own collider in the camera's
    // occlusion sweep — the rider's pivot sits right on/inside it, which
    // otherwise collapses the camera to CAMERA.minDistance every frame.
    tpCamera.update(dt, player.position, player.mounted ? horse.speed : player.speed, player.mounted ? horse.collider : null);
    world.update(player.position);
    ui.updateBoundaryWarning(dt, player.boundaryProximity);
    ui.updateStamina(horse.stamina, horse.staminaExhausted);

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
