/**
 * 全屏 3D 展示界面：按稀有度换背景色，拖动旋转。
 * 两种模式：
 *   mode 'new'  —— 新开出的 / 从仓库打开的：[放进展柜] [放入仓库] [卖掉]；点空白处 = 放入仓库
 *   mode 'case' —— 从展柜点开的：只有 [放入仓库]（展柜里的不能卖）；点空白处 = 关闭
 * 点空白处回调 onBlank(mode)。
 */
import * as THREE from 'three';
import { makePlaceholder } from './placeholder.js';
import { loadFigure } from './modelLoader.js';

export function createShowcase(container, opts = {}) {
  const el = document.createElement('div');
  el.id = 'showcase';
  el.innerHTML = `
    <canvas id="sc-canvas"></canvas>
    <div id="sc-info">
      <div id="sc-name"></div>
      <div id="sc-rarity"></div>
      <div id="sc-desc"></div>
      <div id="sc-hint">拖动旋转 · 点空白处放入仓库</div>
    </div>
    <div id="sc-actions">
      <button id="sc-showcase-btn" type="button">放进展柜</button>
      <button id="sc-storage-btn" type="button">放入仓库</button>
      <button id="sc-sell-btn" type="button">卖掉</button>
    </div>
  `;
  el.style.display = 'none';
  container.appendChild(el);

  const canvas = el.querySelector('#sc-canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
  camera.position.set(0, 1.2, 3.2);
  camera.lookAt(0, 0.7, 0);

  const amb = new THREE.AmbientLight(0xffffff, 0.7);
  const dir = new THREE.DirectionalLight(0xffffff, 1.0);
  dir.position.set(2, 4, 3);
  scene.add(amb, dir);

  let figure = null;
  let animId = 0;
  let dragging = false;
  let lastX = 0, lastY = 0;
  let rotY = 0, rotX = 0.15;
  let autoSpin = true;
  let currentEntry = null;
  let mode = 'new';
  let dragged = false;

  function resize() {
    const w = el.clientWidth, h = el.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(h, 1);
    camera.updateProjectionMatrix();
  }

  function clearFigure() {
    if (figure) {
      scene.remove(figure);
      figure.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          if (Array.isArray(o.material)) o.material.forEach(m => m.dispose());
          else o.material.dispose();
        }
      });
      figure = null;
    }
  }

  async function show(entry, item, rarityInfo, { alreadyInShowcase = false, mode: m = 'new', sellPrice } = {}) {
    currentEntry = entry;
    mode = m;
    clearFigure();
    rotY = 0; rotX = 0.15; autoSpin = true; dragged = false;

    const color = rarityInfo.color || '#9aa0a6';
    el.style.background = `radial-gradient(ellipse at center, ${color}55 0%, #0a0a14 70%)`;
    el.querySelector('#sc-name').textContent = item.name;
    el.querySelector('#sc-rarity').textContent = rarityInfo.label;
    el.querySelector('#sc-rarity').style.color = color;
    el.querySelector('#sc-desc').textContent = item.desc || '';
    const sellBtn = el.querySelector('#sc-sell-btn');
    const putBtn = el.querySelector('#sc-showcase-btn');
    sellBtn.textContent = `卖掉 +${sellPrice ?? rarityInfo.sellPrice} 金币`;
    putBtn.disabled = alreadyInShowcase;
    putBtn.textContent = alreadyInShowcase ? '展柜已有这款' : '放进展柜';
    // 展柜模式：只留 [放入仓库]
    putBtn.style.display = mode === 'case' ? 'none' : '';
    sellBtn.style.display = mode === 'case' ? 'none' : '';
    el.querySelector('#sc-hint').textContent =
      mode === 'case' ? '拖动旋转 · 点空白处关闭' : '拖动旋转 · 点空白处放入仓库';

    let mesh = await loadFigure(item, opts.modelConvention);
    if (!mesh) mesh = makePlaceholder(item, color);
    figure = mesh;
    scene.add(figure);

    el.style.display = 'block';
    resize();
    cancelAnimationFrame(animId);
    const loop = () => {
      animId = requestAnimationFrame(loop);
      if (figure) {
        if (autoSpin && !dragging) rotY += 0.012;
        figure.rotation.y = rotY;
        figure.rotation.x = rotX;
      }
      renderer.render(scene, camera);
    };
    loop();
  }

  function hide() {
    el.style.display = 'none';
    cancelAnimationFrame(animId);
    clearFigure();
    currentEntry = null;
  }

  function isVisible() { return el.style.display !== 'none'; }

  // Drag rotate
  canvas.addEventListener('pointerdown', e => {
    dragging = true; dragged = false;
    autoSpin = false;
    lastX = e.clientX; lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', e => {
    if (!dragging) return;
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    if (Math.abs(dx) + Math.abs(dy) > 3) dragged = true;
    rotY += dx * 0.01;
    rotX += dy * 0.01;
    rotX = Math.max(-0.6, Math.min(0.8, rotX));
    lastX = e.clientX; lastY = e.clientY;
  });
  canvas.addEventListener('pointerup', () => { dragging = false; });

  // Click blank (on el but not buttons / not a drag on canvas that moved) → warehouse
  el.addEventListener('click', e => {
    if (e.target.closest('#sc-actions')) return;
    if (e.target.closest('#sc-info')) return;
    // canvas click without drag = blank
    if (e.target === canvas && dragged) return;
    if (e.target === canvas || e.target === el) {
      opts.onBlank?.(mode, currentEntry);
    }
  });

  el.querySelector('#sc-showcase-btn').addEventListener('click', e => {
    e.stopPropagation();
    opts.onShowcase?.(currentEntry);
  });
  el.querySelector('#sc-storage-btn').addEventListener('click', e => {
    e.stopPropagation();
    opts.onStorage?.(mode, currentEntry);
  });
  el.querySelector('#sc-sell-btn').addEventListener('click', e => {
    e.stopPropagation();
    opts.onSell?.(currentEntry);
  });

  window.addEventListener('resize', () => { if (isVisible()) resize(); });

  return {
    el, show, hide, isVisible,
    getMode: () => mode,
    getRotation: () => ({ x: rotX, y: rotY }),
    /** test helper: apply a drag delta */
    _drag(dx, dy) {
      autoSpin = false;
      rotY += dx * 0.01;
      rotX += dy * 0.01;
    },
    get figure() { return figure; }
  };
}
