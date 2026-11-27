// RETRO RUSH: an endless three-lane highway dodger.
//
// Read the files in this order:
//   main.js     (you are here) setup, game states, the loop, input, camera
//   road.js     the endless "treadmill" road and scenery
//   traffic.js  object pooling, fair spawning and box collision
//   shake.js    trauma-based screen shake
//   sound.js    sound effects made in code with Web Audio
import * as THREE from 'three';
import { loadModels, sizeOf } from './assets.js';
import { Road, LANES } from './road.js';
import { Traffic, TRAFFIC_SPEED } from './traffic.js';
import { Shake } from './shake.js';
import { Sound } from './sound.js';

// ---------------------------------------------------------------------------
// Tuning: change these numbers and see what happens. That is how game feel is found.
// ---------------------------------------------------------------------------
const START_SPEED = 22;     // m/s (about 80 km/h)
const MAX_SPEED = 46;       // m/s (about 165 km/h)
const RAMP_DISTANCE = 3500; // metres until top speed and full difficulty
const NITRO_BOOST = 1.4;    // speed multiplier while boosting
const NITRO_DRAIN = 0.35;   // nitro used per second of boosting (meter is 0..1)
const NITRO_REGEN = 0.03;   // passive refill per second
const NEAR_MISS_NITRO = 0.22;
const NEAR_MISS_SCORE = 100;
const LANE_SNAP = 12;       // higher = snappier lane changes
const BEST_KEY = 'retro-rush-best';

const PLAYER_CAR = 'muscle-car-60s';
const TRAFFIC_KINDS = ['boxy-sedan-70s', 'hatchback-80s', 'pickup-truck-70s', 'camper-van',
  'station-wagon-70s', 'wedge-coupe-80s', 'convertible-60s'];
const SCENERY = ['two-lane-street-tile', 'guardrail', 'street-lamp', 'gas-pump', 'diner-sign',
  'motel-sign', 'phone-booth', 'oil-drum', 'tire', 'traffic-cone', 'planter'];

// ---------------------------------------------------------------------------
// Renderer, scene, camera, lights (see the threejs-scene-setup skill)
// ---------------------------------------------------------------------------
const canvas = document.querySelector('#c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true }); // alpha: CSS sky shows through
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;

const scene = new THREE.Scene();
// Fog fades distant objects into the horizon colour, hiding where the road "ends".
scene.fog = new THREE.Fog(0xf59a6b, 40, 140);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 400);

scene.add(new THREE.HemisphereLight(0xffd8b0, 0x7a4a3a, 1.6));
const sun = new THREE.DirectionalLight(0xffc49a, 2.6);
sun.position.set(-12, 18, 6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
// The shadow camera only needs to cover the area near the player (the world comes to us).
Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 30, bottom: -50, near: 1, far: 70 });
sun.shadow.bias = -0.0005;
scene.add(sun);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------------------------------------------------------------------------
// HUD and overlay helpers (plain DOM: HTML is the easiest way to draw text)
// ---------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const ui = {
  hud: $('hud'), score: $('score'), best: $('best'), speed: $('speed'),
  nitro: $('nitro'), nitroFill: $('nitro-fill'),
  screen: $('screen'), text: $('screen-text'), hint: $('screen-hint'), popups: $('popups'),
};

function showScreen(text, hint = '') {
  ui.text.textContent = text;
  ui.hint.innerHTML = hint;
  ui.screen.classList.remove('hidden');
}
const hideScreen = () => ui.screen.classList.add('hidden');

function popup(text) {
  const el = document.createElement('div');
  el.className = 'popup';
  el.textContent = text;
  ui.popups.append(el);
  setTimeout(() => el.remove(), 900);
}

const CONTROLS_HINT =
  '<kbd>&larr;</kbd> <kbd>&rarr;</kbd> or <kbd>A</kbd> <kbd>D</kbd> change lanes &nbsp;·&nbsp; hold <kbd>Space</kbd> or <kbd>&uarr;</kbd> for nitro\n' +
  'Pass cars closely for a near-miss bonus and a nitro refill.\n' +
  '<kbd>P</kbd> pause &nbsp;·&nbsp; <kbd>M</kbd> mute &nbsp;·&nbsp; on a phone, tap left or right';

// ---------------------------------------------------------------------------
// Game state. Plain data, kept separate from the meshes that display it.
// ---------------------------------------------------------------------------
const game = {
  state: 'loading', // loading -> title -> playing <-> paused; playing -> crashed -> over -> playing
  speed: 0,
  distance: 0,
  bonus: 0,
  nitro: 1,
  boosting: false,
  lane: 1,
  timeScale: 1,      // < 1 during the crash slow-motion
  crashTimer: 0,
  best: Number(localStorage.getItem(BEST_KEY)) || 0,
  get score() { return Math.floor(this.distance) + this.bonus; },
};

