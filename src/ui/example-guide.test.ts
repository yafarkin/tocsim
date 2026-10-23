import {expect,it} from 'vitest';
import {compileConfig} from '../engine/config';
import type {EditorConfig} from '../engine/config';
import {Simulation} from '../engine/simulation';
import {defaultBatchProfiles,previewConfig} from './preview';
import {withDuration} from './DurationPanel';
const M=60_000,Q=1_000_000;
const run=(c:EditorConfig)=>new Simulation(compileConfig(c));
const sold=(s:Simulation,id='product')=>s.getSnapshot().line!.counters.find(x=>x.materialId===id)!.sold/Q;
function firstStart(c:EditorConfig,id:string):number {
  const sim=run(c);while(sim.step()){const s=sim.getSnapshot();if(s.stations.find(x=>x.stationId===id)!.remainingProcessingMs!==null)return s.timeMs;}
  throw new Error('Station never started');
}
function firstSale(c:EditorConfig,id='product'):number {
  const sim=run(c);while(sim.step()){if(sold(sim,id)>0)return sim.getSnapshot().timeMs;}
  throw new Error('No sale');
}
it('supports the queue experiment through the same duration-setting helper as the UI',()=>{
  const baseline=run(previewConfig('queue')),changed=run(withDuration(previewConfig('queue'),{kind:'constant',timeMs:6*M}));
  baseline.runToEnd();changed.runToEnd();expect(sold(baseline)).toBe(59);expect(sold(changed)).toBe(79);
});
it('shows extra upstream work and stock without extra output when the deterministic blocking buffer grows',()=>{
  const a=previewConfig('blocking'),b=structuredClone(a);b.stations.find(s=>s.id==='work')!.inputBuffer={kind:'quantity',quantity:'8'};
  const sa=run(a),sb=run(b),endA=sa.runToEnd(),endB=sb.runToEnd();
  expect(sold(sb)).toBe(sold(sa));expect(sold(sa)).toBe(59);
  expect(endB.stocks.filter(x=>x.ownerId==='work'&&x.location==='input').reduce((s,x)=>s+x.quantity,0)).toBeGreaterThan(endA.stocks.filter(x=>x.ownerId==='work'&&x.location==='input').reduce((s,x)=>s+x.quantity,0));
  expect(endB.line!.counters.find(x=>x.materialId==='prepared')!.produced).toBeGreaterThan(endA.line!.counters.find(x=>x.materialId==='prepared')!.produced);
});
it('delays supply to the lower-priority split branch when the preferred input is enlarged',()=>{
  const a=previewConfig('split'),b=structuredClone(a);b.stations.find(s=>s.id==='work')!.inputBuffer={kind:'quantity',quantity:'8'};
  expect(firstStart(a,'finish')).toBe(9*M);expect(firstStart(b,'finish')).toBeGreaterThan(firstStart(a,'finish'));
});
it('does not substitute excess ordinary parts for missing processed components at assembly',()=>{
  const a=previewConfig('assembly'),b=structuredClone(a);
  b.stations.find(s=>s.id==='assembly')!.inputBuffer={kind:'materials',materials:[{materialId:'prepared',capacity:{kind:'quantity',quantity:'8'}},{materialId:'processed',capacity:{kind:'quantity',quantity:'4'}}]};
  const sa=run(a),sb=run(b);sa.runToEnd();sb.runToEnd();expect(sold(sb)).toBe(sold(sa));expect(sold(sa)).toBe(29);
});
it('distinguishes the unchanged full-kit start from earlier final output after lowering transfer thresholds',()=>{
  const a=previewConfig('batches'),profiles=structuredClone(defaultBatchProfiles);profiles.prep.transportThreshold=1;profiles.work.transportThreshold=1;
  const b=previewConfig('batches',0,42,profiles);
  expect(firstStart(a,'work')).toBe(17*M);expect(firstStart(b,'work')).toBe(17*M);
  expect(firstSale(a)).toBe(24*M);expect(firstSale(b)).toBe(20*M);
});
it('preserves the planned product mix while trading fewer setups for a later first B',()=>{
  const a=previewConfig('plans'),b=previewConfig('plans',0,42,undefined,{batchesA:4,batchesB:2,setupMinutes:7,supplyB:true});
  expect(firstSale(a,'product-b')).toBe(19*M);expect(firstSale(b,'product-b')).toBe(25*M);
  const setups=(c:EditorConfig)=>{const s=run(c);let count=0;while(s.step()){const station=s.getSnapshot().stations[0]!;if(station.remainingSetupMs!==null&&station.remainingSetupMs===station.operationDurationMs)count++;}return count;};
  expect(setups(b)).toBeLessThan(setups(a));
  expect(b.stations[0]!.plan[0]!.batches/b.stations[0]!.plan[1]!.batches).toBe(a.stations[0]!.plan[0]!.batches/a.stations[0]!.plan[1]!.batches);
});
it('calibrates the balanced variability experiment over the fixed seed series without promising an individual outcome',()=>{
  const base=run(previewConfig('balanced'));base.runToEnd();
  const outputs=Array.from({length:30},(_,seed)=>{const s=run(previewConfig('balanced',0.5,seed));s.runToEnd();return sold(s);}).sort((a,b)=>a-b);
  const median=(outputs[14]!+outputs[15]!)/2;
  expect(median).toBeLessThan(sold(base));expect(sold(base)).toBe(158);
});
