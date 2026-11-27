// CRYPT CRAWLER: a turn-based dungeon crawl. Each floor is generated from a seed.
// Bump into monsters to fight, grab gold and potions, find the trapdoor down.
//
// Read the files in this order:
//   main.js         (you are here) game flow, turns, combat, input, camera, HUD
//   dungeon.js      procedural generation + validation (pure data)
//   rng.js          seeded random numbers
//   pathfinding.js  A*, breadth-first search, line of sight, field of view
//   turns.js        the energy turn scheduler
//   monsters.js     monster data + the finite-state-machine AI
//   world3d.js      dungeon data -> instanced 3D meshes, fog of war
//   actors.js       skinned, animated characters
// Pure-logic files are unit-tested in ../tests (run `npm test`).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { generateFloor, FLOOR } from './dungeon.js';
import { randomSeed } from './rng.js';
import { astar, computeVisible } from './pathfinding.js';
import { nextReady, ACTION_COST } from './turns.js';
import { MONSTERS, createMonster, decide } from './monsters.js';
import { FloorView, TILE, cellToWorld } from './world3d.js';
import { ActorView } from './actors.js';

const FOV_RADIUS = 7;
const POTION_HEAL = 10;
const MAX_POTIONS = 5;
const BEST_KEY = 'crypt-crawler-best';
const MODEL_NAMES = ['armoured-knight-hero', 'goblin', 'dungeon-rat', 'shambling-ghoul', 'orc-brute',
  'flagstone-floor-tile', 'dungeon-wall-module', 'spilled-coin-pile', 'potion-bottle', 'wall-torch-bracket',
  'oak-barrel', 'timber-crate', 'bone-scatter', 'clay-storage-pot', 'standing-brazier', 'mushroom-cluster',
  'iron-banded-strongbox', 'trapdoor-pit'];

// ---------------------------------------------------------------------------
// Renderer, scene, camera, lights
// ---------------------------------------------------------------------------
const canvas = document.querySelector('#c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x07060a);
scene.fog = new THREE.Fog(0x07060a, 18, 38);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.5, 120);

scene.add(new THREE.HemisphereLight(0x9c8fb8, 0x2a1d14, 0.9)); // dim: the dungeon is dark
// The knight carries a warm light. It is the main light in the game.
const lantern = new THREE.PointLight(0xffb066, 90, 22, 1.4);
scene.add(lantern);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const ui = {
  hud: $('hud'), hpText: $('hp-text'), hpFill: $('hp-fill'), depth: $('depth'), gold: $('gold'),
  potions: $('potions'), seed: $('seed'), log: $('log'), floaters: $('floaters'),
  screen: $('screen'), text: $('screen-text'), hint: $('screen-hint'),
};
function showScreen(text, hint = '') {
  ui.text.textContent = text;
  ui.hint.innerHTML = hint;
  ui.screen.classList.remove('hidden');
}
const hideScreen = () => ui.screen.classList.add('hidden');

function log(text, kind = '') {
  const li = document.createElement('li');
  li.textContent = text;
  if (kind) li.className = kind;
  ui.log.append(li);
  while (ui.log.children.length > 6) ui.log.firstChild.remove();
}

// Floating combat numbers: a DOM element that follows a 3D point.
const floaters = [];
function floatText(text, worldPos, kind = '') {
  const el = document.createElement('div');
  el.className = `floater ${kind}`;
  el.textContent = text;
  ui.floaters.append(el);
  floaters.push({ el, pos: worldPos.clone().setY(2.4), t: 0 });
}
function updateFloaters(dt) {
  const v = new THREE.Vector3();
  for (const f of floaters) {
    f.t += dt;
    v.copy(f.pos).setY(f.pos.y + f.t * 1.2).project(camera); // 3D -> screen (-1..1)
    f.el.style.left = `${(v.x * 0.5 + 0.5) * window.innerWidth}px`;
    f.el.style.top = `${(-v.y * 0.5 + 0.5) * window.innerHeight}px`;
    f.el.style.opacity = String(Math.min(1, 2.5 - f.t * 2.5));
    if (f.t > 1) f.el.remove();
  }
  for (let i = floaters.length - 1; i >= 0; i--) if (floaters[i].t > 1) floaters.splice(i, 1);
}

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------
const game = {
  state: 'loading', // loading -> title -> playing -> dead -> playing ...
  seed: 0, depth: 1, floor: null, view: null,
  explored: null, visible: null,
  gold: 0, potions: 0, cause: '',
  cooldown: 0,     // seconds before the next player action is accepted (lets animations read)
  travel: [],      // remaining path for click-to-travel
  travelTimer: 0,
  best: loadBest(),
};
const player = { kind: 'player', name: 'you', x: 0, y: 0, hp: 20, maxHp: 20, atk: [2, 5], speed: 100, energy: 0, alive: true };
let monsters = [];
let models = null;
let playerView = null;
const views = new Map(); // monster id -> ActorView
const charLayer = new THREE.Group();
scene.add(charLayer);

