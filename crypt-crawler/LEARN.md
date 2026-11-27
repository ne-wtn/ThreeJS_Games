# Crypt Crawler: what this game teaches

A turn-based dungeon crawl. Every floor is generated from a seed. Walk into monsters to
fight them, collect gold and potions, and find the glowing trapdoor to go deeper. Death is
permanent; your best run is saved.

Run it with `npm run crypt` from the `polyfork-games` folder. Add `?seed=1234` to the
address to replay a dungeon. Run the unit tests with `npm test`.

## Read the code in this order

| File | Concept |
|------|---------|
| `src/main.js` | Game flow, **the turn loop**, combat, click-to-travel, camera, HUD |
| `src/dungeon.js` | **Procedural generation** (rooms, corridors, content) and **validation** |
| `src/rng.js` | **Seeded random numbers** and deriving per-floor seeds |
| `src/pathfinding.js` | **A\*** with a binary heap, breadth-first search, **line of sight**, **field of view** |
| `src/turns.js` | The **energy turn scheduler** (fast and slow monsters) |
| `src/monsters.js` | Data-driven monsters and their **finite state machine** AI |
| `src/world3d.js` | Grid data → **instanced meshes**, **fog of war**, cutaway walls |
| `src/actors.js` | **Skinned characters**: `SkeletonUtils.clone`, `AnimationMixer`, cross-fades |
| `tests/*.test.js` | Unit tests for the pure-logic files |

## The big ideas

**1. Seeds make randomness repeatable.** `mulberry32(seed)` always produces the same
numbers for the same seed. Each floor gets its own seed, `hashSeeds(runSeed, depth)`, so
what you do on floor 1 never changes the layout of floor 2. Combat uses `Math.random()` on
purpose, because only the *map* needs to be replayable.

**2. Generate data, then render it.** `dungeon.js` only produces numbers and lists: a grid
of walls and floors, plus where the monsters, loot and props go. It never touches three.js.
That's why it can be tested in Node, hundreds of seeds per second.

**3. Validate what you generate.** After building a floor, `validateFloor` checks that every
floor cell and the trapdoor can be reached, that no monster is near the start, and that the
border is solid. A solid prop (a barrel or crate) is only kept if a flood fill proves it
didn't seal off a doorway. A floor that fails is regenerated from a derived seed.

**4. A\* pathfinding.** It explores outward from the start, always expanding the cell with the
lowest `f = g + h`: the steps taken so far plus a guess of the steps left. Manhattan
distance never overestimates on a 4-way grid, so the path is always a shortest one. The
test suite checks this against breadth-first search on 300 random grids. Click-to-travel
only plans through cells you've already seen.

**5. Field of view.** For every cell within 7 tiles, draw a Bresenham line to it. If no wall
is in the way, you can see it. Monsters "see" you using *your* view, so sight is symmetric:
if you can see the goblin, it can see you.

**6. The energy scheduler.** Each tick, every actor gains `speed` energy. Whoever reaches
100 acts and pays 100. Rats (speed 200) act twice per turn and ghouls (speed 50) every other
turn, without any special-case code.

**7. Finite state machine AI.** `sleep → hunt → search → wander`. Hunting monsters chase
the spot where they *last saw* you, not your live position, so you can break line of sight
and slip away. They give up after 5 turns without seeing you: that gap is **hysteresis**,
and it stops them flickering between states.

**8. Logic is instant; the view catches up.** The rules move a monster to its new cell
straight away. `ActorView` then glides the model there over 0.16 s and plays the Walk clip.
Keeping these separate is what makes a turn-based game feel smooth.

**9. Skinned characters.** Rigged models must be cloned with `SkeletonUtils.clone()`.
Each one gets its own `AnimationMixer`, and clips are cross-faded so poses blend.

**10. Instancing and fog of war.** All the floor tiles and walls are drawn with a handful of
`InstancedMesh` draw calls. Copies are only added when a cell is first seen. Each copy's
colour is set every turn: bright if you can see it now, dim if you only remember it.

**11. Lights and recompiles.** The trapdoor light is never hidden; its intensity is set to 0.
Changing the *number* of lights in a scene makes three.js recompile every material, which
causes a hitch.

## Try changing

- `FOV_RADIUS` in `main.js`: 4 makes the dungeon tense, 12 makes it easy.
- Add a monster: add a row to `MONSTERS` and `MONSTER_TABLE` in `monsters.js`. The
  `hooded-cultist` model is in the Polyfork Dungeon Crypt kit
  (https://polyfork.dev/kit/dungeon-crypt-c27d93).
- Give orcs speed 150, then rerun `npm test` to see the scheduler test still pass.
- Make corridors two tiles wide in `dungeon.js` and watch the validation sweep.
- Swap Bresenham field of view for symmetric shadowcasting
  (https://www.albertford.com/shadowcasting/).

## Skills used

`procedural-gen`, `roguelike`, `game-ai`, `threejs-gltf-loading` (skinned clones and
animation), `threejs-scene-setup`, `threejs-materials-lighting` (from `.claude/skills`).
