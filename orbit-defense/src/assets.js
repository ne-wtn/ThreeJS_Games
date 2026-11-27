// Loading the Polyfork GLB models (same idea as Retro Rush, plus one new trick below).
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const loader = new GLTFLoader();
const modelUrl = (name) => new URL(`../models/${name}.glb`, import.meta.url).href;

export async function loadModels(names, onProgress = () => {}) {
  let done = 0;
  const entries = await Promise.all(
    names.map(async (name) => {
      const gltf = await loader.loadAsync(modelUrl(name));
      onProgress(++done, names.length);
      return [name, gltf.scene];
    }),
  );
  return Object.fromEntries(entries);
}

/**
 * Clone a model AND give the copy its own materials.
 *
 * LESSON: `object.clone()` shares materials with the original. Polyfork models even
 * share one material across most of the catalogue. If we flashed an enemy white by
 * changing its material, EVERY enemy would flash. Cloning the materials gives each
 * enemy its own copy to change. (Geometry stays shared: it never changes.)
 */
export function cloneWithOwnMaterials(template) {
  const copy = template.clone();
  const materials = [];
  copy.traverse((node) => {
    if (!node.isMesh) return;
    node.material = Array.isArray(node.material)
      ? node.material.map((m) => m.clone())
      : node.material.clone();
    materials.push(...[].concat(node.material));
  });
  copy.userData.materials = materials;
  return copy;
}

/** Make every material on an object glow (amount 0..1) for a hit flash. */
export function setFlash(object, amount, color = 0xffffff) {
  for (const m of object.userData.materials ?? []) {
    if (!m.emissive) continue;
    m.emissive.setHex(color);
    m.emissiveIntensity = amount;
  }
}
