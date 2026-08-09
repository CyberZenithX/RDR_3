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
window.__debug = { modelsLoaded: { player: false }, playerY: null, grounded: null, propCounts: null };

async function init() {
  ui.setLoadingText('building world…');
  const world = buildWorld(scene);
  window.__debug.propCounts = world.propCounts;

  ui.setLoadingText('loading player…');
  const character = await createPlayerCharacter();
  window.__debug.modelsLoaded.player = !character.isPlaceholder;
  scene.add(character.root);

  const player = new Player(character, world);
  const tpCamera = new ThirdPersonCamera(camera);
  tpCamera.yaw = SPAWN.yaw;
  tpCamera.snap(player.position);

  initInput(renderer.domElement);
  onPointerLockChanged((locked) => ui.setPointerLocked(locked));

  ui.hideLoading();
  window.__ready = true;

  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), RENDER.maxDeltaTime);

    tpCamera.handleLook();
    player.update(dt, tpCamera);
    tpCamera.update(dt, player.position, player.speed);
    world.update(player.position);
    ui.updateBoundaryWarning(dt, player.boundaryProximity);

    renderer.render(scene, camera);
    window.__frames++;
    window.__debug.playerY = player.position.y;
    window.__debug.grounded = player.grounded;
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
