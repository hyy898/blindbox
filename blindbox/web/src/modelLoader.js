/**
 * GLB loader module.
 * Expected naming: models/<itemId>.glb  (e.g. models/ms-01.glb)
 * Or set item.model (from /api/config) to another URL under models/.
 * If file missing / load fails → caller falls back to placeholder.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const TARGET_SIZE = 1.4;
const loader = new GLTFLoader();
const cache = new Map();
const missing = new Set();

export function modelPathFor(item, convention) {
  if (item.model) return item.model;
  const pat = (convention && convention.pathPattern) || 'models/<id>.glb';
  return pat.replace('<id>', item.id);
}

export function normalizeModel(root, targetSize = TARGET_SIZE) {
  const box = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3();
  box.getSize(size);
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const scale = targetSize / maxDim;
  root.scale.setScalar(scale);
  const box2 = new THREE.Box3().setFromObject(root);
  const center = new THREE.Vector3();
  box2.getCenter(center);
  root.position.x -= center.x;
  root.position.z -= center.z;
  root.position.y -= box2.min.y;
  return root;
}

export async function loadFigure(item, convention) {
  const path = modelPathFor(item, convention);
  if (!path) return null;
  if (missing.has(path)) return null;
  if (cache.has(path)) return cache.get(path).clone(true);
  try {
    const gltf = await new Promise((resolve, reject) => {
      loader.load(path, resolve, undefined, reject);
    });
    const root = gltf.scene || gltf.scenes[0];
    normalizeModel(root);
    root.userData = { itemId: item.id, isPlaceholder: false, modelPath: path };
    cache.set(path, root);
    return root.clone(true);
  } catch {
    missing.add(path);
    return null;
  }
}
