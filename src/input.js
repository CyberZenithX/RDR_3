/**
 * input.js — keyboard state, pointer lock, and raw mouse deltas. Mouse look
 * reads `movementX`/`movementY` only, never absolute cursor position, per the
 * pointer-lock rule in BUILD-PLAN.md.
 */

const keys = new Set();
const mouseButtons = new Set();
let mouseDX = 0;
let mouseDY = 0;
let locked = false;
const lockListeners = new Set();

function onKeyDown(e) {
  keys.add(e.code);
}
function onKeyUp(e) {
  keys.delete(e.code);
}
function onMouseMove(e) {
  if (!locked) return;
  mouseDX += e.movementX;
  mouseDY += e.movementY;
}
function onMouseDown(e) {
  if (locked) mouseButtons.add(e.button);
}
function onMouseUp(e) {
  mouseButtons.delete(e.button);
}
function onPointerLockChange(canvas) {
  locked = document.pointerLockElement === canvas;
  // A lock lost mid-shot (Esc, alt-tab) must not leave the trigger held down —
  // the game pauses, and it should not resume already firing.
  if (!locked) mouseButtons.clear();
  for (const fn of lockListeners) fn(locked);
}

/** Wires up keyboard + pointer lock on `canvas`. Call once at startup. */
export function initInput(canvas) {
  addEventListener('keydown', onKeyDown);
  addEventListener('keyup', onKeyUp);
  addEventListener('mousemove', onMouseMove);
  addEventListener('mousedown', onMouseDown);
  // On `window`, not the canvas: a button released outside the canvas (or over
  // an overlay) must still clear, or aim-down-sights sticks on forever.
  addEventListener('mouseup', onMouseUp);
  // Right mouse is the aim button, so its context menu has to go — otherwise
  // every attempt to aim opens a menu over the game.
  addEventListener('contextmenu', (e) => { if (locked) e.preventDefault(); });
  document.addEventListener('pointerlockchange', () => onPointerLockChange(canvas));
  // Listen on document, not canvas: the #clickToPlay overlay sits visually on
  // top of the canvas (later in the DOM, pointer-events: auto in index.html)
  // precisely while the pointer is unlocked, so it — not the canvas — is what
  // actually receives the click. Binding only to canvas meant the "click to
  // play" prompt was never clickable.
  //
  // Round 7: the `[data-noplay]` guard. The main/pause menu is clickable UI
  // that must NOT start play — its own buttons request pointer lock themselves
  // where that is what they mean. This is the `e.target` guard docs/ARCHITECTURE.md's
  // note on this listener anticipated a future overlay would need.
  document.addEventListener('click', (e) => {
    if (locked) return;
    if (e.target instanceof Element && e.target.closest('[data-noplay]')) return;
    canvas.requestPointerLock();
  });
}

export function isKeyDown(code) {
  return keys.has(code);
}

/** 0 = left (fire), 2 = right (aim), the DOM's own MouseEvent.button numbering. */
export function isMouseDown(button) {
  return mouseButtons.has(button);
}

export function isPointerLocked() {
  return locked;
}

/** Fires immediately with the current state, then on every lock/unlock. */
export function onPointerLockChanged(fn) {
  lockListeners.add(fn);
  fn(locked);
}

/** Reads and clears the accumulated mouse movement since the last call this frame. */
export function consumeMouseDelta() {
  const d = { x: mouseDX, y: mouseDY };
  mouseDX = 0;
  mouseDY = 0;
  return d;
}
