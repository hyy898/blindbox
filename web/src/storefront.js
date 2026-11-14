import { esc, motif, boxMarkup, themeFor } from './themes.js';
import { modelAssets } from './assets.js';
import './storefront.css';
const fmt = n => new Intl.NumberFormat('zh-CN').format(n);
export function collectibleArt(item, series) {
  const asset = modelAssets[item.id];
  return asset?.available && asset.thumbnail
    ? `<img class="collectible-thumb" src="${asset.thumbnail}" alt="${esc(item.name)}的真实模型缩略图" loading="lazy">`
    : `<span class="catalog-icon">${motif(series.id)}</span>`;
}
export function boxPosition(index, picked) {
  if (index === picked) return 'center';
  return [0, 1, 2].filter(i => i !== picked).indexOf(index) === 0 ? 'left' : 'right';
}
export function renderStorefront({series, selected, picked, state, entries, index, slots, busy}) {
  const current = index.bySeries[selected], owned = new Set(entries.map(e => e.itemId));
  const disabled = busy || (!state.pending && state.coins < current.boxPrice);
  return `<section class="store-space" aria-label="奇物百货店内柜台" style="--accent:${themeFor(selected).accent};--paper:#f1e4d3">
    <div class="store-sign"><span>今日到货</span><i></i><small>四格货架，各有脾气</small><span class="business-sign">● 营业中</span></div>
    <div class="mobile-series-tabs" aria-label="选择系列">${series.map(s=>`<button data-series="${s.id}" aria-pressed="${s.id===selected}">${esc(s.name)}</button>`).join('')}</div>
    <div class="rear-shelves" aria-label="系列货架">${series.map((s,i)=>{
      return `<button class="shelf-niche ${s.id===selected?'active':''}" data-series="${s.id}" aria-pressed="${s.id===selected}" aria-label="${esc(s.name)}，${s.items.length}款，选择这个系列">
        <span class="niche-number">${String(i+1).padStart(2,'0')}</span>
        <span class="niche-figure generated-art art-${s.id}"><img src="./series/${s.id}.png" alt="${esc(s.name)}系列手绘插画" class="shelf-illustration"></span>
        <span class="illustration-note">系列示意</span>
        <span class="niche-plaque"><strong>${esc(s.name)}</strong><small>${s.items.length} 款 · 已拥有 ${s.items.filter(it=>owned.has(it.id)).length}</small></span>
        <span class="shelf-selected">${s.id===selected?'正在挑选':'来这边看看'}</span>
      </button>`;
    }).join('')}</div>
    <div class="shop-counter"><div class="wood-countertop"></div><div class="counter-apron"></div><div class="counter-runner"></div>
      <div class="counter-boxes" aria-label="选择包装盒">${[0,1,2].map(i=>`<button class="counter-box pos-${boxPosition(i,picked)}" data-box="${i}" aria-label="选择第 ${i+1} 盒" aria-pressed="${picked===i}">${boxMarkup(current,i+1)}<span class="box-pick-label">${String(i+1).padStart(2,'0')} · ${picked===i?'就这一盒':'换这盒'}</span></button>`).join('')}</div>
      <div class="counter-price"><span>${esc(current.name)}</span><b>${fmt(current.boxPrice)} <small>金币 / 盒</small></b><button id="odds" class="text-link">${current.items.length} 款 · 查看款式与概率 ↗</button></div>
      <div class="counter-action"><button id="pick" class="primary" ${disabled?'disabled':''}>${state.pending?'继续查看柜台藏品':state.coins<current.boxPrice?'金币不足':'挑这一盒'}<span>↗</span></button><small>选盒不扣金币，拆封时才结算</small></div>
      <span class="counter-inscription">奇物百货 · 请轻拿轻放</span>
    </div>
  </section>
  <section class="collection-strip" aria-label="我的收藏快捷入口"><div class="strip-title"><strong>我的收藏</strong><small>${entries.length} 件 · ${owned.size} 款已拥有</small></div><div class="strip-items">${entries.length?entries.slice(0,4).map((e,i)=>{const item=index.byId[e.itemId];return `<button data-entry="${i}" aria-label="查看${esc(item.name)}"><span>${collectibleArt(item,index.bySeries[e.seriesId])}</span><small>${esc(item.name)}</small></button>`;}).join(''):'<p>第一件奇物，等你带回。</p>'}</div><div class="strip-links"><button data-nav="collection">查看收藏 →</button><button data-nav="case">我的展柜 <small>${slots.filter(Boolean).length} / 3</small> →</button></div></section>`;
}
