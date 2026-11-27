// ORBIT DEFENSE: a top-down twin-stick shooter. Guard the beacon in the middle of the
// arena against waves of interceptors, raiders, mines, asteroids and a bomber boss.
//
// Read the files in this order:
//   main.js       (you are here) setup, the shared "world", input, camera, game states
//   player.js     acceleration + drag movement, mouse aiming, shooting
//   enemies.js    data-driven enemy types, steering AI, circle collisions
//   waves.js      the budget-based wave director
//   bullets.js    a projectile pool
//   particles.js  thousands of particles in one draw call (InstancedMesh)
//   feel.js       screen shake and hit-stop
//   pickups.js    supply crate drops
import * as THREE from 'three';
import { loadModels, cloneWithOwnMaterials, setFlash } from './assets.js';
import { Feel } from './feel.js';
import { Sound } from './sound.js';
import { Particles } from './particles.js';
import { Bullets } from './bullets.js';
import { Player, MAX_HULL } from './player.js';
import { Enemies } from './enemies.js';
import { WaveDirector } from './waves.js';
import { Pickups } from './pickups.js';

const ARENA_RADIUS = 52;
const BEACON_HP = 24;
const BEST_KEY = 'orbit-defense-best';
const MODELS = ['agile-starfighter', 'interceptor', 'alien-raider', 'space-mine', 'heavy-bomber',
  'large-asteroid', 'medium-asteroid', 'small-asteroid', 'supply-crate', 'nav-beacon'];

// ---------------------------------------------------------------------------
// Renderer, scene, camera, lights
// ---------------------------------------------------------------------------
const canvas = document.querySelector('#c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05060f);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 1, 500);

scene.add(new THREE.HemisphereLight(0xa8ccff, 0x2a1440, 1.4));
const key = new THREE.DirectionalLight(0xffffff, 2.4);
key.position.set(20, 40, 12);
scene.add(key);
const rim = new THREE.DirectionalLight(0xff5ae0, 1.1); // coloured light from the side
rim.position.set(-30, 8, -25);
scene.add(rim);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

buildBackdrop();

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const ui = {
  hud: $('hud'), wave: $('wave'), score: $('score'), hull: $('hull'), beacon: $('beacon'),
  power: $('power'), powerTime: $('power-time'), banner: $('banner'),
  screen: $('screen'), text: $('screen-text'), hint: $('screen-hint'),
};
const CONTROLS =
  '<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> fly &nbsp;·&nbsp; <b>mouse</b> aim &nbsp;·&nbsp; hold <b>left click</b> or <kbd>Space</kbd> to fire\n' +
  'Protect the beacon. Interceptors dive at it, mines drift to it, raiders hunt you.\n' +
  'Shoot mines near enemies for chain explosions. Crates: green = repair, amber = triple shot.\n' +
  '<kbd>P</kbd> pause &nbsp;·&nbsp; <kbd>M</kbd> mute';

function showScreen(text, hint = '') {
  ui.text.textContent = text;
  ui.hint.innerHTML = hint;
  ui.screen.classList.remove('hidden');
}
const hideScreen = () => ui.screen.classList.add('hidden');

// ---------------------------------------------------------------------------
// The world: one object that every system receives. It is how player.js can reach
// the bullets, enemies.js can reach the player, and so on, without global variables.
// ---------------------------------------------------------------------------
const game = { state: 'loading', score: 0, deadTimer: 0, reason: '', best: loadBest() };
const w = {
  scene, arenaRadius: ARENA_RADIUS, models: null,
  feel: new Feel(), sound: new Sound(), particles: new Particles(scene), bullets: new Bullets(scene),
  addScore(n) { game.score += n; },
  announce(text, boss = false) {
    ui.banner.textContent = text;
    ui.banner.classList.toggle('boss', boss);
    ui.banner.classList.remove('show');
    void ui.banner.offsetWidth; // restart the CSS animation
    ui.banner.classList.add('show');
    if (boss) w.sound.alarm(); else w.sound.wave();
  },
  waveCleared(n) {
    w.addScore(n * 150);
    w.beacon.heal(2);
  },
};

// ---------------------------------------------------------------------------
// Input. Held keys go in a Set; the mouse position is turned into a point on the
// ground plane with a Raycaster.
// ---------------------------------------------------------------------------
const keys = new Set();
const mouseNdc = new THREE.Vector2();
let mouseDown = false;
const raycaster = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0); // y = 0
const aimPoint = new THREE.Vector3();