// --- grid helpers the rules use
const W = () => game.floor.width;
const cellIndex = (x, y) => y * W() + x;
const inBounds = (x, y) => x >= 0 && y >= 0 && x < game.floor.width && y < game.floor.height;
const isWalkable = (x, y) => inBounds(x, y) && game.floor.grid[cellIndex(x, y)] === FLOOR && !game.floor.blocked[cellIndex(x, y)];
const opaque = (x, y) => !inBounds(x, y) || game.floor.grid[cellIndex(x, y)] !== FLOOR;
const monsterAt = (x, y) => monsters.find((m) => m.alive && m.x === x && m.y === y) ?? null;
const roll = ([min, max]) => min + Math.floor(Math.random() * (max - min + 1)); // combat: not seeded on purpose

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------
async function init() {
  const loader = new GLTFLoader();
  let done = 0;
  const entries = await Promise.all(MODEL_NAMES.map(async (name) => {
    const gltf = await loader.loadAsync(new URL(`../models/${name}.glb`, import.meta.url).href);
    ui.text.textContent = `Loading models… ${++done}/${MODEL_NAMES.length}`;
    return [name, { scene: gltf.scene, animations: gltf.animations }];
  }));
  models = Object.fromEntries(entries);
  game.state = 'title';
  const urlSeed = new URLSearchParams(location.search).get('seed');
  showScreen(`${bestLine()}Press Enter to descend`,
    'Each dungeon is built from a seed. Add <b>?seed=1234</b> to the address to replay one.\n' +
    '<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> or arrows: move, and walk into monsters to attack\n' +
    '<b>Click</b> a floor tile to travel there (uses A* pathfinding)\n' +
    '<kbd>Space</kbd> wait a turn · <kbd>Q</kbd> drink a potion · find the glowing trapdoor to go deeper' +
    (urlSeed ? `\n\nSeed from the address: ${urlSeed}` : ''));
}

// ---------------------------------------------------------------------------
// Runs and floors
// ---------------------------------------------------------------------------
function newRun(seed) {
  Object.assign(player, { hp: 20, maxHp: 20, atk: [2, 5], alive: true });
  game.seed = seed;
  game.depth = 1;
  game.gold = 0;
  game.potions = 1;
  ui.log.replaceChildren();
  if (!playerView) playerView = new ActorView(charLayer, models['armoured-knight-hero'], 1);
  playerView.root.visible = true;
  playerView.dying = false;
  playerView.done = false;
  playerView.body.rotation.set(0, 0, 0);
  playerView.body.position.set(0, 0, 0);
  if (!playerView.root.parent) charLayer.add(playerView.root);
  enterFloor();
  game.state = 'playing';
  ui.hud.hidden = false;
  hideScreen();
  log(`You enter the crypt. (seed ${seed})`);
}

function enterFloor() {
  game.view?.dispose();
  for (const v of views.values()) v.root.removeFromParent();
  views.clear();

  const floor = generateFloor(game.seed, game.depth);
  game.floor = floor;
  game.view = new FloorView(scene, models, floor);
  game.explored = new Uint8Array(floor.width * floor.height);
  game.travel = [];

  monsters = floor.monsters.map((spawn, i) => createMonster(spawn, game.depth, i));
  for (const m of monsters) {
    const view = new ActorView(charLayer, models[MONSTERS[m.type].model], MONSTERS[m.type].scale);
    view.place(cellToWorld(m.x, m.y));
    view.face(Math.random() - 0.5, Math.random() - 0.5);
    view.root.visible = false;
    views.set(m.id, view);
  }

  player.x = floor.start.x;
  player.y = floor.start.y;
  player.energy = ACTION_COST; // ready to act immediately
  playerView.place(cellToWorld(player.x, player.y));
  snapCamera();
  updateFov();
  updateHud();
}

function descend() {
  game.depth++;
  player.maxHp += 4;
  player.hp = Math.min(player.maxHp, player.hp + 6);
  if (game.depth % 2 === 1) { player.atk = [player.atk[0] + 1, player.atk[1] + 1]; }
  enterFloor();
  log(`You climb down to depth ${game.depth}. You feel tougher.`, 'good');
}

