/** The native service remains the sole owner of currency, draws and inventory. */
const clone = value => structuredClone(value);
const failure = (error, message, extra = {}) => ({ ok: false, error, reason: error, message, ...extra });
const pendingKey = entry => entry ? `${entry.uid ?? ''}:${entry.seriesId}:${entry.itemId}` : null;

export async function createGame(base = new URL('./', location.href).href, options = {}) {
  const server = base.endsWith('/') ? base : `${base}/`;
  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  const locks = options.locks === undefined ? globalThis.navigator?.locks : options.locks;
  const timeoutMs = options.timeoutMs ?? 12000;
  let state, progress, busy = false, needsSync = false;

  async function request(method, path, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(new URL(path, server).href, {
        method, cache: 'no-store', signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
      let json;
      try { json = await response.json(); }
      catch { return failure('invalid-response', '服务返回不完整，正在核对存档。', { uncertain: method === 'POST', status: response.status }); }
      return { ...json, status: response.status, ok: response.ok && json.ok !== false };
    } catch {
      return failure('network', '暂时连不上本机服务，请确认启动窗口仍在运行。', { uncertain: method === 'POST', status: 0 });
    } finally { clearTimeout(timer); }
  }

  function accept(result) {
    if (result.state) state = clone(result.state);
    if (result.progress) progress = clone(result.progress);
    return result;
  }

  async function readState() {
    const result = await request('GET', 'api/state');
    if (!result.ok || !result.state || !result.progress) {
      needsSync = true;
      return failure('sync-required', '存档尚未同步。请恢复连接后点击「重新同步」，再进行操作。');
    }
    accept(result);
    needsSync = false;
    return result;
  }

  const config = await request('GET', 'api/config');
  if (!config.ok || !Array.isArray(config.series)) throw new Error(config.message || '无法读取系列配置。');
  // Config responses are not wrapped by the service.
  const { status: _status, ok: _ok, ...data } = config;
  const index = { byId: {}, bySeries: {} };
  for (const series of data.series) {
    index.bySeries[series.id] = series;
    for (const item of series.items) index.byId[item.id] = { ...item, seriesId: series.id, seriesName: series.name };
  }
  const initial = await readState();
  if (!initial.ok) throw new Error(initial.message);

  const blockedResult = () => failure('sync-required', '上次操作的结果尚未确认。请先重新同步存档。');
  const busyResult = () => failure('busy', '正在保存这次操作，请稍候。');
  const staleResult = () => failure('state-changed', '收藏状态已在其他页面更新，请按当前状态继续。');

  // ifAvailable rejects concurrent intent instead of queuing it as a second purchase.
  async function mutate(path, body, guard, recover) {
    if (busy) return busyResult();
    if (needsSync) return blockedResult();
    busy = true;
    const perform = async () => {
      const sync = await readState();
      if (!sync.ok) return sync;
      const rejected = guard?.(state);
      if (rejected) return rejected;
      const before = clone(state);
      const result = accept(await request('POST', path, body ?? {}));
      if (result.ok && result.state && result.progress) return result;
      // Never retry a mutation: a lost response may still have committed to SQLite.
      needsSync = true;
      const reconciled = await readState();
      if (!reconciled.ok) return blockedResult();
      if (result.uncertain || (result.ok && !result.state)) {
        const recovered = recover?.(before, state);
        if (recovered) return { ok: true, recovered: true, ...recovered, state: clone(state), progress: clone(progress) };
        return failure('outcome-unknown', '已重新读取存档，请查看当前结果；这次操作不会自动重试。', { refreshed: true, state: clone(state), progress: clone(progress) });
      }
      return { ...result, error: result.error || 'request-failed', message: result.message || '操作未完成，请查看当前收藏状态。', state: clone(state), progress: clone(progress) };
    };
    try {
      if (locks?.request) {
        return await locks.request(`qiwu-write:${server}`, { mode: 'exclusive', ifAvailable: true }, lock => lock ? perform() : busyResult());
      }
      return await perform();
    } catch {
      needsSync = true;
      return blockedResult();
    } finally { busy = false; }
  }

  function pendingMutation(path, body, expectedEntry) {
    // A dialog can outlive a sync. Bind writes to the displayed physical item,
    // rather than silently acting on a newer pending item in the client mirror.
    const entry = expectedEntry !== undefined ? clone(expectedEntry) : state.pending ? clone(state.pending) : null;
    if (!entry) return Promise.resolve(failure('no-pending', '没有待收纳的藏品。'));
    const key = pendingKey(entry);
    return mutate(path, body, latest => pendingKey(latest.pending) !== key ? staleResult() : null,
      (_before, latest) => {
        if (latest.pending) return null;
        if (path === 'api/storage' && latest.storage.some(value => value.uid === entry.uid)) return { entry };
        if (path === 'api/showcase' && latest.showcase[entry.seriesId]?.[entry.itemId]) return { entry };
        // Do not infer a sale solely from absence; another client could have moved it.
        return null;
      });
  }

  const game = {
    data, index, server,
    getState: () => clone(state),
    getProgress: () => clone(progress),
    getPending: () => state.pending ? clone(state.pending) : null,
    isBusy: () => busy,
    needsSync: () => needsSync,
    async refresh() {
      if (busy) return busyResult();
      busy = true;
      try { return await readState(); }
      finally { busy = false; }
    },
    async open(seriesId) {
      if (!index.bySeries[seriesId]) return failure('unknown-series', '找不到这个系列。');
      if (state.pending) return failure('pending', '请先安置已拆开的藏品。');
      const opened = state.boxesOpened;
      const result = await mutate('api/open', { seriesId }, latest => {
        if (latest.pending) return failure('pending', '已有一件待收纳藏品，继续查看即可。');
        if (latest.boxesOpened !== opened) return staleResult();
        return null;
      }, (before, latest) => latest.pending?.seriesId === seriesId && latest.boxesOpened === before.boxesOpened + 1
        ? { entry: clone(latest.pending), price: index.bySeries[seriesId].boxPrice, alreadyInShowcase: !!latest.showcase[seriesId]?.[latest.pending.itemId] }
        : null);
      return result.ok && result.entry ? { ...result, item: clone(index.byId[result.entry.itemId]) } : result;
    },
    toStorage: expectedEntry => pendingMutation('api/storage', undefined, expectedEntry),
    toShowcase: expectedEntry => pendingMutation('api/showcase', undefined, expectedEntry),
    sellPending: expectedEntry => pendingMutation('api/sell', { from: 'pending' }, expectedEntry),
    async reopen(uid) {
      const result = await mutate('api/reopen', { uid }, latest => {
        if (latest.pending) return failure('pending', '请先安置当前藏品。');
        return latest.storage.some(entry => entry.uid === uid) ? null : staleResult();
      }, (_before, latest) => latest.pending?.uid === uid ? { entry: clone(latest.pending) } : null);
      return result.ok && result.entry ? { ...result, item: clone(index.byId[result.entry.itemId]) } : result;
    },
    unshowcase: (seriesId, itemId) => mutate('api/unshowcase', { seriesId, itemId }, latest => latest.showcase[seriesId]?.[itemId] ? null : staleResult()),
    sellFromStorage: uid => mutate('api/sell', { from: 'storage', uid }, latest => latest.storage.some(entry => entry.uid === uid) ? null : staleResult()),
    async maybeBailout() {
      const cheapest = Math.min(...data.series.map(series => series.boxPrice));
      if (busy || needsSync || state.pending || state.storage.length || state.coins >= cheapest) return null;
      const result = await mutate('api/bailout', {}, latest => latest.pending || latest.storage.length || latest.coins >= cheapest
        ? failure('not-needed', '当前无需补助。') : null);
      return result.ok ? result.coins ?? data.economy.bailout.coins : null;
    }
  };
  return game;
}
