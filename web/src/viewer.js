import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import './viewer.css';

const LOAD_TIMEOUT = 25000;
const DEG = Math.PI / 180;

function releaseObject(object) {
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  object.traverse(child => {
    if (child.geometry) geometries.add(child.geometry);
    child.shadow?.map?.dispose();
    for (const material of Array.isArray(child.material) ? child.material : [child.material]) {
      if (!material) continue;
      materials.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    }
  });
  textures.forEach(texture => {
    texture.dispose();
    const source = texture.source?.data;
    if (typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap) source.close();
  });
  materials.forEach(material => material.dispose());
  geometries.forEach(geometry => geometry.dispose());
}

function addStage(scene, theme) {
  const stage = new THREE.Group();
  stage.name = 'packaging-display-stage';
  const paper = new THREE.MeshStandardMaterial({ color: theme.paper || '#eee4d3', roughness: 0.9 });
  const accent = new THREE.MeshStandardMaterial({ color: theme.accent || '#733438', roughness: 0.7 });
  const porcelain = new THREE.MeshStandardMaterial({ color: '#fff8e9', roughness: 0.38 });
  const add = (geometry, material, x, y, z, rx = 0) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.rotation.x = rx;
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    stage.add(mesh);
    return mesh;
  };
  const id = theme.id || '';
  if (id === 'midnight-snack') {
    add(new THREE.CylinderGeometry(1.12, 1.16, 0.12, 72), paper, 0, -0.14, 0);
    add(new THREE.CylinderGeometry(1.02, 1.04, 0.065, 72), porcelain, 0, -0.045, 0);
    add(new THREE.TorusGeometry(0.99, 0.014, 8, 72), accent, 0, -0.003, 0, Math.PI / 2);
    const chopstick = new THREE.BoxGeometry(0.025, 0.025, 1.08);
    for (const x of [1.19, 1.27]) add(chopstick, accent, x, -0.11, 0.05);
  } else if (id === 'working-animals') {
    add(new THREE.BoxGeometry(2.35, 0.13, 1.75), paper, 0, -0.09, 0);
    add(new THREE.BoxGeometry(1.85, 0.015, 1.28), porcelain, 0, -0.012, 0.05);
    add(new THREE.BoxGeometry(0.5, 0.2, 0.04), accent, -0.76, 0.08, -0.72);
  } else if (id === 'milk-frog') {
    const water = new THREE.MeshStandardMaterial({ color: '#b7c7b2', roughness: 0.3, metalness: 0.08 });
    add(new THREE.CylinderGeometry(1.14, 1.19, 0.14, 72), paper, 0, -0.12, 0);
    add(new THREE.CylinderGeometry(1.07, 1.07, 0.02, 72), water, 0, -0.036, 0);
    for (const radius of [0.85, 1.02]) {
      add(new THREE.TorusGeometry(radius, 0.007, 5, 72), porcelain, 0, -0.019, 0, Math.PI / 2);
    }
    add(new THREE.CylinderGeometry(0.57, 0.57, 0.02, 48, 1, false, 0.16, Math.PI * 1.88), accent, 0, -0.01, 0);
  } else {
    add(new THREE.BoxGeometry(2.15, 0.16, 1.8), paper, 0, -0.11, 0);
    add(new THREE.BoxGeometry(1.94, 0.025, 1.58), porcelain, 0, -0.018, 0);
    add(new THREE.BoxGeometry(2.14, 0.045, 0.045), accent, 0, -0.06, 0.9);
  }
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(24, 24), new THREE.ShadowMaterial({ opacity: 0.12 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.235;
  floor.receiveShadow = true;
  scene.add(stage, floor);
  return stage;
}

/** A display-only viewer. Loading/retrying never calls the game or changes inventory. */
export async function createViewer(container, {
  item, modelUrl, theme = {}, rotation = 0, reducedMotion = false, onRotation = () => {}
}) {
  const element = document.createElement('div');
  element.className = 'qiwu-viewer';
  element.dataset.reducedMotion = String(reducedMotion);
  element.setAttribute('role', 'group');
  element.setAttribute('aria-label', `${item.name}的藏品展示`);
  element.style.setProperty('--viewer-accent', theme.accent || '#733438');
  element.innerHTML = `
    <canvas class="qiwu-viewer-canvas" tabindex="0" role="img"></canvas>
    <div class="qiwu-viewer-status" role="status" aria-live="polite">
      <span class="qiwu-viewer-status-mark" aria-hidden="true"></span>
      <strong class="qiwu-viewer-status-title"></strong>
      <span class="qiwu-viewer-status-detail"></span>
      <button class="qiwu-viewer-retry" type="button" hidden>重新加载模型</button>
    </div>
    <span class="qiwu-viewer-stage-label"></span>
    <div class="qiwu-viewer-controls" hidden>
      <button class="qiwu-viewer-turn" type="button" data-turn="-1" aria-label="向左转动藏品">↶</button>
      <span>拖动查看 · 方向键旋转</span>
      <button class="qiwu-viewer-turn" type="button" data-turn="1" aria-label="向右转动藏品">↷</button>
    </div>`;
  container.appendChild(element);
  const canvas = element.querySelector('canvas');
  canvas.setAttribute('aria-label', `${item.name}的三维展台，左右方向键旋转`);
  const status = element.querySelector('.qiwu-viewer-status');
  const statusTitle = element.querySelector('.qiwu-viewer-status-title');
  const statusDetail = element.querySelector('.qiwu-viewer-status-detail');
  const retryButton = element.querySelector('.qiwu-viewer-retry');
  const controls = element.querySelector('.qiwu-viewer-controls');
  element.querySelector('.qiwu-viewer-stage-label').textContent = theme.stage || theme.label || '奇物展台';
  let disposed = false;
  let token = 0;
  let controller = null;
  let timeout = 0;
  let model = null;
  let renderer = null;
  let frame = 0;
  let resizeObserver = null;
  let intersectionObserver = null;
  let inView = true;
  let angle = Number.isFinite(rotation) ? rotation : 0;
  let drag = null;
  let scene = null;
  let camera = null;
  let ready = false;
  const events = new AbortController();

  function setStatus(kind, title, detail) {
    element.dataset.status = kind;
    status.hidden = kind === 'ready';
    statusTitle.textContent = title;
    statusDetail.textContent = detail;
    retryButton.hidden = kind !== 'error';
    controls.hidden = kind !== 'ready';
    canvas.setAttribute('aria-busy', String(kind === 'loading'));
  }

  function render() {
    if (disposed || !renderer || !inView || frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (!disposed && renderer && inView) renderer.render(scene, camera);
    });
  }

  function resize() {
    if (!renderer || disposed) return;
    const width = Math.max(1, element.clientWidth);
    const height = Math.max(1, element.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    // The full display fits narrow collection cards as well as the large reveal.
    const distance = camera.aspect < 0.9 ? 5 / Math.max(camera.aspect, 0.6) : 5;
    camera.position.set(0, 1.8, distance);
    camera.lookAt(0, 0.65, 0);
    camera.updateProjectionMatrix();
    render();
  }

  function clearModel() {
    if (!model) return;
    scene.remove(model);
    releaseObject(model);
    model = null;
    ready = false;
  }

  function setRotation(value) {
    if (!Number.isFinite(value) || disposed) return;
    angle = value;
    if (model) model.rotation.y = angle;
    render();
  }

  function turn(delta) {
    if (!ready) return;
    setRotation(angle + delta);
    onRotation(angle);
  }

  function initRenderer() {
    if (renderer) return true;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
      renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.75));
      renderer.setClearColor(0, 0);
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.15;
      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(34, 1, 0.1, 60);
      scene.add(new THREE.HemisphereLight('#fff8e9', '#c1ae91', 2.3));
      const key = new THREE.DirectionalLight('#fff1d6', 3.4);
      key.position.set(-3.5, 5, 4.5);
      key.castShadow = true;
      key.shadow.mapSize.set(512, 512);
      key.shadow.camera.left = key.shadow.camera.bottom = -2.5;
      key.shadow.camera.right = key.shadow.camera.top = 2.5;
      key.shadow.camera.near = 0.5;
      key.shadow.camera.far = 14;
      key.shadow.normalBias = 0.025;
      scene.add(key);
      const fill = new THREE.DirectionalLight('#e4e9ef', 1.5);
      fill.position.set(4, 2, -2);
      scene.add(fill);
      addStage(scene, theme);
      resize();
      return true;
    } catch {
      if (scene) releaseObject(scene);
      renderer?.dispose();
      renderer = null;
      setStatus('error', '暂时无法显示 3D', '浏览器的三维显示尚未就绪。藏品结果和收藏不受影响。');
      return false;
    }
  }

  async function retry() {
    if (disposed) return;
    const request = ++token;
    controller?.abort();
    clearTimeout(timeout);
    clearModel();
    setStatus('loading', '正在取出这件奇物', '模型加载中，抽取结果已保留。');
    render();
    if (!initRenderer()) return;
    if (!modelUrl) {
      setStatus('error', '这件奇物的模型尚未到店', `${item.name} · ${item.id}，当前没有可用的模型文件。`);
      return;
    }
    const abort = new AbortController();
    controller = abort;
    let timedOut = false;
    let parsed = null;
    timeout = setTimeout(() => {
      if (disposed || request !== token) return;
      timedOut = true;
      abort.abort();
      ++token;
      setStatus('error', '模型加载超时', '可以重新加载同一件藏品，不会再次抽取或扣费。');
    }, LOAD_TIMEOUT);
    try {
      const absoluteUrl = new URL(modelUrl, location.href);
      const response = await fetch(absoluteUrl, { signal: abort.signal, cache: 'no-cache' });
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}`);
        error.missing = response.status === 404;
        throw error;
      }
      const data = await response.arrayBuffer();
      if (disposed || request !== token) return;
      const loader = new GLTFLoader();
      const gltf = await loader.parseAsync(data, new URL('./', absoluteUrl).href);
      parsed = gltf.scene || gltf.scenes[0];
      if (!parsed) throw new Error('模型中没有场景');
      if (disposed || request !== token) {
        releaseObject(parsed);
        return;
      }
      parsed.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(parsed);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const maximum = Math.max(size.x, size.y, size.z);
      if (!Number.isFinite(maximum) || maximum <= 0) throw new Error('模型尺寸无效');
      const scale = 1.65 / maximum;
      const normalizer = new THREE.Group();
      normalizer.add(parsed);
      normalizer.scale.setScalar(scale);
      normalizer.position.set(-center.x * scale, -box.min.y * scale + 0.012, -center.z * scale);
      const pivot = new THREE.Group();
      pivot.name = `collectible-${item.id}`;
      pivot.userData = { itemId: item.id, modelUrl: absoluteUrl.href, isPlaceholder: false };
      pivot.add(normalizer);
      pivot.rotation.y = angle;
      parsed.traverse(child => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
      model = pivot;
      parsed = null;
      scene.add(model);
      ready = true;
      setStatus('ready', '', '');
      canvas.setAttribute('aria-label', `${item.name}的真实三维模型，拖动或左右方向键旋转`);
      if (!reducedMotion) element.classList.add('qiwu-viewer-arrived');
      render();
    } catch (error) {
      if (parsed) releaseObject(parsed);
      if (disposed || request !== token || timedOut) return;
      setStatus('error', error.missing ? '这件奇物的模型尚未到店' : '暂时没能加载模型',
        `${item.name} · ${item.id}。${error.missing ? '团队模型文件待补齐；' : ''}重新加载会保留同一次抽取结果。`);
    } finally {
      if (request === token) clearTimeout(timeout);
    }
  }

  retryButton.addEventListener('click', retry, { signal: events.signal });
  element.querySelectorAll('[data-turn]').forEach(button => {
    button.addEventListener('click', () => turn(Number(button.dataset.turn) * 15 * DEG), { signal: events.signal });
  });
  canvas.addEventListener('keydown', event => {
    if (!ready || !['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Home') { setRotation(0); onRotation(0); }
    else turn((event.key === 'ArrowLeft' ? -1 : 1) * 10 * DEG);
  }, { signal: events.signal });
  canvas.addEventListener('pointerdown', event => {
    if (!ready || (event.pointerType === 'mouse' && event.button !== 0)) return;
    drag = { id: event.pointerId, x: event.clientX };
    canvas.setPointerCapture(event.pointerId);
    canvas.classList.add('is-dragging');
  }, { signal: events.signal });
  canvas.addEventListener('pointermove', event => {
    if (!drag || drag.id !== event.pointerId) return;
    setRotation(angle + (event.clientX - drag.x) * 0.009);
    drag.x = event.clientX;
  }, { signal: events.signal });
  const finishDrag = event => {
    if (!drag || drag.id !== event.pointerId) return;
    drag = null;
    canvas.classList.remove('is-dragging');
    onRotation(angle);
  };
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    canvas.addEventListener(type, finishDrag, { signal: events.signal });
  }
  canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault();
    if (!disposed) setStatus('error', '三维显示暂时中断', '重新加载即可继续查看这件藏品。');
  }, { signal: events.signal });
  canvas.addEventListener('webglcontextrestored', () => {
    if (!disposed) retry();
  }, { signal: events.signal });
  resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(element);
  intersectionObserver = new IntersectionObserver(entries => {
    inView = entries[0]?.isIntersecting ?? true;
    if (inView) render();
  });
  intersectionObserver.observe(element);
  void retry();

  return {
    retry, setRotation,
    dispose() {
      if (disposed) return;
      disposed = true;
      ++token;
      controller?.abort();
      clearTimeout(timeout);
      cancelAnimationFrame(frame);
      events.abort();
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      clearModel();
      if (scene) releaseObject(scene);
      renderer?.dispose();
      renderer?.forceContextLoss();
      renderer = null;
      element.remove();
    }
  };
}
