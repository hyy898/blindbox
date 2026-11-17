import './style.css';
import './experience.css';
import { createBoxGesture } from './box-gesture.js';
import { createGame } from './api.js';
import { themeFor, esc, motif, boxMarkup } from './themes.js';
import { renderStorefront, collectibleArt, boxPosition } from './storefront.js';
import { modelAssets, refreshModelAssets } from './assets.js';
import { renderCabinet } from './cabinet.js';
import { startBrowserSession } from './session.js';
import { openSaveManager } from './saves.js';
import { startOpeningSequence } from './opening.js';
import { bindCollectionPreviews } from './collection-previews.js';
const $ = (q,el=document)=>el.querySelector(q);
const fmt = n=>new Intl.NumberFormat('zh-CN').format(n);
const percent = n=>new Intl.NumberFormat('zh-CN',{style:'percent',maximumFractionDigits:2}).format(n);
const app=$('#app'), dialog=$('#experience');
startBrowserSession(new URL('./', location.href).href);
let game, page='shop', selected, picked=1, busy=false, dialogToken=0, openingSequence, viewer, shelves=[], activeEntry, entryMode, lastFocus, selectedSlot=null, experiencePhase='closed';
let disposePreviews=()=>{};
const boxViewers=new Map(), packageTasks=new WeakMap();
let activePackageTask=null;
let sealProgress=0, transferAnimation=null, sealResize=null;
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
function openSaves(){
  if(busy){toast('正在保存这次操作，请稍候。');return;}
  const applyPresentation=view=>{
    closeExperience();selectedSlot=null;
    layout=Array.isArray(view?.layout)?view.layout.map(slot=>slot&&game.index.byId[slot.itemId]?{itemId:slot.itemId,rotation:Number(slot.rotation)||0}:null):[null,null,null];
    if(view?.preferences){prefs.muted=!!view.preferences.muted;prefs.reduced=!!view.preferences.reduced;}
    persist('qiwu-display-v1',layout);persist('qiwu-preferences',prefs);render();
  };
  openSaveManager({game,toast,onStateChange:render,onLoad:applyPresentation,
    getPresentation:()=>({layout:validLayout(),preferences:{muted:!!prefs.muted,reduced:!!prefs.reduced}}),
    onNewGame:view=>{
      page='shop';picked=1;selected=game.data.series[0].id;
      applyPresentation(view);
      window.scrollTo({top:0,behavior:'instant'});
    }
  });
}
function header(){const st=game.getState();return `<header class="header"><button class="brand" data-nav="shop" aria-label="奇物百货，回到店内"><span class="brand-stamp">奇</span><span>奇物百货</span></button><nav aria-label="主导航">${[['shop','店内'],['collection','我的收藏'],['case','我的展柜']].map(([id,label])=>`<button data-nav="${id}" ${page===id?'aria-current="page"':''}>${label}${id==='collection'?`<span class="nav-number">${ownEntries().length}</span>`:''}</button>`).join('')}</nav><div class="header-end"><span class="wallet"><i>◉</i><span><small>可用金币</small><b>${fmt(st.coins)}</b></span></span><button class="save-entry" id="save-game" aria-label="存档、读档与删除存档">存档</button><button class="icon-button" id="settings" aria-label="偏好与店内说明">☷</button></div></header>`;}
function pendingBar(){return game.getPending()?`<div class="pending-bar"><span>柜台还有一件藏品待收纳。</span><button class="text-link" id="resume">继续查看 →</button></div>`:'';}
function render(){disposePreviews();boxViewers.forEach(v=>v.dispose());boxViewers.clear();shelves.forEach(v=>v.dispose());shelves=[];document.documentElement.dataset.reduced=prefs.reduced;app.innerHTML=header()+`<main id="main">${pendingBar()}${page==='shop'?shop():page==='collection'?collection():showcase()}</main><footer class="footer"><span><b>奇物百货</b></span><button class="text-link" id="rules">店内说明 ↗</button></footer>`;app.querySelectorAll('[data-nav]').forEach(b=>b.onclick=()=>navigate(b.dataset.nav));$('#save-game').onclick=openSaves;$('#settings').onclick=()=>openGuide();$('#rules').onclick=()=>openGuide();if($('#resume'))$('#resume').onclick=()=>showResult(game.getPending(),'pending');if(page==='shop')bindShop();if(page==='collection')bindCollection();if(page==='case')bindCase();disposePreviews=bindCollectionPreviews(app,{index:game.index,base:game.server});}
function navigate(next){closeExperience();selectedSlot=null;page=next;render();window.scrollTo({top:0,behavior:prefs.reduced?'instant':'smooth'});}
function shop(){return renderStorefront({series:game.data.series,selected,picked,state:game.getState(),entries:ownEntries(),index:game.index,slots:validLayout(),busy});}
function selectBox(index) {
  picked=index;
  app.querySelectorAll('[data-box]').forEach(box=>{
    const id=Number(box.dataset.box);
    box.className=`counter-box pos-${boxPosition(id,picked)}`;
    box.setAttribute('aria-pressed',id===picked);
    $('.box-pick-label',box).textContent=`${String(id+1).padStart(2,'0')} · ${id===picked?'就这一盒':'换这盒'}`;
  });
}
function beginSeal(index=picked) {
  if(busy||dialog.open)return;
  if(game.getPending()){showResult(game.getPending(),'pending');return;}
  selectBox(index);
  showSeal();
}
function bindShop(){
  app.querySelectorAll('[data-box]').forEach(box=>{
    const container=$('.paper-box',box),series=current();
    const task=(async()=>{
      const {createViewer}=await import('./viewer.js');
      if(!container.isConnected)return null;
      const v=await createViewer(container,{theme:themeFor(series.id),packaging:true,reducedMotion:prefs.reduced});
      if(!container.isConnected){v.dispose();return null;}
      if(dialog.contains(container)){viewer=v;v.setSealProgress(sealProgress);v.resize();}
      else boxViewers.set(Number(box.dataset.box),v);
      return v;
    })();
    packageTasks.set(container,task);
    task.catch(()=>{if(container.isConnected)container.textContent='包装暂时未能显示';});
  });
  app.querySelectorAll('[data-series]').forEach(b=>b.onclick=()=>{selected=b.dataset.series;picked=1;render();});
  const gesture=createBoxGesture();
  $('.counter-boxes').addEventListener('click',event=>{
    const box=event.target.closest('[data-box]');
    const intent=gesture.click({id:box?Number(box.dataset.box):null,x:event.clientX,y:event.clientY,time:event.timeStamp,
      pointer:event.detail>0&&matchMedia('(pointer:fine)').matches});
    if(intent.open!==null){event.preventDefault();beginSeal(intent.open);}
    else if(intent.select!==null)selectBox(intent.select);
  });
  app.querySelectorAll('[data-box]').forEach(box=>box.ondblclick=event=>{
    event.preventDefault();if(matchMedia('(pointer:fine)').matches)beginSeal(Number(box.dataset.box));
  });
  $('#pick').onclick=()=>beginSeal();
  $('#odds').onclick=()=>openGuide(selected);
  bindCollection();
}
function collection(){const entries=ownEntries(),unique=possessed().size;return `<section class="page-heading"><h1>我的收藏</h1><p>已拥有 ${unique} / ${game.data.economy.totalItems} 款 · 共 ${entries.length} 件。</p></section>${entries.length?`<div class="collection-grid">${entries.map((e,i)=>{const item=game.index.byId[e.itemId],s=game.index.bySeries[e.seriesId],rarity=game.data.rarities[item.rarity];return `<button class="collection-card" data-entry="${i}" style="${themeStyle(s)}"><div class="collection-art"><span class="catalog-code">${esc(item.id.toUpperCase())}</span>${collectibleArt(item,s)}<span class="model-tag">${modelAssets[item.id]?.available===false?'模型待补齐':'查看藏品'}</span></div><div class="collection-meta"><small>${esc(s.name)} · ${esc(rarity.label)}</small><h3>${esc(item.name)}</h3><span>${e.mode==='case'?'已在展柜':e.mode==='pending'?'待收纳':'已入收藏'} <i>查看 →</i></span></div></button>`;}).join('')}</div>`:`<div class="empty"><span class="empty-symbol">${motif(current().id)}</span><h2>还没有收藏</h2><p>拆一盒，开始收藏。</p><button class="primary" data-nav="shop">去挑一盒 <span>↗</span></button></div>`}`;}
function bindCollection(){const entries=ownEntries();app.querySelectorAll('[data-entry]').forEach(b=>b.onclick=()=>{const e=entries[Number(b.dataset.entry)];showResult(e,e.mode);});}
function displayItems(){return ownEntries().filter(e=>e.mode==='case');}
function validLayout(){const available=new Set(displayItems().map(e=>e.itemId));return layout.map(slot=>slot&&available.has(slot.itemId)?slot:null);}
function showcase(){return renderCabinet({slots:validLayout(),available:displayItems(),index:game.index,selectedSlot,totalOwned:game.getProgress().owned,totalItems:game.getProgress().total});}
async function mountViewer(container,entry,options={}){const {createViewer}=await import('./viewer.js');if(!container.isConnected)return null;container.replaceChildren();const item=game.index.byId[entry.itemId];return createViewer(container,{item,modelUrl:new URL(item.model||`models/${item.id}.glb`,game.server).href,theme:themeFor(entry.seriesId),assetBase:game.server,reducedMotion:prefs.reduced,...options});}
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
    $('.q-cabinet-edit-hint',button).textContent=active?'正在调整 ↗':'调整 ↗';
  });
  bindCaseEditor();
}
function bindCaseEditor(){
  if($('#view-slot')) $('#view-slot').onclick=()=>{const slot=validLayout()[selectedSlot];if(slot){const item=game.index.byId[slot.itemId];showResult({itemId:item.id,seriesId:item.seriesId},'case');}};
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
function showCabinetPhoto({url,filename}){
  const modal=document.createElement('dialog');modal.className='photo-dialog';
  modal.setAttribute('aria-label','展柜合影');
  modal.innerHTML=`<div class="dialog-top"><span>展柜合影</span><button class="close-button" aria-label="关闭合影">×</button></div><img src="${url}" alt="当前三格陈列的合影"><a class="photo-save" href="${url}" download="${esc(filename)}">保存图片</a>`;
  const close=()=>{modal.close();modal.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);};
  modal.querySelector('button').onclick=close;
  modal.addEventListener('cancel',event=>{event.preventDefault();close();});
  document.body.append(modal);modal.showModal();
}
function bindCase(){
  if($('#cabinet-photo')) $('#cabinet-photo').onclick=async()=>{
    const button=$('#cabinet-photo');button.disabled=true;button.textContent='正在保存…';
    try{const {saveCabinetPhoto}=await import('./cabinet-photo.js');const photo=await saveCabinetPhoto({slots:validLayout(),index:game.index,views:[0,1,2].map(i=>$(`#slot-${i}`)?.viewer)});showCabinetPhoto(photo);}
    catch(error){toast(error.message||'合影暂时未能保存，请稍后重试。');}
    finally{if(button.isConnected){button.disabled=false;button.textContent='保存展柜合影';}}
  };

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
function closeExperience(restore=true){sealResize?.disconnect();sealResize=null;transferAnimation?.cancel();transferAnimation=null;activePackageTask=null;experiencePhase='closed';openingSequence?.dispose();openingSequence=null;dialogToken++;viewer?.dispose();viewer=null;dialog.close();dialog.innerHTML='';activeEntry=null;if(restore&&lastFocus?.isConnected)lastFocus.focus();}
dialog.addEventListener('cancel',e=>{e.preventDefault();closeExperience();if(page!=='case')render();});
function dialogTop(label){return `<div class="dialog-top"><span><b class="mini-stamp">奇</b> ${label}</span><button class="close-button" id="close-experience" aria-label="收起，保留当前结果">×</button></div>`;}
function bindClose(){$('#close-experience').onclick=()=>{closeExperience();if(page!=='case')render();};}
function showSeal(){
  if(busy||game.getPending()||dialog.open)return;
  const s=current(),packageNode=$(`[data-box="${picked}"] .paper-box`),from=packageNode?.getBoundingClientRect();
  const previous=boxViewers.get(picked);boxViewers.delete(picked);
  startDialog();experiencePhase='seal';sealProgress=0;viewer=previous;dialog.dataset.box=String(picked);
  dialog.className='experience result-dialog flow-dialog phase-seal';dialog.style=themeStyle(s);
  dialog.innerHTML=dialogTop('柜台拆封')+`<div class="result-grid">
    <div class="result-stage"><div id="result-viewer" class="packaging-viewport">${packageNode?'':boxMarkup(s)}</div><button id="tear-handle" class="seal-hit" aria-label="向上揭起封签，或按回车拆封"></button></div>
    <div class="result-details seal-details"><span class="eyebrow">${esc(s.name)}</span><h2>拆这一盒</h2><p class="seal-price">${fmt(s.boxPrice)} 金币 / 盒</p><button class="primary" data-write id="direct-open">直接拆封 <span>−${fmt(s.boxPrice)}</span></button><details class="seal-help"><summary>拆封方式</summary><p>从封签下缘向上揭起，或点击「直接拆封」。也可选中封签后按回车。拆封时结算。</p></details></div></div>`;
  const target=$('#result-viewer');
  if(packageNode){
    packageNode.removeAttribute('aria-hidden');target.append(packageNode);activePackageTask=packageTasks.get(packageNode)||Promise.resolve(previous);
    viewer?.resize();
    const to=packageNode.getBoundingClientRect();
    if(!prefs.reduced)transferAnimation=packageNode.animate([
      {transform:`translate(${from.left-to.left}px,${from.top-to.top}px) scale(${from.width/to.width})`},
      {transform:'none'}],{duration:480,easing:'cubic-bezier(.2,.7,.2,1)'});
  }else{
    $('.paper-box',target).removeAttribute('aria-hidden');
    activePackageTask=import('./viewer.js').then(({createViewer})=>createViewer($('.paper-box',target),{theme:themeFor(s.id),packaging:true,reducedMotion:prefs.reduced})).then(v=>{
      if(!target.isConnected){v.dispose();return null;}viewer=v;return v;
    });
  }
  bindClose();$('#direct-open').onclick=()=>draw(s.id);
  const handle=$('#tear-handle');let startY,dragging=false;
  activePackageTask.then(v=>{
    if(!handle.isConnected||!v)return;
    const locate=()=>{
      v.resize();const point=v.sealAnchor(),rect=v.element.getBoundingClientRect(),stage=target.parentElement.getBoundingClientRect();
      handle.style.left=`${rect.left-stage.left+point.x*rect.width-handle.offsetWidth/2}px`;
      handle.style.top=`${rect.top-stage.top+point.y*rect.height-handle.offsetHeight/2}px`;
    };
    sealResize=new ResizeObserver(locate);sealResize.observe(target);locate();
    transferAnimation?.finished.then(locate).catch(()=>{});
  }).catch(()=>{});
  const peel=value=>{sealProgress=value;viewer?.setSealProgress(value);};
  handle.onpointerenter=()=>{if(experiencePhase==='seal'&&!dragging)peel(.05);};
  handle.onpointerleave=()=>{if(experiencePhase==='seal'&&!dragging)peel(0);};
  handle.onpointerdown=e=>{if(busy||experiencePhase!=='seal')return;dragging=true;startY=e.clientY;handle.setPointerCapture(e.pointerId);};
  handle.onpointermove=e=>{if(!dragging)return;const progress=Math.max(0,Math.min(1,(startY-e.clientY)/100));peel(progress);if(progress>=.86){dragging=false;draw(s.id);}};
  handle.onpointerup=handle.onpointercancel=()=>{dragging=false;if(experiencePhase==='seal')peel(0);};
  handle.onclick=e=>{if(e.detail===0)draw(s.id);};
}
async function draw(sid){
  if(busy||experiencePhase!=='seal'||!dialog.open)return;
  sealResize?.disconnect();sealResize=null;
  experiencePhase='settling';setBusy(true);sound(sid);const token=dialogToken;
  $('#tear-handle')?.remove();
  const direct=$('#direct-open');if(direct)direct.textContent='正在结算…';
  try{
    const result=await game.open(sid);render();
    if(!result.ok){toast(result.message||'这次拆封未完成，请检查柜台。');if(game.getPending()&&dialog.open)await showResult(game.getPending(),'pending');else if(dialog.open)closeExperience();return;}
    if(token!==dialogToken||!dialog.open){toast('藏品待收纳，可从柜台继续查看。');return;}
    playOpening(result.entry);
  }catch{toast('连接中断，请重新读取柜台保存的结果。');closeExperience();}
  finally{setBusy(false);render();}
}
function resultDetails(entry,mode){
  const item=game.index.byId[entry.itemId],s=game.index.bySeries[entry.seriesId],rarity=game.data.rarities[item.rarity];
  const duplicate=!!game.getState().showcase[entry.seriesId]?.[entry.itemId];
  const count=ownEntries().filter(e=>e.itemId===entry.itemId).length;
  return `<span class="eyebrow">${esc(s.name)} / ${esc(rarity.label)}</span><h2>${esc(item.name)}</h2><p class="item-description">${esc(item.desc)}</p>
    <div class="ownership"><span>${mode==='pending'?'○':'✓'}</span><div><b>${mode==='pending'?'待收纳':mode==='case'?'已在展柜':'已入收藏'}</b><small>${count>1?`同款共 ${count} 件`:(mode==='pending'&&entry.preferredNew===true?'新入藏':'共 1 件')}${mode!=='case'&&duplicate?' · 展柜已有同款':''}</small></div></div>
    <div class="result-actions">${mode!=='case'?`<button class="primary" data-write id="place" data-locked="${duplicate}" ${duplicate?'disabled':''}>${duplicate?'展柜已有同款':'放入展柜'}<span>↗</span></button>`:''}
    ${mode==='pending'?`<button class="secondary" data-write id="store">收进收藏</button><button class="text-link" data-write id="again">收好，再拆一盒 →</button>`:`<button class="secondary" id="see-collection">查看我的收藏</button><button class="text-link" id="go-case">去我的展柜 →</button>`}
    ${mode==='storage'?`<button class="text-link resale" data-write id="sell">售回店里 · +${fmt(item.sellPrice)} 金币</button>`:''}
    ${mode==='case'?`<button class="text-link" data-write id="unshowcase">取回收藏</button>`:''}</div>
    ${mode==='pending'?'<p class="result-footnote">结果已保存，收起后可继续收纳。</p>':''}`;
}
function bindResult(entry,mode){
  const act=action=>()=>{
    if(busy||game.isBusy())return;
    return openingSequence?openingSequence.run(action):action();
  };
  if($('#place'))$('#place').onclick=act(()=>placeEntry(entry,mode));
  if($('#store'))$('#store').onclick=act(()=>storeEntry(entry,false));
  if($('#again'))$('#again').onclick=act(()=>storeEntry(entry,true));
  if($('#see-collection'))$('#see-collection').onclick=act(()=>navigate('collection'));
  if($('#go-case'))$('#go-case').onclick=act(()=>navigate('case'));
  if($('#sell'))$('#sell').onclick=act(()=>sellEntry(entry,game.index.byId[entry.itemId]));
  if($('#unshowcase'))$('#unshowcase').onclick=act(()=>mutate(()=>game.unshowcase(entry.seriesId,entry.itemId),'已入收藏',()=>navigate('collection')));
  setBusy(busy);
}
async function loadResultViewer(entry,token,onStatus=()=>{}){
  const container=$('#result-viewer');
  container.innerHTML='<p class="viewer-fallback" role="status">正在加载藏品…</p>';
  try{const v=await mountViewer(container,entry,{onStatus});if(token!==dialogToken){v?.dispose();return;}viewer=v;}
  catch{if(container.isConnected){container.innerHTML='<div class="viewer-fallback" role="status"><p>暂时无法显示藏品，结果已保存。</p><button class="secondary" id="retry-viewer">重新加载</button></div>';$('#retry-viewer').onclick=()=>loadResultViewer(entry,token,onStatus);onStatus('error');}}
}
function playOpening(entry){
  openingSequence?.dispose();experiencePhase='opening';activeEntry={...entry};entryMode='pending';
  const token=dialogToken,peel=sealProgress;
  dialog.classList.remove('phase-seal');dialog.classList.add('phase-opening');
  const details=$('.result-details');
  details.className='result-details reveal-waiting';
  details.innerHTML='<p role="status" class="opening-status">正在准备这件藏品…</p><button class="text-link" id="skip">跳过动画 →</button>';
  const reveal=()=>{
    $('.dialog-top > span').innerHTML='<b class="mini-stamp">奇</b> 藏品详情';
    details.className='result-details';details.innerHTML=resultDetails(entry,'pending');
    bindResult(entry,'pending');
  };
  const finish=()=>{
    experiencePhase='result';
    dialog.classList.remove('phase-opening');dialog.classList.add('phase-revealed');
    $('#skip')?.remove();
  };
  openingSequence=startOpeningSequence({reducedMotion:prefs.reduced,
    isActive:()=>token===dialogToken&&dialog.open,
    onFrame:time=>{viewer?.setOpeningTime(time,peel);dialog.dataset.openingTime=String(Math.round(time));},
    startViewer:async report=>{
      const v=await activePackageTask;
      if(token!==dialogToken||!dialog.open)return;
      if(!v)throw new Error('包装展示未就绪');
      viewer=v;v.setOpeningTime(Number(dialog.dataset.openingTime)||0,peel);
      const item=game.index.byId[entry.itemId];
      await v.loadCollectible({item,modelUrl:new URL(item.model,game.server).href,assetBase:game.server,onStatus:report});
    },
    onModelStatus:kind=>{
      dialog.dataset.modelStatus=kind;
      const status=$('.opening-status');if(status)status.textContent=kind==='ready'?'正在揭晓…':'正在准备这件藏品…';
    },
    onReveal:reveal,onFinish:finish
  });
  if($('#skip'))$('#skip').onclick=()=>openingSequence?.skip();
}
async function showResult(entry,mode){
  if(!entry)return;const token=startDialog();experiencePhase='result';activeEntry={...entry};entryMode=mode;
  const item=game.index.byId[entry.itemId],s=game.index.bySeries[entry.seriesId];
  dialog.className='experience result-dialog flow-dialog phase-revealed';dialog.style=themeStyle(s);
  dialog.innerHTML=dialogTop('藏品详情')+`<div class="result-grid"><div class="result-stage"><div id="result-viewer" class="result-viewer"></div><span class="stage-code">${esc(item.id.toUpperCase())}</span></div><div class="result-details">${resultDetails(entry,mode)}</div></div>`;
  bindClose();bindResult(entry,mode);await loadResultViewer(entry,token);
}
async function mutate(action,message,done){if(busy)return;setBusy(true);try{const result=await action();if(!result.ok){toast(result.message||'操作暂时没有完成');render();return;}toast(message);done?.(result);const bailout=await game.maybeBailout();if(bailout)toast(`金币补助 +${fmt(bailout)} 金币`);}finally{setBusy(false);render();}}
async function storeEntry(entry,again){let stored=false;await mutate(()=>game.toStorage(entry),'已入收藏',()=>{stored=true;closeExperience();page=again?'shop':'collection';});if(stored&&again)showSeal();}
async function placeEntry(entry,mode){await mutate(async()=>{if(mode==='storage'){const reopened=await game.reopen(entry.uid);if(!reopened.ok)return reopened;return game.toShowcase(reopened.entry);}return game.toShowcase(entry);},'已在展柜',()=>{layout=validLayout();const free=layout.findIndex(s=>!s);if(free>=0){layout[free]={itemId:entry.itemId,rotation:0};persist('qiwu-display-v1',layout);}else toast('已在展柜，选择一个位置摆放。');closeExperience();page='case';selectedSlot=free>=0?free:0;});}
function sellEntry(entry,item){const actions=$('.result-actions');actions.innerHTML=`<p class="sell-confirm">确认将「${esc(item.name)}」售回店里？这件实物会离开仓库，获得 ${fmt(item.sellPrice)} 金币。</p><button class="secondary" id="cancel-sell">保留这件藏品</button><button class="primary" data-write id="confirm-sell">确认售回</button>`;$('#cancel-sell').onclick=()=>showResult(entry,'storage');$('#confirm-sell').onclick=()=>mutate(()=>game.sellFromStorage(entry.uid),'已售回店里',()=>navigate('collection'));}
function openGuide(seriesId){const el=$('#guide');const list=seriesId?game.data.series.filter(s=>s.id===seriesId):game.data.series;el.innerHTML=`<div class="dialog-top"><span><b class="mini-stamp">奇</b> 店内说明</span><button class="close-button" id="close-guide" aria-label="关闭店内说明">×</button></div><div class="guide-body"><h2>${seriesId?'款式与概率':'店内说明'}</h2><div class="preferences"><button id="mute" class="secondary" aria-pressed="${prefs.muted}">${prefs.muted?'声音：已静音':'声音：已开启'}</button><button id="reduce" class="secondary" aria-pressed="${prefs.reduced}">${prefs.reduced?'减少动效：开启':'减少动效：关闭'}</button></div><p>每盒独立抽取，没有连续次数保底。同稀有度内优先抽到从未拥有的款式；全部拥有过后恢复完整候选池。展柜同款最多一件，重复款仍可保存在仓库。</p>${list.map(s=>`<section class="odds-section"><h3>${esc(s.name)} <small>${fmt(s.boxPrice)} 金币 / 盒</small></h3><div class="odds-summary">${Object.entries(s.dropRates).map(([key,chance])=>`<span>${esc(game.data.rarities[key].label)} <b>${percent(chance)}</b></span>`).join('')}</div><details ${seriesId?'open':''}><summary>查看 ${s.items.length} 款藏品与基础概率</summary><ul>${s.items.map(it=>`<li><span>${esc(it.name)} <small>${esc(game.data.rarities[it.rarity].label)}</small></span><b>${percent(it.drawChance)}</b></li>`).join('')}</ul></details></section>`).join('')}<p class="resource-note">已有 ${Object.values(modelAssets).filter(a=>a.available).length} 款可转动查看，${Object.values(modelAssets).filter(a=>a.available===false).length} 款仍待补齐。</p><p>金币不足且仓库没有可售藏品时，可获得金币补助。当前进度自动保存在本机，也可以手动保存三个存档。手动存档会一起记录展柜摆放与偏好，读档前会保留一份备份。</p><button class="secondary" id="manage-saves">管理存档与读档</button><button class="text-link" id="refresh-state">重新同步当前进度 →</button></div>`;el.showModal();$('#close-guide').onclick=()=>el.close();$('#manage-saves').onclick=()=>{el.close();openSaves();};$('#mute').onclick=()=>{prefs.muted=!prefs.muted;persist('qiwu-preferences',prefs);$('#mute').textContent=prefs.muted?'声音：已静音':'声音：已开启';$('#mute').setAttribute('aria-pressed',prefs.muted);if(!prefs.muted)sound(selected);};$('#reduce').onclick=()=>{prefs.reduced=!prefs.reduced;persist('qiwu-preferences',prefs);document.documentElement.dataset.reduced=prefs.reduced;$('#reduce').textContent=prefs.reduced?'减少动效：开启':'减少动效：关闭';$('#reduce').setAttribute('aria-pressed',prefs.reduced);};$('#refresh-state').onclick=async()=>{const r=await game.refresh();toast(r.ok?'已重新读取保存的进度':r.message);if(r.ok){await refreshModelAssets(game.server);el.close();render();}};}
async function boot(){try{game=await createGame(new URL('./',location.href).href);await refreshModelAssets(game.server);selected=game.data.series[0].id;render();const r=await game.maybeBailout();if(r){toast(`金币补助 +${fmt(r)} 金币`);render();}}catch(error){app.innerHTML=`<div class="boot"><span>奇</span><h1>店门暂时没打开</h1><p>未能连接本机游戏服务。请通过「启动奇物百货」重新打开。</p><button class="secondary" id="retry-boot">重新连接</button><small>${esc(error.message)}</small></div>`;$('#retry-boot').onclick=boot;}}
boot();
