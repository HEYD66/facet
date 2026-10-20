'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const plans=require('../src/main/ai-task-plan.cjs');
const draft=()=>[{id:'inspect',title:'查看页面',status:'in_progress'},{id:'verify',title:'核对结果',status:'pending'}];
test('plan schemas and legacy restore are compatible',()=>{
 assert.deepEqual(plans.names,['update_plan','read_plan']);assert.equal(plans.restore(undefined),null);assert.equal(plans.restore(null),null);
 const agent={run:{},persist(){}};assert.deepEqual(plans.execute(agent,'read_plan',{}),{plan:null});
});
test('updates validate before mutation, preserve stable IDs and skip unchanged writes',()=>{
 let writes=0;const agent={run:{permission:'read'},persist(){writes++;}};
 const first=plans.execute(agent,'update_plan',{steps:draft(),explanation:'开始检查'});assert.equal(first.changed,true);assert.equal(writes,1);
 const before=structuredClone(agent.run.plan);assert.deepEqual(plans.restore(before),before);
 assert.equal(plans.execute(agent,'update_plan',{steps:draft(),explanation:'开始检查'}).changed,false);assert.equal(writes,1);
 for(const input of [[],[...draft(),draft()[0]],[{id:'x',title:' ',status:'pending'}],[{id:'x',title:'x',status:'wrong'}],draft().map(s=>({...s,status:'in_progress'}))]){
  assert.throws(()=>plans.execute(agent,'update_plan',{steps:input}));assert.deepEqual(agent.run.plan,before);assert.equal(writes,1);
 }
 const next=draft().map(s=>({...s,status:'completed'}));plans.execute(agent,'update_plan',{steps:next});assert.equal(agent.run.plan.revision,2);assert.equal(writes,2);
 assert.equal(plans.execute(agent,'read_plan',{}).plan.steps[1].id,'verify');
});
test('failed persistence restores the previous plan and invalid saved plans are rejected',()=>{
 const agent={run:{},persist(){}};plans.execute(agent,'update_plan',{steps:draft()});const before=structuredClone(agent.run.plan);
 agent.persist=()=>{throw Error('disk full');};assert.throws(()=>plans.execute(agent,'update_plan',{steps:[{id:'new',title:'新步骤',status:'pending'}]}),/disk full/);assert.deepEqual(agent.run.plan,before);
 assert.throws(()=>plans.restore({...before,revision:0}));assert.throws(()=>plans.restore({...before,updatedAt:'invalid'}));
 assert.throws(()=>plans.execute(agent,'update_plan',{steps:draft(),explanation:'x'.repeat(401)}));
});
