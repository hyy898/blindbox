import './style.css';
import { createGame } from './api.js';
import { themeFor, esc, motif, boxMarkup } from './themes.js';
import { renderStorefront, collectibleArt, boxPosition } from './storefront.js';
import { modelAssets } from './assets.js';
import { renderCabinet } from './cabinet.js';
const $ = (q,el=document)=>el.querySelector(q);
const fmt = n=>new Intl.NumberFormat('zh-CN').format(n);
const percent = n=>new Intl.NumberFormat('zh-CN',{style:'percent',maximumFractionDigits:2}).format(n);
const app=$('#app'), dialog=$('#experience');
let game, page='shop', selected, picked=1, busy=false, dialogToken=0, animationTimer, viewer, shelves=[], activeEntry, entryMode, lastFocus, selectedSlot=null;
const safeRead=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{return fallback;}};
const prefs=safeRead('qiwu-preferences',{muted:true,reduced:matchMedia('(prefers-reduced-motion: reduce)').matches});
let layout=safeRead('qiwu-display-v1',[null,null,null]);
if(!Array.isArray(layout)) layout=[null,null,null];
layout=Array.from({length:3},(_,i)=>layout[i]&&typeof layout[i].itemId==='string'?{itemId:layout[i].itemId,rotation:Number(layout[i].rotation)||0}:null);
function persist(key,value){try{localStorage.setItem(key,JSON.stringify(value));return true;}catch{toast('浏览器未允许保存陈列设置；藏品仍保存在本机。');return false;}}
function toast(message){const t=$('#toast');t.textContent=message;t.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.classList.remove('show'),4200);}
function themeStyle(s){const t=themeFor(s.id);return `--accent:${t.accent};--paper:${t.paper}`;}
function current(){return game.index.bySeries[selected];}
function ownEntries(){const st=game.getState();const entries=st.storage.map(e=>({...e,mode:'storage'}));for(const [sid,items] of Object.entries(st.showcase)) for(const [id,value] of Object.entries(items)) if(value) entries.push({seriesId:sid,itemId:id,mode:'case'});if(st.pending) entries.unshift({...st.pending,mode:'pending'});return entries;}
function possessed(){return new Set(ownEntries().map(e=>e.itemId));}
function setBusy(value){busy=value;document.querySelectorAll('[data-write]').forEach(b=>b.disabled=value||b.dataset.locked==='true');}
function sound(id){if(prefs.muted)return;try{const ctx=new (window.AudioContext||window.webkitAudioContext)();const osc=ctx.createOscillator(),gain=ctx.createGain();osc.connect(gain);gain.connect(ctx.destination);osc.type=id==='weird-appliances'?'triangle':'sine';osc.frequency.setValueAtTime(themeFor(id).frequency,ctx.currentTime);osc.frequency.exponentialRampToValueAtTime(170,ctx.currentTime+.23);gain.gain.setValueAtTime(.045,ctx.currentTime);gain.gain.exponentialRampToValueAtTime(.001,ctx.currentTime+.3);osc.start();osc.stop(ctx.currentTime+.3);osc.onended=()=>ctx.close();}catch{}}
function header(){const st=game.getState();return `<header class="header"><button class="brand" data-nav="shop" aria-label="奇物百货，回到店内"><span class="brand-stamp">奇</span><span>奇物百货<small>一间收藏不寻常的店</small></span></button><nav aria-label="主导航">${[['shop','店内'],['collection','我的收藏'],['case','我的展柜']].map(([id,label])=>`<button data-nav="${id}" ${page===id?'aria-current="page"':''}>${label}${id==='collection'?`<span class="nav-number">${ownEntries().length}</span>`:''}</button>`).join('')}</nav><div class="header-end"><span class="wallet"><i>◉</i><span><small>可用金币</small><b>${fmt(st.coins)}</b></span></span><button class="icon-button" id="settings" aria-label="偏好与店内说明">☷</button></div></header>`;}
function pendingBar(){return game.getPending()?`<div class="pending-bar"><span>柜台上还有一件待安置的藏品，结果已保存。</span><button class="text-link" id="resume">继续查看 →</button></div>`:'';}
function render(){shelves.forEach(v=>v.dispose());shelves=[];document.documentElement.dataset.reduced=prefs.reduced;app.innerHTML=header()+`<main id="main">${pendingBar()}${page==='shop'?shop():page==='collection'?collection():showcase()}</main><footer class="footer"><span><b>奇物百货</b>　认真陈列 · 不寻常的小物件</span><span>Aholo Lux3D × 团队藏品计划</span><button class="text-link" id="rules">店内说明 ↗</button></footer>`;app.querySelectorAll('[data-nav]').forEach(b=>b.onclick=()=>navigate(b.dataset.nav));$('#settings').onclick=()=>openGuide();$('#rules').onclick=()=>openGuide();if($('#resume'))$('#resume').onclick=()=>showResult(game.getPending(),'pending');if(page==='shop')bindShop();if(page==='collection')bindCollection();if(page==='case')bindCase();}
function navigate(next){closeExperience();selectedSlot=null;page=next;render();window.scrollTo({top:0,behavior:prefs.reduced?'instant':'smooth'});}
function shop(){return renderStorefront({series:game.data.series,selected,picked,state:game.getState(),entries:ownEntries(),index:game.index,slots:validLayout(),busy});}
function bindShop(){
  app.querySelectorAll('[data-series]').forEach(b=>b.onclick=()=>{selected=b.dataset.series;picked=1;render();});
  app.querySelectorAll('[data-box]').forEach(b=>b.onclick=()=>{
    picked=Number(b.dataset.box);
    app.querySelectorAll('[data-box]').forEach(box=>{
      const index=Number(box.dataset.box);
      box.className=`counter-box pos-${boxPosition(index,picked)}`;
      box.setAttribute('aria-pressed',index===picked);
      $('.box-pick-label',box).textContent=`${String(index+1).padStart(2,'0')} · ${index===picked?'就这一盒':'换这盒'}`;
    });
  });
  $('#pick').onclick=()=>game.getPending()?showResult(game.getPending(),'pending'):showSeal();
  $('#odds').onclick=()=>openGuide(selected);
  bindCollection();
}
function collection(){const entries=ownEntries(),unique=possessed().size;return `<section class="page-heading"><span class="eyebrow">每件都有来处</span><h1>我的收藏<span class="heading-dot">.</span></h1><p>已拥有 ${unique} / ${game.data.economy.totalItems} 款 · 共 ${entries.length} 件。重复款按独立实物保留。</p></section>${entries.length?`<div class="collection-grid">${entries.map((e,i)=>{const item=game.index.byId[e.itemId],s=game.index.bySeries[e.seriesId],rarity=game.data.rarities[item.rarity];return `<button class="collection-card" data-entry="${i}" style="${themeStyle(s)}"><div class="collection-art"><span class="catalog-code">${esc(item.id.toUpperCase())}</span>${collectibleArt(item,s)}<span class="model-tag">${modelAssets[item.id]?.available?'真实模型 · 点击转动':'模型待补齐 · 查看收藏'}</span></div><div class="collection-meta"><small>${esc(s.name)} · ${esc(rarity.label)}</small><h3>${esc(item.name)}</h3><span>${e.mode==='case'?'已收入展柜':e.mode==='pending'?'柜台待安置':'收藏仓库'} <i>查看 →</i></span></div></button>`;}).join('')}</div>`:`<div class="empty"><span class="empty-symbol">${motif(current().id)}</span><h2>这里，等一件你的奇物。</h2><p>从柜台带回来的藏品，会好好收在这里。</p><button class="primary" data-nav="shop">去挑一盒 <span>↗</span></button></div>`}`;}
function bindCollection(){const entries=ownEntries();app.querySelectorAll('[data-entry]').forEach(b=>b.onclick=()=>{const e=entries[Number(b.dataset.entry)];showResult(e,e.mode);});}
function displayItems(){return ownEntries().filter(e=>e.mode==='case');}
function validLayout(){const available=new Set(displayItems().map(e=>e.itemId));return layout.map(slot=>slot&&available.has(slot.itemId)?slot:null);}
function showcase(){return renderCabinet({slots:validLayout(),available:displayItems(),index:game.index,selectedSlot,totalOwned:game.getProgress().owned,totalItems:game.getProgress().total});}
async function mountViewer(container,entry,options={}){const {createViewer}=await import('./viewer.js');if(!container.isConnected)return null;container.replaceChildren();const item=game.index.byId[entry.itemId];return createViewer(container,{item,modelUrl:new URL(item.model||`models/${item.id}.glb`,game.server).href,theme:themeFor(entry.seriesId),reducedMotion:prefs.reduced,...options});}
function updateCaseEditor(){
  const template=document.createElement('template');
  template.innerHTML=showcase();
  const editor=template.content.querySelector('#q-cabinet-editor');
  $('#q-cabinet-editor')?.remove();
  if(editor) $('.q-cabinet-furniture').after(editor);
  app.querySelectorAll('[data-select-slot]').forEach(button=>{
    const active=Number(button.dataset.selectSlot)===selectedSlot;
    button.setAttribute('aria-pressed',active);
    button.setAttribute('aria-expanded',active);
    button.closest('.q-cabinet-bay').classList.toggle('is-selected',active);
    $('.q-cabinet-edit-hint',button).textContent=active?'正在调整 ↗':'选择此位置 ↗';
  });
  bindCaseEditor();
}
function bindCaseEditor(){
  if($('#close-slot-editor')) $('#close-slot-editor').onclick=()=>{
    const previous=selectedSlot;selectedSlot=null;updateCaseEditor();
    $(`[data-select-slot="${previous}"]`)?.focus({preventScroll:true});
  };
  app.querySelectorAll('[data-reset-rotation]').forEach(button=>button.onclick=()=>{
    const i=Number(button.dataset.resetRotation);if(!layout[i])return;
    layout[i].rotation=0;$(`#slot-${i}`).viewer?.setRotation(0);
    const input=$(`[data-rotation="${i}"]`);if(input)input.value=0;
    persist('qiwu-display-v1',layout);
  });
  app.querySelectorAll('[data-slot]').forEach(select=>select.onchange=()=>{
    const index=Number(select.dataset.slot),id=select.value;
    layout=validLayout().map((slot,i)=>i!==index&&slot?.itemId===id?null:slot);
    layout[index]=id?{itemId:id,rotation:0}:null;
    persist('qiwu-display-v1',layout);render();
    $(`[data-slot="${index}"]`)?.focus({preventScroll:true});
  });
  app.querySelectorAll('[data-rotation]').forEach(input=>input.oninput=()=>{
    const i=Number(input.dataset.rotation);if(!layout[i])return;
    layout[i].rotation=Number(input.value);
    $(`#slot-${i}`).viewer?.setRotation(layout[i].rotation*Math.PI/180);
    persist('qiwu-display-v1',layout);
  });
}
function bindCase(){
  app.querySelectorAll('[data-select-slot]').forEach(button=>button.onclick=()=>{
    selectedSlot=Number(button.dataset.selectSlot);updateCaseEditor();
    $(`[data-slot="${selectedSlot}"]`)?.focus({preventScroll:true});
    $('#q-cabinet-editor')?.scrollIntoView({block:'nearest',behavior:prefs.reduced?'instant':'smooth'});
  });
  bindCaseEditor();
  validLayout().forEach(async(slot,i)=>{
    if(!slot)return;
    const item=game.index.byId[slot.itemId],el=$(`#slot-${i}`);
    const v=await mountViewer(el,{itemId:item.id,seriesId:item.seriesId},{rotation:slot.rotation*Math.PI/180,onRotation:radians=>{
      const rotation=((radians*180/Math.PI+180)%360+360)%360-180;
      layout[i]={itemId:item.id,rotation};
      const input=$(`[data-rotation="${i}"]`);if(input)input.value=rotation;
      persist('qiwu-display-v1',layout);
    }});
    if(!v)return;
    if(!el.isConnected)v.dispose();else{shelves.push(v);el.viewer=v;}
  });
}
function startDialog(){lastFocus=document.activeElement;closeExperience(false);dialogToken++;dialog.showModal();dialog.scrollTop=0;return dialogToken;}
function closeExperience(restore=true){clearTimeout(animationTimer);dialogToken++;viewer?.dispose();viewer=null;dialog.close();dialog.innerHTML='';activeEntry=null;if(restore&&lastFocus?.isConnected)lastFocus.focus();}
dialog.addEventListener('cancel',e=>{e.preventDefault();closeExperience();render();});
function dialogTop(label){return `<div class="dialog-top"><span><b class="mini-stamp">奇</b> ${label}</span><button class="close-button" id="close-experience" aria-label="收起，保留当前结果">×</button></div>`;}
function bindClose(){$('#close-experience').onclick=()=>{closeExperience();render();};}
function showSeal(){if(busy||game.getPending())return;const s=current(),packageNode=$('.counter-box.pos-center .paper-box'),from=packageNode?.getBoundingClientRect();startDialog();dialog.className='experience seal-dialog';dialog.style=themeStyle(s);dialog.innerHTML=dialogTop('柜台拆封')+`<div class="seal-body"><span class="eyebrow">你挑中了第 ${String(picked+1).padStart(2,'0')} 盒</span><h2>轻轻一揭，奇物见面。</h2><p>${esc(s.name)} · ${fmt(s.boxPrice)} 金币 / 盒</p><div class="seal-box">${packageNode?'':boxMarkup(s,picked+1)}</div><div class="tear-track" id="tear-track"><div class="tear-progress"></div><span>沿封条向右揭开</span><button id="tear-handle" aria-label="向右拖动封条，或按回车拆封">→</button><span class="tear-end">✂</span></div><button class="primary" data-write id="direct-open">拆开看看 <span>−${fmt(s.boxPrice)} 金币</span></button><p class="quiet-note">也可点击上方按钮，或按回车直接拆封。</p></div>`;if(packageNode){$('.seal-box').append(packageNode);const to=packageNode.getBoundingClientRect();if(!prefs.reduced)packageNode.animate([{transform:`translate(${from.left-to.left}px,${from.top-to.top}px) scale(${from.width/to.width})`},{transform:'none'}],{duration:500,easing:'cubic-bezier(.2,.7,.2,1)'});}bindClose();$('#direct-open').onclick=()=>draw(s.id);const handle=$('#tear-handle'),track=$('#tear-track');let startX,dragging=false;handle.onpointerdown=e=>{if(busy)return;dragging=true;startX=e.clientX;handle.setPointerCapture(e.pointerId);};handle.onpointermove=e=>{if(!dragging)return;const max=track.clientWidth-58,dx=Math.max(0,Math.min(max,e.clientX-startX));track.style.setProperty('--peel',`${dx}px`);track.style.setProperty('--peel-progress',`${dx/max*100}%`);if(dx>=max*.86){dragging=false;draw(s.id);}};handle.onpointerup=handle.onpointercancel=()=>{dragging=false;track.style.setProperty('--peel','0px');track.style.setProperty('--peel-progress','0%');};handle.onclick=e=>{if(e.detail===0)draw(s.id);};}
async function draw(sid){if(busy)return;setBusy(true);sound(sid);const token=dialogToken;const direct=$('#direct-open');if(direct)direct.textContent='正在结算这一盒…';try{const result=await game.open(sid);render();if(!result.ok){toast(result.message||'这次拆封未完成，请检查柜台。');if(game.getPending()&&dialog.open)await showResult(game.getPending(),'pending');else if(dialog.open)closeExperience();return;}if(token!==dialogToken||!dialog.open){toast('藏品已留在柜台，随时继续查看。');return;}activeEntry=result.entry;playOpening(result.entry);}catch(error){toast('连接中断。请刷新读取柜台保存的结果。');}finally{setBusy(false);render();}}
function playOpening(entry){clearTimeout(animationTimer);const s=game.index.bySeries[entry.seriesId],packageNode=$('.seal-box .paper-box');dialog.className='experience opening-dialog';dialog.innerHTML=dialogTop('正在拆封')+`<div class="opening-body ${prefs.reduced?'still':''}"><span class="eyebrow">${esc(s.name)} · 第 ${game.getState().boxesOpened} 次开盒</span><h2>盒子，也是一座小展台。</h2><div class="unfold-stage"><div class="fold-wing left"></div><div class="fold-wing right"></div><div class="fold-base"></div><div class="opening-package">${packageNode?'':boxMarkup(s,picked+1)}</div><span class="opening-spark">✦</span></div><p>正在打开包装，抽取结果已保存。</p><button class="text-link" id="skip">跳过动画，查看藏品 →</button></div>`;if(packageNode)$('.opening-package').append(packageNode);bindClose();$('#skip').onclick=()=>showResult(entry,'pending');animationTimer=setTimeout(()=>showResult(entry,'pending'),prefs.reduced?0:4000);}
async function showResult(entry,mode){clearTimeout(animationTimer);if(!entry)return;const token=startDialog();activeEntry={...entry};entryMode=mode;const item=game.index.byId[entry.itemId],s=game.index.bySeries[entry.seriesId],rarity=game.data.rarities[item.rarity],st=game.getState(),duplicate=!!st.showcase[entry.seriesId]?.[entry.itemId];dialog.className='experience result-dialog';dialog.style=themeStyle(s);dialog.innerHTML=dialogTop('奇物到店')+`<div class="result-grid"><div class="result-stage"><span class="stage-caption">${esc(themeFor(s.id).stage)} · 包装展开的小世界</span><div id="result-viewer" class="result-viewer"><p class="viewer-fallback" role="status">正在准备这件藏品的 3D 展示…</p></div><span class="stage-code">${esc(item.id.toUpperCase())}</span></div><div class="result-details"><span class="eyebrow">${esc(s.name)} / ${esc(rarity.label)}</span><h2>${esc(item.name)}</h2><p class="item-description">${esc(item.desc)}</p><div class="ownership"><span>✓</span><div><b>${mode==='pending'?'这一件，已是你的收藏':mode==='case'?'已经收入展柜':'已收好在收藏仓库'}</b><small>${mode==='pending'?'已保存抽取结果 · 等你选择安置位置':mode==='storage'&&duplicate?'展柜已有这款，重复实物保留在仓库。':'查看、转动不扣金币。'}</small></div></div><div class="result-actions">${mode!=='case'?`<button class="primary" data-write id="place" data-locked="${duplicate}" ${duplicate?'disabled':''}>${duplicate?'展柜已有这款':'放入展柜'}<span>↗</span></button>`:''}${mode==='pending'?`<button class="secondary" data-write id="store">先收进收藏</button><button class="text-link" data-write id="again">收好，再拆一盒 →</button>`:`<button class="secondary" id="see-collection">查看我的收藏</button><button class="text-link" id="go-case">去我的展柜 →</button>`}${mode==='storage'?`<button class="text-link resale" data-write id="sell">售回店里 · +${fmt(item.sellPrice)} 金币</button>`:''}${mode==='case'?`<button class="text-link" data-write id="unshowcase">从展柜取回收藏仓库</button>`:''}</div><p class="result-footnote">${mode==='pending'?'收起后，仍可从柜台继续查看同一件藏品。':'陈列操作不会再次抽取或扣费。'}</p></div></div>`;bindClose();if($('#place'))$('#place').onclick=()=>placeEntry(entry,mode);if($('#store'))$('#store').onclick=()=>storeEntry(entry,false);if($('#again'))$('#again').onclick=()=>storeEntry(entry,true);if($('#see-collection'))$('#see-collection').onclick=()=>navigate('collection');if($('#go-case'))$('#go-case').onclick=()=>navigate('case');if($('#sell'))$('#sell').onclick=()=>sellEntry(entry,item);if($('#unshowcase'))$('#unshowcase').onclick=()=>mutate(()=>game.unshowcase(entry.seriesId,entry.itemId),'已取回收藏仓库',()=>navigate('collection'));
 const container=$('#result-viewer');try{const v=await mountViewer(container,entry);if(token!==dialogToken){v?.dispose();return;}viewer=v;}catch(error){if(container.isConnected)container.innerHTML='<p class="viewer-fallback">3D 查看器未能启动。藏品结果已保存，请收起后重试。</p>';}}
