/**
 * 全屏 3D 展示界面：暖白收藏场景，拖动旋转。
 * 两种模式：
 *   mode 'new'  —— 新开出的 / 从仓库打开的：[放进展柜] [放入仓库] [卖掉]；点空白处 = 放入仓库
 *   mode 'case' —— 从展柜点开的：只有 [放入仓库]（展柜里的不能卖）；点空白处 = 关闭
 * 点空白处回调 onBlank(mode)。
 */
import * as THREE from 'three';
import { icon, seriesTheme, boxArt } from './art.js';
import { createDisplayStage } from './showcase-stage.js';
import './showcase.css';
import { makePlaceholder } from './placeholder.js';
import { loadFigure } from './modelLoader.js';

export function createShowcase(container, opts = {}) {
  const el = document.createElement('div');
  el.id = 'showcase';
  el.innerHTML = `
    <div class="sc-room" aria-hidden="true">
      <div class="sc-room-floor"><div class="sc-floor-lines"></div></div>
      <div class="sc-alcove"></div>
      <div class="sc-wall-card">${icon('sparkle')}<span>SMALL BOX<br>BIG HAPPINESS</span></div>
      <div class="sc-wall-card sc-wall-card--small">${icon('box')}<span>LITTLE JOYS</span></div>
      <div class="sc-room-plant"><svg viewBox="0 0 130 210" fill="none"><ellipse cx="65" cy="195" rx="38" ry="8" fill="#b8c5a4" opacity=".18"/><path d="M65 158c-4-45-17-68-24-92m24 92c7-49 27-80 35-106m-35 106c-1-49 1-93 0-119" stroke="#9cad83" stroke-width="3" stroke-linecap="round"/><path d="M58 109C16 113 12 81 20 68c30 2 39 16 38 41Z" fill="#bdcfa8"/><path d="M69 84c-12-31-5-62 12-73 20 23 11 51-12 73Z" fill="#c7d7b6"/><path d="M78 118c-4-36 19-61 41-56-2 29-18 46-41 56Z" fill="#b1c59b"/><path d="M59 142c-36 1-48-20-43-38 25 0 40 14 43 38Z" fill="#cfddbd"/><path d="M36 151h59l-7 37c-2 15-41 15-45 0l-7-37Z" fill="#e5dcc7"/><ellipse cx="65" cy="151" rx="30" ry="8" fill="#f8f1df"/><ellipse cx="65" cy="152" rx="24" ry="4" fill="#d5ccb5"/><path d="M49 159l3 29" stroke="#f4ecda" stroke-width="4" stroke-linecap="round"/></svg></div>
      <div class="sc-scene-package"></div>
      <span class="sc-room-star">${icon('sparkle')}</span><span class="sc-room-star sc-room-star--right">${icon('sparkle')}</span>
    </div>
    <div class="sc-topbar"><span class="sc-topbar-mark">${icon('box')}</span><span><strong>开盲盒</strong><small>THE LITTLE BOX CLUB</small></span></div>
    <canvas id="sc-canvas"></canvas>
    <button id="sc-close" type="button" aria-label="收起手办">${icon('close')}</button>
    <div id="sc-info">
      <div class="sc-eyebrow">A LITTLE JOY, JUST FOR YOU</div>
      <div class="sc-rarity-wrap"><span id="sc-rarity"></span></div>
      <div id="sc-name"></div>
      <div id="sc-desc"></div>

    </div>
    <div id="sc-hint">拖动旋转 · 点空白处放入仓库</div>
    <div class="sc-corner-note">MAKE ROOM FOR LITTLE JOYS</div>
    <div class="sc-item-code"></div>
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
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
  camera.position.set(0, 1.15, 4.3);
  camera.lookAt(0, 0.55, 0);
  const displayStage = createDisplayStage(scene);

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
    const w = canvas.clientWidth, h = canvas.clientHeight;
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
    const theme = seriesTheme({ id: item.seriesId || entry.seriesId, name: item.seriesName || item.name });
    el.style.setProperty('--sc-scene-tone', theme.tone);
    el.style.setProperty('--sc-scene-ink', theme.ink);
    el.style.setProperty('--sc-rarity-color', color);
    el.querySelector('.sc-eyebrow').textContent = item.seriesName ? `${item.seriesName} · 你的新一份喜欢` : 'YOUR LITTLE COLLECTION';
    el.querySelector('.sc-item-code').textContent = item.id.toUpperCase();
    el.querySelector('.sc-scene-package').innerHTML = boxArt(theme, 'scene-package-' + entry.seriesId);
    displayStage.setTheme(theme, color);
    el.querySelector('#sc-name').textContent = item.name;
    el.querySelector('#sc-rarity').textContent = rarityInfo.label;
    el.querySelector('#sc-rarity').style.removeProperty('color');
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
      mode === 'case' ? '拖动看看每个角度 · 点击空白处收起' : '拖动看看每个角度 · 点击空白处放入仓库';

    let mesh = await loadFigure(item, opts.modelConvention);
    if (!mesh) mesh = makePlaceholder(item, color);
    figure = mesh;
    displayStage.prepareFigure(figure);
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

  el.querySelector('#sc-close').addEventListener('click', e => {
    e.stopPropagation();
    opts.onBlank?.(mode, currentEntry);
  });

  el.querySelector('#sc-showcase-btn').addEventListener('click', e => {
    e.stopPropagation();
    opts.onShowcase?.(currentEntry, mode);
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
