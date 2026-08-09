/**
 * collision.js — the one collider array and the one resolve function every
 * round shares, per the locked tech decision ("no physics engine"). Circles
 * cover rocks, trees, barrels and characters; boxes cover buildings and
 * fences. Both live in this one array so any system (player, bandits, camera)
 * can query it without knowing which shape it's dealing with.
 */

/** @typedef {{type:'circle', x:number, z:number, r:number, meta?:object}} CircleCollider */
/** @typedef {{type:'box', x:number, z:number, w:number, d:number, rot:number, meta?:object}} BoxCollider */

/** @type {(CircleCollider|BoxCollider)[]} */
export const colliders = [];

export function addCircleCollider(x, z, r, meta) {
  const c = { type: 'circle', x, z, r, meta };
  colliders.push(c);
  return c;
}

export function addBoxCollider(x, z, w, d, rot, meta) {
  const c = { type: 'box', x, z, w, d, rot, meta };
  colliders.push(c);
  return c;
}

export function removeCollider(c) {
  const i = colliders.indexOf(c);
  if (i !== -1) colliders.splice(i, 1);
}

/**
 * Pushes a circular agent (position {x,z}, given radius) out of any collider
 * it overlaps. Mutates `pos` in place. Boxes are resolved by clamping the
 * agent's position (rotated into box space) to the box's expanded extents,
 * which reads correctly at corners — a circle-vs-circle test on a building
 * pushes away from its center and clips through the walls near the edges.
 */
export function resolveCollisions(pos, radius, ignore = null) {
  for (const c of colliders) {
    if (c === ignore) continue;
    if (c.type === 'circle') {
      resolveCircle(pos, radius, c);
    } else {
      resolveBox(pos, radius, c);
    }
  }
  return pos;
}

function resolveCircle(pos, radius, c) {
  const dx = pos.x - c.x;
  const dz = pos.z - c.z;
  const minDist = radius + c.r;
  const distSq = dx * dx + dz * dz;
  if (distSq >= minDist * minDist || distSq < 1e-10) return;
  const dist = Math.sqrt(distSq);
  const push = (minDist - dist) / dist;
  pos.x += dx * push;
  pos.z += dz * push;
}

const _cos = Math.cos, _sin = Math.sin;

function resolveBox(pos, radius, c) {
  const cosR = _cos(-c.rot), sinR = _sin(-c.rot);
  const dx = pos.x - c.x, dz = pos.z - c.z;
  // Rotate the agent into the box's local space.
  const lx = dx * cosR - dz * sinR;
  const lz = dx * sinR + dz * cosR;

  const hw = c.w / 2 + radius;
  const hd = c.d / 2 + radius;
  if (Math.abs(lx) >= hw || Math.abs(lz) >= hd) return;

  // Push out along whichever axis has the smaller overlap.
  const overlapX = hw - Math.abs(lx);
  const overlapZ = hd - Math.abs(lz);
  let nlx = lx, nlz = lz;
  if (overlapX < overlapZ) {
    nlx = lx >= 0 ? hw : -hw;
  } else {
    nlz = lz >= 0 ? hd : -hd;
  }

  // Rotate back to world space.
  const cosB = _cos(c.rot), sinB = _sin(c.rot);
  pos.x = c.x + nlx * cosB - nlz * sinB;
  pos.z = c.z + nlx * sinB + nlz * cosB;
}
