// The endless road, built as a "treadmill".
//
// LESSON: the player's car never actually moves forward. It stays at z = 0 and the
// WORLD slides towards the camera (+z). When a piece of road falls behind the camera
// we teleport it to the far end of the queue. A few dozen pieces make a road that
// never ends, and the numbers stay small (no floating-point drift after 50 km).
import * as THREE from 'three';

export const LANES = [-3.5, 0, 3.5]; // x position of each lane centre
const SEG_LEN = 8;                   // the street tile is 8 m long
const SEG_COUNT = 24;                // 24 x 8 m = 192 m of road
const BEHIND = 16;                   // how far behind the car a piece may go before recycling

export class Road {
  constructor(scene, models) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.segments = [];
    this.props = [];

    // Dashed lane markings: one shared geometry + material for every dash.
    // Sharing means hundreds of dashes cost almost nothing to create.
    const dashGeo = new THREE.BoxGeometry(0.16, 0.02, 3);
    const dashMat = new THREE.MeshStandardMaterial({ color: 0xfff3d6, emissive: 0x403020 });

    for (let i = 0; i < SEG_COUNT; i++) {
      const seg = new THREE.Group();

      // The two-lane tile is 8 m wide; stretching it 1.5x gives our three 4 m lanes.
      const tile = models['two-lane-street-tile'].clone();
      tile.scale.set(1.5, 1, 1);
      seg.add(tile);

      for (const x of [-1.75, 1.75]) {
        const dash = new THREE.Mesh(dashGeo, dashMat);
        dash.position.set(x, 0.01, 0);
        dash.receiveShadow = true;
        seg.add(dash);
      }

      // Guardrails run along the road, so turn them 90 degrees.
      for (const side of [-1, 1]) {
        for (const dz of [-2, 2]) {
          const rail = models.guardrail.clone();
          rail.rotation.y = Math.PI / 2;
          rail.position.set(side * 6.6, 0, dz);
          seg.add(rail);
        }
      }

      seg.position.z = BEHIND - i * SEG_LEN;
      this.group.add(seg);
      this.segments.push(seg);
    }

    // Roadside props: lamps, signs and junk, scattered on both sides.
    const kinds = ['street-lamp', 'gas-pump', 'diner-sign', 'motel-sign', 'phone-booth',
      'oil-drum', 'tire', 'traffic-cone', 'planter', 'street-lamp'];
    const PROP_COUNT = 34;
    this.propSpacing = (SEG_COUNT * SEG_LEN) / PROP_COUNT;
    for (let i = 0; i < PROP_COUNT; i++) {
      const kind = kinds[i % kinds.length];
      const prop = models[kind].clone();
      prop.userData.kind = kind;
      this.placeProp(prop, BEHIND - i * this.propSpacing);
      this.group.add(prop);
      this.props.push(prop);
    }

    // Ground: a big flat desert plane that never moves (it has no texture, so you
    // could not tell if it did). Plus a few distant mesas for depth.
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(600, 600),
      new THREE.MeshStandardMaterial({ color: 0xd99a6c, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.06;
    ground.receiveShadow = true;
    scene.add(ground);

    const mesaMat = new THREE.MeshStandardMaterial({ color: 0xb8664f, flatShading: true });
    const rng = mulberry32(7); // seeded, so the skyline is the same every time
    for (let i = 0; i < 14; i++) {
      const h = 10 + rng() * 25;
      const mesa = new THREE.Mesh(new THREE.CylinderGeometry(6 + rng() * 10, 14 + rng() * 14, h, 6), mesaMat);
      const side = i % 2 ? 1 : -1;
      mesa.position.set(side * (45 + rng() * 80), h / 2 - 0.1, -120 - rng() * 120);
      mesa.rotation.y = rng() * Math.PI;
      scene.add(mesa);
    }
  }

  placeProp(prop, z) {
    const side = Math.random() < 0.5 ? -1 : 1;
    const kind = prop.userData.kind;
    // Lamps hug the guardrail and lean over the road; everything else sits further out.
    const x = kind === 'street-lamp' ? side * 7.6 : side * (8.5 + Math.random() * 6);
    prop.position.set(x, 0, z);
    if (kind === 'street-lamp') prop.rotation.y = side > 0 ? Math.PI : 0; // arm reaches over the road
    else if (kind.endsWith('-sign')) prop.rotation.y = side * -0.35; // angled to face the driver
    else prop.rotation.y = Math.random() * Math.PI * 2;
  }

  /** Slide everything towards the camera by `dz` metres and recycle what falls behind. */
  update(dz) {
    const total = SEG_COUNT * SEG_LEN;
    for (const seg of this.segments) {
      seg.position.z += dz;
      if (seg.position.z > BEHIND) seg.position.z -= total;
    }
    for (const prop of this.props) {
      prop.position.z += dz;
      if (prop.position.z > BEHIND) this.placeProp(prop, prop.position.z - total);
    }
  }
}

/** Small seeded random number generator: same seed, same sequence. */
export function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