// The player as the collision code sees it. halfW/halfL are filled in after loading.
const player = { x: 0, z: 0, halfW: 1, halfL: 2.3, mesh: null, spin: 0 };

const shake = new Shake();
const sound = new Sound();
const keys = new Set();
let road, traffic;

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------
async function init() {
  const names = [PLAYER_CAR, ...TRAFFIC_KINDS, ...SCENERY];
  const models = await loadModels(names, (done, total) => {
    ui.text.textContent = `Loading models… ${done}/${total}`;
  });

  road = new Road(scene, models);
  traffic = new Traffic(scene, models, TRAFFIC_KINDS);

  player.mesh = models[PLAYER_CAR].clone();
  player.mesh.rotation.y = Math.PI; // the model faces +z, we drive towards -z
  scene.add(player.mesh);
  const size = sizeOf(player.mesh);
  player.halfW = size.x / 2;
  player.halfL = size.z / 2;

  ui.best.textContent = game.best;
  game.state = 'title';
  showScreen('Press Enter to drive', CONTROLS_HINT);
}

// ---------------------------------------------------------------------------
// State changes
// ---------------------------------------------------------------------------
function startRun() {
  sound.start();
  sound.start_beep();
  Object.assign(game, { state: 'playing', speed: START_SPEED, distance: 0, bonus: 0, nitro: 1,
    lane: 1, timeScale: 1, crashTimer: 0 });
  player.x = 0;
  player.spin = 0;
  player.mesh.position.set(0, 0, 0);
  player.mesh.rotation.set(0, Math.PI, 0);
  traffic.reset();
  ui.hud.hidden = false;
  hideScreen();
}

function crash() {
  game.state = 'crashed';
  game.crashTimer = 0;
  game.timeScale = 0.3; // slow motion, restored by the crash timer (in real time)
  player.spin = (player.x >= 0 ? -1 : 1) * 9;
  shake.add(1);
  sound.crash();
}

function gameOver() {
  game.state = 'over';
  game.timeScale = 1;
  const newBest = game.score > game.best;
  if (newBest) {
    game.best = game.score;
    localStorage.setItem(BEST_KEY, String(game.best)); // survives closing the tab
    ui.best.textContent = game.best;
  }
  showScreen(
    `${newBest ? 'New best! ' : ''}Score ${game.score}\n${Math.floor(game.distance)} m driven`,
    'Press <kbd>Enter</kbd> to drive again',
  );
}

function togglePause() {
  if (game.state === 'playing') {
    game.state = 'paused';
    showScreen('Paused', 'Press <kbd>P</kbd> to keep driving');
  } else if (game.state === 'paused') {
    game.state = 'playing';
    hideScreen();
  }
}

function changeLane(dir) {
  if (game.state !== 'playing') return;
  const next = THREE.MathUtils.clamp(game.lane + dir, 0, LANES.length - 1);
  if (next !== game.lane) {
    game.lane = next;
    sound.laneChange();
  }
}

// ---------------------------------------------------------------------------
// Input. Discrete actions (lane change) react to keydown; held actions (nitro)
// are read from the `keys` set every frame.
// ---------------------------------------------------------------------------
window.addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (e.repeat) return; // holding a key should not machine-gun lane changes
  switch (e.code) {
    case 'ArrowLeft': case 'KeyA': changeLane(-1); break;
    case 'ArrowRight': case 'KeyD': changeLane(1); break;
    case 'KeyP': case 'Escape': togglePause(); break;
    case 'KeyM': sound.start(); sound.toggleMute(); break;
    case 'Enter': case 'Space':
      if (game.state === 'title' || game.state === 'over') startRun();
      break;
  }
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => { keys.clear(); if (game.state === 'playing') togglePause(); });

// Touch: tap the left or right half of the screen.
canvas.addEventListener('pointerdown', (e) => {
  if (game.state === 'title' || game.state === 'over') return startRun();
  changeLane(e.clientX < window.innerWidth / 2 ? -1 : 1);
});
ui.screen.addEventListener('pointerdown', () => {
  if (game.state === 'title' || game.state === 'over') startRun();
  else if (game.state === 'paused') togglePause();
});

