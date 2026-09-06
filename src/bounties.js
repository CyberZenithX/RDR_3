/**
 * bounties.js — the reason to play. BUILD-PLAN.md round 6: "A bounty board
 * outside the sheriff's office lists the bandit camps from round 4 by name and
 * reward. Read it to accept one; the target camp gets a marker on the horizon.
 * Clear the camp, ride back, collect."
 *
 * TWO HALVES, and only one of them is a mesh:
 *
 *  - `buildBountyBoard()` runs at town-build time and pushes the board's posts
 *    and panel into the town's shared opaque `PartBuilder`, and its three camp
 *    names into the shared sign `PartBuilder` — PARTS, never a new mesh
 *    (ADR-033). It returns the board's trigger point.
 *  - `Bounties` is the runtime: the money, which bounty is accepted, the camp
 *    state machine (`open -> active -> cleared -> paid`), and the one beam of
 *    light standing over the accepted camp. That marker is the only mesh this
 *    file adds to the scene, it is two draw calls, and it exists only while a
 *    bounty is active.
 *
 * The B key, at the board: take the next open bounty, or — if the accepted
 * camp is cleared — collect the reward.
 */

import * as THREE from 'three';
import { TOWN } from './config.js';
import { STREET } from './config-town.js';
import { CAMPS } from './config-ai.js';
import { BOUNTY } from './config-bounty.js';
import { addBoxCollider } from './collision.js';
import { isKeyDown, isPointerLocked } from './input.js';

const ROWS = 3;
/** Height of one name row on the board — shared by the atlas entries and the quads. */
function rowHeight() {
  return (BOUNTY.boardH - 0.3) / ROWS;
}

/**
 * The atlas cells the bounty board needs, appended after the buildings' own.
 * Same shape `signs.js` takes for a shop sign: text, board colour, aspect.
 */
export function bountySignEntries() {
  const aspect = (BOUNTY.boardW * 0.9) / rowHeight();
  return CAMPS.map((c, i) => ({
    text: `${c.name}  $${BOUNTY.rewards[i] ?? BOUNTY.defaultReward}`,
    background: BOUNTY.boardColor,
    aspect,
  }));
}

/**
 * Builds the board into the shared builders and returns its trigger point.
 *
 * @param {object} ctx `{ opaque, signs, atlas, bountyAtlasBase }` — the town's
 *   own build context, with `bountyAtlasBase` set to `BUILDINGS.length` so the
 *   camp cells sit after the shop signs in the one atlas.
 * @param {object[]} buildings the resolved placements from buildings.js.
 * @returns {{x:number, z:number, readRadius:number}|null}
 */
export function buildBountyBoard(ctx, buildings) {
  const sheriff = buildings.find((b) => b.spec.kind === 'sheriff');
  if (!sheriff) return null;
  const { opaque, signs, atlas, bountyAtlasBase } = ctx;
  const rh = rowHeight();
  const lx = BOUNTY.sideOffset;
  // Off the front edge of the sheriff's boardwalk, on the street side.
  const lz = sheriff.frontZ - STREET.boardwalkDepth - BOUNTY.standoff;
  const boardMidY = BOUNTY.postHeight + BOUNTY.boardH / 2;

  opaque.setFrame(sheriff.cx, TOWN.height, sheriff.cz, sheriff.yaw);
  for (const s of [-1, 1]) {
    opaque.post(BOUNTY.postRadius, BOUNTY.postRadius, BOUNTY.postHeight + BOUNTY.boardH,
      lx + s * (BOUNTY.boardW / 2 - 0.15), 0, lz, BOUNTY.frameColor, 6);
  }
  opaque.box(BOUNTY.boardW, BOUNTY.boardH, BOUNTY.boardThickness, lx, boardMidY, lz, BOUNTY.boardColor);
  opaque.box(BOUNTY.boardW + 0.14, 0.1, BOUNTY.boardThickness + 0.06,
    lx, BOUNTY.postHeight + BOUNTY.boardH + 0.05, lz, BOUNTY.frameColor);

  // The three camp names, top to bottom, on the outward face (local -Z).
  signs.setFrame(sheriff.cx, TOWN.height, sheriff.cz, sheriff.yaw);
  const faceZ = lz - BOUNTY.boardThickness / 2 - 0.02;
  const yTop = BOUNTY.postHeight + BOUNTY.boardH - 0.15 - rh / 2;
  for (let i = 0; i < CAMPS.length && i < ROWS; i++) {
    signs.facePlate(BOUNTY.boardW * 0.9, rh * 0.88, lx, yTop - i * rh, faceZ,
      atlas.uvFor(bountyAtlasBase + i));
  }

  // World position of the board, for the collider and the read trigger.
  const world = opaque.toWorld(lx, lz);
  const trigger = opaque.toWorld(lx, lz - 1.1); // a step further into the street, where you stand to read
  // `top` is addBoxCollider's 7th arg, not a meta field — a shot passes over
  // the board, it is not an infinitely tall wall.
  addBoxCollider(
    world.x, world.z, BOUNTY.boardW, BOUNTY.boardThickness + 0.08, sheriff.yaw,
    { kind: 'bountyboard' }, TOWN.height + BOUNTY.postHeight + BOUNTY.boardH,
  );
  return { x: trigger.x, z: trigger.z, readRadius: BOUNTY.readRadius };
}

