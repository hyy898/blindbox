import { esc, motif } from './themes.js';
import { modelAssets, resolveModelAsset } from './assets.js';
import { modelAssets as bundled } from './asset-previews.js';
import { createPreviewCache } from './preview-cache.js';

export function staticPreview(asset, original) {
  if (asset?.available === false || !asset?.thumbnail) return null;
  // 已替换的模型不能继续使用旧缩略图；资源清单暂不可用时仍可显示已有图片。
  if (original?.bytes && asset.bytes && original.bytes !== asset.bytes) return null;
  return asset.thumbnail;
}

export function collectibleArt(item, series) {
  const asset = modelAssets[item.id];
  if (asset?.available === false) return `<span class="catalog-icon">${motif(series.id)}</span>`;
  const thumbnail = staticPreview(asset, bundled[item.id]);
  return `<span class="collectible-preview" data-preview-item="${esc(item.id)}">${thumbnail
    ? `<img class="collectible-thumb" src="${esc(thumbnail)}" alt="${esc(item.name)}的藏品预览" loading="lazy" decoding="async">`
    : '<span class="collectible-loading" role="status">藏品载入中…</span>'}</span>`;
}

export function previewKey(item, asset, base, unverified = 'unverified') {
  const key = new URL(`__collection-preview__/${encodeURIComponent(item.id)}.png`, base);
  key.searchParams.set('model', new URL(asset.url || item.model || `models/${item.id}.glb`, base).href);
  key.searchParams.set('version', asset.version || unverified);
  key.searchParams.set('orientation', String(Number(asset.orientation) || 0));
  return key.href;
}

async function loadPreview(source, key) {
  let disk;
  if (source.asset.version) {
    try {
      disk = await globalThis.caches?.open('qiwu-collection-previews-v1');
      const saved = await disk?.match(key);
      if (saved?.ok) return URL.createObjectURL(await saved.blob());
    } catch { /* 浏览器限制缓存时，仍使用当前页面内存缓存。 */ }
  }
  let asset = source.asset;
  if (asset.available !== true) asset = await resolveModelAsset(source.item.id, source.base,
    new URL(source.item.model || `models/${source.item.id}.glb`, source.base).href);
  if (!asset.available) throw new Error('模型尚未提供');
  const { renderModelThumbnail } = await import('./viewer.js');
  const blob = await renderModelThumbnail({ item: source.item, asset, assetBase: source.base });
  if (disk) {
    try {
      await disk.put(key, new Response(blob, { headers: { 'Content-Type': 'image/png' } }));
      const keys = await disk.keys();
      for (const old of keys.slice(0, Math.max(0, keys.length - 64))) await disk.delete(old);
    } catch { /* 存储不足不影响当前卡片。 */ }
  }
  return URL.createObjectURL(blob);
}

const previews = createPreviewCache({ load: loadPreview, dispose: url => URL.revokeObjectURL(url) });

/** Fill visible cards without requiring a detail-view click or changing inventory. */
export function bindCollectionPreviews(root, { index, base, cache = previews }) {
  const releases = [], events = new AbortController(), started = new WeakSet();
  const unverified = String(Date.now());
  let active = true, observer;
  const start = node => {
    if (!active || !node.isConnected || started.has(node)) return;
    const item = index.byId[node.dataset.previewItem];
    if (!item) return;
    started.add(node);
    observer?.unobserve(node);
    const asset = { ...modelAssets[item.id] };
    const key = previewKey(item, asset, base, unverified);
    releases.push(cache.subscribe(key, { item, asset, base }, result => {
      if (!active || !node.isConnected) return;
      if (!result.ok) {
        if (!node.querySelector('img')) node.textContent = '预览暂未载入';
        return;
      }
      const image = (root.ownerDocument || document).createElement('img');
      image.className = 'collectible-thumb';
      image.alt = `${item.name}的藏品预览`;
      image.decoding = 'async';
      image.src = result.url;
      node.replaceChildren(image);
    }));
  };
  const observe = node => observer ? observer.observe(node) : start(node);
  if (typeof IntersectionObserver !== 'undefined') {
    observer = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) start(entry.target);
    }, { rootMargin: '160px' });
  }
  for (const node of root.querySelectorAll('[data-preview-item]')) {
    const image = node.querySelector('img');
    if (!image) observe(node);
    else {
      const fallback = () => {
        if (!active || image.parentNode !== node) return;
        image.remove(); node.textContent = '藏品载入中…'; observe(node);
      };
      image.addEventListener('error', fallback, { once: true, signal: events.signal });
      if (image.complete && !image.naturalWidth) fallback();
    }
  }
  return () => {
    active = false;
    observer?.disconnect();
    events.abort();
    releases.forEach(release => release());
  };
}