// ---------------------------------------------------------------------------
// Update: one step of the simulation. dt is scaled by slow-mo; realDt is not.
// ---------------------------------------------------------------------------
function update(dt, realDt) {
  if (game.state === 'loading') return;

  if (game.state === 'title') {
    road.update(18 * dt); // attract mode: the road rolls behind the title
  }

  if (game.state === 'playing') {
    const difficulty = Math.min(1, game.distance / RAMP_DISTANCE);

    // Nitro: hold to boost while the meter lasts.
    const wantBoost = keys.has('Space') || keys.has('ArrowUp') || keys.has('KeyW');
    game.boosting = wantBoost && game.nitro > 0.02;
    game.nitro += (game.boosting ? -NITRO_DRAIN : NITRO_REGEN) * dt;
    game.nitro = THREE.MathUtils.clamp(game.nitro, 0, 1);

    // Speed eases towards its target instead of jumping, so nitro feels like a surge.
    const cruise = START_SPEED + (MAX_SPEED - START_SPEED) * difficulty;
    const target = cruise * (game.boosting ? NITRO_BOOST : 1);
    game.speed += (target - game.speed) * (1 - Math.exp(-2.5 * dt));
    game.distance += game.speed * dt;

    // Frame-rate independent smoothing: 1 - exp(-k*dt) gives the same motion at 30 or 144 fps.
    const laneX = LANES[game.lane];
    const prevX = player.x;
    player.x += (laneX - player.x) * (1 - Math.exp(-LANE_SNAP * dt));
    const lateralSpeed = (player.x - prevX) / Math.max(dt, 1e-6);
    player.mesh.position.x = player.x;
    player.mesh.rotation.y = Math.PI - lateralSpeed * 0.035; // steer into the turn
    player.mesh.rotation.z = lateralSpeed * 0.006;           // body roll

    road.update(game.speed * dt);
    const events = traffic.update(dt, game.speed, player, difficulty);

    if (events.nearMisses) {
      game.bonus += NEAR_MISS_SCORE * events.nearMisses;
      game.nitro = Math.min(1, game.nitro + NEAR_MISS_NITRO * events.nearMisses);
      shake.add(0.15);
      sound.nearMiss();
      popup(`+${NEAR_MISS_SCORE * events.nearMisses} NEAR MISS`);
    }
    if (events.crash) crash();
  }

  if (game.state === 'crashed') {
    game.crashTimer += realDt;
    if (game.crashTimer > 0.5) game.timeScale = 1;
    game.speed = Math.max(0, game.speed - 40 * dt);
    player.spin *= Math.exp(-2 * dt);
    player.mesh.rotation.y += player.spin * dt;
    road.update(game.speed * dt);
    traffic.update(dt, game.speed, { x: 999, z: 0, halfW: 0, halfL: 0 }, 0); // traffic drives on
    if (game.crashTimer > 1.6) gameOver();
  }

  if (game.state === 'over') {
    traffic.update(dt, 0, { x: 999, z: 0, halfW: 0, halfL: 0 }, 0);
  }

  sound.setEngine(game.speed, game.state === 'playing', game.boosting);
  shake.update(realDt);
  updateCamera(dt);
  updateHud();
}

// Chase camera: follows the car loosely, widens its field of view with speed.
function updateCamera(dt) {
  const speedFactor = THREE.MathUtils.clamp((game.speed - START_SPEED) / (MAX_SPEED * NITRO_BOOST - START_SPEED), 0, 1);
  const fov = 60 + speedFactor * 16;
  camera.fov += (fov - camera.fov) * (1 - Math.exp(-4 * dt));
  camera.updateProjectionMatrix();

  const camX = player.x * 0.55;
  camera.position.set(camX + shake.x, 5.2 + shake.y - speedFactor * 0.8, 11 - speedFactor * 1.5);
  camera.lookAt(player.x * 0.7, 1.2, -14);
  camera.rotation.z += shake.roll;
}

function updateHud() {
  if (ui.hud.hidden) return;
  ui.score.textContent = game.score;
  ui.speed.textContent = Math.round(game.speed * 3.6); // m/s to km/h
  ui.nitroFill.style.transform = `scaleX(${game.nitro})`;
  ui.nitro.classList.toggle('active', game.boosting);
}

// ---------------------------------------------------------------------------
// The loop (threejs-scene-setup skill, pattern 3)
// ---------------------------------------------------------------------------
const timer = new THREE.Timer();
timer.connect(document); // no giant delta after the tab was hidden

renderer.setAnimationLoop(() => {
  timer.update();
  const realDt = Math.min(Math.max(timer.getDelta(), 0), 0.1);
  update(realDt * game.timeScale, realDt);
  renderer.render(scene, camera);
});

// Exposed for console debugging and the automated smoke test.
Object.assign(window, { renderer, scene, game, TRAFFIC_SPEED });

camera.position.set(0, 5.2, 11);
camera.lookAt(0, 1.2, -14);
init().catch((err) => {
  console.error(err);
  showScreen('Could not load the models.', String(err.message || err));
});