function die(cause) {
  player.alive = false;
  game.state = 'dead';
  game.cause = cause;
  playerView.die();
  const score = game.gold + game.depth * 100;
  const isBest = score > game.best.score;
  if (isBest) {
    game.best = { score, depth: game.depth, gold: game.gold };
    localStorage.setItem(BEST_KEY, JSON.stringify(game.best));
  }
  setTimeout(() => showScreen(
    `Slain by ${cause} on depth ${game.depth}.\n${game.gold} gold · score ${score}${isBest ? ' · new best!' : ''}`,
    `Seed ${game.seed}\n<kbd>Enter</kbd> new dungeon · <kbd>R</kbd> retry this seed`,
  ), 1100);
}

function loadBest() {
  try { return JSON.parse(localStorage.getItem(BEST_KEY)) ?? { score: 0, depth: 0, gold: 0 }; }
  catch { return { score: 0, depth: 0, gold: 0 }; }
}
function bestLine() {
  return game.best.score ? `Best: depth ${game.best.depth}, ${game.best.gold} gold\n` : '';
}

// ---------------------------------------------------------------------------
// TURNS. The player acts, then the scheduler lets monsters act until the player is
// ready again. Nothing happens in between: it's a turn-based game, the world waits.
// ---------------------------------------------------------------------------
function playerAct(action) {
  if (game.state !== 'playing' || game.cooldown > 0) return false;
  let acted = false;

  if (action.type === 'move') {
    const nx = player.x + action.dx, ny = player.y + action.dy;
    const target = monsterAt(nx, ny);
    if (target) {
      attack(player, target);
      acted = true;
    } else if (isWalkable(nx, ny)) {
      player.x = nx;
      player.y = ny;
      playerView.moveTo(cellToWorld(nx, ny));
      pickUp();
      acted = true;
    }
  } else if (action.type === 'wait') {
    acted = true;
  } else if (action.type === 'drink') {
    if (game.potions <= 0) log('You have no potions.');
    else if (player.hp >= player.maxHp) log('You are already at full health.');
    else {
      game.potions--;
      const healed = Math.min(POTION_HEAL, player.maxHp - player.hp);
      player.hp += healed;
      floatText(`+${healed}`, playerView.root.position, 'heal');
      log(`You drink a potion and recover ${healed} health.`, 'good');
      acted = true;
    }
  }
  if (!acted) return false; // walking into a wall costs no turn

  player.energy -= ACTION_COST;
  game.cooldown = 0.13;

  if (player.x === game.floor.stairs.x && player.y === game.floor.stairs.y) {
    descend();
    return true;
  }
  updateFov();          // monsters must react to where you are NOW
  runMonsterTurns();
  updateFov();
  updateHud();
  return true;
}

function runMonsterTurns() {
  const actors = [player, ...monsters.filter((m) => m.alive)];
  const ctx = {
    width: game.floor.width, height: game.floor.height,
    isWalkable, monsterAt, player, rng: Math.random,
    playerSees: (x, y) => game.visible[cellIndex(x, y)] === 1,
  };
  for (let guard = 0; guard < 1000; guard++) {
    const a = nextReady(actors);
    if (a === player) return;            // the player's turn: wait for input
    a.energy -= ACTION_COST;
    if (!a.alive) continue;              // killed earlier this round
    const act = decide(a, ctx);
    if (act.say) log(act.say);
    if (act.type === 'attack') attack(a, player);
    if (act.type === 'move') {
      a.x = act.x;
      a.y = act.y;
      views.get(a.id).moveTo(cellToWorld(a.x, a.y));
    }
    if (!player.alive) return;
  }
}

function attack(attacker, defender) {
  const dmg = roll(attacker.atk);
  defender.hp -= dmg;
  const aView = attacker === player ? playerView : views.get(attacker.id);
  const dView = defender === player ? playerView : views.get(defender.id);
  aView.lunge(defender.x - attacker.x, defender.y - attacker.y);
  dView.flashHurt();
  floatText(String(dmg), dView.root.position, defender === player ? 'hurt' : '');

  if (defender === player) {
    log(`The ${attacker.name} hits you for ${dmg}.`, 'bad');
    shake = Math.min(1, shake + 0.35);
    if (player.hp <= 0) die(`a ${attacker.name}`);
  } else {
    log(`You hit the ${defender.name} for ${dmg}.`);
    if (defender.state === 'sleep' || defender.state === 'wander') {
      defender.state = 'hunt'; // hitting a monster wakes it, obviously
      defender.lastKnown = { x: player.x, y: player.y };
    }
    if (defender.hp <= 0) {
      defender.alive = false;
      dView.die();
      log(`The ${defender.name} dies.`, 'good');
    }
  }
}