window.addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (e.repeat) return;
  if (e.code === 'KeyP' || e.code === 'Escape') togglePause();
  if (e.code === 'KeyM') { w.sound.start(); w.sound.toggleMute(); }
  if ((e.code === 'Enter' || e.code === 'Space') && (game.state === 'title' || game.state === 'over')) startRun();
  if (e.code === 'Space') e.preventDefault();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => { keys.clear(); mouseDown = false; if (game.state === 'playing') togglePause(); });
window.addEventListener('pointermove', (e) => {
  // Normalised device coordinates: -1..1 across the screen, +1 at the top.
  mouseNdc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
});
canvas.addEventListener('pointerdown', (e) => { if (e.button === 0) mouseDown = true; });
window.addEventListener('pointerup', () => { mouseDown = false; });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
ui.screen.addEventListener('pointerdown', () => {
  if (game.state === 'title' || game.state === 'over') startRun();
  else if (game.state === 'paused') togglePause();
});

function readInput() {
  const axis = (neg, pos) => (keys.has(pos[0]) || keys.has(pos[1]) ? 1 : 0) - (keys.has(neg[0]) || keys.has(neg[1]) ? 1 : 0);
  raycaster.setFromCamera(mouseNdc, camera);
  raycaster.ray.intersectPlane(groundPlane, aimPoint);
  return {
    moveX: axis(['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']),
    moveZ: axis(['KeyW', 'ArrowUp'], ['KeyS', 'ArrowDown']), // screen-up is -z
    aim: aimPoint,
    firing: mouseDown || keys.has('Space'),
  };
}

// ---------------------------------------------------------------------------
// Setup after loading
// ---------------------------------------------------------------------------
async function init() {
  w.models = await loadModels(MODELS, (d, t) => { ui.text.textContent = `Loading models… ${d}/${t}`; });
  w.beacon = makeBeacon();
  w.player = new Player(w);
  w.enemies = new Enemies(w);
  w.pickups = new Pickups(w);
  w.waves = new WaveDirector(w);
  w.player.mesh.visible = false;
  game.state = 'title';
  showScreen(bestLine() + 'Click or press Enter to launch', CONTROLS);
}

function makeBeacon() {
  const mesh = cloneWithOwnMaterials(w.models['nav-beacon']);
  mesh.scale.setScalar(2.4);
  scene.add(mesh);
  // A glowing ring around the beacon doubles as its health display.
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x5ad1ff, toneMapped: false, transparent: true, opacity: 0.85 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(4.2, 0.18, 8, 64), ringMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.3;
  scene.add(ring);

  const healthy = new THREE.Color(0x5ad1ff);
  const hurt = new THREE.Color(0xff4fd8);
  return {
    mesh, ring, pos: mesh.position, radius: 3.2, hp: BEACON_HP, flash: 0,
    damage(n) {
      if (game.state !== 'playing') return;
      this.hp = Math.max(0, this.hp - n);
      this.flash = 1;
      w.feel.shake(0.35);
      w.sound.hurt();
      w.particles.burst(this.pos, { count: 14, color: 0x5ad1ff, speed: 12 });
      if (this.hp <= 0) {
        w.particles.burst(this.pos, { count: 120, color: 0x5ad1ff, speed: 30, size: 1.4, life: 1.4 });
        w.feel.shake(1);
        w.feel.hitStop(0.2);
        w.sound.bigExplode();
        this.mesh.visible = false;
        endRun('The beacon was destroyed');
      }
    },
    heal(n) { this.hp = Math.min(BEACON_HP, this.hp + n); },
    update(dt, t) {
      this.flash = Math.max(0, this.flash - dt * 5);
      setFlash(this.mesh, this.flash, 0xff4fd8);
      ringMat.color.copy(hurt).lerp(healthy, this.hp / BEACON_HP);
      this.ring.scale.setScalar(1 + Math.sin(t * 3) * 0.03 + this.flash * 0.15);
      this.mesh.rotation.y += dt * 0.4;
    },
    reset() { this.hp = BEACON_HP; this.mesh.visible = true; },
  };
}