async function mutate(action,message,done){if(busy)return;setBusy(true);try{const result=await action();if(!result.ok){toast(result.message||'操作暂时没有完成');render();return;}toast(message);done?.(result);const bailout=await game.maybeBailout();if(bailout)toast(`原规则破产补助 +${fmt(bailout)} 金币`);}finally{setBusy(false);render();}}
async function storeEntry(entry,again){let stored=false;await mutate(()=>game.toStorage(entry),'已收进收藏仓库',()=>{stored=true;closeExperience();page=again?'shop':'collection';});if(stored&&again)showSeal();}
async function placeEntry(entry,mode){await mutate(async()=>{if(mode==='storage'){const reopened=await game.reopen(entry.uid);if(!reopened.ok)return reopened;return game.toShowcase(reopened.entry);}return game.toShowcase(entry);},'已收入展柜，藏品数量没有增加',()=>{layout=validLayout();const free=layout.findIndex(s=>!s);if(free>=0){layout[free]={itemId:entry.itemId,rotation:0};persist('qiwu-display-v1',layout);}else toast('已收入展柜。三个位置已满，可选择替换陈列。');closeExperience();page='case';selectedSlot=free>=0?free:0;});}
function sellEntry(entry,item){const actions=$('.result-actions');actions.innerHTML=`<p class="sell-confirm">确认将「${esc(item.name)}」售回店里？这件实物会离开仓库，获得 ${fmt(item.sellPrice)} 金币。</p><button class="secondary" id="cancel-sell">保留这件藏品</button><button class="primary" data-write id="confirm-sell">确认售回</button>`;$('#cancel-sell').onclick=()=>showResult(entry,'storage');$('#confirm-sell').onclick=()=>mutate(()=>game.sellFromStorage(entry.uid),'已按原规则售回店里',()=>navigate('collection'));}
function openGuide(seriesId){const el=$('#guide');const list=seriesId?game.data.series.filter(s=>s.id===seriesId):game.data.series;el.innerHTML=`<div class="dialog-top"><span><b class="mini-stamp">奇</b> 店内说明</span><button class="close-button" id="close-guide" aria-label="关闭店内说明">×</button></div><div class="guide-body"><h2>${seriesId?'每一款，都有机会见面。':'按你喜欢的方式逛店。'}</h2><div class="preferences"><button id="mute" class="secondary" aria-pressed="${prefs.muted}">${prefs.muted?'声音：已静音':'声音：已开启'}</button><button id="reduce" class="secondary" aria-pressed="${prefs.reduced}">${prefs.reduced?'减少动效：开启':'减少动效：关闭'}</button></div><p>每盒独立抽取，没有连续次数保底。同稀有度内优先抽到从未拥有的款式；全部拥有过后恢复完整候选池。展柜同款最多一件，重复款仍可保存在仓库。</p>${list.map(s=>`<section class="odds-section"><h3>${esc(s.name)} <small>${fmt(s.boxPrice)} 金币 / 盒</small></h3><div class="odds-summary">${Object.entries(s.dropRates).map(([key,chance])=>`<span>${esc(game.data.rarities[key].label)} <b>${percent(chance)}</b></span>`).join('')}</div><details ${seriesId?'open':''}><summary>查看 ${s.items.length} 款藏品与基础概率</summary><ul>${s.items.map(it=>`<li><span>${esc(it.name)} <small>${esc(game.data.rarities[it.rarity].label)}</small></span><b>${percent(it.drawChance)}</b></li>`).join('')}</ul></details></section>`).join('')}<p class="resource-note">已有 ${Object.values(modelAssets).filter(a=>a.available).length} 款真实模型到店，${Object.values(modelAssets).filter(a=>!a.available).length} 款仍待补齐。货架中标注「系列示意」的图案仅用于选系列；实际抽取结果始终对应自己的藏品。</p><p>金币不足且仓库没有可售藏品时，沿用原有破产补助规则。存档保存在本机，陈列位置与朝向保存在当前浏览器。</p><button class="secondary" id="refresh-state">重新读取本机存档</button></div>`;el.showModal();$('#close-guide').onclick=()=>el.close();$('#mute').onclick=()=>{prefs.muted=!prefs.muted;persist('qiwu-preferences',prefs);$('#mute').textContent=prefs.muted?'声音：已静音':'声音：已开启';$('#mute').setAttribute('aria-pressed',prefs.muted);if(!prefs.muted)sound(selected);};$('#reduce').onclick=()=>{prefs.reduced=!prefs.reduced;persist('qiwu-preferences',prefs);document.documentElement.dataset.reduced=prefs.reduced;$('#reduce').textContent=prefs.reduced?'减少动效：开启':'减少动效：关闭';$('#reduce').setAttribute('aria-pressed',prefs.reduced);};$('#refresh-state').onclick=async()=>{const r=await game.refresh();toast(r.ok?'已重新读取保存的进度':r.message);if(r.ok){el.close();render();}};}
async function boot(){try{game=await createGame(new URL('./',location.href).href);selected=game.data.series[0].id;render();const r=await game.maybeBailout();if(r){toast(`原规则破产补助 +${fmt(r)} 金币`);render();}}catch(error){app.innerHTML=`<div class="boot"><span>奇</span><h1>店门暂时没打开</h1><p>未能连接本机游戏服务。请通过「启动奇物百货」重新打开。</p><button class="secondary" id="retry-boot">重新连接</button><small>${esc(error.message)}</small></div>`;$('#retry-boot').onclick=boot;}}
boot();
