// 展示场景：只包含展台、接影地面和棚拍灯光，不改变手办本身。
import * as THREE from 'three';

export function createDisplayStage(scene) {
  const stage = new THREE.Group();
  stage.name = 'collection-display-stage';
  const bodyMaterial = new THREE.MeshStandardMaterial({ color: '#e1e7d5', roughness: .84 });
  const topMaterial = new THREE.MeshStandardMaterial({ color: '#fff9ee', roughness: .94 });
  const rimMaterial = new THREE.MeshStandardMaterial({ color: '#c6d4af', roughness: .7 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(.90, .96, .16, 96), bodyMaterial);
  body.position.y = -.10;
  body.castShadow = true;
  body.receiveShadow = true;
  const top = new THREE.Mesh(new THREE.CylinderGeometry(.90, .90, .04, 96), topMaterial);
  top.position.y = -.02;
  top.castShadow = true;
  top.receiveShadow = true;
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(.88, .91, .035, 96), bodyMaterial);
  foot.position.y = -.197;
  foot.castShadow = true;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(.893, .009, 8, 96), rimMaterial);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = .003;
  stage.add(body, top, foot, rim);
  scene.add(stage);

  // 透明接影地面保留后面的插画场景，同时让模型与展台真正落地。
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.ShadowMaterial({ opacity: .12 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -.216;
  floor.receiveShadow = true;
  scene.add(floor);
  const ambient = new THREE.AmbientLight('#fff9ed', .65);
  const sky = new THREE.HemisphereLight('#fffdf4', '#c9d6ba', 1.25);
  const key = new THREE.DirectionalLight('#fff6e7', 2.1);
  key.position.set(-3, 5, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -3;
  key.shadow.camera.right = 3;
  key.shadow.camera.top = 3;
  key.shadow.camera.bottom = -3;
  key.shadow.camera.near = .5;
  key.shadow.camera.far = 14;
  key.shadow.bias = -.0004;
  key.shadow.normalBias = .02;
  const fill = new THREE.DirectionalLight('#eaf3e3', .7);
  fill.position.set(3, 2, -2);
  scene.add(ambient, sky, key, fill);

  return {
    setTheme(theme, rarityColor) {
      bodyMaterial.color.set(theme.tone).lerp(new THREE.Color('#f7f9ef'), .35);
      rimMaterial.color.set(rarityColor).lerp(new THREE.Color('#e7eddb'), .7);
    },
    prepareFigure(figure) {
      figure.traverse(object => { if (object.isMesh) object.castShadow = true; });
    },
  };
}