// ---------------------------------------------------------------------------
// Game states
// ---------------------------------------------------------------------------
function startRun() {
  w.sound.start();
  w.enemies.clear();
  w.bullets.clear();
  w.pickups.clear();
  w.player.reset();
  w.beacon.reset();
  w.waves.reset();
  game.score = 0;
  game.reason = '';
  game.deadTimer = 0;
  game.state = 'playing';
  ui.hud.hidden = false;
  hideScreen();
}

function endRun(reason) {
  if (game.state !== 'playing') return;
  game.state = 'dying'; // keep simulating for a moment so the explosion plays out
  game.reason = reason;
  game.deadTimer = 0;
}

function showGameOver() {
  game.state = 'over';
  const wave = w.waves.wave;
  const isBest = game.score > game.best.score;
  if (isBest) {
    game.best = { score: game.score, wave };
    localStorage.setItem(BEST_KEY, JSON.stringify(game.best));
  }
  showScreen(`${game.reason}\n${isBest ? 'New best! ' : ''}Score ${game.score} · reached wave ${wave}`,
    `${bestLine()}Click or press <kbd>Enter</kbd> to launch again`);
}

function togglePause() {
  if (game.state === 'playing') { game.state = 'paused'; showScreen('Paused', 'Press <kbd>P</kbd> to resume'); }
  else if (game.state === 'paused') { game.state = 'playing'; hideScreen(); }
}

