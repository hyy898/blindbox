import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createPreviewCache } from '../web/src/preview-cache.js';
import { bindCollectionPreviews, collectibleArt, previewKey, staticPreview } from '../web/src/collection-previews.js';
import { modelAssets } from '../web/src/assets.js';
import { modelAssets as bundled } from '../web/src/asset-previews.js';

const turn = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

test('bundled previews point to real models and valid transparent images', () => {
  const root = new URL('../', import.meta.url);
  const entries = Object.entries(bundled).filter(([, asset]) => asset.thumbnail);
  assert.ok(entries.length > 0);
  for (const [id, asset] of entries) {
    assert.ok(existsSync(new URL(`blindbox/models/${id}.glb`, root)), `${id} has a real source model`);
    const path = fileURLToPath(new URL(`web/public/${asset.thumbnail.replace(/^\.\//, '')}`, root));
    assert.ok(existsSync(path), `${id} thumbnail file exists`);
    const png = readFileSync(path);
    assert.equal(png.subarray(1, 4).toString(), 'PNG', id);
    assert.ok(png.readUInt32BE(16) >= 256 && png.readUInt32BE(20) >= 256, id);
    assert.equal(png[25], 6, `${id} uses RGBA`);
  }
});

test('collection markup displays known thumbnails during a catalog outage, and queues new models without a click', () => {
  const id = 'wa-01', original = modelAssets[id], item = { id, name: '外卖柯基' }, series = { id: 'working-animals' };
  try {
    modelAssets[id] = { ...bundled[id], available: null };
    assert.match(collectibleArt(item, series), /<img[^>]+wa-01\.png/);
    modelAssets[id] = { available: true, version: 'new', thumbnail: null };
    const markup = collectibleArt(item, series);
    assert.match(markup, /data-preview-item="wa-01"/);
    assert.doesNotMatch(markup, /catalog-icon/);
    modelAssets[id] = { available: false };
    assert.doesNotMatch(collectibleArt(item, series), /data-preview-item/);
  } finally { modelAssets[id] = original; }
});

test('replaced model files and changed versions never reuse the old preview key', () => {
  assert.equal(staticPreview({ available: true, thumbnail: './old.png', bytes: 200 }, { bytes: 100 }), null);
  const item = { id: 'wa-01' }, asset = { url: 'models/wa-01.glb?v=1', version: 'one', orientation: 0 };
  const key = previewKey(item, asset, 'http://test/');
  assert.notEqual(key, previewKey(item, { ...asset, version: 'two' }, 'http://test/'));
  assert.notEqual(key, previewKey(item, { ...asset, orientation: 1 }, 'http://test/'));
  assert.notEqual(key, previewKey(item, asset, 'http://other/'));
});

test('a broken card thumbnail automatically renders, and late image errors cannot erase its replacement', () => {
  class Picture extends EventTarget {
    constructor() { super(); this.complete = true; this.naturalWidth = 0; this.parentNode = null; }
    remove() { if (this.parentNode) this.parentNode.image = null; this.parentNode = null; }
  }
  const old = new Picture();
  const node = {
    dataset: { previewItem: 'wa-01' }, isConnected: true, image: old, textContent: '',
    querySelector() { return this.image; },
    replaceChildren(image) { this.image = image; image.parentNode = this; }
  };
  old.parentNode = node;
  const root = { ownerDocument: { createElement: () => new Picture() }, querySelectorAll: () => [node] };
  let calls = 0, released = false, notify;
  const dispose = bindCollectionPreviews(root, { base: 'http://test/',
    index: { byId: { 'wa-01': { id: 'wa-01', name: '外卖柯基' } } },
    cache: { subscribe(_key, _source, callback) {
      calls++; notify = callback; callback({ ok: true, url: 'blob:real-preview' });
      return () => { released = true; };
    } }
  });
  assert.equal(calls, 1);
  assert.equal(node.image.src, 'blob:real-preview');
  old.dispatchEvent(new Event('error'));
  assert.equal(node.image.src, 'blob:real-preview');
  assert.equal(calls, 1);
  dispose();
  notify({ ok: true, url: 'blob:stale' });
  assert.equal(node.image.src, 'blob:real-preview');
  assert.equal(released, true);
});

test('same-model cards share one preview job and navigation cancels queued work', async () => {
  const first = deferred(), calls = [], results = [];
  const cache = createPreviewCache({ load: source => { calls.push(source); return source === 'one' ? first.promise : Promise.resolve('url-two'); } });
  const stopA = cache.subscribe('one', 'one', result => results.push(['a', result]));
  const stopB = cache.subscribe('one', 'one', result => results.push(['b', result]));
  const stopQueued = cache.subscribe('two', 'two', () => assert.fail('cancelled card was updated'));
  await turn();
  assert.deepEqual(calls, ['one']);
  stopA(); stopQueued();
  first.resolve('url-one');
  await turn();
  assert.deepEqual(calls, ['one']);
  assert.deepEqual(results, [['b', { ok: true, url: 'url-one' }]]);
  stopB();
  const stopAgain = cache.subscribe('one', 'one', result => results.push(['again', result]));
  await turn();
  assert.equal(calls.length, 1, 'revisiting collection does not regenerate the thumbnail');
  assert.equal(results.at(-1)[0], 'again');
  stopAgain();
});

test('different models render serially and inactive previews are evicted safely', async () => {
  const first = deferred(), calls = [], disposed = [];
  const cache = createPreviewCache({ maxEntries: 1, dispose: url => disposed.push(url),
    load: source => { calls.push(source); return source === 'one' ? first.promise : Promise.resolve('url-two'); } });
  const stopFirst = cache.subscribe('one', 'one', () => {});
  const stopSecond = cache.subscribe('two', 'two', () => {});
  await turn();
  assert.deepEqual(calls, ['one']);
  first.resolve('url-one');
  await turn();
  assert.deepEqual(calls, ['one', 'two']);
  assert.deepEqual(disposed, [], 'visible cards keep their object URLs');
  stopFirst();
  assert.deepEqual(disposed, ['url-one']);
  stopSecond();
});

test('a failed preview retries later and a stale card cannot block other cards', async () => {
  let calls = 0;
  const results = [];
  const cache = createPreviewCache({ load: async () => { if (++calls === 1) throw new Error('temporary failure'); return 'ready'; } });
  const first = cache.subscribe('one', {}, result => results.push(result));
  await turn(); first();
  assert.deepEqual(results, [{ ok: false }]);
  const bad = cache.subscribe('one', {}, () => { throw new Error('card removed'); });
  const good = cache.subscribe('one', {}, result => results.push(result));
  await turn();
  assert.equal(calls, 2);
  assert.deepEqual(results.at(-1), { ok: true, url: 'ready' });
  bad(); good();
});
