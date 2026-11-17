import { modelAssets as previews } from './asset-previews.js';

// null means unverified, not missing. The server is the authority for files.
export const modelAssets = Object.fromEntries(Object.entries(previews).map(([id, asset]) => [id, {...asset, available: null}]));
let inflight = null;
let inflightBase = '';

export async function refreshModelAssets(base, {fetchImpl = globalThis.fetch, timeoutMs = 5000} = {}) {
  if (inflight && inflightBase === base) return inflight;
  inflightBase=base;
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  const work=(async()=>{
    try {
      const response=await fetchImpl(new URL('api/models',base),{cache:'no-store',signal:controller.signal});
      if(!response.ok) throw new Error('资源清单暂时不可用');
      const result=await response.json();
      if(!result.models || typeof result.models!=='object') throw new Error('资源清单格式错误');
      // The live catalog owns identities too: retired series must not inflate counts.
      for(const id of Object.keys(modelAssets)) if (!(id in result.models)) delete modelAssets[id];
      for(const [id,asset] of Object.entries(result.models)) {
        modelAssets[id]={...previews[id],...asset,available:asset.available===true ? true : asset.available===false ? false : null};
      }
      return true;
    } catch {
      // An unreachable endpoint must not turn a formerly present file into "missing".
      for(const asset of Object.values(modelAssets)) asset.available=null;
      return false;
    } finally { clearTimeout(timer); }
  })();
  inflight=work;
  try{return await work;}finally{if(inflight===work)inflight=null;}
}

export async function resolveModelAsset(id, base, originalUrl) {
  const verified=await refreshModelAssets(base);
  const asset=modelAssets[id] || {};
  if(verified && asset.available!==null && asset.available!==undefined) return asset;
  // Compatibility with an older server: probe only the requested model, no preload.
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),5000);
  try {
    const response=await fetch(originalUrl,{method:'HEAD',cache:'no-store',signal:controller.signal});
    if(response.status===404)return {...asset,available:false};
    if(!response.ok)throw new Error('暂时无法确认模型');
    // Old servers lack reliable versions: do not reuse parsed resources across views.
    return {...asset,available:true,version:null,url:originalUrl,bytes:Number(response.headers.get('content-length'))||0};
  } finally {clearTimeout(timer);}
}
