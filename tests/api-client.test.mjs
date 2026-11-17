import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../web/src/api.js';

const copy = value => structuredClone(value);
function fixture() {
  const data = {
    economy: { startCoins: 1000, bailout: { coins: 200 } }, rarities: { common: { label: '普通' } },
    series: [{ id: 'food', name: '食堂', boxPrice: 100, items: [{ id: 'food-1', name: '饭团', rarity: 'common', model: 'models/food-1.glb' }] }]
  };
  const state = { coins: 1000, boxesOpened: 0, coinsSpent: 0, storage: [], showcase: { food: {} }, pending: null, uidSeq: 0 };
  const initialState = copy(state);
  const progress = { owned: 0, total: 1, bySeries: { food: { owned: 0, total: 1 } } };
  const controls = { failRead: false, loseResponse: false, holdPost: null };
  const calls = [];
  const saves = new Map();
  let saveRevision = 0;
  const response = (json, status = 200) => ({ ok: status < 400, status, json: async () => copy(json) });
  const snapshot = extra => ({ ok: true, state, progress, ...extra });
  async function fetch(url, opts) {
    const path = new URL(url).pathname;
    calls.push([opts.method, path]);
    if (path === '/api/config') return response(data);
    if (path === '/api/state') {
      if (controls.failRead) throw new Error('offline');
      return response(snapshot());
    }
    if (opts.method === 'GET' && path === '/api/saves') return response({ ok: true, saves: [...saves.values()] });
    if (opts.method === 'GET' && /^\/api\/saves\/[0-3]$/.test(path)) {
      const save = saves.get(Number(path.at(-1)));
      return save ? response({ ok: true, save }) : response({ ok: false, error: 'save_not_found' }, 404);
    }
    if (controls.holdPost) await controls.holdPost;
    let entry;
    if (path === '/api/saves/new') {
      const { presentation } = JSON.parse(opts.body);
      saves.set(0, { slot: 0, revision: String(++saveRevision), name: '重新开局前的进度', state: copy(state), presentation: copy(presentation) });
      Object.assign(state, copy(initialState));
      progress.owned = 0; progress.bySeries.food.owned = 0;
      if (controls.loseResponse) { controls.loseResponse = false; throw new Error('lost committed reset response'); }
      return response(snapshot({ reset: true, presentation: { ...copy(presentation), layout: [null, null, null] } }));
    } else if (path.startsWith('/api/saves/')) {
      const { slot, revision, name, presentation } = JSON.parse(opts.body);
      const previous = saves.get(slot);
      if ((previous?.revision ?? '') !== revision) return response({ ok: false, error: 'save_changed' }, 409);
      if (path.endsWith('/save')) {
        saves.set(slot, { slot, revision: String(++saveRevision), name, state: copy(state), presentation: copy(presentation) });
      } else if (path.endsWith('/load')) {
        saves.set(0, { slot: 0, revision: String(++saveRevision), name: '读档前的进度', state: copy(state), presentation: copy(presentation) });
        Object.assign(state, copy(previous.state));
      } else if (path.endsWith('/delete')) saves.delete(slot);
      if (controls.loseResponse) { controls.loseResponse = false; throw new Error('lost committed save response'); }
      return response(snapshot(path.endsWith('/load') ? { loadedSlot: slot, presentation: previous.presentation } : { save: saves.get(slot) }));
    } else if (path === '/api/open') {
      if (state.pending) return response({ ok: false, error: 'pending' }, 409);
      state.coins -= 100; state.boxesOpened++; state.coinsSpent += 100;
      entry = { uid: ++state.uidSeq, seriesId: 'food', itemId: 'food-1' };
      state.pending = entry;
    } else if (path === '/api/storage') {
      entry = state.pending;
      if (!entry) return response({ ok: false, error: 'no-pending' }, 409);
      state.storage.push(entry); state.pending = null;
    } else if (path === '/api/showcase') {
      entry = state.pending;
      if (!entry) return response({ ok: false, error: 'no-pending' }, 409);
      state.showcase[entry.seriesId][entry.itemId] = true; state.pending = null;
      progress.owned = 1; progress.bySeries.food.owned = 1;
    } else if (path === '/api/reopen') {
      const uid = JSON.parse(opts.body).uid;
      entry = state.storage.find(value => value.uid === uid);
      state.storage = state.storage.filter(value => value.uid !== uid);
      state.pending = entry;
    }
    if (controls.loseResponse) {
      controls.loseResponse = false;
      throw new Error('response lost after commit');
    }
    return response(snapshot({ entry, price: 100 }));
  }
  return { data, state, saves, controls, calls, fetch, posts: () => calls.filter(([method]) => method === 'POST') };
}
const create = f => createGame('http://test/', { fetch: f.fetch, locks: null, timeoutMs: 1000 });

