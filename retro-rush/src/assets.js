// Loading the Polyfork GLB models.
//
// LESSON: loading is asynchronous. GLTFLoader fetches and parses the file in the
// background, so we `await` it. We load every model up front (with a progress
// count) so nothing pops in during play.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const loader = new GLTFLoader();

// `new URL(..., import.meta.url)` lets Vite find the files and copy them into the
// production build. A plain string like '/models/car.glb' would work in dev but
// Vite would not know to ship the file.
const modelUrl = (name) => new URL(`../models/${name}.glb`, import.meta.url).href;

/**
 * Loads every model in `names` and returns { name: THREE.Group }.
 * Each returned group is a "template": clone it to place copies in the world.
 */
export async function loadModels(names, onProgress = () => {}) {
  let done = 0;
  const entries = await Promise.all(
    names.map(async (name) => {
      const gltf = await loader.loadAsync(modelUrl(name));
      const root = gltf.scene;
      root.name = name;
      root.traverse((node) => {
        if (node.isMesh) {
          node.castShadow = true;    // shadows need this on every caster...
          node.receiveShadow = true; // ...and this on every receiver
        }
      });
      onProgress(++done, names.length);
      return [name, root];
    }),
  );
  return Object.fromEntries(entries);
}

/** Size of a model's bounding box in metres (Polyfork models are real-world scale). */
export function sizeOf(object) {
  return new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3());
}