function loadBest() {
  try { return JSON.parse(localStorage.getItem(BEST_KEY)) ?? { score: 0, wave: 0 }; }
  catch { return { score: 0, wave: 0 }; }
}
function bestLine() {
  return game.best.score ? `Best: ${game.best.score} (wave ${game.best.wave})\n` : '';
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------
let elapsed = 0;

function update(dt, realDt) {
  elapsed += realDt;
  if (!w.beacon) return;
  w.beacon.update(dt, elapsed);

  const simulate = game.state === 'playing' || game.state === 'dying';
  if (simulate) {
    const input = readInput();
    w.player.update(dt, input, w);
    if (game.state === 'playing') w.waves.update(dt);
    w.enemies.update(dt);
    w.bullets.update(dt);
    w.pickups.update(dt);
    enemyBulletHits();
    if (!w.player.alive) endRun('Your ship was destroyed');
  }
  if (game.state === 'dying') {
    game.deadTimer += realDt;
    if (game.deadTimer > 1.6) showGameOver();
  }

  w.particles.update(dt);
  w.feel.update(realDt);
  updateCamera(realDt);
  updateHud();
}

// Enemy bullets against the player and the beacon (circle checks).
function enemyBulletHits() {
  for (const b of w.bullets.list) {
    if (!b.active || b.team !== 'enemy') continue;
    const p = b.mesh.position;
    if (w.player.alive && p.distanceTo(w.player.pos) < w.player.radius + b.radius) {
      w.bullets.kill(b);
      w.player.damage(1, w);
    } else if (p.distanceTo(w.beacon.pos) < w.beacon.radius + b.radius) {
      w.bullets.kill(b);
      w.beacon.damage(1);
    }
  }
}

// The camera looks down at an angle and drifts between the beacon and the player,
// so you can always see both. Shake is added on top as an offset.
const focus = new THREE.Vector3();
function updateCamera(dt) {
  const target = w.player?.alive && game.state !== 'title' ? w.player.pos : w.beacon.pos;
  const goal = new THREE.Vector3().copy(target).multiplyScalar(0.65);
  focus.lerp(goal, 1 - Math.exp(-3 * dt));
  camera.position.set(focus.x + w.feel.offsetX, 52, focus.z + 27 + w.feel.offsetZ);
  camera.lookAt(focus.x + w.feel.offsetX * 0.5, 0, focus.z + w.feel.offsetZ * 0.5);
}

function updateHud() {
  if (ui.hud.hidden || !w.player) return;
  ui.wave.textContent = w.waves.wave;
  ui.score.textContent = game.score;
  const hull = w.player.hull / MAX_HULL;
  const beacon = w.beacon.hp / BEACON_HP;
  ui.hull.style.transform = `scaleX(${Math.max(0, hull)})`;
  ui.beacon.style.transform = `scaleX(${beacon})`;
  ui.hull.classList.toggle('low', hull <= 0.34);
  ui.beacon.classList.toggle('low', beacon <= 0.3);
  ui.power.hidden = w.player.tripleShot <= 0;
  ui.powerTime.textContent = Math.ceil(w.player.tripleShot) + 's';
}

// ---------------------------------------------------------------------------
// Backdrop: a starfield (one Points object = one draw call for 3000 stars), soft nebula
// sprites, and the dashed arena boundary.
// ---------------------------------------------------------------------------
function buildBackdrop() {
  const count = 3000;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < count; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 520;
    positions[i * 3 + 1] = -20 - Math.random() * 80; // below the play plane: parallax as the camera moves
    positions[i * 3 + 2] = (Math.random() - 0.5) * 420;
    c.setHSL(0.55 + Math.random() * 0.2, 0.6, 0.6 + Math.random() * 0.4);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  scene.add(new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.9, vertexColors: true, toneMapped: false })));

  // Nebula: a radial gradient painted on a <canvas>, used as a texture on big sprites.
  const tex = new THREE.CanvasTexture(radialGradientCanvas());
  tex.colorSpace = THREE.SRGBColorSpace;
  const nebulae = [[0x6a2bd9, -90, -70, 200], [0x1f6fd1, 110, 30, 220], [0xd12b9b, -20, 80, 160]];
  for (const [color, x, z, size] of nebulae) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, color, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    sprite.position.set(x, -110, z);
    sprite.scale.set(size, size, 1);
    scene.add(sprite);
  }

  // Arena edge: a dashed circle.
  const pts = [];
  for (let i = 0; i <= 128; i++) {
    const a = (i / 128) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * ARENA_RADIUS, 0, Math.sin(a) * ARENA_RADIUS));
  }
  const edge = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineDashedMaterial({ color: 0x5ad1ff, dashSize: 2, gapSize: 2, transparent: true, opacity: 0.35 }));
  edge.computeLineDistances(); // dashed lines need this
  scene.add(edge);
}

function radialGradientCanvas() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return cv;
}

// ---------------------------------------------------------------------------
// Loop
// ---------------------------------------------------------------------------
const timer = new THREE.Timer();
timer.connect(document);
renderer.setAnimationLoop(() => {
  timer.update();
  const realDt = Math.min(Math.max(timer.getDelta(), 0), 0.1);
  const dt = game.state === 'paused' ? 0 : realDt * w.feel.timeScale;
  update(dt, game.state === 'paused' ? 0 : realDt);
  renderer.render(scene, camera);
});

Object.assign(window, { renderer, scene, game, w }); // for debugging and the smoke test

camera.position.set(0, 52, 27);
camera.lookAt(0, 0, 0);
init().catch((err) => {
  console.error(err);
  showScreen('Could not load the models.', String(err.message || err));
});
