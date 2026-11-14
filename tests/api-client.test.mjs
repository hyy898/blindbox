import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../web/src/api.js';

const copy = value => structuredClone(value);
function fixture() {
  const data = {
    economy: { bailout: { coins: 200 } }, rarities: { common: { label: '普通' } },
    series: [{ id: 'food', name: '食堂', boxPrice: 100, items: [{ id: 'food-1', name: '饭团', rarity: 'common', model: 'models/food-1.glb' }] }]
  };
  const state = { coins: 1000, boxesOpened: 0, coinsSpent: 0, storage: [], showcase: { food: {} }, pending: null, uidSeq: 0 };
  const progress = { owned: 0, total: 1, bySeries: { food: { owned: 0, total: 1 } } };
  const controls = { failRead: false, loseResponse: false, holdPost: null };
  const calls = [];
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
    if (controls.holdPost) await controls.holdPost;
    let entry;
    if (path === '/api/open') {
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
  return { data, state, controls, calls, fetch, posts: () => calls.filter(([method]) => method === 'POST') };
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
