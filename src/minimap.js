/**
 * minimap.js — the corner minimap. BUILD-PLAN.md lists it last for round 7 and
 * says to drop it first if something has to go, so it is deliberately the most
 * severable thing in the round: one 2D canvas, redrawn each frame, reading only
 * public state that already exists.
 *
 * North-up, centred on the player, showing the town footprint, the three bandit
 * camps, an accepted bounty's camp, any deployed deputies, and the horse. If
 * the canvas element is absent it is simply inert.
 */

import { MINIMAP } from './config-polish.js';
import { TOWN } from './config.js';

export class Minimap {
  constructor() {
    this.canvas = document.getElementById('minimap');
    this.ctx = this.canvas?.getContext('2d') ?? null;
    if (this.canvas) {
      this.canvas.width = MINIMAP.size;
      this.canvas.height = MINIMAP.size;
    }
  }

  /** World (x, z) → canvas (px, py), north-up, player at centre. */
  _project(cx, cz, px, pz, scale, half) {
    return [half + (px - cx) * scale, half + (pz - cz) * scale];
  }

  /**
   * @param {object} s
   * @param {{x:number,z:number}} s.player
   * @param {number} s.playerYaw   meshYaw — the facing wedge
   * @param {{position:{x:number,z:number}}|null} s.horse
   * @param {Array<{x:number,z:number,alive:number}>} s.camps       bandits.camps
   * @param {{x:number,z:number}|null} s.bountyCamp                 the accepted camp, or null
   * @param {Array<{x:number,z:number}>} s.deputies                 active deputy positions
   * @param {number} s.nightFactor 0..1, tints the backdrop
   */
  update(s) {
    const ctx = this.ctx;
    if (!ctx) return;
    const size = MINIMAP.size;
    const half = size / 2;
    const scale = half / MINIMAP.range;
    const { player } = s;

    ctx.clearRect(0, 0, size, size);

    // Round clip + backdrop.
    ctx.save();
    ctx.beginPath();
    ctx.arc(half, half, half - 1, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = s.nightFactor > 0.5 ? MINIMAP.bgNight : MINIMAP.bgDay;
    ctx.fillRect(0, 0, size, size);

    // Town footprint.
    const [tx0, ty0] = this._project(player.x, player.z, TOWN.centerX - TOWN.halfSize, TOWN.centerZ - TOWN.halfSize, scale, half);
    ctx.fillStyle = MINIMAP.townColor;
    ctx.fillRect(tx0, ty0, TOWN.halfSize * 2 * scale, TOWN.halfSize * 2 * scale);

    const dot = (wx, wz, color, r) => {
      const [x, y] = this._project(player.x, player.z, wx, wz, scale, half);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    };

    for (const c of s.camps ?? []) {
      if (c.alive > 0) dot(c.x, c.z, MINIMAP.campColor, 3);
    }
    if (s.bountyCamp) {
      const [x, y] = this._project(player.x, player.z, s.bountyCamp.x, s.bountyCamp.z, scale, half);
      ctx.strokeStyle = MINIMAP.bountyColor;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (const d of s.deputies ?? []) dot(d.x, d.z, MINIMAP.deputyColor, 2.5);
    if (s.horse) dot(s.horse.position.x, s.horse.position.z, MINIMAP.horseColor, 2.5);

    ctx.restore();

    // Player wedge, on top of the clip so it is never cut.
    ctx.save();
    ctx.translate(half, half);
    // meshYaw 0 = facing world -Z = screen up; three.js +yaw turns toward -X,
    // which on a north-up map is screen left, so the canvas rotation is negated.
    ctx.rotate(-(s.playerYaw ?? 0));
    ctx.fillStyle = MINIMAP.playerColor;
    ctx.beginPath();
    ctx.moveTo(0, -5.5);
    ctx.lineTo(3.5, 4);
    ctx.lineTo(-3.5, 4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Ring.
    ctx.strokeStyle = MINIMAP.ringColor;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(half, half, half - 1, 0, Math.PI * 2);
    ctx.stroke();
  }
}
