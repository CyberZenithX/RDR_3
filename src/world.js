/**
 * world.js — orchestrator. Builds terrain, sky/lighting, props and grass and
 * wires their per-frame updates together. The actual generation code lives in
 * terrain.js / sky.js / props.js / grass.js — this file just assembles them,
 * per the "split before 400 lines" rule.
 */

import { buildTerrain, groundHeightAt } from './terrain.js';
import { buildSky, updateShadowFollow } from './sky.js';
import { buildProps } from './props.js';
import { buildGrass, updateGrass } from './grass.js';

export function buildWorld(scene) {
  const terrainMesh = buildTerrain(scene);
  const { sun, sunDirection } = buildSky(scene);
  const propCounts = buildProps(scene);
  const grassState = buildGrass(scene);

  return {
    terrainMesh,
    sun,
    sunDirection,
    grassState,
    propCounts,
    /** Ground height directly under (x, z). See terrain.js for why this is analytic, not a mesh raycast. */
    groundHeightAt,
    /** Call once per frame with the player's world position. */
    update(playerPos) {
      updateShadowFollow(sun, sunDirection, playerPos);
      updateGrass(grassState, playerPos);
    },
  };
}
