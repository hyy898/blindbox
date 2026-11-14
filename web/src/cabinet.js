import { esc, themeFor } from './themes.js';
import './cabinet.css';

const SLOT_COUNT = 3;

function safeCount(value) {
  return Math.max(0, Number(value) || 0);
}

function renderSlot(slot, position, item, selected) {
  const number = String(position + 1).padStart(2, '0');
  return `
    <article class="q-cabinet-bay${selected ? ' is-selected' : ''}${item ? ' is-filled' : ''}">
      <div class="q-cabinet-light" aria-hidden="true"></div>
      <div class="q-cabinet-view" id="slot-${position}" aria-label="陈列位置 ${position + 1}${item ? `：${esc(item.name)}` : '，尚未摆放'}">
        ${!item ? `<div class="q-cabinet-empty"><span>${number}</span><p>暂未摆放</p></div>` : ''}
      </div>
      <div class="q-cabinet-plinth" aria-hidden="true"></div>
      <button class="q-cabinet-nameplate" data-select-slot="${position}" aria-pressed="${selected}" aria-expanded="${selected}"${selected ? ' aria-controls="q-cabinet-editor"' : ''}>
        <span class="q-cabinet-position">陈列 ${number}</span>
        <strong>${item ? esc(item.name) : '待陈列'}</strong>
        <span class="q-cabinet-series">${item ? esc(themeFor(item.seriesId).label) : '选择一件藏品'}</span>
        <span class="q-cabinet-edit-hint">${selected ? '正在调整' : '调整'} <span aria-hidden="true">↗</span></span>
      </button>
    </article>`;
}

function renderEditor(position, slot, available, byId) {
  const rotation = Math.max(-180, Math.min(180, Number(slot?.rotation) || 0));
  return `
    <section class="q-cabinet-editor" id="q-cabinet-editor" aria-labelledby="q-cabinet-editor-title">
      <div class="q-cabinet-editor-heading">
        <div><span class="q-cabinet-kicker">调整陈列</span><h2 id="q-cabinet-editor-title">位置 ${String(position + 1).padStart(2, '0')}</h2></div>
        <button class="q-cabinet-close" id="close-slot-editor" aria-label="完成陈列调整">完成 <span aria-hidden="true">×</span></button>
      </div>
      <div class="q-cabinet-editor-fields">
        <label class="q-cabinet-pick"><span>摆放藏品</span>
          <select data-slot="${position}" aria-label="陈列位置 ${position + 1} 的藏品">
            <option value="">暂时留空</option>
            ${available.map(entry => `<option value="${esc(entry.itemId)}"${slot?.itemId === entry.itemId ? ' selected' : ''}>${esc(byId[entry.itemId].name)}</option>`).join('')}
          </select>
        </label>
        ${slot ? `<div class="q-cabinet-orientation">
          <label for="q-cabinet-rotation">藏品朝向</label>
          <div class="q-cabinet-rotation-row"><span aria-hidden="true">−180°</span><input id="q-cabinet-rotation" data-rotation="${position}" type="range" min="-180" max="180" step="5" value="${rotation}" aria-label="陈列位置 ${position + 1} 的朝向"><span aria-hidden="true">180°</span></div>
          <button class="q-cabinet-reset" data-reset-rotation="${position}">回到正面</button><button class="q-cabinet-reset" id="view-slot">查看藏品</button>
        </div>` : '<p class="q-cabinet-editor-note">选择要摆放的藏品。</p>'}
      </div>
      <p class="q-cabinet-save-note">陈列位置与朝向自动保存在当前浏览器。</p>
    </section>`;
}

/** Presentation only: the caller owns inventory, selection, persistence and viewers. */
export function renderCabinet({ slots = [], available = [], index, selectedSlot = null, totalOwned = 0, totalItems = 0 }) {
  const byId = index?.byId || {};
  const seen = new Set();
  const choices = available.filter(entry => {
    if (!byId[entry.itemId] || seen.has(entry.itemId)) return false;
    seen.add(entry.itemId);
    return true;
  });
  const positions = Array.from({ length: SLOT_COUNT }, (_, position) => {
    const slot = slots[position];
    return slot && byId[slot.itemId] ? slot : null;
  });
  const selected = Number.isInteger(selectedSlot) && selectedSlot >= 0 && selectedSlot < SLOT_COUNT ? selectedSlot : null;
  const displayed = positions.filter(Boolean).length;

  return `
    <section class="q-cabinet-page">
      <header class="q-cabinet-heading">
        <div><h1>我的展柜</h1></div>
        <div class="q-cabinet-collection-count"><strong>${safeCount(totalOwned)}<span> / ${safeCount(totalItems)}</span></strong><span>款已在展柜</span></div>
      </header>
      <section class="q-cabinet-furniture" aria-label="三个固定陈列位置">
        <div class="q-cabinet-cornice"><span>奇物百货</span></div>
        <div class="q-cabinet-interior">
          ${positions.map((slot, position) => renderSlot(slot, position, slot && byId[slot.itemId], selected === position)).join('')}
        </div>
        <div class="q-cabinet-base"><span>正在陈列 <strong>${displayed} / ${SLOT_COUNT}</strong> 件</span></div>
      </section>
      ${selected !== null ? renderEditor(selected, positions[selected], choices, byId) : ''}
      <div class="q-cabinet-footer">${displayed?'<button class="secondary" id="cabinet-photo">保存展柜合影</button>':''}
        ${choices.length ? '' : '<p>暂无可陈列藏品。在收藏详情中选择「放入展柜」。</p>'}
        <button class="q-cabinet-collection-link" data-nav="collection">从我的收藏挑选 <span aria-hidden="true">→</span></button>
      </div>
    </section>`;
}
