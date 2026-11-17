import test from 'node:test';
import assert from 'node:assert/strict';
import { startOpeningSequence } from '../web/src/opening.js';

function fixture(extra={}) {
  let reveal=0,finish=0,report,clock=0,nextId=0;
  const frames=new Map(),times=[],statuses=[];
  const sequence=startOpeningSequence({onReveal:()=>reveal++,onFinish:()=>finish++,
    onModelStatus:kind=>statuses.push(kind),onFrame:time=>times.push(time),
    startViewer:callback=>{report=callback;callback('loading');},
    requestFrame:cb=>{const id=++nextId;frames.set(id,cb);return id;},cancelFrame:id=>frames.delete(id),...extra});
  const advance=ms=>{for(let spent=0;spent<ms;spent+=20){clock+=20;const work=[...frames.values()];frames.clear();work.forEach(cb=>cb(clock));}};
  return {sequence,advance,report:kind=>report(kind),reveals:()=>reveal,finishes:()=>finish,
    time:()=>times.at(-1),statuses,frames};
}

test('slow resources hold at 260ms with the lid closed; waiting does not consume the show',()=>{
  const f=fixture();f.advance(10000);assert.equal(f.time(),260);assert.equal(f.reveals(),0);assert.equal(f.finishes(),0);
  f.report('ready');f.advance(1800);assert.equal(f.reveals(),0);assert.ok(f.time()<2280);
  f.advance(260);assert.equal(f.reveals(),1);assert.equal(f.finishes(),0);
  f.advance(400);assert.equal(f.time(),2600);assert.equal(f.finishes(),1);
});
test('ready resources play the full 2.6 seconds; details follow the stable collectible',()=>{
  const f=fixture();f.report('ready');f.advance(2260);assert.equal(f.reveals(),0);
  f.advance(100);assert.equal(f.reveals(),1);assert.equal(f.finishes(),0);
  f.advance(300);assert.equal(f.finishes(),1);assert.equal(f.reveals(),1);
});
test('failed or missing models reveal saved identity and retry resumes the same clock',()=>{
  for(const kind of ['error','missing']){
    const f=fixture();f.advance(400);f.report(kind);f.advance(5000);
    assert.equal(f.time(),260);assert.equal(f.reveals(),1);assert.equal(f.finishes(),0);
    f.report('loading');f.report('ready');f.advance(2500);
    assert.equal(f.time(),2600);assert.equal(f.reveals(),1);assert.equal(f.finishes(),1);
  }
});
test('skip before readiness reveals once; late readiness cannot replay or finish twice',()=>{
  const f=fixture();f.sequence.skip();assert.equal(f.time(),2600);assert.equal(f.reveals(),1);
  f.report('ready');f.sequence.skip();f.advance(10000);assert.equal(f.finishes(),1);assert.equal(f.frames.size,0);
});
test('reduced motion still respects loading and finishes with a brief transition',()=>{
  const f=fixture({reducedMotion:true});f.advance(1000);assert.equal(f.time(),260);assert.equal(f.finishes(),0);
  f.report('ready');f.advance(240);assert.equal(f.finishes(),1);assert.equal(f.reveals(),1);
});
test('result action can finish presentation while model loading continues',()=>{
  const f=fixture();let writes=0;
  assert.equal(f.sequence.run(()=>{writes++;return 'stored';}),'stored');assert.equal(writes,1);
  f.report('ready');f.advance(5000);assert.equal(writes,1);assert.equal(f.finishes(),1);
});
test('closing cancels pending animation and late model events',()=>{
  const f=fixture();f.sequence.dispose();f.report('ready');f.sequence.skip();f.advance(4000);
  f.sequence.run(()=>assert.fail('closed result must not write'));assert.equal(f.finishes(),0);assert.equal(f.reveals(),0);
  assert.deepEqual(f.statuses,['loading']);
});
test('navigation makes all outstanding callbacks inert',()=>{
  let active=true;const f=fixture({isActive:()=>active});active=false;
  f.report('ready');f.advance(4000);f.sequence.skip();f.sequence.run(()=>assert.fail());
  assert.equal(f.finishes(),0);assert.equal(f.reveals(),0);
});