function pickUp() {
  const cell = cellIndex(player.x, player.y);
  const i = game.floor.items.findIndex((it) => it.x === player.x && it.y === player.y);
  if (i < 0) return;
  const it = game.floor.items[i];
  if (it.kind === 'potion' && game.potions >= MAX_POTIONS) { log('You cannot carry more potions.'); return; }
  game.floor.items.splice(i, 1);
  game.view.removeItem(cell);
  if (it.kind === 'gold' || it.kind === 'strongbox') {
    game.gold += it.amount;
    floatText(`+${it.amount} gold`, playerView.to, 'gold');
    log(it.kind === 'strongbox' ? `You pry open a strongbox: ${it.amount} gold!` : `You pick up ${it.amount} gold.`, 'good');
  } else if (it.kind === 'potion') {
    game.potions++;
    log('You pick up a healing potion.', 'good');
  }
}

// Field of view: what the knight can see right now, and what has been seen before.
function updateFov() {
  const f = game.floor;
  game.visible = computeVisible(f.width, f.height, opaque, player.x, player.y, FOV_RADIUS);
  for (let i = 0; i < game.visible.length; i++) if (game.visible[i]) game.explored[i] = 1;
  game.view.updateVisibility(game.explored, game.visible);
  for (const m of monsters) {
    const v = views.get(m.id);
    if (m.alive) v.root.visible = game.visible[cellIndex(m.x, m.y)] === 1;
  }
}

function updateHud() {
  ui.hpText.textContent = `${Math.max(0, player.hp)} / ${player.maxHp}`;
  ui.hpFill.style.transform = `scaleX(${Math.max(0, player.hp) / player.maxHp})`;
  ui.depth.textContent = game.depth;
  ui.gold.textContent = game.gold;
  ui.potions.textContent = game.potions;
  ui.seed.textContent = game.seed;
}

// ---------------------------------------------------------------------------
// Input: keys move one step (holding repeats), clicks travel along an A* path.
// ---------------------------------------------------------------------------
const KEY_DIRS = {
  KeyW: [0, -1], ArrowUp: [0, -1], KeyS: [0, 1], ArrowDown: [0, 1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0],
};
let heldKey = null;
let repeatTimer = 0;

window.addEventListener('keydown', (e) => {
  if (KEY_DIRS[e.code] || e.code === 'Space') e.preventDefault();
  if (e.repeat) return;
  if (game.state === 'title' && e.code === 'Enter') {
    const urlSeed = Number(new URLSearchParams(location.search).get('seed'));
    return newRun(urlSeed > 0 ? urlSeed : randomSeed());
  }
  if (game.state === 'dead') {
    if (e.code === 'Enter') return newRun(randomSeed());
    if (e.code === 'KeyR') return newRun(game.seed);
    return;
  }
  if (game.state !== 'playing') return;
  game.travel = [];
  if (KEY_DIRS[e.code]) {
    heldKey = e.code;
    repeatTimer = 0.24;
    const [dx, dy] = KEY_DIRS[e.code];
    game.cooldown = 0; // a fresh key press is always accepted
    playerAct({ type: 'move', dx, dy });
  }
  if (e.code === 'Space' || e.code === 'Period') playerAct({ type: 'wait' });
  if (e.code === 'KeyQ') playerAct({ type: 'drink' });
});
window.addEventListener('keyup', (e) => { if (e.code === heldKey) heldKey = null; });
window.addEventListener('blur', () => { heldKey = null; });

// Mouse: hover shows the path, click walks it.
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const hit = new THREE.Vector3();
const marker = new THREE.Mesh(
  new THREE.RingGeometry(0.55, 0.75, 32).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0xffc65a, transparent: true, opacity: 0.8, depthWrite: false }),
);
marker.position.y = 0.08;
marker.visible = false;
scene.add(marker);
const dotGeo = new THREE.CircleGeometry(0.16, 12).rotateX(-Math.PI / 2);
const dotMat = new THREE.MeshBasicMaterial({ color: 0xffc65a, transparent: true, opacity: 0.55, depthWrite: false });
const dots = Array.from({ length: 80 }, () => {
  const d = new THREE.Mesh(dotGeo, dotMat);
  d.position.y = 0.08;
  d.visible = false;
  scene.add(d);
  return d;
});
let hoverPath = null;

