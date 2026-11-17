import test from 'node:test';
import assert from 'node:assert/strict';
import {createModelCache} from '../web/src/model-cache.js';
import {modelAssets,refreshModelAssets} from '../web/src/assets.js';

test('concurrent viewers share one load; reopening reuses a released asset',async()=>{
 let calls=0; const cache=createModelCache(); const load=async()=>{calls++;return {id:1};};
 const [a,b]=await Promise.all([cache.acquire('v1',10,load),cache.acquire('v1',10,load)]);
 assert.equal(calls,1); assert.equal(a.value,b.value);a.release();b.release();
 const c=await cache.acquire('v1',10,load);assert.equal(calls,1);c.release();
});
test('new version loads anew and eviction never disposes active shared resources',async()=>{
 const disposed=[];const cache=createModelCache({maxEntries:1,maxBytes:100,dispose:v=>disposed.push(v)});
 const a=await cache.acquire('v1',10,async()=>1);const b=await cache.acquire('v2',10,async()=>2);
 assert.deepEqual(disposed,[]);a.release();assert.deepEqual(disposed,[1]);b.release();b.release();assert.equal(cache.size,1);
});
test('byte budget evicts idle assets; failed requests do not poison retries',async()=>{
 let tries=0;const disposed=[];const cache=createModelCache({maxBytes:5,dispose:v=>disposed.push(v)});
 await assert.rejects(cache.acquire('bad',1,async()=>{throw Error('offline')}));
 const good=await cache.acquire('bad',6,async()=>{tries++;return 'good'});good.release();
 assert.equal(tries,1);assert.equal(cache.size,0);assert.deepEqual(disposed,['good']);
});
test('invalidation waits for the last lease before disposing',async()=>{
 const disposed=[];const cache=createModelCache({dispose:v=>disposed.push(v)});
 const a=await cache.acquire('old',1,async()=>1),b=await cache.acquire('old',1,async()=>2);
 cache.invalidate('old');a.release();assert.deepEqual(disposed,[]);b.release();assert.deepEqual(disposed,[1]);
});
test('live file inventory overrides stale missing metadata and notices removal',async()=>{
 const base='http://test/';
 await refreshModelAssets(base,{fetchImpl:async()=>({ok:true,json:async()=>({models:{'ms-06':{available:true,version:'new',bytes:10,url:'models/ms-06.glb?v=new'}}})})});
 assert.equal(modelAssets['ms-06'].available,true);
 await refreshModelAssets(base,{fetchImpl:async()=>({ok:true,json:async()=>({models:{'ms-06':{available:false,version:null}}})})});
 assert.equal(modelAssets['ms-06'].available,false);
 await refreshModelAssets(base,{fetchImpl:async()=>{throw Error('offline')}});
 assert.equal(modelAssets['ms-06'].available,null);
});

test('retired series metadata is removed when the live prize catalog changes', async()=>{
 modelAssets['mf-10']={available:true,thumbnail:'./thumbnails/mf-10.png'};
 await refreshModelAssets('http://test/',{fetchImpl:async()=>({ok:true,json:async()=>({models:{'vt-01':{available:true,version:'toy-v1',bytes:42,url:'models/vt-01.glb?v=toy-v1'}}})})});
 assert.equal(modelAssets['mf-10'],undefined);
 assert.deepEqual(Object.keys(modelAssets),['vt-01']);
 assert.equal(modelAssets['vt-01'].available,true);
});
