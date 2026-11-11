/**
 * 开盲盒 · 网页界面
 * 所有规则都在 C++ 服务器上（server/src/economy.cpp），这里只负责显示和把操作发给服务器。
 * 盲盒、手办、价格全部来自服务器的 GET /api/config（server/src/game_config.cpp）。
 */
import { detectServer, createGame } from './api.js';
import { createShowcase } from './showcase.js';
import './ui.css';

const MODEL_CONVENTION = { pathPattern: 'models/<id>.glb' };
const esc = (t) => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const wait = (ms) => new Promise(r => setTimeout(r, ms));

function showBootMessage(title, sub) {
  document.getElementById('boot-title').textContent = title;
  document.getElementById('boot-sub').textContent = sub;
}

async function main() {
  // 没有服务器（例如直接双击 index.html）→ 保持提示画面
  const base = await detectServer();
  if (!base) {
    showBootMessage('请双击 启动游戏.bat 运行',
      location.protocol === 'file:'
        ? '游戏需要通过启动器打开（macOS：右键 启动游戏.command → 打开）'
        : '连不上游戏服务器：请重新双击 启动游戏.bat，并且不要关闭黑窗口');
    return;
  }
  let game;
  try {
    game = await createGame(base);
  } catch (e) {
    showBootMessage('游戏服务器出错了', String(e.message || e));
    return;
  }
  document.body.classList.add('ready');
  const { data } = game;
  let startedAt = Date.now();

  // ---------------- 展示界面 ----------------
  const showcase = createShowcase(document.body, {
    modelConvention: MODEL_CONVENTION,
    // 点空白处：新开出的 → 放入仓库；从展柜点开的 → 只是关闭
    async onBlank(mode) {
      if (mode === 'case') { showcase.hide(); return; }
      await act(game.toStorage(), '已放入仓库（可以在仓库里再打开）');
      showcase.hide();
      render();
    },
    async onShowcase() {
      const r = await game.toShowcase();
      if (!r.ok) return toast('操作失败：' + r.message);
      showcase.hide();
      if (r.won) showWin();
      else if (r.seriesComplete) toast(`✨ 集齐「${game.index.bySeries[r.entry.seriesId].name}」！`);
      else toast('已放进展柜');
      render();
    },
    async onStorage(mode, entry) {
      if (mode === 'case') await act(game.unshowcase(entry.seriesId, entry.itemId), '已从展柜取回仓库');
      else await act(game.toStorage(), '已放入仓库');
      showcase.hide();
      render();
    },
    async onSell() {
      const r = await game.sellPending();
      showcase.hide();
      toast(r.ok ? `卖掉 +${r.price} 金币` : '操作失败：' + r.message);
      render();
    }
  });

  async function act(promise, okMsg) {
    const r = await promise;
    toast(r.ok ? okMsg : '操作失败：' + r.message);
    return r;
  }

  function showFigure(entry, mode) {
    const item = game.item(entry.itemId);
    return showcase.show(entry, item, game.rarityOf(entry.itemId), {
      mode,
      alreadyInShowcase: mode === 'new' && game.inShowcase(entry.seriesId, entry.itemId),
      sellPrice: game.sellPrice(entry.itemId)
    });
  }

  // ---------------- 开箱动画 ----------------
  const openOv = document.createElement('div');
  openOv.id = 'open-ov';
  openOv.innerHTML = `<div class="box-big">🎁</div><div class="open-msg">开箱中…</div>`;
  openOv.style.cssText = 'display:none;position:fixed;inset:0;z-index:25;background:#000a;align-items:center;justify-content:center;flex-direction:column;gap:12px;font-size:18px;';
  openOv.querySelector('.box-big').style.cssText = 'font-size:96px;';
  document.body.appendChild(openOv);

  let opening = false;
  async function playOpen(seriesId) {
    if (opening) return;
    opening = true;
    try {
      const res = await game.open(seriesId);
      if (!res.ok) {
        toast(res.message || '无法开箱');
        await checkBailout();
        render();
        return;
      }
      if (res.bailout) toast(`破产补助 +${res.bailout} 金币`);
      const box = openOv.querySelector('.box-big');
      const msg = openOv.querySelector('.open-msg');
      openOv.style.display = 'flex';
      box.textContent = '🎁'; msg.textContent = '盒子在晃…';
      box.style.animation = 'shake 0.7s ease-in-out';
      await wait(700);
      box.textContent = '📦'; msg.textContent = '打开了！'; box.style.animation = '';
      await wait(450);
      box.textContent = '✨'; msg.textContent = res.item.name + ' 跳出来了！';
      await wait(500);
      openOv.style.display = 'none';
      render();
      await showFigure(res.entry, 'new');
    } finally {
      opening = false;
    }
  }

  // 钱买不起最便宜的盒子、仓库也空了 → 自动领破产补助（每次刷新界面后检查一次）
  let bailing = false;
  async function checkBailout() {
    if (bailing || showcase.isVisible()) return;
    bailing = true;
    try {
      const b = await game.maybeBailout();
      if (b) { toast(`破产补助 +${b} 金币`); render(); }
    } finally {
      bailing = false;
    }
  }

  // ---------------- 页签 ----------------
  let tab = 'shop';
  document.querySelectorAll('.tabs button').forEach(btn => {
    btn.addEventListener('click', () => {
      tab = btn.dataset.tab;
      document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('active', b === btn));
      render();
    });
  });

  document.getElementById('btn-reset').addEventListener('click', async () => {
    if (!confirm('确定重置全部进度？')) return;
    await act(game.reset(), '已重置');
    startedAt = Date.now();
    showcase.hide();
    render();
  });

  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.remove('show');
    void t.offsetWidth;
    t.classList.add('show');
  }

  function showWin() {
    const st = game.getState();
    const secs = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
    document.getElementById('win-stats').textContent =
      `${game.getProgress().total} 个手办全部放进展柜！开了 ${st.boxesOpened} 个盲盒 · 本次用时 ${Math.floor(secs / 60)} 分 ${secs % 60} 秒`;
    document.getElementById('win-overlay').classList.add('show');
  }
  document.getElementById('btn-win-close').addEventListener('click', () => {
    document.getElementById('win-overlay').classList.remove('show');
  });

  // ---------------- 渲染 ----------------
  function render() {
    const st = game.getState();
    document.getElementById('coins').textContent = st.coins;
    document.getElementById('pity-info').textContent = '保底进度（每种盲盒分别计算）：' +
      data.series.map(s => `${s.name} ${st.pity[s.id] || 0}/${game.pityAfter}`).join(' · ');
    for (const name of ['shop', 'storage', 'case'])
      document.getElementById('panel-' + name).classList.toggle('hidden', tab !== name);
    if (tab === 'shop') renderShop(st);
    if (tab === 'storage') renderStorage(st);
    if (tab === 'case') renderCase(st);
    setTimeout(checkBailout, 0);
  }

  function renderShop(st) {
    const root = document.getElementById('panel-shop');
    const prog = game.getProgress();
    root.innerHTML = '';
    const grid = document.createElement('div');
    grid.className = 'series-grid';
    for (const s of data.series) {
      const p = prog.bySeries[s.id];
      const card = document.createElement('div');
      card.className = 'series-card';
      card.innerHTML = `
        <div class="box-visual">🎁</div>
        <h3>${esc(s.name)}${p.owned === p.total ? ' ✅' : ''}</h3>
        <div class="meta">展柜 ${p.owned}/${p.total} · 卖价 ×${s.sellMultiplier}</div>
        <button class="btn btn-primary buy-btn" data-sid="${s.id}"
          ${st.coins < s.boxPrice || st.pending ? 'disabled' : ''}>开盲盒 · ${s.boxPrice} 金币</button>`;
      grid.appendChild(card);
    }
    root.appendChild(grid);
    root.querySelectorAll('.buy-btn').forEach(btn => btn.addEventListener('click', () => playOpen(btn.dataset.sid)));
  }

  function renderStorage(st) {
    const root = document.getElementById('panel-storage');
    root.innerHTML = '<p style="color:var(--muted)">点手办打开展示界面，可以放进展柜或卖掉。只有仓库里的手办能卖。</p>';
    if (!st.storage.length) { root.innerHTML += '<p>仓库空空如也</p>'; return; }
    const grid = document.createElement('div');
    grid.className = 'storage-grid';
    for (const entry of st.storage) {
      const item = game.item(entry.itemId);
      const rar = game.rarityOf(entry.itemId);
      const card = document.createElement('div');
      card.className = 'storage-card';
      card.innerHTML = `<div class="thumb" style="background:${rar.color}33">🧸</div>
        <div>${esc(item.name)}</div><div style="color:${rar.color}">${rar.label} · ${item.sellPrice} 金币</div>`;
      card.addEventListener('click', async () => {
        const r = await game.reopen(entry.uid);
        if (!r.ok) return toast('无法打开：' + r.message);
        await showFigure(r.entry, 'new');
        render();
      });
      grid.appendChild(card);
    }
    root.appendChild(grid);
  }

  function renderCase(st) {
    const root = document.getElementById('panel-case');
    const prog = game.getProgress();
    const pct = prog.total ? Math.round(prog.owned / prog.total * 100) : 0;
    root.innerHTML = `<div class="progress-head">
        <div class="total" id="progress-total">收集进度 ${prog.owned}/${prog.total}</div>
        <div class="progress-bar"><div style="width:${pct}%"></div></div>
        <div class="progress-series">${data.series.map(s =>
          `<span>${esc(s.name)} ${prog.bySeries[s.id].owned}/${prog.bySeries[s.id].total}</span>`).join('')}</div>
      </div>`;
    for (const s of data.series) {
      const p = prog.bySeries[s.id];
      const block = document.createElement('div');
      block.className = 'series-card';
      block.style.marginBottom = '12px';
      block.innerHTML = `<h3>${esc(s.name)} · ${p.owned}/${p.total}${p.owned === p.total ? ' · 已集齐' : ''}</h3>`;
      const row = document.createElement('div');
      row.className = 'showcase-row';
      for (const it of s.items) {
        const rar = data.rarities[it.rarity];
        const owned = !!st.showcase[s.id]?.[it.id];
        const slot = document.createElement('div');
        slot.className = 'slot' + (owned ? ' owned' : '');
        if (owned) {
          slot.title = it.name + '（点击查看）';
          slot.innerHTML = `<div class="dot" style="background:${rar.color}"></div>
            <div>${esc(it.name)}</div><span class="rarity-tag" style="color:${rar.color}">${rar.label}</span>`;
          slot.addEventListener('click', () => showFigure({ seriesId: s.id, itemId: it.id }, 'case'));
        } else {
          slot.innerHTML = `<div class="sil"></div><div style="color:#666">${esc(it.name)}</div>`;
        }
        row.appendChild(slot);
      }
      block.appendChild(row);
      root.appendChild(block);
    }
  }

  // 上次关网页时还在展示界面里的手办 → 放回仓库
  if (game.getState().pending) await game.toStorage();

  // 给自动化测试用
  window.game = game;
  window.showcase = showcase;
  window.__blindbox = { render, toast, showWin, playOpen, getStartedAt: () => startedAt };

  render();
  await checkBailout();
}

main().catch(err => {
  console.error(err);
  showBootMessage('启动失败', err.message);
});
