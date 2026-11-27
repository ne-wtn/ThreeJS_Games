# Polyfork Games

Three small three.js games for learning game programming, built with free low-poly models
from [Polyfork](https://polyfork.dev) (via the
[polyfork-catalog](https://github.com/lucas-martinic/polyfork-catalog) index).

| # | Game | Teaches | Run |
|---|------|---------|-----|
| 1 | **Retro Rush**: endless highway dodger | game loop, delta time, GLB loading, treadmill world, object pooling, AABB collision, screen shake | `npm run rush` |
| 2 | **Orbit Defense**: twin-stick space shooter | vectors and aiming, raycasting, steering AI, wave director, InstancedMesh particles, hit-stop | `npm run orbit` |
| 3 | **Crypt Crawler**: turn-based dungeon crawl | seeded procedural generation, validation, A*, field of view, energy turn scheduler, FSM AI, skinned animation | `npm run crypt` |

Each game folder has a `LEARN.md` (read this first), a `CREDITS.md` and a `models/` folder
holding its GLB files, so everything runs offline.

## Commands

```bash
npm install      # once
npm run dev      # launcher page with all three games
npm run rush     # open one game directly (also: orbit, crypt)
npm test         # unit tests for Crypt Crawler's generator, A* and turn scheduler
npm run build    # production build into dist/
```

## Layout

```
polyfork-games/
├─ index.html            launcher page
├─ vite.config.js        one Vite project, four pages
├─ retro-rush/           index.html, src/, models/, LEARN.md, CREDITS.md
├─ orbit-defense/        same layout
├─ crypt-crawler/        same layout + tests/
└─ .claude/skills/       the awesome-gamedev-agent-skills pack (router + 79 skills),
                         installed for this folder only
```

## Agent skills

The [awesome-gamedev-agent-skills](https://github.com/gamedev-skills/awesome-gamedev-agent-skills)
pack is installed in `.claude/skills/`, so Claude Code sessions started in this folder load
it automatically. The games were written using its `threejs-scene-setup`,
`threejs-gltf-loading`, `threejs-materials-lighting`, `game-feel`, `game-ai`,
`procedural-gen` and `roguelike` skills. `skills-lock.json` records the installed version.
