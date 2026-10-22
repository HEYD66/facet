'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {parseProcessSamples,CpuTracker}=require('../src/main/process-metrics.cjs');
const sample=(cpuSeconds,sampledAt,creationTime='638966000000000001',pid=42)=>({pid,cpuSeconds,sampledAt,creationTime});
test('parse Windows memory, CPU and monotonic timestamps without losing creation ticks',()=>{
 const samples=parseProcessSamples('42 12345 1.25 638966000000000001 700.5\r\n43 0 - - 700.6\r\ninvalid\n0 100 1 5 1\n');
 assert.equal(samples.size,2);assert.deepEqual(samples.get(42),{...sample(1.25,700.5),memoryKB:12345});
 assert(Number.isNaN(samples.get(43).cpuSeconds));
});
test('CPU uses elapsed time and logical cores; first sample stays incomplete',()=>{
 const tracker=new CpuTracker();let result=tracker.update([sample(10,20)],8);assert.equal(result.cpu.get(42),0);assert(!result.ready.has(42));
 result=tracker.update([sample(11,22)],8);assert.equal(result.cpu.get(42),6.25);assert(result.ready.has(42));
});
test('rapid queries preserve baseline and last valid rate',()=>{
 const tracker=new CpuTracker();tracker.update([sample(10,20)],4);tracker.update([sample(10.05,20.1)],4);
 let result=tracker.update([sample(10.5,21)],4);assert.equal(result.cpu.get(42),12.5);
 result=tracker.update([sample(10.51,21.01)],4);assert.equal(result.cpu.get(42),12.5);assert(result.ready.has(42));
 result=tracker.update([sample(11,22)],4);assert.equal(result.cpu.get(42),12.5);
});
test('PID reuse, counter reset and unknown creation time do not report a complete CPU sample',()=>{
 const tracker=new CpuTracker();tracker.update([sample(10,20)],4);
 for(const s of [sample(100,21,'different'),sample(1,22,'different'),sample(2,23,'-')]){
  const result=tracker.update([s],4);assert(!result.ready.has(42));assert.equal(result.cpu.get(42)||0,0);
 }
 assert.equal(tracker.previous.size,0);
});
test('exited processes leave no stale CPU and negative timestamps rebaseline',()=>{
 const tracker=new CpuTracker();tracker.update([sample(10,20)],4);assert.equal(tracker.update([sample(11,19)],4).ready.size,0);
 tracker.update([],4);assert.equal(tracker.previous.size,0);assert.equal(tracker.update([sample(100,25)],4).ready.size,0);
});
