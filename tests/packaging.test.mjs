import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {packagingFor,openingPose,boxSize} from '../web/src/packaging.js';
import {boxMarkup} from '../web/src/themes.js';

test('production series map to the supplied face assets without changing identities',()=>{
 const colors=['#667057','#4D6570','#4D4E65','#74414B'];
 ['midnight-snack','working-animals','weird-appliances','vintage-toys'].forEach((id,i)=>{
  const skin=packagingFor(id);assert.equal(skin.body_color,colors[i]);
  const svg=readFileSync(new URL('../web/public/packaging/'+skin.body_front_asset,import.meta.url),'utf8');
  assert.ok(svg.includes('id="series-name"'));assert.doesNotMatch(svg,/<text[\s>]|<image[\s>]/);
  assert.doesNotMatch(boxMarkup({id,name:skin.name}),/box-brand|box-edition|box-footer|奇物百货|系列藏品/);
 });
 assert.equal(boxSize.width/boxSize.depth,240/180);
 assert.equal(boxSize.body+boxSize.lid,boxSize.height);
});
test('loading hold stays closed; lid clears before body and stage moves in only after clearance',()=>{
 const wait=openingPose(260);assert.equal(wait.lidY,1.85);assert.equal(Math.abs(wait.bodyY),0);assert.equal(wait.stageVisible,false);
 const open=openingPose(760);assert.ok(open.lidY>4);assert.ok(open.lidZ<-3);assert.equal(Math.abs(open.bodyY),0);
 for(let t=0;t<1810;t+=10)assert.equal(openingPose(t).stageVisible,false);
 for(let t=1810;t<=2600;t+=10){const p=openingPose(t);assert.ok(p.bodyY+boxSize.body<-.3);}
 const done=openingPose(2600);assert.equal(done.bodyVisible,false);assert.equal(done.lidVisible,false);assert.equal(done.details,1);
});
test('sealing resumes at the gesture position instead of resetting the strip',()=>{
 assert.equal(openingPose(0,.86).peel,.86);assert.ok(openingPose(130,.86).peel>.86);assert.equal(openingPose(260,.86).peel,1);
});
