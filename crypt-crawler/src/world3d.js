// Turning the dungeon DATA into 3D: floors, walls, props, loot, torches, stairs.
//
// LESSONS:
//  1. INSTANCING A GLB. A floor can need ~600 floor tiles and ~700 wall pieces. As
//     separate meshes that's over a thousand draw calls. InstancedModel (below) turns
//     each mesh inside a GLB into one THREE.InstancedMesh, so ALL the walls cost a
//     couple of draw calls.
//  2. FOG OF WAR. Nothing is drawn until you have seen it. Cells you have seen before
//     but can't see right now are drawn darker, using per-instance colour
//     (setColorAt), which multiplies the material's colour.
//  3. CUTAWAY WALLS. The camera looks from the south, so south walls would hide the
//     player. They're drawn as low stubs: a classic trick in isometric-style games.
import * as THREE from 'three';
import { FLOOR, WALL } from './dungeon.js';

export const TILE = 2; // metres per grid cell (the flagstone tile is 2 x 2 m)
const SEEN_TINT = new THREE.Color(0.32, 0.3, 0.38); // remembered but not in view
const LIT_TINT = new THREE.Color(1, 1, 1);

export const cellToWorld = (x, y, out = new THREE.Vector3()) => out.set(x * TILE, 0, y * TILE);

/** Every mesh inside `template` becomes one InstancedMesh with room for `capacity` copies. */
class InstancedModel {
  constructor(template, capacity, parent) {
    template.updateMatrixWorld(true);
    this.count = 0;
    this.parts = [];
    this.tmp = new THREE.Matrix4();
    template.traverse((node) => {
      if (!node.isMesh) return;
      const mesh = new THREE.InstancedMesh(node.geometry, node.material, Math.max(1, capacity));
      mesh.count = 0;            // draw nothing until cells are revealed
      mesh.frustumCulled = false; // instances are spread out; the default bounds are wrong
      for (let i = 0; i < capacity; i++) mesh.setColorAt(i, LIT_TINT); // create the colour buffer up front
      parent.add(mesh);
      this.parts.push({ mesh, local: node.matrixWorld.clone() }); // the mesh's offset inside the model
    });
  }

  /** Add one copy placed by `matrix`. Returns its index. */
  add(matrix) {
    const i = this.count++;
    for (const { mesh, local } of this.parts) {
      mesh.setMatrixAt(i, this.tmp.multiplyMatrices(matrix, local));
      mesh.count = this.count;
      mesh.instanceMatrix.needsUpdate = true;
    }
    return i;
  }

  tint(i, color) {
    for (const { mesh } of this.parts) mesh.setColorAt(i, color);
  }

  flushColors() {
    for (const { mesh } of this.parts) if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  dispose() {
    for (const { mesh } of this.parts) {
      mesh.removeFromParent();
      mesh.dispose(); // frees the instance buffers; geometry/material belong to the template
    }
  }
}

const matrixFor = (x, z, rotY = 0, sx = 1, sy = 1, sz = 1) => new THREE.Matrix4().compose(
  new THREE.Vector3(x, 0, z),
  new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY),
  new THREE.Vector3(sx, sy, sz),
);

