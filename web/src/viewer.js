import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { modelAssets, resolveModelAsset } from './assets.js';
import { createModelCache } from './model-cache.js';
import { clone as cloneScene } from 'three/addons/utils/SkeletonUtils.js';
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

const modelCache = createModelCache({dispose: releaseObject});
async function loadModel(url, onProgress) {
  const controller = new AbortController();
  let expired = false, timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      expired = true; controller.abort();
      reject(new Error('模型加载超时'));
    }, LOAD_TIMEOUT);
  });
  const work = (async () => {
    let source;
    try {
      const response = await fetch(url, {signal: controller.signal, cache: 'default'});
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}`);
        error.missing = response.status === 404;
        throw error;
      }
      const data = await response.arrayBuffer();
      onProgress?.('正在准备三维显示');
      const gltf = await new GLTFLoader().parseAsync(data, new URL('./', url).href);
      source = gltf.scene || gltf.scenes[0];
      if (!source) throw new Error('模型中没有场景');
      if (expired) throw new Error('模型加载超时');
      return source;
    } catch(error) {
      if(source) releaseObject(source);
      throw error;
    }
  })();
  // parseAsync is not abortable. Reject visibly on time, release any late scene.
  try {return await Promise.race([work, timeout]);}
  finally {clearTimeout(timer);}
}

let thumbnailRenderer = null;
globalThis.addEventListener?.('pagehide', () => {
  thumbnailRenderer?.dispose();
  thumbnailRenderer?.forceContextLoss();
  thumbnailRenderer = null;
});

/** Render the real model into a transparent card image, sharing detail-view loads. */
export async function renderModelThumbnail({ item, asset, assetBase }) {
  const absoluteUrl = new URL(asset.url || item.model || `models/${item.id}.glb`, assetBase);
  const key = asset.version ? absoluteUrl.href : `${absoluteUrl.href}#uncached-${Date.now()}-${Math.random()}`;
  const lease = await modelCache.acquire(key, asset.bytes, () => loadModel(absoluteUrl.href));
  if (!asset.version) modelCache.invalidate(key);
  let scene;
  try {
    if (thumbnailRenderer?.getContext().isContextLost()) {
      thumbnailRenderer.dispose(); thumbnailRenderer = null;
    }
    if (!thumbnailRenderer) {
      thumbnailRenderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true, powerPreference: 'low-power' });
      thumbnailRenderer.setPixelRatio(1);
      thumbnailRenderer.setSize(384, 384);
      thumbnailRenderer.setClearColor(0, 0);
      thumbnailRenderer.toneMapping = THREE.ACESFilmicToneMapping;
      thumbnailRenderer.toneMappingExposure = 1.15;
    }
    const renderer = thumbnailRenderer;
    const parsed = cloneScene(lease.value);
    parsed.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(parsed);
    const size = bounds.getSize(new THREE.Vector3()), center = bounds.getCenter(new THREE.Vector3());
    const maximum = Math.max(size.x, size.y, size.z);
    if (!Number.isFinite(maximum) || maximum <= 0) throw new Error('模型尺寸无效');
    const scale = 1.75 / maximum;
    const normalizer = new THREE.Group();
    normalizer.add(parsed);
    normalizer.scale.setScalar(scale);
    normalizer.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale);
    const pivot = new THREE.Group();
    pivot.add(normalizer);
    pivot.rotation.y = Number(asset.orientation) || 0;
    scene = new THREE.Scene();
    scene.add(pivot, new THREE.HemisphereLight('#fff7e7', '#bba88c', 2.3));
    const light = new THREE.DirectionalLight('#fff0da', 3.4);
    light.position.set(-3.5, 5, 4.5); scene.add(light);
    const fill = new THREE.DirectionalLight('#edf1f5', 1.5);
    fill.position.set(4, 2, -2); scene.add(fill);
    const camera = new THREE.PerspectiveCamera(30, 1, .1, 20);
    camera.position.set(0, 1.3, 4.25); camera.lookAt(0, .85, 0);
    renderer.render(scene, camera);
    const blob = await new Promise(resolve => renderer.domElement.toBlob(resolve, 'image/png'));
    if (!blob || renderer.getContext().isContextLost()) throw new Error('预览未能生成');
    return blob;
  } finally {
    // Geometry and textures belong to the shared model lease, not the snapshot.
    scene?.clear();
    thumbnailRenderer?.renderLists.dispose();
    lease.release();
  }
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
  } else if (id === 'vintage-toys') {
    const wood = new THREE.MeshStandardMaterial({ color: '#a8784e', roughness: 0.85 });
    const brass = new THREE.MeshStandardMaterial({ color: '#b89556', roughness: 0.55, metalness: 0.4 });
    add(new THREE.CylinderGeometry(1.12, 1.18, 0.16, 72), wood, 0, -0.12, 0);
    add(new THREE.CylinderGeometry(1.06, 1.06, 0.035, 72), paper, 0, -0.025, 0);
    add(new THREE.TorusGeometry(1.08, 0.015, 8, 72), brass, 0, -0.008, 0, Math.PI / 2);
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
  item, modelUrl, theme = {}, rotation = 0, reducedMotion = false, onRotation = () => {}, onStatus = () => {},
  assetBase = new URL('./', location.href).href,
  thumbnail = modelAssets[item.id]?.thumbnail,
  orientation = modelAssets[item.id]?.orientation || 0
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
      <button class="qiwu-viewer-front" type="button" title="拖动藏品或使用左右方向键旋转，Home 键回到正面">回到正面</button>
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
  let preview = null;
  let previewFailed = false;
  if (thumbnail) {
    preview = document.createElement('img');
    preview.className = 'qiwu-viewer-preview';
    preview.src = thumbnail;
    preview.alt = `${item.name}的预览`;
    preview.addEventListener('error', () => { previewFailed = true; preview.hidden = true; }, { once: true });
    element.prepend(preview);
  }
  element.querySelector('.qiwu-viewer-stage-label').textContent = '';
  element.querySelector('.qiwu-viewer-stage-label').hidden = true;
  let disposed = false;
  let token = 0;
  let model = null;
  let modelLease = null;
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
  let cameraInitialized = false;
  let contextLost = false;
  const events = new AbortController();

  function setStatus(kind, title, detail) {
    element.dataset.status = kind;
    status.hidden = kind === 'ready';
    statusTitle.textContent = title;
    statusDetail.textContent = detail;
    retryButton.hidden = !['error', 'missing'].includes(kind);
    retryButton.textContent = kind === 'missing' ? '检查模型更新' : '重新加载模型';
    controls.hidden = kind !== 'ready';
    if (preview) preview.hidden = kind === 'ready' || previewFailed;
    canvas.setAttribute('aria-busy', String(kind === 'loading'));
    canvas.tabIndex = kind === 'ready' ? 0 : -1;
    onStatus(kind);
  }

  function paint() {
    if (disposed || !renderer || !cameraInitialized || contextLost) return false;
    if (element.clientWidth < 1 || element.clientHeight < 1) return false;
    try {
      renderer.render(scene, camera);
      if (model && !ready && element.dataset.status === 'loading') {
        ready = true;
        canvas.setAttribute('aria-label', `${item.name}，拖动或左右方向键旋转`);
        if (!reducedMotion) element.classList.add('qiwu-viewer-arrived');
        // Consumers may begin their reveal only after an actual frame exists.
        setStatus('ready', '', '');
      }
      return true;
    } catch {
      ready = false;
      setStatus('error', '暂时无法显示藏品', '请重新加载，收藏状态不受影响。');
      return false;
    }
  }

  function render() {
    if (disposed || !renderer || !inView || frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (inView) paint();
    });
  }

  function resize() {
    if (!renderer || disposed) return;
    const width = element.clientWidth, height = element.clientHeight;
    if (width < 1 || height < 1) return;
    const ratio = renderer.getPixelRatio();
    const sizeChanged = canvas.width !== Math.floor(width * ratio) || canvas.height !== Math.floor(height * ratio);
    // Reassigning canvas dimensions clears WebGL, even when the size is unchanged.
    if (sizeChanged) renderer.setSize(width, height, false);
    // The initial DOM canvas size can already match its container. It still
    // needs a correctly positioned camera before its first frame is exposed.
    if (sizeChanged || !cameraInitialized) {
      camera.aspect = width / height;
      const distance = camera.aspect < 0.9 ? 5 / Math.max(camera.aspect, 0.6) : 5;
      camera.position.set(0, 1.8, distance);
      camera.lookAt(0, 0.65, 0);
      camera.updateProjectionMatrix();
      cameraInitialized = true;
    }
    paint();
  }

  function clearModel() {
    if (!model) return;
    scene.remove(model);
    modelLease?.release();
    modelLease = null;
    model = null;
    ready = false;
    element.classList.remove('qiwu-viewer-arrived');
  }

  function setRotation(value) {
    if (!Number.isFinite(value) || disposed) return;
    angle = value;
    if (model) model.rotation.y = angle + orientation;
    render();
  }

  function turn(delta) {
    if (!ready) return;
    setRotation(angle + delta);
    onRotation(angle);
  }

  function initRenderer() {
    if (contextLost) {
      setStatus('error', '三维显示暂时中断', '等待浏览器恢复后，可重新加载这件藏品。');
      return false;
    }
    if (renderer) return true;
    try {
      // Keep the last on-demand frame available to WebKit compositing/snapshots.
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true, powerPreference: 'low-power' });
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
      cameraInitialized = false;
      setStatus('error', '暂时无法显示 3D', '浏览器的三维显示尚未就绪。藏品结果和收藏不受影响。');
      return false;
    }
  }

  async function retry(initial = false) {
    if (disposed) return;
    const request = ++token;
    clearModel();
    setStatus('loading', '正在确认模型资源', '先显示预览，三维藏品准备好后自动出现。');
    render();
    let parsed = null;
    let lease = null;
    try {
      const asset = await resolveModelAsset(item.id, assetBase, modelUrl);
      if (disposed || request !== token) return;
      if (asset.available === false) {
        setStatus('missing', '模型待补齐', `${item.name} · 文件尚未提供，可稍后检查更新。`);
        return;
      }
      if (!initRenderer()) return;
      const absoluteUrl = new URL(asset.url || modelUrl, assetBase);
      setStatus('loading', '正在加载三维藏品', '首次查看需要准备模型，收藏状态已保留。');
      const key = asset.version ? absoluteUrl.href : `${absoluteUrl.href}#uncached-${Date.now()}-${Math.random()}`;
      lease = await modelCache.acquire(key, asset.bytes, () => loadModel(absoluteUrl.href, title => {
        if(!disposed && request === token) statusTitle.textContent = title;
      }));
      if (!asset.version) modelCache.invalidate(key);
      if (disposed || request !== token) { lease.release(); return; }
      parsed = cloneScene(lease.value);
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
      pivot.rotation.y = angle + orientation;
      parsed.traverse(child => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
      model = pivot;
      modelLease = lease;
      lease = null;
      parsed = null;
      scene.add(model);
      // A hidden viewer stays loading until it has a visible frame.
      resize();
    } catch (error) {
      lease?.release();
      if (disposed || request !== token) return;
      setStatus(error.missing ? 'missing' : 'error', error.missing ? '模型待补齐' : '暂时没能加载模型',
        error.missing ? `${item.name} · 文件尚未提供。` : '请重试；收藏状态不变，不会再次抽取或扣费。');
    }
  }

  retryButton.addEventListener('click', retry, { signal: events.signal });
  element.querySelectorAll('[data-turn]').forEach(button => {
    button.addEventListener('click', () => turn(Number(button.dataset.turn) * 15 * DEG), { signal: events.signal });
  });
  element.querySelector('.qiwu-viewer-front').addEventListener('click', () => {
    if (!ready) return;
    setRotation(0);
    onRotation(0);
  }, { signal: events.signal });
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
    contextLost = true;
    ready = false;
    if (!disposed) setStatus('error', '三维显示暂时中断', '等待浏览器恢复后，可重新加载这件藏品。');
  }, { signal: events.signal });
  canvas.addEventListener('webglcontextrestored', () => {
    contextLost = false;
    if (!disposed) retry();
  }, { signal: events.signal });
  resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(element);
  intersectionObserver = new IntersectionObserver(entries => {
    inView = entries[0]?.isIntersecting ?? true;
    if (inView) resize();
  });
  intersectionObserver.observe(element);
  void retry(true);

  return {
    retry, setRotation,
    getImage() {
      if (!ready || !paint()) return null;
      const exportRenderer = renderer;
      const originalRatio = exportRenderer.getPixelRatio();
      const originalSize = exportRenderer.getSize(new THREE.Vector2());
      const longestSide = Math.max(originalSize.x, originalSize.y);
      if (longestSide < 1) return null;
      const exportRatio = Math.max(originalRatio, 1200 / longestSide);
      try {
        // Render extra pixels for the photograph without changing the CSS size,
        // camera, or the user's chosen angle. This work is entirely synchronous.
        exportRenderer.setPixelRatio(exportRatio);
        exportRenderer.setSize(originalSize.x, originalSize.y, false);
        exportRenderer.render(scene, camera);
        if (exportRenderer.getContext().isContextLost()) return null;
        return canvas.toDataURL('image/png');
      } catch {
        return null;
      } finally {
        if (!disposed && renderer === exportRenderer) {
          try {
            exportRenderer.setPixelRatio(originalRatio);
            exportRenderer.setSize(originalSize.x, originalSize.y, false);
            // Resizing clears WebGL. Restore the visible frame before yielding.
            paint();
          } catch {
            ready = false;
            setStatus('error', '暂时无法显示藏品', '请重新加载，收藏状态不受影响。');
          }
        }
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      ++token;
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
