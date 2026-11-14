import './session.js';
import { detectServer, createGame } from './api.js';
import { createShowcase } from './showcase.js';
import { icon, seriesTheme, boxArt, figureArt, hash } from './art.js';
import './ui.css';

const MODEL_CONVENTION = { pathPattern: 'models/<id>.glb' };
const esc = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const number = value => new Intl.NumberFormat('zh-CN').format(value);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const percent = (value, total) => total ? Math.min(100, Math.round(value / total * 100)) : 0;

function showBootMessage(title, subtitle) {
  document.getElementById('boot-title').textContent = title;
  document.getElementById('boot-sub').textContent = subtitle;
}
function fillIcons() {
  document.querySelectorAll('[data-icon]').forEach(node => { node.innerHTML = icon(node.dataset.icon); });
}

async function main() {
  fillIcons();
  const base = await detectServer();
  if (!base) {
    showBootMessage('还没连上你的收藏世界', '请通过「启动游戏」或「开发模式」重新打开，页面会从本机服务器读取游戏。');
    return;
  }
  let game;
  try { game = await createGame(base); }
  catch (error) { showBootMessage('暂时没能打开收藏', String(error.message || error)); return; }
  const { data } = game;
  const totalItems = data.economy.totalItems;
  const itemSeries = new Map(data.series.flatMap((series, index) => series.items.map(item => [item.id, { series, theme: seriesTheme(series, index) }])));
  const featuredRarity = data.rarities.secret ? 'secret' : Object.keys(data.rarities).at(-1);
  const featuredRarityLabel = data.rarities[featuredRarity]?.label || '隐藏款';
  let tab = 'shop', sort = 'default', opening = false, bailing = false, startedAt = Date.now(), toastTimer;
  document.getElementById('hero-total').textContent = number(totalItems);
  document.body.classList.add('ready');

  const showcase = createShowcase(document.body, {
    modelConvention: MODEL_CONVENTION,
    async onBlank(mode) {
      if (mode === 'case') { showcase.hide(); return; }
      const result = await act(game.toStorage(), '已放入仓库，小伙伴在这里等你');
      if (result.ok) showcase.hide();
      render();
    },
    async onShowcase(entry, mode) {
      const result = await game.toShowcase();
      if (!result.ok) return toast(result.message || '暂时没能放入展柜');
      showcase.hide();
      if (result.won) showWin();
      else if (result.seriesComplete) toast(`「${game.index.bySeries[result.entry.seriesId].name}」已经集齐啦`);
      else toast('已放进展柜，又多了一份小小的喜欢');
      render();
    },
    async onStorage(mode, entry) {
      const result = await act(mode === 'case' ? game.unshowcase(entry.seriesId, entry.itemId) : game.toStorage(), mode === 'case' ? '已从展柜取回仓库' : '已放入仓库');
      if (result.ok) showcase.hide();
      render();
    },
    async onSell() {
      const result = await game.sellPending();
      if (result.ok) showcase.hide();
      toast(result.ok ? `已卖出，获得 ${number(result.price)} 金币` : result.message || '暂时没能卖出');
      render();
    },
  });

  async function act(promise, message) {
    const result = await promise;
    toast(result.ok ? message : result.message || '操作失败，请再试一次');
    return result;
  }
  function toast(message) {
    const element = document.getElementById('toast');
    element.textContent = message;
    element.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => element.classList.remove('show'), 3000);
  }
  function showFigure(entry, mode) {
    return showcase.show(entry, game.item(entry.itemId), game.rarityOf(entry.itemId), {
      mode,
      alreadyInShowcase: mode === 'new' && game.inShowcase(entry.seriesId, entry.itemId),
      sellPrice: game.sellPrice(entry.itemId),
    });
  }
  function switchTab(next, shouldScroll = true) {
    if (!['shop', 'storage', 'case'].includes(next)) return;
    tab = next;
    document.querySelectorAll('.tabs button').forEach(button => {
      const active = button.dataset.tab === tab;
      button.classList.toggle('active', active);
      button.setAttribute('aria-current', active ? 'page' : 'false');
    });
    render();
    if (shouldScroll) window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  document.querySelectorAll('.tabs button').forEach(button => button.addEventListener('click', () => switchTab(button.dataset.tab)));
  document.querySelectorAll('[data-nav]').forEach(button => button.addEventListener('click', () => switchTab(button.dataset.nav)));
  document.getElementById('brand-home').addEventListener('click', () => switchTab('shop'));
  document.getElementById('btn-explore').addEventListener('click', () => document.getElementById('panel-shop').scrollIntoView({ behavior: 'smooth', block: 'start' }));

  // 说明和重置使用站内对话框；只有确认后才会清空进度。
  document.querySelectorAll('[data-close-dialog]').forEach(button => button.addEventListener('click', () => document.getElementById(button.dataset.closeDialog).close()));
  document.querySelectorAll('.club-dialog').forEach(dialog => dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  }));
  document.getElementById('btn-rules').addEventListener('click', () => document.getElementById('rules-dialog').showModal());
  document.getElementById('btn-reset').addEventListener('click', () => document.getElementById('reset-dialog').showModal());
  document.getElementById('reset-confirm').addEventListener('click', async event => {
    event.currentTarget.disabled = true;
    try {
      const result = await act(game.reset(), '新的收藏旅程，开始啦');
      if (result.ok) {
        document.getElementById('reset-dialog').close();
        document.getElementById('win-overlay').classList.remove('show');
        startedAt = Date.now(); showcase.hide(); render();
      }
    } finally { document.getElementById('reset-confirm').disabled = false; }
  });
  const rules = [
    ['把喜欢留在展柜里', `所有 ${number(totalItems)} 款手办放进展柜，就能完成收藏。展柜中同一款只能放一个。`],
    ['每一抽独立计算', '各系列分别配置掉率，没有连续开盒保底。'],
    ...(data.economy.noDuplicateWithinRarityUntilOwned ? [['新朋友，优先见面', '同一系列、同一稀有度内优先开出从未拥有过的款式。']] : []),
    ['仓库里的小伙伴可以卖出', '展柜中的手办需要先取回仓库再卖出。金币不足且没有能卖的手办时，游戏会提供破产补助。'],
  ];
  document.getElementById('rules-content').innerHTML = `<div class="series-odds-table">${data.series.map(series => `<div class="series-odds-row"><strong>${esc(series.name)} · ${number(series.boxPrice)} 金币 / 盒</strong><div>${Object.entries(data.rarities).map(([key, rarity])=>`<span><i class="rarity-dot" style="--rarity-color:${esc(rarity.color)}"></i>${esc(rarity.label)} <b>${new Intl.NumberFormat('zh-CN',{style:'percent',maximumFractionDigits:2}).format(series.dropRates[key] || 0)}</b></span>`).join('')}</div></div>`).join('')}</div><div class="rule-list">${rules.map(([title, text], index) => `<div class="rule-row"><span>0${index + 1}</span><div><strong>${esc(title)}</strong><p>${esc(text)}</p></div></div>`).join('')}</div>`;


  const openOverlay = document.createElement('div');
  openOverlay.id = 'open-ov';
  openOverlay.setAttribute('role', 'status');
  openOverlay.setAttribute('aria-live', 'polite');
  document.body.appendChild(openOverlay);
  async function playOpen(seriesId) {
    if (opening) return;
    opening = true;
    render();
    try {
      const result = await game.open(seriesId);
      if (!result.ok) { toast(result.message || '暂时无法开箱'); return; }
      if (result.bailout) toast(`破产补助 +${number(result.bailout)} 金币`);
      const series = game.index.bySeries[seriesId];
      const theme = seriesTheme(series);
      openOverlay.innerHTML = `<span class="opening-kicker">A LITTLE SURPRISE IS COMING</span><div class="opening-box">${boxArt(theme, 'opening-' + seriesId)}</div><div class="open-msg">听，盒子里有小小的心跳。</div><div class="opening-note">${esc(series.name)} · 正在拆开你的惊喜</div>`;
      openOverlay.style.display = 'flex';
      await wait(650);
      openOverlay.querySelector('.opening-box').classList.add('revealing');
      openOverlay.querySelector('.open-msg').textContent = '你的新朋友，准备好见面啦。';
      await wait(500);
      openOverlay.querySelector('.open-msg').textContent = result.item.name;
      render();
      await showFigure(result.entry, 'new');
    } catch (error) {
      console.error(error);
      toast('展示暂时没有准备好，手办已经保存在本局进度中');
    } finally {
      openOverlay.style.display = 'none';
      opening = false;
      render();
    }
  }
  async function checkBailout() {
    if (bailing || opening || showcase.isVisible()) return;
    bailing = true;
    try {
      const coins = await game.maybeBailout();
      if (coins) { toast(`破产补助 +${number(coins)} 金币`); render(); }
    } finally { bailing = false; }
  }
  function showWin() {
    const state = game.getState();
    const seconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
    document.getElementById('win-stats').textContent = `集齐 ${number(game.getProgress().total)} 款手办 · 拆开 ${number(state.boxesOpened)} 个盲盒 · 用时 ${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
    document.getElementById('win-overlay').classList.add('show');
  }
  document.getElementById('btn-win-close').addEventListener('click', () => {
    document.getElementById('win-overlay').classList.remove('show');
    switchTab('case');
  });

  function render() {
    const state = game.getState();
    const progress = game.getProgress();
    document.getElementById('coins').textContent = number(state.coins);
    document.getElementById('storage-count').textContent = number(state.storage.length);
    document.getElementById('storage-count').hidden = !state.storage.length;
    document.getElementById('collection-info').innerHTML = `<span class="collection-status">${icon('sparkle')}<span>已收藏 <strong>${progress.owned} / ${progress.total}</strong> 款小伙伴</span><i class="status-divider"></i><span class="status-extra">让每份喜欢，都有一个位置</span></span>`;
    document.getElementById('shop-hero').classList.toggle('hidden', tab !== 'shop');
    for (const name of ['shop', 'storage', 'case']) document.getElementById('panel-' + name).classList.toggle('hidden', tab !== name);
    if (tab === 'shop') renderShop(state);
    if (tab === 'storage') renderStorage(state);
    if (tab === 'case') renderCase(state);
    setTimeout(checkBailout, 0);
  }
  function renderShop(state) {
    const panel = document.getElementById('panel-shop');
    const progress = game.getProgress();
    const seriesList = [...data.series];
    if (sort === 'ascending') seriesList.sort((a, b) => a.boxPrice - b.boxPrice);
    if (sort === 'descending') seriesList.sort((a, b) => b.boxPrice - a.boxPrice);
    panel.innerHTML = `<div class="section-heading"><div><h2>挑选你的下一份惊喜</h2><p>小小一盒，装着不同的奇妙世界。</p></div><div class="section-meta"><span class="series-total-label">共 <strong>${data.series.length}</strong> 个系列</span><select id="shop-sort" class="shop-sort" aria-label="盲盒排序"><option value="default">默认排序</option><option value="ascending">价格从低到高</option><option value="descending">价格从高到低</option></select></div></div><div class="series-grid"></div><p class="shop-footnote">${icon('sparkle')}各系列独立掉率 · 打开惊喜，把喜欢慢慢集齐</p>`;
    const grid = panel.querySelector('.series-grid');
    for (const series of seriesList) {
      const index = data.series.indexOf(series);
      const theme = seriesTheme(series, index);
      const owned = progress.bySeries[series.id];
      const complete = owned.owned >= owned.total;
      const disabled = opening || state.coins < series.boxPrice || state.pending;
      const card = document.createElement('article');
      card.className = 'series-card';
      card.style.setProperty('--tone', theme.tone);
      card.style.setProperty('--ink', theme.ink);
      card.innerHTML = `<div class="series-cover"><div class="cover-topline"><span>SERIES ${String(index + 1).padStart(2, '0')}</span><span class="cover-count">${series.items.length} 款可收藏</span></div>${boxArt(theme, series.id)}<span class="cover-caption">${theme.label}</span></div><div class="series-body"><div class="series-title-row"><h3>${esc(series.name)}</h3>${complete ? `<span class="series-complete">${icon('check')}已集齐</span>` : ''}</div><div class="series-meta"><span>${series.items.length} 款小伙伴</span><i class="meta-dot"></i><span>卖价 ×${series.sellMultiplier}</span></div><div class="series-progress"><span>已收藏 <strong>${owned.owned} / ${owned.total}</strong></span><span>${complete ? '快乐满格' : '慢慢集齐喜欢'}</span></div><div class="mini-progress"><span style="width:${percent(owned.owned, owned.total)}%"></span></div><button class="buy-btn" type="button" ${disabled ? 'disabled' : ''} aria-label="开盲盒 · ${series.boxPrice} 金币"><span>${state.pending ? '先安置小伙伴' : state.coins < series.boxPrice ? '金币不足' : '开一盒'}</span><span class="buy-price">${icon('coin')}${number(series.boxPrice)}</span></button><div class="series-secret-rate"><span>${esc(featuredRarityLabel)} ${new Intl.NumberFormat('zh-CN',{style:'percent',maximumFractionDigits:1}).format(series.dropRates[featuredRarity] || 0)}</span><span>各系列独立掉率</span></div></div>`;
      card.querySelector('.buy-btn').addEventListener('click', () => playOpen(series.id));
      grid.appendChild(card);
    }
    const select = panel.querySelector('#shop-sort');
    select.value = sort;
    select.addEventListener('change', () => { sort = select.value; renderShop(game.getState()); });
  }
  function renderStorage(state) {
    const panel = document.getElementById('panel-storage');
    panel.innerHTML = `<div class="section-heading"><div><h2>我的小小仓库</h2><p>暂时收好每一份喜欢，随时再见面。</p></div><span class="section-meta">${state.storage.length} 位小伙伴在这里</span></div>`;
    if (!state.storage.length) {
      panel.innerHTML += `<div class="empty-state"><div class="empty-art">${boxArt(seriesTheme(data.series[0]), 'empty-storage')}</div><h3>下一位小伙伴，还在盒子里。</h3><p>开出的手办可以先放在这里，再决定留在展柜，或换成下一次惊喜的金币。</p><button class="btn btn-primary" id="empty-go-shop" type="button">去逛逛商店${icon('arrow')}</button></div>`;
      panel.querySelector('#empty-go-shop').addEventListener('click', () => switchTab('shop'));
      return;
    }
    const grid = document.createElement('div'); grid.className = 'storage-grid';
    for (const entry of state.storage) {
      const item = game.item(entry.itemId);
      if (!item) continue;
      const rarity = game.rarityOf(entry.itemId);
      if (!rarity) continue;
      const { series, theme } = itemSeries.get(item.id);
      const card = document.createElement('button');
      card.type = 'button'; card.className = 'storage-card'; card.setAttribute('aria-label', `查看${item.name}`);
      card.style.setProperty('--tone', theme.soft);
      card.style.setProperty('--ink', theme.ink);
      card.innerHTML = `<div class="storage-thumb">${figureArt(theme, item.id, false, item.name)}<span class="storage-rarity"><i class="rarity-dot" style="--rarity-color:${esc(rarity.color)}"></i>${esc(rarity.label)}</span></div><div class="storage-details"><h3>${esc(item.name)}</h3><p>${esc(series.name)}</p><div class="storage-price"><span>${icon('coin')}${number(item.sellPrice)}</span><span>点击看看${icon('arrow')}</span></div></div>`;
      card.addEventListener('click', async () => {
        const result = await game.reopen(entry.uid);
        if (!result.ok) return toast(result.message || '暂时没能打开');
        await showFigure(result.entry, 'new'); render();
      });
      grid.appendChild(card);
    }
    panel.appendChild(grid);
  }
  function renderCase(state) {
    const panel = document.getElementById('panel-case');
    const progress = game.getProgress();
    const ratio = percent(progress.owned, progress.total);
    panel.innerHTML = `<div class="collection-summary"><div><span class="eyebrow">MY LITTLE COLLECTION</span><h2>我的收藏宇宙</h2><p>每多一位小伙伴，快乐就多一点。</p></div><div><div class="collection-total" id="progress-total">${progress.owned} <span>/ ${progress.total} 款已收藏</span></div><div class="progress-bar"><div style="width:${ratio}%"></div></div><div class="progress-fraction"><span>离收藏圆满又近了一点</span><span>${ratio}%</span></div></div></div><div class="progress-series">${data.series.map((series, index) => { const theme = seriesTheme(series, index); const p = progress.bySeries[series.id]; return `<button class="series-jump" type="button" data-target="collection-${hash(series.id)}" style="--ink:${theme.ink}"><i></i>${esc(series.name)}<span>${p.owned}/${p.total}</span></button>`; }).join('')}</div>`;
    for (const [index, series] of data.series.entries()) {
      const theme = seriesTheme(series, index);
      const owned = progress.bySeries[series.id];
      const block = document.createElement('section'); block.className = 'collection-series'; block.id = 'collection-' + hash(series.id); block.style.setProperty('--ink', theme.ink);
      block.innerHTML = `<div class="collection-series-heading"><h3><i></i>${esc(series.name)}</h3><span>${owned.owned === owned.total ? '已集齐，快乐满格' : `已收藏 ${owned.owned} / ${owned.total} 款`}</span></div><div class="showcase-row"></div>`;
      const row = block.querySelector('.showcase-row');
      for (const item of series.items) {
        const rarity = data.rarities[item.rarity];
        const collected = !!state.showcase[series.id]?.[item.id];
        const slot = document.createElement('button'); slot.type = 'button'; slot.className = 'slot' + (collected ? ' owned' : ''); slot.disabled = !collected;
        slot.setAttribute('aria-label', collected ? `查看${item.name}` : `尚未收集：${item.name}`);
        slot.innerHTML = `<span class="slot-code">${esc(item.id.toUpperCase())}</span>${figureArt(theme, item.id, !collected, item.name)}${collected ? '' : `<span class="lock-mark">${icon('lock')}</span>`}<span class="slot-name">${esc(item.name)}</span><span class="slot-rarity"><i class="rarity-dot" style="--rarity-color:${collected ? esc(rarity.color) : '#c1cab3'}"></i>${collected ? esc(rarity.label) : '等待相遇'}</span>`;
        if (collected) slot.addEventListener('click', () => showFigure({ seriesId: series.id, itemId: item.id }, 'case'));
        row.appendChild(slot);
      }
      panel.appendChild(block);
    }
    panel.querySelectorAll('.series-jump').forEach(button => button.addEventListener('click', () => document.getElementById(button.dataset.target).scrollIntoView({ behavior: 'smooth', block: 'start' })));
  }

  if (game.getState().pending) await game.toStorage();
  window.game = game;
  window.showcase = showcase;
  window.__blindbox = { render, toast, showWin, playOpen, switchTab, getStartedAt: () => startedAt };
  render();
  await checkBailout();
}
main().catch(error => { console.error(error); showBootMessage('暂时没能打开收藏', error.message); });
