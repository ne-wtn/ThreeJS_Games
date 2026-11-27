// The energy turn scheduler (roguelike skill, pattern 1).
//
// LESSON: every actor has a SPEED and an ENERGY pool. Time passes in ticks; each tick,
// every actor gains `speed` energy. Whoever reaches ACTION_COST acts and pays for it.
//   speed 100 = normal, 200 = twice as many turns (rats), 50 = half as many (ghouls).
// That one rule gives fast and slow monsters with no special cases.
//
// Gotcha from the skill: grant energy in its OWN pass. Granting inside the loop that
// looks for a ready actor lets the first actor in the list hog every turn.

export const ACTION_COST = 100;

/**
 * Advance time until someone can act, and return them. The caller performs the action
 * and subtracts its cost from `actor.energy`. `clock.time` counts ticks (optional).
 */
export function nextReady(actors, clock = null) {
  if (!actors.length) throw new Error('no actors');
  for (;;) {
    for (const a of actors) {       // 1) anyone already ready, in a stable order
      if (a.energy >= ACTION_COST) return a;
    }
    for (const a of actors) {       // 2) nobody ready: one tick passes for everyone at once
      a.energy += a.speed;
    }
    if (clock) clock.time++;
  }
}
