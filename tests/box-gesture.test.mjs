import test from 'node:test';
import assert from 'node:assert/strict';
import {createBoxGesture} from '../web/src/box-gesture.js';

test('side box second click at old position keeps its identity after movement',()=>{
 for(const id of [0,2]){
  const g=createBoxGesture();
  assert.deepEqual(g.click({id,x:200,y:500,time:10,pointer:true}),{select:id,open:null});
  assert.deepEqual(g.click({id:null,x:204,y:501,time:230,pointer:true}),{select:null,open:id});
 }
});
test('second click hitting an underlying box still opens original; unrelated click selects',()=>{
 const g=createBoxGesture();g.click({id:0,x:200,y:500,time:0,pointer:true});
 assert.equal(g.click({id:1,x:201,y:500,time:150,pointer:true}).open,0);
 g.click({id:0,x:200,y:500,time:500,pointer:true});
 assert.deepEqual(g.click({id:2,x:800,y:500,time:600,pointer:true}),{select:2,open:null});
});
test('following moved box double click works; keyboard/touch and slow clicks only select',()=>{
 const g=createBoxGesture();g.click({id:2,x:800,y:500,time:0,pointer:true});
 assert.equal(g.click({id:2,x:500,y:500,time:200,pointer:true}).open,2);
 for(const pointer of [false,true]){
  g.click({id:0,x:200,y:500,time:1000,pointer});
  assert.equal(g.click({id:0,x:200,y:500,time:1600,pointer}).open,null);
 }
});