function cellUnderMouse(e) {
  ndc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  if (!raycaster.ray.intersectPlane(ground, hit)) return null;
  const x = Math.round(hit.x / TILE), y = Math.round(hit.z / TILE);
  return inBounds(x, y) ? { x, y } : null;
}

function pathTo(cell) {
  if (!cell || !game.explored[cellIndex(cell.x, cell.y)] || !isWalkable(cell.x, cell.y)) return null;
  // Only plan through cells you have already seen: no free map knowledge.
  const known = (x, y) => game.explored[cellIndex(x, y)] && isWalkable(x, y) && !monsterAt(x, y);
  return astar(game.floor.width, game.floor.height, known, player, cell);
}

canvas.addEventListener('pointermove', (e) => {
  if (game.state !== 'playing') return;
  const cell = cellUnderMouse(e);
  hoverPath = pathTo(cell);
  marker.visible = !!hoverPath;
  if (cell) cellToWorld(cell.x, cell.y, marker.position).setY(0.08);
});
canvas.addEventListener('pointerdown', (e) => {
  if (game.state !== 'playing' || e.button !== 0) return;
  const path = pathTo(cellUnderMouse(e));
  if (path && path.length) {
    game.travel = path;
    game.travelTimer = 0;
  }
});

function updatePathDots() {
  const path = game.travel.length ? game.travel : hoverPath;
  dots.forEach((d, i) => {
    const c = path?.[i];
    d.visible = !!c && game.state === 'playing';
    if (c) cellToWorld(c.x, c.y, d.position).setY(0.08);
  });
}

function stepTravel(dt) {
  if (!game.travel.length || game.state !== 'playing') return;
  // Stop if a monster comes into view: auto-walking into a fight is never what you want.
  const threat = monsters.find((m) => m.alive && game.visible[cellIndex(m.x, m.y)]);
  if (threat) {
    log(`You stop: a ${threat.name} is in sight.`);
    game.travel = [];
    return;
  }
  game.travelTimer -= dt;
  if (game.travelTimer > 0 || game.cooldown > 0) return;
  const next = game.travel.shift();
  const acted = playerAct({ type: 'move', dx: next.x - player.x, dy: next.y - player.y });
  if (!acted) game.travel = [];
  game.travelTimer = 0.05;
}

// ---------------------------------------------------------------------------
// Camera: a high three-quarter view that follows the knight smoothly.
// ---------------------------------------------------------------------------
const CAM_OFFSET = new THREE.Vector3(0, 15, 10.5);
const camTarget = new THREE.Vector3();
let shake = 0;
function snapCamera() {
  camTarget.copy(playerView.to);
  camera.position.copy(camTarget).add(CAM_OFFSET);
  camera.lookAt(camTarget);
}
function updateCamera(dt) {
  camTarget.lerp(playerView.root.position, 1 - Math.exp(-6 * dt));
  shake = Math.max(0, shake - dt * 2.5);
  const s = shake * shake * 0.5;
  const t = performance.now() / 1000;
  camera.position.copy(camTarget).add(CAM_OFFSET);
  camera.position.x += Math.sin(t * 47) * s;
  camera.position.z += Math.sin(t * 61) * s;
  camera.lookAt(camTarget);
  lantern.position.copy(playerView.root.position).setY(3.2);
}

// ---------------------------------------------------------------------------
// Loop
// ---------------------------------------------------------------------------
const timer = new THREE.Timer();
timer.connect(document);
renderer.setAnimationLoop(() => {
  timer.update();
  const dt = Math.min(Math.max(timer.getDelta(), 0), 0.1);

  if (game.state === 'playing' || game.state === 'dead') {
    game.cooldown = Math.max(0, game.cooldown - dt);
    if (heldKey && game.state === 'playing') {
      repeatTimer -= dt;
      if (repeatTimer <= 0 && game.cooldown <= 0) {
        const [dx, dy] = KEY_DIRS[heldKey];
        playerAct({ type: 'move', dx, dy });
        repeatTimer = 0.14;
      }
    }
    stepTravel(dt);
    updatePathDots();
    game.view.update(dt);
    playerView.update(dt);
    for (const v of views.values()) if (!v.done) v.update(dt);
    updateCamera(dt);
    updateFloaters(dt);
  }
  renderer.render(scene, camera);
});

// Exposed for console debugging and the automated smoke test.
Object.assign(window, { renderer, scene, game, player, getMonsters: () => monsters, playerAct });

camera.position.set(40, 30, 50);
camera.lookAt(40, 0, 30);
init().catch((err) => {
  console.error(err);
  showScreen('Could not load the models.', String(err.message || err));
});