export class FloorView {
  constructor(scene, models, floor) {
    this.scene = scene;
    this.floor = floor;
    this.group = new THREE.Group();
    scene.add(this.group);

    const W = floor.width;
    const idx = (x, y) => y * W + x;
    const isWall = (x, y) => floor.grid[idx(x, y)] === WALL;
    const stairsCell = idx(floor.stairs.x, floor.stairs.y);

    // --- Work out every instance first (so we know the capacities), grouped by cell.
    this.pending = new Map(); // cell -> [{ model: 'floor'|'wall'|'low', matrix }]
    const queue = (cell, model, matrix) => {
      if (!this.pending.has(cell)) this.pending.set(cell, []);
      this.pending.get(cell).push({ model, matrix });
    };
    const counts = { floor: 0, wall: 0, low: 0 };
    const h = TILE / 2;
    for (let y = 0; y < floor.height; y++) {
      for (let x = 0; x < W; x++) {
        if (floor.grid[idx(x, y)] !== FLOOR) continue;
        const cell = idx(x, y);
        const cx = x * TILE, cz = y * TILE;
        if (cell !== stairsCell) { queue(cell, 'floor', matrixFor(cx, cz)); counts.floor++; }
        // A wall panel on each side of this floor cell that touches rock.
        if (isWall(x, y - 1)) { queue(cell, 'wall', matrixFor(cx, cz - h, 0)); counts.wall++; }
        if (isWall(x - 1, y)) { queue(cell, 'wall', matrixFor(cx - h, cz, Math.PI / 2)); counts.wall++; }
        if (isWall(x + 1, y)) { queue(cell, 'wall', matrixFor(cx + h, cz, -Math.PI / 2)); counts.wall++; }
        if (isWall(x, y + 1)) { queue(cell, 'low', matrixFor(cx, cz + h, Math.PI, 1, 0.18, 1)); counts.low++; }
      }
    }
    this.models = {
      floor: new InstancedModel(models['flagstone-floor-tile'].scene, counts.floor, this.group),
      wall: new InstancedModel(models['dungeon-wall-module'].scene, counts.wall, this.group),
      low: new InstancedModel(models['dungeon-wall-module'].scene, counts.low, this.group),
    };
    this.revealedInstances = []; // { model, index, cell }

    // --- Individual objects (few enough to be normal meshes), hidden until seen.
    this.cellObjects = new Map(); // cell -> [Object3D]
    this.items = new Map();       // cell -> Object3D, so pickups can remove them
    this.mixers = [];
    const addObject = (cell, obj) => {
      obj.visible = false;
      this.group.add(obj);
      if (!this.cellObjects.has(cell)) this.cellObjects.set(cell, []);
      this.cellObjects.get(cell).push(obj);
      return obj;
    };
    const PROP_SCALE = { 'oak-barrel': 1.3, 'timber-crate': 1.3, 'clay-storage-pot': 1.8, 'standing-brazier': 1.0 };
    for (const p of floor.props) {
      const obj = models[p.kind].scene.clone();
      obj.scale.setScalar(PROP_SCALE[p.kind]);
      cellToWorld(p.x, p.y, obj.position);
      obj.rotation.y = p.rot;
      addObject(idx(p.x, p.y), obj);
    }
    for (const d of floor.decor) {
      const obj = models[d.kind].scene.clone();
      obj.scale.setScalar(d.kind === 'mushroom-cluster' ? 1.8 : 1.2);
      obj.position.set((d.x + d.ox * 0.7) * TILE, 0.04, (d.y + d.oy * 0.7) * TILE);
      obj.rotation.y = d.rot;
      addObject(idx(d.x, d.y), obj);
    }
    const ITEM_MODEL = { gold: ['spilled-coin-pile', 2.6], potion: ['potion-bottle', 4.5], strongbox: ['iron-banded-strongbox', 1.2] };
    for (const it of floor.items) {
      const [name, scale] = ITEM_MODEL[it.kind];
      const obj = models[name].scene.clone();
      obj.scale.setScalar(scale);
      cellToWorld(it.x, it.y, obj.position);
      obj.position.y = 0.05;
      obj.rotation.y = (it.x * 7 + it.y * 3) % 6;
      this.items.set(idx(it.x, it.y), addObject(idx(it.x, it.y), obj));
    }
    for (const t of floor.torches) {
      // The torch model sits 2.1 m up a wall; push it onto the face of the north wall.
      const obj = models['wall-torch-bracket'].scene.clone();
      obj.position.set(t.x * TILE, -0.2, t.y * TILE - h + 0.25);
      addObject(idx(t.x, t.y), obj);
      const clip = models['wall-torch-bracket'].animations[0];
      if (clip) {
        const mixer = new THREE.AnimationMixer(obj);
        mixer.clipAction(clip).play();
        mixer.setTime(Math.random() * clip.duration); // out of step, so they don't flicker in unison
        this.mixers.push(mixer);
      }
    }
    // Stairs down: a trapdoor shaft sunk into the floor, with a cold light so it stands out.
    const shaft = models['trapdoor-pit'].scene.clone();
    cellToWorld(floor.stairs.x, floor.stairs.y, shaft.position);
    shaft.position.y = -2.85;
    addObject(stairsCell, shaft);
    // Lights are never hidden: changing how many lights a scene has makes three.js
    // recompile every material (a visible hitch). We keep it and switch its intensity.
    this.stairsCell = stairsCell;
    this.stairsLight = new THREE.PointLight(0x7fb8ff, 0, 9, 1.5);
    cellToWorld(floor.stairs.x, floor.stairs.y, this.stairsLight.position).y = 1.5;
    this.group.add(this.stairsLight);

    this.revealed = new Uint8Array(floor.width * floor.height);
  }

  /** Call after every turn with the explored and currently visible cell masks. */
  updateVisibility(explored, visible) {
    // Reveal newly explored cells: add their instances and show their objects.
    for (let cell = 0; cell < explored.length; cell++) {
      if (!explored[cell] || this.revealed[cell]) continue;
      this.revealed[cell] = 1;
      for (const { model, matrix } of this.pending.get(cell) ?? []) {
        const index = this.models[model].add(matrix);
        this.revealedInstances.push({ model, index, cell });
      }
      for (const obj of this.cellObjects.get(cell) ?? []) obj.visible = true;
      if (cell === this.stairsCell) this.stairsLight.intensity = 30;
    }
    // Tint: bright if in view, dim if only remembered.
    for (const r of this.revealedInstances) {
      this.models[r.model].tint(r.index, visible[r.cell] ? LIT_TINT : SEEN_TINT);
    }
    for (const m of Object.values(this.models)) m.flushColors();
  }

  removeItem(cell) {
    const obj = this.items.get(cell);
    if (!obj) return;
    obj.removeFromParent();
    this.items.delete(cell);
  }

  update(dt) {
    for (const m of this.mixers) m.update(dt);
  }

  dispose() {
    for (const m of Object.values(this.models)) m.dispose();
    this.group.removeFromParent();
  }
}