test('simultaneous open intents cause exactly one charge and one pending item', async () => {
  const f = fixture(), game = await create(f);
  let release;
  f.controls.holdPost = new Promise(resolve => { release = resolve; });
  const first = game.open('food');
  const second = await game.open('food');
  assert.equal(second.error, 'busy');
  release();
  const result = await first;
  assert.equal(result.ok, true);
  assert.equal(f.posts().length, 1);
  assert.equal(game.getState().coins, 900);
  assert.equal(game.getState().boxesOpened, 1);
  assert.equal(game.getPending().uid, 1);
  assert.equal((await game.open('food')).error, 'pending');
  assert.equal(f.posts().length, 1);
});

test('lost successful open response recovers the same persisted result without a retry', async () => {
  const f = fixture(), game = await create(f);
  f.controls.loseResponse = true;
  const result = await game.open('food');
  assert.equal(result.ok, true);
  assert.equal(result.recovered, true);
  assert.equal(result.entry.uid, 1);
  assert.equal(result.item.id, 'food-1');
  assert.equal(f.posts().length, 1);
  assert.equal(game.getState().coins, 900);
});

test('unconfirmed result blocks writes until an explicit successful sync', async () => {
  const f = fixture(), game = await create(f);
  const wrapped = f.fetch;
  f.fetch = async (url, opts) => wrapped(url, opts);
  // Set the read outage only once the write has reached the server.
  const game2 = await createGame('http://test/', {
    locks: null,
    fetch: async (url, opts) => {
      if (opts.method === 'POST') { f.controls.loseResponse = true; f.controls.failRead = true; }
      return wrapped(url, opts);
    }
  });
  assert.equal((await game2.open('food')).error, 'sync-required');
  assert.equal((await game2.open('food')).error, 'sync-required');
  assert.equal(f.posts().length, 1);
  f.controls.failRead = false;
  assert.equal((await game2.refresh()).ok, true);
  assert.equal(game2.getPending().uid, 1);
  assert.equal((await game2.open('food')).error, 'pending');
  assert.equal(f.posts().length, 1);
  assert.equal(game.getState().coins, 1000, 'another client mirror is not modified behind its back');
});

test('refresh or a new client preserves pending instead of auto-storing it', async () => {
  const f = fixture(), game = await create(f);
  await game.open('food');
  await game.refresh();
  const reopened = await create(f);
  assert.equal(reopened.getPending().uid, 1);
  assert.equal(reopened.getState().storage.length, 0);
  assert.deepEqual(f.posts().map(([, path]) => path), ['/api/open']);
});

test('pending placement is bound to its original uid after a cross-tab change', async () => {
  const f = fixture(), game = await create(f);
  await game.open('food');
  f.state.pending = { uid: 2, seriesId: 'food', itemId: 'food-1' };
  const result = await game.toStorage();
  assert.equal(result.error, 'state-changed');
  assert.equal(f.posts().length, 1);
  assert.equal(game.getPending().uid, 2);
});

test('storage reopen and showcase placement transfer ownership without additional charges', async () => {
  const f = fixture(), game = await create(f);
  await game.open('food');
  await game.toStorage();
  assert.equal(game.getState().storage.length, 1);
  await game.reopen(1);
  assert.equal(game.getState().storage.length, 0);
  assert.equal(game.getPending().uid, 1);
  await game.toShowcase();
  assert.equal(game.getPending(), null);
  assert.equal(game.getState().showcase.food['food-1'], true);
  assert.equal(game.getState().coins, 900);
  assert.equal(game.getState().boxesOpened, 1);
});

