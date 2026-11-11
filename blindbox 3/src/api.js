/**
 * 和本机 C++ 游戏服务器（server/）通信的客户端。
 *
 * 游戏只通过服务器运行：规则、金币、存档都在服务器上，网页只负责显示。
 * 服务器地址：默认就是打开网页的这个地址（blindbox-server 自己提供网页）；
 * 开发时可以用 ?server=http://127.0.0.1:8765/ 指定。
 * 单机只有一份存档，启动时直接读取，不需要名字或登录。
 */

const HEALTH_TIMEOUT_MS = 2000;

/** 返回服务器根地址（以 / 结尾）；连不上返回 null */
export async function detectServer() {
  if (location.protocol === 'file:' && !new URLSearchParams(location.search).get('server')) return null;
  let base = new URLSearchParams(location.search).get('server') || new URL('./', location.href).href;
  if (!base.endsWith('/')) base += '/';
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), HEALTH_TIMEOUT_MS);
  try {
    const r = await fetch(base + 'api/health', { cache: 'no-store', signal: ctl.signal });
    const j = await r.json();
    return j && j.ok && j.name === 'blindbox-server' ? base : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

function buildIndex(data) {
  const byId = {}, bySeries = {};
  for (const s of data.series) {
    bySeries[s.id] = s;
    for (const it of s.items) byId[it.id] = { ...it, seriesId: s.id, seriesName: s.name };
  }
  return { byId, bySeries };
}

/** 底层请求：统一返回 { ok, status, ...body } */
function makeClient(base) {
  async function call(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    try {
      const r = await fetch(base + path, {
        method, headers, cache: 'no-store',
        body: body ? JSON.stringify(body) : undefined
      });
      const j = await r.json().catch(() => ({}));
      return { status: r.status, ...j, ok: r.ok && j.ok !== false };
    } catch (e) {
      return { ok: false, status: 0, error: 'network', message: '连不上游戏服务器，请确认启动游戏的黑窗口没有关闭' };
    }
  }
  return { call };
}

/**
 * 游戏对象：所有操作都发给服务器，返回服务器的结果（Promise）。
 * 本地只保存一份服务器最新存档的镜像（state），用来画界面。
 */
export async function createGame(base) {
  const client = makeClient(base);
  const cfgRes = await fetch(base + 'api/config', { cache: 'no-store' });
  if (!cfgRes.ok) throw new Error('读取游戏配置失败');
  const data = await cfgRes.json();
  const index = buildIndex(data);

  const first = await client.call('GET', 'api/state');
  if (!first.ok) throw new Error(first.message || '读取存档失败');
  let state = first.state;
  let progress = first.progress;

  /** 发请求；服务器返回的最新 state 覆盖本地镜像 */
  async function act(path, body) {
    const r = await client.call('POST', path, body || {});
    if (r.state) state = r.state;
    if (r.progress) progress = r.progress;
    if (!r.ok) return { ok: false, reason: r.error || 'error', message: r.message };
    return r;
  }

  const cheapest = Math.min(...data.series.map(s => s.boxPrice));

  return {
    data, index, server: base,
    getState: () => structuredClone(state),
    getProgress: () => structuredClone(progress),
    getPending: () => (state.pending ? { ...state.pending } : null),
    pityAfter: data.economy.pity.secretGuaranteeAfter,
    priceOf: (sid) => index.bySeries[sid].boxPrice,
    sellPrice: (id) => index.byId[id].sellPrice,
    item: (id) => index.byId[id],
    rarityOf: (id) => data.rarities[index.byId[id].rarity],
    inShowcase: (sid, id) => !!state.showcase[sid]?.[id],

    async open(seriesId) {
      const r = await act('api/open', { seriesId });
      return r.ok ? { ...r, item: index.byId[r.entry.itemId] } : r;
    },
    toShowcase: () => act('api/showcase'),
    toStorage: () => act('api/storage'),
    async reopen(uid) {
      const r = await act('api/reopen', { uid });
      return r.ok ? { ...r, item: index.byId[r.entry.itemId] } : r;
    },
    unshowcase: (seriesId, itemId) => act('api/unshowcase', { seriesId, itemId }),
    sellPending: () => act('api/sell', { from: 'pending' }),
    sellFromStorage: (uid) => act('api/sell', { from: 'storage', uid }),
    /** 满足补助条件才发请求（服务器还会再判断一次）；返回补助金额或 null */
    async maybeBailout() {
      if (state.pending || state.storage.length || state.coins >= cheapest) return null;
      const r = await act('api/bailout');
      return r.ok ? r.coins : null;
    },
    reset: () => act('api/reset')
  };
}
