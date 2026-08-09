/**
 * input.js — keyboard state, pointer lock, and raw mouse deltas. Mouse look
 * reads `movementX`/`movementY` only, never absolute cursor position, per the
 * pointer-lock rule in BUILD-PLAN.md.
 */

const keys = new Set();
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
function onPointerLockChange(canvas) {
  locked = document.pointerLockElement === canvas;
  for (const fn of lockListeners) fn(locked);
}

/** Wires up keyboard + pointer lock on `canvas`. Call once at startup. */
export function initInput(canvas) {
  addEventListener('keydown', onKeyDown);
  addEventListener('keyup', onKeyUp);
  addEventListener('mousemove', onMouseMove);
  document.addEventListener('pointerlockchange', () => onPointerLockChange(canvas));
  // Listen on document, not canvas: the #clickToPlay overlay sits visually on
  // top of the canvas (later in the DOM, pointer-events: auto in index.html)
  // precisely while the pointer is unlocked, so it — not the canvas — is what
  // actually receives the click. Binding only to canvas meant the "click to
  // play" prompt was never clickable.
  document.addEventListener('click', () => {
    if (!locked) canvas.requestPointerLock();
  });
}

export function isKeyDown(code) {
  return keys.has(code);
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