test('Web Locks refuses concurrent intent instead of queuing another mutation', async () => {
  const f = fixture();
  let held = false;
  const locks = { async request(name, opts, fn) {
    assert.equal(opts.ifAvailable, true);
    if (held) return fn(null);
    held = true;
    try { return await fn({ name }); } finally { held = false; }
  } };
  const one = await createGame('http://test/', { fetch: f.fetch, locks });
  const two = await createGame('http://test/', { fetch: f.fetch, locks });
  const first = one.open('food');
  assert.equal((await two.open('food')).error, 'busy');
  await first;
  assert.equal(f.posts().length, 1);
  assert.equal((await two.open('food')).error, 'pending');
  assert.equal(f.posts().length, 1);
});

test('state snapshots cannot accidentally mutate the live client mirror', async () => {
  const f = fixture(), game = await create(f);
  const value = game.getState(); value.coins = 0; value.storage.push({ uid: 'fake' });
  assert.equal(game.getState().coins, 1000);
  assert.equal(game.getState().storage.length, 0);
});


test('a stale result dialog cannot place a newer pending item after explicit refresh', async () => {
  for (const method of ['toStorage', 'toShowcase', 'sellPending']) {
    const f = fixture(), game = await create(f);
    const original = (await game.open('food')).entry;
    f.state.pending = { uid: 2, seriesId: 'food', itemId: 'food-1' };
    await game.refresh();
    assert.equal(game.getPending().uid, 2);
    const result = await game[method](original);
    assert.equal(result.error, 'state-changed', method);
    assert.equal(f.posts().length, 1, `${method} must not submit a stale mutation`);
    assert.equal(f.state.pending.uid, 2);
  }
});

test('explicit expected entry permits only its own storage transfer', async () => {
  const f = fixture(), game = await create(f);
  const original = (await game.open('food')).entry;
  assert.equal((await game.toStorage(original)).ok, true);
  assert.equal(game.getState().storage[0].uid, original.uid);
  assert.equal((await game.toStorage(original)).error, 'state-changed');
  assert.equal(f.posts().length, 2);
});

test('stale open intent is rejected even when another tab already stored its draw', async () => {
  const f = fixture(), game = await create(f);
  f.state.boxesOpened = 1;
  f.state.coins = 900;
  f.state.coinsSpent = 100;
  f.state.uidSeq = 1;
  f.state.storage = [{ uid: 1, seriesId: 'food', itemId: 'food-1' }];
  const result = await game.open('food');
  assert.equal(result.error, 'state-changed');
  assert.equal(f.posts().length, 0, 'stale intent must not issue a purchase');
  assert.equal(game.getState().coins, 900);
  // A deliberate new click after observing the synchronized state is a new draw.
  const next = await game.open('food');
  assert.equal(next.ok, true);
  assert.equal(next.entry.uid, 2);
  assert.equal(f.posts().length, 1);
});

const presentation = { layout: [null, null, null], preferences: { muted: true, reduced: false } };

test('manual save and load restore the exact pending result and display preferences', async () => {
  const f = fixture(), game = await create(f);
  const entry = (await game.open('food')).entry;
  await game.saveSlot(1, '第一盒', presentation);
  const saved = copy(f.saves.get(1));
  await game.toStorage();
  const before = game.getState();
  const loaded = await game.loadSlot(1, saved.revision, presentation);
  assert.equal(loaded.ok, true);
  assert.deepEqual(game.getPending(), entry);
  assert.deepEqual(game.getState(), saved.state);
  assert.deepEqual(loaded.presentation, presentation);
  assert.deepEqual(f.saves.get(0).state, before);
});

