import './saves.css';
import { esc } from './themes.js';

const number = value => new Intl.NumberFormat('zh-CN').format(value);
const date = value => new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
}).format(new Date(value));

export function openSaveManager({ game, getPresentation, onLoad, onNewGame, onStateChange, toast }) {
  const existing = document.querySelector('#save-manager');
  if (existing) { existing.focus(); return; }
  if (game.isBusy()) { toast('正在保存这次操作，请稍候。'); return; }
  const previousFocus = document.activeElement;
  const modal = document.createElement('dialog');
  modal.id = 'save-manager';
  modal.className = 'save-manager';
  modal.setAttribute('aria-labelledby', 'save-title');
  let saves = [], loading = true, savesReady = false, working = false, error = '', confirmation = null;
  const names = new Map();

  function close() {
    if (working) return;
    modal.close();
    modal.remove();
    if (previousFocus?.isConnected) previousFocus.focus();
    else document.querySelector('#save-game')?.focus();
  }

  function confirmMarkup(slot) {
    if (confirmation?.slot !== slot) return '';
    const { action, name } = confirmation;
    const messages = {
      save: `要覆盖「${name}」吗？这份记录会被当前进度替换。`,
      load: `要读取「${name}」吗？金币、收藏和展柜会一起恢复，当前进度会先自动备份。`,
      delete: `要删除「${name}」吗？这份记录无法恢复，当前游戏进度会保留。`,
      'new-game': `确认重新开局？金币将恢复为 ${number(game.data.economy.startCoins)}，收藏、待收纳藏品和抽盒记录会清空。三个手动存档会保留，当前进度会先自动备份。`
    };
    return `<div class="save-confirm" role="group" aria-label="确认存档操作">
      <p>${esc(messages[action])}</p><div><button class="secondary" data-action="cancel">取消</button>
      <button class="primary${['delete', 'new-game'].includes(action) ? ' save-danger' : ''}" data-action="confirm">确认${{ save: '覆盖', load: '读档', delete: '删除', 'new-game': '重新开局' }[action]}</button></div>
    </div>`;
  }

  function slotMarkup(slot, backup = false) {
    const save = saves.find(value => value.slot === slot);
    const defaultName = `存档 ${String(slot).padStart(2, '0')}`;
    return `<article class="save-slot${save ? ' is-filled' : ''}${backup ? ' is-backup' : ''}" data-save-slot="${slot}">
      <span class="save-number" aria-hidden="true">${backup ? '↶' : String(slot).padStart(2, '0')}</span>
      <div class="save-slot-content"><div class="save-slot-heading">
        ${backup ? `<h3>${esc(save?.name || '操作前的进度')}</h3>` : `<label class="save-name"><span class="sr-only">存档 ${slot} 的名称</span><input data-save-name="${slot}" maxlength="24" placeholder="${defaultName}" value="${esc(names.get(slot) ?? save?.name ?? '')}" autocomplete="off" ${working ? 'disabled' : ''}></label>`}
        <span class="save-status">${save ? '已存档' : '空位'}</span></div>
        ${save ? `<p class="save-time">${date(save.updatedAt)} 保存${save.hasPending ? ' · 含待收纳藏品' : ''}</p>
          <div class="save-stats"><span><b>${number(save.coins)}</b> 金币</span><span><b>${number(save.collectionCount)}</b> 件收藏</span><span><b>${number(save.boxesOpened)}</b> 次拆封</span></div>`
          : '<p class="save-empty">给此刻的收藏留一份记录。</p>'}
        <div class="save-actions">${backup ? '' : `<button class="secondary" data-action="save" data-slot="${slot}" ${working ? 'disabled' : ''}>${save ? '覆盖存档' : '存到这里'}</button>`}
          <button class="${backup ? 'secondary' : 'text-link'}" data-action="load" data-slot="${slot}" ${!save || working ? 'disabled' : ''}>${backup ? '恢复这份进度' : '读取存档'}</button>
          ${save ? `<button class="text-link save-delete" data-action="delete" data-slot="${slot}" ${working ? 'disabled' : ''}>删除</button>` : ''}</div>
        ${confirmMarkup(slot)}</div></article>`;
  }

  function render() {
    const state = game.getState();
    const backupOpen = confirmation?.slot === 0 || modal.querySelector('.save-backup')?.open;
    modal.setAttribute('aria-busy', String(loading || working));
    modal.innerHTML = `<div class="dialog-top"><span><b class="mini-stamp">奇</b> 收藏手记</span>
      <button class="close-button" data-action="close" aria-label="关闭存档管理" ${working ? 'disabled' : ''}>×</button></div>
      <div class="save-body"><div class="save-heading"><span class="eyebrow">留住这一刻</span><h2 id="save-title">存档与读档</h2><p>把喜欢的进度收好，随时回来接着拆。</p></div>
      <div class="save-auto"><span class="save-auto-dot" aria-hidden="true"></span><div><b>当前进度自动保存</b><p>${number(state.coins)} 金币 · 已拆 ${number(state.boxesOpened)} 盒，关闭游戏后仍会保留。</p></div></div>
      ${error ? `<div class="save-error" role="alert"><p>${esc(error)}</p><button class="text-link" data-action="refresh" ${working ? 'disabled' : ''}>重新同步 →</button></div>` : ''}
      ${loading ? '<p class="save-loading" role="status">正在翻开收藏手记…</p>' : `<div class="save-slots">${[1, 2, 3].map(slot => slotMarkup(slot)).join('')}</div>
        ${saves.some(save => save.slot === 0) ? `<details class="save-backup"${backupOpen ? ' open' : ''}><summary>最近一次读档或重置前的备份</summary>${slotMarkup(0, true)}</details>` : ''}`}
      <section class="save-new-game" aria-labelledby="new-game-title"><div><h3 id="new-game-title">全新开局</h3><p>从 ${number(game.data.economy.startCoins)} 金币重新开始，手动存档会保留。</p></div>
        <button class="secondary" data-action="new-game" ${working || loading || !savesReady ? 'disabled' : ''}>重新开局 →</button>${confirmMarkup('new')}</section>
      <p class="save-note">手动存档包含金币、收藏、待收纳藏品、展柜摆放与偏好。记录保存在这台电脑上。</p>
      <p class="save-operation" role="status" aria-live="polite">${working ? '正在保存操作，请稍候…' : ''}</p></div>`;
    if (working) return;
    if (confirmation) modal.querySelector('[data-action="cancel"]')?.focus({ preventScroll: true });
  }

  async function readSaves(sync = false) {
    loading = true; savesReady = false; confirmation = null; error = ''; render();
    try {
      if (sync) {
        const result = await game.refresh();
        onStateChange();
        if (!result.ok) { error = result.message; return; }
      }
      const result = await game.listSaves();
      if (!result.ok) {
        error = result.status === 404 ? '当前服务还没有存档管理功能，请关闭旧启动窗口，再用「启动奇物百货」打开。' : result.message || '暂时无法读取存档，请确认启动窗口仍在运行。';
        return;
      }
      saves = result.saves;
      savesReady = true;
    } catch { error = '暂时无法读取存档，请重新同步后再试。'; }
    finally { loading = false; if (modal.isConnected) render(); }
  }

  async function perform({ action, slot, revision, name }) {
    if (working) return;
    working = true; error = ''; confirmation = null; render();
    try {
      const result = action === 'save' ? await game.saveSlot(slot, name, getPresentation(), revision)
        : action === 'load' ? await game.loadSlot(slot, revision, getPresentation())
        : action === 'new-game' ? await game.startNewGame(getPresentation())
        : await game.deleteSlot(slot, revision);
      onStateChange();
      if (!result.ok) {
        error = result.message || '操作没有完成，请重新同步后再试。';
        const latest = await game.listSaves();
        if (latest.ok) saves = latest.saves;
        return;
      }
      if (action === 'load') {
        onLoad(result.presentation);
        toast('已读取存档，读档前的进度已备份。');
        working = false; close();
        return;
      }
      if (action === 'new-game') {
        onNewGame(result.presentation);
        toast('已开始新游戏，重置前的进度已备份。');
        working = false; close();
        return;
      }
      toast(action === 'save' ? '这一刻的收藏已存好。' : '已删除这份存档，当前进度保留。');
      if (action === 'delete') names.delete(slot);
      const latest = await game.listSaves();
      if (latest.ok) saves = latest.saves;
      else error = '操作已完成，列表暂时未能更新，请重新同步。';
    } catch { error = '连接中断，请重新同步并确认结果后继续。'; }
    finally {
      working = false;
      if (modal.isConnected) render();
    }
  }

  modal.addEventListener('cancel', event => { event.preventDefault(); close(); });
  modal.addEventListener('input', event => {
    if (event.target.matches('[data-save-name]')) names.set(Number(event.target.dataset.saveName), event.target.value);
  });
  modal.addEventListener('click', event => {
    const button = event.target.closest('button[data-action]');
    if (!button || button.disabled || working) return;
    const { action } = button.dataset;
    if (action === 'close') { close(); return; }
    if (action === 'refresh') { void readSaves(true); return; }
    if (action === 'cancel') {
      const previous = confirmation;
      confirmation = null; render();
      modal.querySelector(previous.action === 'new-game' ? '[data-action="new-game"]' : `[data-save-slot="${previous.slot}"] [data-action="${previous.action}"]`)?.focus({ preventScroll: true });
      return;
    }
    if (action === 'confirm') { if (confirmation) void perform(confirmation); return; }
    if (loading) return;
    if (action === 'new-game') {
      confirmation = { action, slot: 'new', name: '全新开局' };
      render();
      modal.querySelector('.save-new-game')?.scrollIntoView({ block: 'nearest' });
      return;
    }
    const slot = Number(button.dataset.slot), save = saves.find(value => value.slot === slot);
    const intent = { action, slot, revision: save?.revision ?? '', name: action === 'save'
      ? (names.get(slot) ?? save?.name ?? '').trim() || `存档 ${String(slot).padStart(2, '0')}` : save?.name };
    if (action === 'save' && !save) { void perform(intent); return; }
    if (!save) return;
    confirmation = intent;
    render();
  });
  document.body.append(modal);
  render();
  modal.showModal();
  void readSaves();
}
