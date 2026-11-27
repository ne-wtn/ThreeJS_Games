# Retro Rush: what this game teaches

An endless three-lane highway dodger. You dodge traffic, use nitro for speed, and pass
cars closely to earn near-miss bonuses that refill the nitro.

Run it with `npm run rush` from the `polyfork-games` folder.

## Read the code in this order

| File | Concept |
|------|---------|
| `src/main.js` | Renderer, camera and lights; the game-state machine; the loop; input; chase camera |
| `src/road.js` | The **treadmill**: the car stays still and the world slides past, recycling road pieces |
| `src/traffic.js` | **Object pooling**, **fair spawning** and **AABB collision** |
| `src/shake.js` | **Trauma-based screen shake** |
| `src/sound.js` | Sound effects made in code with the Web Audio API |
| `src/assets.js` | Loading GLB models with `GLTFLoader` |

## The big ideas

**1. The game loop and delta time.** `renderer.setAnimationLoop` calls our function every
frame. Each frame we measure `dt`, the seconds since the last frame, and multiply every
movement by it. That way the game runs at the same speed on a 60 Hz laptop and a 144 Hz monitor.
`dt` is clamped to 0.1 s so a stall doesn't teleport cars through you.

**2. State vs view.** The `game` object holds plain numbers (speed, distance, lane, nitro).
The meshes only *show* that state. Keeping them separate makes the logic easy to read and test.

**3. A state machine.** `game.state` is one of `loading → title → playing ⇄ paused →
crashed → over`. Each state decides what `update()` does, and the functions that change
state (`startRun`, `crash`, `gameOver`) are the only places where the state changes.

**4. The treadmill (in `road.js`).** An endless road can't be infinitely long. We build 24
pieces of 8 m each, move them toward the camera, and teleport any piece that passes behind
the camera back to the far end. The numbers stay small, so there's no floating-point drift
after many kilometres.

**5. Object pooling (in `traffic.js`).** Every traffic car is created once at load time and
reused. Creating and destroying 3D objects mid-game causes frame hitches.

**6. Fair randomness.** Random isn't the same as fair. Each traffic row fills at most 2 of
the 3 lanes. All traffic moves at one speed, so rows can never close up into a wall. Spacing
grows with your speed, so you always have time to react.

**7. Forgiving hitboxes.** The collision boxes are slightly smaller than the cars. A clip
that *looks* like a miss should count as a miss.

**8. Game feel ("juice").** A near miss fires several small responses at once: a sound, a
popup, a little screen shake and a nitro refill. A crash fires big ones: a big shake, slow
motion and a spin. The camera's field of view also widens with speed to sell the sense of
going fast.

**9. Frame-rate-independent smoothing.** `x += (target - x) * (1 - Math.exp(-k * dt))`
eases toward a target the same way at any frame rate. Plain `x += (target - x) * 0.1`
doesn't: it runs faster on faster screens.

**10. Saving.** The best score goes into `localStorage`, so it survives closing the tab.

## Try changing

- `START_SPEED`, `MAX_SPEED` and `RAMP_DISTANCE` at the top of `main.js`: how fast it gets hard.
- `LANE_SNAP`: 6 feels like a heavy truck, 25 like a go-kart.
- `NEAR_MISS_NITRO`: make the nitro meter generous or stingy.
- In `traffic.js`, allow 3 cars per row and see how unfair it feels.
- Add a fourth lane: add an x position to `LANES` in `road.js` and widen the road tile.

## Skills used

`threejs-scene-setup`, `threejs-gltf-loading`, `threejs-materials-lighting`, `game-feel`
(from `.claude/skills`).