test('lost save, backup restore and delete responses reconcile without repeating writes', async () => {
  const f = fixture(), game = await create(f);
  f.controls.loseResponse = true;
  assert.equal((await game.saveSlot(1, '起点', presentation)).recovered, true);
  const saved = copy(f.saves.get(1));
  await game.open('food');
  const drawn = game.getState();
  await game.loadSlot(1, saved.revision, presentation);
  const backup = copy(f.saves.get(0));
  f.controls.loseResponse = true;
  const restored = await game.loadSlot(0, backup.revision, presentation);
  assert.equal(restored.recovered, true);
  assert.deepEqual(game.getState(), drawn);
  assert.deepEqual(restored.presentation, backup.presentation);
  f.controls.loseResponse = true;
  assert.equal((await game.deleteSlot(1, saved.revision)).recovered, true);
  assert.equal(f.saves.has(1), false);
  assert.deepEqual(game.getState(), drawn);
  for (const path of ['/api/saves/save', '/api/saves/delete']) {
    assert.equal(f.posts().filter(([, value]) => value === path).length, 1);
  }
  assert.equal(f.posts().filter(([, value]) => value === '/api/saves/load').length, 2);
});

test('stale save lists and cross-tab state changes cannot silently overwrite a slot', async () => {
  const f = fixture(), game = await create(f);
  await game.saveSlot(1, '旧记录', presentation);
  const first = copy(f.saves.get(1));
  await game.saveSlot(1, '新记录', presentation, first.revision);
  assert.equal((await game.loadSlot(1, first.revision, presentation)).error, 'save_changed');
  assert.equal((await game.deleteSlot(1, first.revision)).error, 'save_changed');
  const postsBefore = f.posts().length;
  f.state.coins = 700;
  assert.equal((await game.saveSlot(2, '过期进度', presentation)).error, 'state-changed');
  assert.equal(f.posts().length, postsBefore);
  assert.equal(f.saves.has(2), false);
  assert.equal(f.saves.get(1).name, '新记录');
});

test('new game clears progress and display layout, preserves manual saves, and backs up the previous game', async () => {
  const f = fixture(), game = await create(f), initial = game.getState();
  await game.open('food');
  await game.toShowcase();
  const view = { layout: [{ itemId: 'food-1', rotation: 40 }, null, null], preferences: { muted: false, reduced: true } };
  await game.saveSlot(1, '我的收藏', view);
  const manual = copy(f.saves.get(1));
  await game.open('food');
  const before = game.getState();
  const result = await game.startNewGame(view);
  assert.equal(result.ok, true);
  assert.deepEqual(game.getState(), initial);
  assert.equal(game.getProgress().owned, 0);
  assert.deepEqual(result.presentation, { ...view, layout: [null, null, null] });
  assert.deepEqual(f.saves.get(0).state, before);
  assert.deepEqual(f.saves.get(0).presentation, view);
  assert.deepEqual(f.saves.get(1), manual);
});

test('a lost reset response is recovered without resetting again or overwriting its backup', async () => {
  const f = fixture(), game = await create(f);
  await game.open('food');
  const before = game.getState();
  f.controls.loseResponse = true;
  const result = await game.startNewGame(presentation);
  assert.equal(result.recovered, true);
  assert.equal(game.getState().coins, f.data.economy.startCoins);
  assert.deepEqual(f.saves.get(0).state, before);
  assert.equal(f.posts().filter(([, path]) => path === '/api/saves/new').length, 1);
});

test('simultaneous or stale new-game intents cannot reset another tab’s newer progress', async () => {
  const f = fixture(), game = await create(f);
  await game.open('food');
  const before = game.getState();
  let release;
  f.controls.holdPost = new Promise(resolve => { release = resolve; });
  const first = game.startNewGame(presentation);
  assert.equal((await game.startNewGame(presentation)).error, 'busy');
  release();
  assert.equal((await first).ok, true);
  assert.deepEqual(f.saves.get(0).state, before);
  f.state.coins = 700;
  assert.equal((await game.startNewGame(presentation)).error, 'state-changed');
  assert.equal(f.posts().filter(([, path]) => path === '/api/saves/new').length, 1);
});
