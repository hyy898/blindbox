import * as THREE from 'three';

/** Distinct procedural figure per item id (shape + color combo). Rarity tint on accent. */
const SHAPES = ['box', 'sphere', 'cone', 'cylinder', 'torus', 'octa', 'capsule'];

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function makePlaceholder(item, rarityColor) {
  const h = hash(item.id);
  const shape = SHAPES[h % SHAPES.length];
  const hue = ((h >>> 8) % 360) / 360;
  const bodyColor = new THREE.Color().setHSL(hue, 0.55, 0.55);
  const accent = new THREE.Color(rarityColor || '#ffffff');

  const group = new THREE.Group();
  group.name = 'placeholder-' + item.id;

  const mat = new THREE.MeshStandardMaterial({
    color: bodyColor, roughness: 0.35, metalness: 0.15
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: accent, roughness: 0.4, metalness: 0.4, emissive: accent, emissiveIntensity: 0.15
  });

  let geo;
  switch (shape) {
    case 'sphere': geo = new THREE.SphereGeometry(0.45, 24, 16); break;
    case 'cone': geo = new THREE.ConeGeometry(0.4, 0.9, 16); break;
    case 'cylinder': geo = new THREE.CylinderGeometry(0.35, 0.35, 0.85, 16); break;
    case 'torus': geo = new THREE.TorusGeometry(0.32, 0.14, 12, 24); break;
    case 'octa': geo = new THREE.OctahedronGeometry(0.5); break;
    case 'capsule': geo = new THREE.CapsuleGeometry(0.28, 0.45, 6, 12); break;
    default: geo = new THREE.BoxGeometry(0.7, 0.7, 0.7);
  }
  const body = new THREE.Mesh(geo, mat);
  body.position.y = 0.55;
  group.add(body);

  // Head / accent ball
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), accentMat);
  head.position.y = 1.15;
  group.add(head);

  // Eyes
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
  const e1 = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), eyeMat);
  const e2 = e1.clone();
  e1.position.set(-0.08, 1.18, 0.18);
  e2.position.set(0.08, 1.18, 0.18);
  group.add(e1, e2);

  // Base pedestal
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.4, 0.45, 0.12, 24),
    new THREE.MeshStandardMaterial({ color: 0x333344, roughness: 0.6, metalness: 0.2 })
  );
  base.position.y = 0.06;
  group.add(base);

  // Soft rarity glow ring
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.5, 0.03, 8, 32),
    new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.7 })
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.08;
  group.add(ring);

  group.userData = { itemId: item.id, isPlaceholder: true };
  return group;
}
