/**
 * health.js — hit points, and nothing else.
 *
 * Round 4 is the first time anything in this game can die. `targets.js`
 * already counts hits against a `maxHits`, but that is a destructible prop's
 * bookkeeping, not a combatant's: it has no concept of being healed, of a
 * fraction for a bar, or of the moment a hit is the *last* one. docs/ROADMAP.md
 * called that out — "the shape to copy, not to extend".
 *
 * Deliberately tiny and deliberately dumb: it knows nothing about rigs,
 * animations, respawns or who did the shooting. The caller decides what a
 * death looks like. Player, bandit, and round 6's deputies all share it.
 */

export class Health {
  /** @param {number} max hit points at full health */
  constructor(max) {
    this.max = max;
    this.current = max;
  }

  /** 0..1, for a bar. */
  get fraction() {
    return this.max > 0 ? this.current / this.max : 0;
  }

  get dead() {
    return this.current <= 0;
  }

  /**
   * Takes `amount` off. Returns what the hit *was* — `'dead'` only on the
   * hit that actually kills, `'hit'` on any other, and `null` if there was
   * nothing left to take. That three-way answer is the point of the class:
   * it is what lets a caller play a flinch or a death without tracking the
   * previous value itself, and it never fires twice for one death.
   *
   * @returns {'dead'|'hit'|null}
   */
  damage(amount = 1) {
    if (this.dead || amount <= 0) return null;
    this.current = Math.max(0, this.current - amount);
    return this.dead ? 'dead' : 'hit';
  }

  /** Back to full. Used by respawn; round 7's checkpoints will use it too. */
  reset() {
    this.current = this.max;
  }
}
