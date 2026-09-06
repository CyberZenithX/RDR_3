/**
 * checkpoint.js — the localStorage checkpoint BUILD-PLAN.md's round 7 promised
 * would slot in behind `player.respawn()` "without touching combat code".
 *
 * One record: where the player stands (x, z, yaw), plus the money and health
 * to restore with them. `y` is deliberately NOT stored — it is recomputed from
 * the terrain on load, so a checkpoint stays valid even if the ground moves.
 *
 * Every call is wrapped: a private window, disabled site data or a quota error
 * must degrade to "no checkpoint", never throw into the game loop.
 */

const KEY = 'dust-and-iron.checkpoint';

export function saveCheckpoint({ x, z, yaw, money = 0, health = null }) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ x, z, yaw, money, health, savedAt: Date.now() }));
  } catch { /* storage unavailable — a checkpoint is a nicety, not a requirement */ }
}

/** The saved record, or null if there is none / it is unreadable. */
export function loadCheckpoint() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (typeof d?.x !== 'number' || typeof d?.z !== 'number' || typeof d?.yaw !== 'number') return null;
    return d;
  } catch {
    return null;
  }
}

export function hasCheckpoint() {
  return loadCheckpoint() !== null;
}

export function clearCheckpoint() {
  try {
    localStorage.removeItem(KEY);
  } catch { /* see saveCheckpoint */ }
}
