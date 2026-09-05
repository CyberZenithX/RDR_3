/**
 * signs.js — the painted lettering on every shop sign in town.
 *
 * WHY THIS IS AN ATLAS AND NOT TEN TEXTURES. The town is one merged
 * vertex-coloured mesh precisely so that a whole street costs a handful of draw
 * calls (ADR-033), and a textured surface cannot join that merge: it needs UVs
 * and a `map`, and the merged material has neither. Ten signs with ten
 * materials would be ten more draw calls plus ten more in the shadow pass.
 *
 * So every sign's face is drawn into ONE canvas — one horizontal strip per
 * building — and every sign quad is given UVs pointing at its own strip. The
 * result is **one extra draw call for every sign in town**, and it merges into
 * a single mesh exactly the way the rest of the town does.
 *
 * THERE IS NO FONT TO FETCH. `poly.pizza`, CDNs and the rest are 403'd in this
 * environment (see docs/ASSETS.md), so the lettering is drawn with a canvas 2D
 * context in whatever serif the browser already has. That is also why the sign
 * BACKGROUND is baked into the same cell rather than left to the board
 * underneath: an opaque cell needs no alpha blending, no depth sorting, and no
 * second pass.
 *
 * The cell is a fixed 8:1 and a board is not, so each string is drawn through a
 * horizontal scale that cancels the difference — otherwise the saloon's 8.9:1
 * board would stretch its lettering by 11% and the barber's would squeeze it.
 */

import * as THREE from 'three';
import { SIGNS } from './config-town.js';

const _c = new THREE.Color();

/** Relative luminance of a 0xRRGGBB colour, for choosing ink that will read. */
function luminance(hex) {
  _c.setHex(hex);
  // sRGB-space weights: setHex has already converted to linear, so undo that
  // roughly — this only has to pick one of two inks, not be colorimetric.
  return Math.sqrt(0.2126 * _c.r + 0.7152 * _c.g + 0.0722 * _c.b);
}

function cssColor(hex) {
  return `#${hex.toString(16).padStart(6, '0')}`;
}

/**
 * Draws `text` centred in the current cell, tracked out letter by letter.
 *
 * Manual tracking rather than `ctx.letterSpacing`: the property is recent, this
 * is the only place in the codebase that would depend on it, and a signwriter's
 * spacing is the difference between "shop sign" and "browser default".
 */
function drawTracked(ctx, text, cx, cy, tracking) {
  const widths = [];
  let total = 0;
  for (const ch of text) {
    const w = ctx.measureText(ch).width;
    widths.push(w);
    total += w + tracking;
  }
  total -= tracking;
  let x = cx - total / 2;
  let i = 0;
  for (const ch of text) {
    ctx.fillText(ch, x, cy);
    x += widths[i++] + tracking;
  }
  return total;
}

/**
 * Builds the atlas.
 *
 * @param {{text:string, background:number, aspect:number}[]} entries one per
 *   sign, in the order the sign quads will index them. `aspect` is the physical
 *   board's width/height, used to cancel the cell's own aspect.
 * @returns {{texture:THREE.CanvasTexture, uvFor:(i:number)=>{u0:number,v0:number,u1:number,v1:number}, count:number}}
 */
export function buildSignAtlas(entries) {
  const s = SIGNS;
  const n = Math.max(1, entries.length);
  const canvas = document.createElement('canvas');
  canvas.width = s.cellWidth;
  canvas.height = s.cellHeight * n;
  const ctx = canvas.getContext('2d');
  const cellAspect = s.cellWidth / s.cellHeight;

  entries.forEach((entry, i) => {
    const top = i * s.cellHeight;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, top, s.cellWidth, s.cellHeight);
    ctx.clip();

    // The board itself, plus a darker inner border so the painted panel reads
    // as a panel rather than as a flat rectangle of colour.
    ctx.fillStyle = cssColor(entry.background);
    ctx.fillRect(0, top, s.cellWidth, s.cellHeight);
    ctx.globalAlpha = s.borderAlpha;
    ctx.fillStyle = cssColor(SIGNS.borderColor);
    ctx.lineWidth = s.borderWidth;
    ctx.strokeStyle = cssColor(SIGNS.borderColor);
    ctx.strokeRect(
      s.borderInset, top + s.borderInset,
      s.cellWidth - s.borderInset * 2, s.cellHeight - s.borderInset * 2,
    );
    ctx.globalAlpha = 1;

    const ink = luminance(entry.background) > s.inkLuminanceThreshold ? s.inkDark : s.inkLight;
    const text = entry.text.toUpperCase();

    // Cancel the difference between the cell's aspect and the board's, about
    // the cell's own centre, so the lettering lands on the plank undistorted.
    const squeeze = cellAspect / Math.max(0.01, entry.aspect);
    ctx.translate(s.cellWidth / 2, 0);
    ctx.scale(squeeze, 1);
    ctx.translate(-s.cellWidth / 2, 0);

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    // Shrink to fit: a long name on a narrow board gets smaller lettering, the
    // way a signwriter would have done it.
    const usable = s.cellWidth - s.padding * 2;
    let size = s.maxFontSize;
    let width = Infinity;
    while (size > s.minFontSize) {
      ctx.font = `${s.fontWeight} ${size}px ${s.fontFamily}`;
      width = 0;
      for (const ch of text) width += ctx.measureText(ch).width + size * s.tracking;
      width -= size * s.tracking;
      if (width <= usable) break;
      size -= 2;
    }

    const cy = top + s.cellHeight / 2 + s.baselineNudge;
    // A painted drop shadow: at fifty metres this is most of what makes the
    // lettering separate from the board rather than dissolving into it.
    ctx.fillStyle = `rgba(0, 0, 0, ${s.shadowAlpha})`;
    drawTracked(ctx, text, s.cellWidth / 2 + s.shadowOffset, cy + s.shadowOffset, size * s.tracking);
    ctx.fillStyle = cssColor(ink);
    drawTracked(ctx, text, s.cellWidth / 2, cy, size * s.tracking);
    ctx.restore();
  });

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = s.anisotropy; // three clamps this to the GPU's own max
  texture.needsUpdate = true;

  return {
    texture,
    count: n,
    /** The atlas rectangle for sign `i`, as UVs. Canvas y runs down, UV v runs up. */
    uvFor(i) {
      const v1 = 1 - (i / n);
      const v0 = 1 - ((i + 1) / n);
      return { u0: 0, v0, u1: 1, v1 };
    },
  };
}