export class Bounties {
  /**
   * @param {object} deps scene, world, board (from buildBountyBoard), bandits
   *   (for the live per-camp alive count).
   */
  constructor({ scene, world, board }) {
    this.world = world;
    this.board = board ?? { x: 15, z: 20, readRadius: BOUNTY.readRadius };
    this.money = 0;
    this.activeIndex = -1;
    this.nearBoard = false;
    this._prevB = false;

    this.list = CAMPS.map((c, i) => ({
      name: c.name, x: c.x, z: c.z,
      reward: BOUNTY.rewards[i] ?? BOUNTY.defaultReward,
      state: 'open', // open -> active -> cleared -> paid
    }));

    // The horizon marker: a translucent unlit beam and a spinning ring. Unfogged
    // so it carries the length of the map; no depth write so it never hides the
    // world behind it.
    this._beamMat = new THREE.MeshBasicMaterial({
      color: BOUNTY.markerColor, transparent: true, opacity: BOUNTY.markerOpacity,
      depthWrite: false, side: THREE.DoubleSide, fog: false,
    });
    this._ringMat = new THREE.MeshBasicMaterial({
      color: BOUNTY.markerColor, transparent: true, opacity: 0.55,
      depthWrite: false, fog: false,
    });
    const beamGeo = new THREE.CylinderGeometry(
      BOUNTY.markerRadius, BOUNTY.markerRadius, BOUNTY.markerHeight, 8, 1, true);
    beamGeo.translate(0, BOUNTY.markerHeight / 2, 0);
    const beam = new THREE.Mesh(beamGeo, this._beamMat);
    this._ring = new THREE.Mesh(
      new THREE.TorusGeometry(BOUNTY.markerRingRadius, 0.16, 6, 24), this._ringMat);
    this._ring.rotation.x = Math.PI / 2;
    this._ring.position.y = 1.6;
    this.marker = new THREE.Group();
    this.marker.add(beam, this._ring);
    this.marker.visible = false;
    scene.add(this.marker);
    this.markerVisible = false;
  }

  /** State of every bounty, for the HUD and smoke.mjs. */
  get states() {
    return this.list.map((b) => b.state);
  }

  /** What the HUD line should read, or null for nothing. */
  get hudText() {
    if (this.activeIndex >= 0) {
      const b = this.list[this.activeIndex];
      if (b.state === 'cleared') return `${b.name} cleared — collect $${b.reward} at the sheriff's board`;
      return `Bounty: ${b.name}  ·  $${b.reward}${this.nearBoard ? '   (B: switch)' : ''}`;
    }
    if (this.nearBoard) {
      return this.list.some((b) => b.state === 'open')
        ? 'Bounty board  ·  press B to take a bounty'
        : 'Bounty board  ·  every bounty is collected';
    }
    return null;
  }

  /** Take bounty `i`. */
  accept(i) {
    if (i < 0 || i >= this.list.length) return;
    this.activeIndex = i;
    const b = this.list[i];
    b.state = 'active';
    this._beamMat.color.setHex(BOUNTY.markerColor);
    this._ringMat.color.setHex(BOUNTY.markerColor);
    this.marker.position.set(b.x, this.world.groundHeightAt(b.x, b.z), b.z);
    this.marker.visible = true;
    this.markerVisible = true;
  }

  /** The B key at the board: collect a cleared bounty, else rotate to the next open one. */
  collectOrCycle() {
    if (this.activeIndex >= 0) {
      const b = this.list[this.activeIndex];
      if (b.state === 'cleared') {
        this.money += b.reward;
        b.state = 'paid';
        this.activeIndex = -1;
        this.marker.visible = false;
        this.markerVisible = false;
        return;
      }
    }
    // Round-robin forward from whatever is accepted, so B cycles through all
    // three rather than oscillating between the first two.
    const start = this.activeIndex >= 0 ? this.activeIndex : -1;
    let next = -1;
    for (let k = 1; k <= this.list.length; k++) {
      const idx = (start + k + this.list.length) % this.list.length;
      if (this.list[idx].state === 'open') { next = idx; break; }
    }
    if (next < 0) return;
    if (this.activeIndex >= 0 && this.list[this.activeIndex].state === 'active') {
      this.list[this.activeIndex].state = 'open';
    }
    this.accept(next);
  }

  update(dt, player, bandits) {
    if (this.activeIndex >= 0) {
      const b = this.list[this.activeIndex];
      const camp = bandits?.camps?.[this.activeIndex];
      if (b.state === 'active' && camp && camp.alive <= 0) {
        b.state = 'cleared';
        this._beamMat.color.setHex(BOUNTY.markerClearedColor);
        this._ringMat.color.setHex(BOUNTY.markerClearedColor);
      }
    }

    this.nearBoard = !player.dead && !player.mounted
      && Math.hypot(player.position.x - this.board.x, player.position.z - this.board.z) <= this.board.readRadius;
    const bDown = this.nearBoard && isPointerLocked() && isKeyDown('KeyB');
    if (bDown && !this._prevB) this.collectOrCycle();
    this._prevB = bDown;

    if (this.markerVisible && this.activeIndex >= 0) {
      const b = this.list[this.activeIndex];
      this.marker.position.set(b.x, this.world.groundHeightAt(b.x, b.z), b.z);
      this._ring.rotation.z += BOUNTY.markerSpin * dt;
    }
  }
}
