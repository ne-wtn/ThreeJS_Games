# Orbit Defense: what this game teaches

A top-down twin-stick shooter. You fly with WASD, aim with the mouse and hold the mouse
button to fire. Waves of enemies try to destroy the beacon in the middle of the arena, and
every fifth wave brings a bomber boss.

Run it with `npm run orbit` from the `polyfork-games` folder.

## Read the code in this order

| File | Concept |
|------|---------|
| `src/main.js` | The shared **world object**, mouse-to-world **raycasting**, the follow camera, game states |
| `src/player.js` | **Acceleration and drag** movement, **aiming with vectors and `atan2`**, firing |
| `src/enemies.js` | **Data-driven enemy types**, **steering behaviours**, **circle collision** |
| `src/waves.js` | A **budget-based wave director** |
| `src/bullets.js` | A projectile pool |
| `src/particles.js` | **InstancedMesh**: 800 particles in one draw call |
| `src/feel.js` | **Screen shake and hit-stop** |
| `src/pickups.js` | Random drops with a lifetime |
| `src/assets.js` | Why clones need **their own materials** for hit flashes |

## The big ideas

**1. Vectors are directions and distances.** "Where is the mouse relative to me?" is
`aim - position`. Divide by its length to get a direction of length 1. Multiply by a speed
to get a velocity. Most of the maths in this game is that one idea.

**2. `atan2` turns a direction into an angle.** `Math.atan2(dir.x, dir.z)` gives the rotation
around the y axis that points a +z-facing model along `dir`. Every ship uses it to face where
it's going or aiming.

**3. Mouse to world: raycasting.** The mouse is a 2D point on the screen.
`raycaster.setFromCamera` fires a ray from the camera through that point, and
`ray.intersectPlane` finds where it hits the game's flat plane.

**4. Movement with momentum.** The player doesn't set their position directly. Input adds
acceleration, drag removes a share of the velocity each second
(`vel *= Math.exp(-DRAG * dt)`), and velocity moves the ship. Tweak `ACCEL` and `DRAG` to
change the whole feel.

**5. Steering behaviours (Craig Reynolds).** `desired = direction to target × max speed`,
then `steer = desired − velocity`, limited by `accel × dt`. Enemies curve toward their
targets instead of snapping. **Separation** pushes neighbours apart so they don't merge into
one blob. Raiders seek a moving point on a circle around you, so they **orbit**.

**6. Target selection.** Interceptors head for the beacon but switch to you if you come
within 15 m. That gives you a way to pull them off the beacon.

**7. Circle collision.** Two circles touch when `dx² + dz² < (r1 + r2)²`. Comparing squared
values skips a square root. It's enough for every collision in this game.

**8. Data-driven design.** Each enemy is a row in `TYPES` (model, size, health, speed, score
and special traits). Asteroids split because they have `splitInto`; mines explode because
they have `blast`.

**9. A budget-based wave director.** Wave *n* gets `5 + 3n` points and buys a random mix of
unlocked enemies. Difficulty rises smoothly and no two waves are the same.

**10. Draw calls and InstancedMesh.** Each `Mesh` is a separate request to the GPU. The
particle system draws all 800 particles with **one** `InstancedMesh` and only updates each
copy's matrix and colour. The 3000 stars are one `Points` object. Compare with `bullets.js`,
where a few dozen plain pooled meshes are simpler and fine.

**11. Game feel.** Hits make enemies flash white. A kill fires particles, a small shake and a
35 ms **hit-stop**: the game nearly freezes, and your brain reads the pause as weight. The boss
gets everything at once. Shake and hit-stop count down in *real* time, so they still end while
the game is slowed.

**12. Shared materials.** `clone()` shares materials, so flashing one enemy would flash them
all. `cloneWithOwnMaterials` gives each enemy its own copy.

## Try changing

- `ACCEL`, `DRAG` and `FIRE_RATE` in `player.js`.
- Add a new enemy: copy a row in `TYPES` (try the `gunship` model, which is already
  downloaded), add a `think` branch, then give it a cost and unlock wave in `waves.js`.
- Make raiders lead their shots: aim at `player.pos + player.vel * time-to-hit`.
- Set `feel.shakeStrength = 0` and play. Notice how much flatter hits feel.

## Skills used

`threejs-scene-setup`, `threejs-gltf-loading`, `threejs-materials-lighting`, `game-feel`,
`game-ai` (from `.claude/skills`).
