import * as THREE from 'three';
import design from './packaging-design.json' with {type:'json'};

// Design keys are deliberately separate from persisted game identities.
const keys = {'midnight-snack':'midnight-diner','working-animals':'office-animals','weird-appliances':'strange-appliances','vintage-toys':'old-dream-toys'};
export const packagingFor = id => design.series.find(s => s.key === keys[id]) || design.series[0];
export const boxSize = {width:2.4,height:2.16,depth:1.8,body:1.84,lid:.32,wall:.03};
const images = new Map();
async function texture(file) {
  // Public assets use the application base, also when the JS is bundled.
  const source = new URL(`./packaging/${file}`, document.baseURI).href;
  if (!images.has(source)) images.set(source, new THREE.TextureLoader().loadAsync(source).catch(error => {images.delete(source);throw error;}));
  const map = (await images.get(source)).clone();
  map.colorSpace = THREE.SRGBColorSpace;map.anisotropy = 4;map.needsUpdate = true;
  return map;
}

/** Real opaque walls, a hollow shallow lid, and an independently hinged seal. */
export async function createPackaging(id) {
  const skin = packagingFor(id), {width:w,depth:d,body:h,lid:lh,wall:t} = boxSize;
  const [frontMap,sealMap,topMap] = await Promise.all([texture(skin.body_front_asset),texture('seal-front.svg'),texture('seal-top.svg')]);
  const outer = new THREE.MeshStandardMaterial({color:skin.body_color,roughness:.94});
  const inner = new THREE.MeshStandardMaterial({color:new THREE.Color(skin.body_color).multiplyScalar(.57),roughness:1});
  const cream = new THREE.MeshStandardMaterial({color:design.palette.lid,roughness:.94});
  const print = new THREE.MeshStandardMaterial({map:frontMap,roughness:.94});
  const sealInk = new THREE.MeshStandardMaterial({map:sealMap,roughness:.98,side:THREE.DoubleSide});
  const sealTopInk = new THREE.MeshStandardMaterial({map:topMap,roughness:.98,side:THREE.DoubleSide});
  const grainData=new Uint8Array(128*128*4);let seed=71;
  for(let i=0;i<grainData.length;i+=4){seed=(seed*1664525+1013904223)>>>0;const n=112+(seed%32);grainData[i]=grainData[i+1]=grainData[i+2]=n;grainData[i+3]=255;}
  const grain=new THREE.DataTexture(grainData,128,128);grain.wrapS=grain.wrapT=THREE.RepeatWrapping;grain.repeat.set(9,9);grain.needsUpdate=true;
  for(const material of [outer,inner,cream,print,sealInk,sealTopInk]){material.bumpMap=grain;material.bumpScale=.008;}
  const root=new THREE.Group(),body=new THREE.Group(),lid=new THREE.Group(),seal=new THREE.Group();
  root.name=`package-${id}`;root.add(body,lid,seal);
  const shadow=new THREE.Mesh(new THREE.PlaneGeometry(5,4),new THREE.ShadowMaterial({opacity:.16,depthWrite:false}));
  shadow.rotation.x=-Math.PI/2;shadow.position.y=-.012;shadow.receiveShadow=true;root.add(shadow);
  const block=(parent,x,y,z,px,py,pz,material)=>{
    const mesh=new THREE.Mesh(new THREE.BoxGeometry(x,y,z),material);
    mesh.position.set(px,py,pz);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;
  };
  // BoxGeometry materials: right, left, top, bottom, front, back.
  block(body,w,h,t,0,h/2,d/2-t/2,[outer,outer,outer,outer,print,inner]);
  block(body,w,h,t,0,h/2,-d/2+t/2,[outer,outer,outer,outer,inner,outer]);
  block(body,t,h,d-2*t,-w/2+t/2,h/2,0,[inner,outer,outer,outer,outer,outer]);
  block(body,t,h,d-2*t,w/2-t/2,h/2,0,[outer,inner,outer,outer,outer,outer]);
  block(body,w-2*t,t,d-2*t,0,t/2,0,inner);
  // A 1u seam, 3u rim and underside remain visible when the whole lid lifts.
  lid.position.y=h+.01;
  block(lid,w,lh,t,0,lh/2,d/2-t/2,cream);
  block(lid,w,lh,t,0,lh/2,-d/2+t/2,cream);
  block(lid,t,lh,d-2*t,-w/2+t/2,lh/2,0,cream);
  block(lid,t,lh,d-2*t,w/2-t/2,lh/2,0,cream);
  block(lid,w,t,d,0,lh-t/2,0,cream);
  seal.position.set(.72,h+lh+.015,d/2+.009);
  const strip=new THREE.Mesh(new THREE.PlaneGeometry(.24,.6),sealInk);
  strip.position.y=-.3;strip.castShadow=true;seal.add(strip);
  const top=new THREE.Mesh(new THREE.PlaneGeometry(.24,.2),sealTopInk);
  top.rotation.x=-Math.PI/2;top.position.set(0,.002,-.1);seal.add(top);
  return {root,body,lid,seal,shadow, setPeel(progress){
    const p=Math.max(0,Math.min(1,progress));
    strip.rotation.x=-p*Math.PI*.92;
    // Hinge at the upper edge, rather than rotating the strip through the box.
    strip.position.set(0,-.3*Math.cos(p*Math.PI*.92),.3*Math.sin(p*Math.PI*.92));
  }};
}

const clamp=x=>Math.max(0,Math.min(1,x));
const smooth=x=>{const t=clamp(x);return t*t*(3-2*t);};
export function openingPose(ms, initialPeel=0) {
  const seal=smooth(ms/260),lift=smooth((ms-260)/280),back=smooth((ms-480)/280),exit=smooth((ms-800)/1160);
  const stage=smooth((ms-1810)/320);
  return {peel:initialPeel+(1-initialPeel)*seal,sealY:2.175+1.2*smooth((ms-80)/180),sealVisible:ms<260,
    lidY:1.85+lift*2.5+back*1.2,lidZ:-back*3.8,lidVisible:ms<900,
    bodyY:-exit*6,bodyVisible:ms<1960,
    modelY:(.05+.12*Math.sin(clamp((ms-760)/1200)*Math.PI)*(1-stage))*(1-smooth((ms-1960)/320)),
    stageVisible:ms>=1810,stageY:-.12*(1-stage),details:smooth((ms-2280)/320)};
}
