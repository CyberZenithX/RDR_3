/**
 * world.js — orchestrator. Builds terrain, sky/lighting, props and grass and
 * wires their per-frame updates together. The actual generation code lives in
 * terrain.js / sky.js / props.js / grass.js — this file just assembles them,
 * per the "split before 400 lines" rule.
 */

import { buildTerrain, groundHeightAt } from './terrain.js';
import { buildSky, updateShadowFollow } from './sky.js';
import { buildProps } from './props.js';
import { buildGrass, updateGrass, updateGrassWind } from './grass.js';

export function buildWorld(scene) {
  const terrainMesh = buildTerrain(scene);
  const { sun, sunDirection, hemi, skyDome } = buildSky(scene);
  const propCounts = buildProps(scene);
  const grassState = buildGrass(scene);

  let windClock = 0;

  return {
    terrainMesh,
    sun,
    sunDirection,
    hemi,
    skyDome,
    grassState,
    propCounts,
    /** Ground height directly under (x, z). See terrain.js for why this is analytic, not a mesh raycast. */
    groundHeightAt,
    /**
     * Call once per frame with the player's world position and the frame's
     * real delta. `dt` feeds only the grass-wind clock (round 7); everything
     * else here is position-driven.
     */
    update(playerPos, dt = 0) {
      updateShadowFollow(sun, sunDirection, playerPos);
      updateGrass(grassState, playerPos);
      windClock += dt;
      updateGrassWind(grassState, windClock);
    },
  };
}
