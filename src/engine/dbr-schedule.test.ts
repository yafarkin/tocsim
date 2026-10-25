import {describe,expect,it} from 'vitest';
import {compileConfig} from './config';
import type {EditorConfig} from './config';
import {planDrumSchedule,DrumScheduleError,MAX_DRUM_SLOTS} from './dbr-schedule';
import type {DrumSchedule} from './dbr-schedule';
import type {DbrSelection} from './dbr-validation';
import {line,cyclicLine} from './test-fixtures';
import {Simulation} from './simulation';
import {DAY_MS} from './calendar';
const M=60_000;
function one(timeMs=4*M,repetitions=1,mode:'sequential'|'simultaneous'='sequential'):EditorConfig {
  const c=line();c.stations=[c.stations[0]!];c.recipes=[c.recipes[0]!];c.materials=c.materials.filter(m=>m.id!=='product');
  c.materials.find(m=>m.id==='part')!.role='finished';c.materials.find(m=>m.id==='part')!.salePrice='20';
  c.routes=[c.routes[0]!,{...c.routes[2]!,fromId:'s1',materialId:'part'}];
  c.stations[0]!.inputBuffer={kind:'infinite'};c.stations[0]!.plan[0]!.processing={timeMs,cv:0,mode,repetitions};
  c.calendar={shiftStartMs:0,lunchStartMs:4*M,lunchEndMs:6*M,shiftEndMs:10*M};c.durationMs=10*M;
  c.sources[0]!.availability='warehouse';c.initialStocks=[{id:'input',ownerId:'s1',location:'input',materialId:'raw',quantity:'1000',cost:'10000'}];
  return c;
}
function choice(c:EditorConfig):DbrSelection {
  return {drumStationId:c.stations[0]!.id,drumCycles:1,products:c.materials.filter(m=>m.role==='finished').map(m=>({materialId:m.id,quantity:'1'})),routeIds:c.routes.map(r=>r.id),bufferMs:0,maxOpenSlots:1};
}
function schedule(c=one(),s=choice(c)):DrumSchedule {
  const result=planDrumSchedule(compileConfig(c),s);expect(result.structurallyValid).toBe(true);expect(result.canStart).toBe(false);
  expect(result.pendingChecks).toEqual(['quantitiesAndPlans','stockAndCapacity','slotGroups']);return result.schedule!;
}
function activeIntervals(plan:DrumSchedule,kind:'processing'|'setup'|'maintenance') {
  const intervals=kind==='processing'?plan.slots:plan.preparations.filter(p=>p.kind===kind);
  return intervals.reduce((sum,x)=>sum+BigInt(x.workMs)-BigInt(x.remainingMs),0n);
}
describe('nominal drum schedule without DBR execution',()=>{
  it('starts at zero, finishes on lunch close and moves the next start to opening',()=>{
    const plan=schedule();expect(plan.slots.map(s=>[s.startMs,s.endMs])).toEqual([[0,4*M],[6*M,10*M]]);
    expect(plan.completedDrumCycles).toBe(2);expect(plan.lastDrumCycle).toEqual({index:1,complete:true});
    expect(plan.slots.every(s=>s.startMs<plan.horizonMs)).toBe(true);
  });
  it('preserves a started unfinished slot, without fabricating its completion',()=>{
    const plan=schedule(one(5*M));expect(plan.slots.map(s=>[s.startMs,s.endMs,s.throughMs,s.remainingMs])).toEqual([[0,7*M,7*M,'0'],[7*M,null,10*M,String(2*M)]]);
    expect(plan.completedDrumCycles).toBe(1);expect(plan.lastDrumCycle).toEqual({index:1,complete:false});expect(plan.lastProductCycle).toEqual({index:1,complete:false});
  });
  it('retains processing over nights and lunch without restarting the operation',()=>{
    const c=one(5*M);c.durationMs=DAY_MS+10*M;const plan=schedule(c);
    expect(plan.slots.map(s=>[s.startMs,s.endMs])).toEqual([[0,7*M],[7*M,DAY_MS+2*M],[DAY_MS+2*M,DAY_MS+9*M],[DAY_MS+9*M,null]]);
    expect(plan.slots.at(-1)!.remainingMs).toBe(String(4*M));
  });
  it('includes lunch only for the drum with replacement, never the night',()=>{
    const c=one(5*M);c.stations[0]!.lunchReplacement=true;c.durationMs=DAY_MS+10*M;
    expect(schedule(c).slots.map(s=>[s.startMs,s.endMs])).toEqual([[0,5*M],[5*M,10*M],[DAY_MS,DAY_MS+5*M],[DAY_MS+5*M,DAY_MS+10*M]]);
  });
  it('keeps full sequential and simultaneous batches as one slot with different work durations',()=>{
    for(const mode of ['sequential','simultaneous'] as const){const plan=schedule(one(M,3,mode));expect(plan.slots[0]).toMatchObject({repetitions:3,mode,workMs:String(mode==='sequential'?3*M:M)});}
  });
  it('uses row batches, recipe order, initial setup and cycle-boundary setup',()=>{
    const c=cyclicLine();c.initialStocks=[];c.stations[0]!.setupMs=7*M;c.stations[0]!.initialRecipeId='recipeB';
    const plan=schedule(c);expect(plan.slots.slice(0,4).map(s=>[s.planRowId,s.batchIndex,s.drumCycleIndex,s.startMs])).toEqual([
      ['rowA',0,0,7*M],['rowA',1,0,8*M],['rowB',0,0,16*M],['rowA',0,1,25*M],
    ]);
    expect(plan.preparations.slice(0,3).map(p=>[p.kind,p.startMs,p.endMs])).toEqual([['setup',0,7*M],['setup',9*M,16*M],['setup',18*M,25*M]]);
    expect(new Set(plan.slots.map(s=>s.slotId)).size).toBe(plan.slots.length);
    expect(plan.slots[0]!.slotId).toBe(JSON.stringify(['s1',0,'rowA',0]));
  });
  it('does not repeat setup between adjacent rows sharing a recipe',()=>{
    const c=one(M);c.stations[0]!.setupMs=2*M;c.stations[0]!.plan.push({...structuredClone(c.stations[0]!.plan[0]!),id:'same-recipe'});
    const plan=schedule(c);expect(plan.preparations).toEqual([]);expect(plan.slots.slice(0,3).map(s=>s.planRowId)).toEqual(['plan1','same-recipe','plan1']);
  });
  it('records unfinished initial setup without creating an unstarted processing slot',()=>{
    const c=cyclicLine();c.calendar=one().calendar;c.durationMs=10*M;c.stations[0]!.setupMs=9*M;c.stations[0]!.initialRecipeId='recipeB';
    const plan=schedule(c);expect(plan.slots).toEqual([]);expect(plan.preparations).toMatchObject([{kind:'setup',startMs:0,endMs:null,throughMs:10*M,remainingMs:String(M)}]);
    expect(plan.lastDrumCycle).toBeNull();expect(plan.lastProductCycle).toBeNull();
  });
  it('does not create a slot when preparation finishes exactly at the horizon',()=>{
    const c=cyclicLine();c.calendar=one().calendar;c.durationMs=10*M;c.stations[0]!.setupMs=8*M;c.stations[0]!.initialRecipeId='recipeB';
    const plan=schedule(c);expect(plan.slots).toEqual([]);expect(plan.preparations[0]).toMatchObject({endMs:10*M,remainingMs:'0'});
  });
  it('marks a product cycle incomplete even when its started drum cycles are complete',()=>{
    const c=one(),s=choice(c);s.drumCycles=3;const plan=schedule(c,s);
    expect(plan.completedDrumCycles).toBe(2);expect(plan.completedProductCycles).toBe(0);
    expect(plan.lastDrumCycle).toEqual({index:1,complete:true});expect(plan.lastProductCycle).toEqual({index:0,complete:false});
    expect(plan.slots.map(s=>s.productCycleIndex)).toEqual([0,0]);
  });
  it('marks full product groups complete without appending a partial group',()=>{
    const c=one(),s=choice(c);s.drumCycles=2;const plan=schedule(c,s);expect(plan.completedProductCycles).toBe(1);expect(plan.lastProductCycle).toEqual({index:0,complete:true});
  });
  it.each(['sequential','simultaneous'] as const)('defers repetition-triggered maintenance to the end of a full %s batch',mode=>{
    const c=one(M,3,mode);c.stations[0]!.maintenance={enabled:true,durationMs:M,repetitionsThreshold:2};
    const plan=schedule(c),firstEnd=mode==='sequential'?3*M:M;
    expect(plan.preparations[0]).toMatchObject({kind:'maintenance',startMs:firstEnd,endMs:firstEnd+M});
    expect(plan.slots[0]!.repetitions).toBe(3);
  });
  it('defers a processing threshold reached mid-batch and resets both service counters',()=>{
    const c=one(3*M,2);c.stations[0]!.maintenance={enabled:true,durationMs:M,processingThresholdMs:2*M,repetitionsThreshold:99};
    const plan=schedule(c);expect(plan.slots[0]!.endMs).toBe(8*M);expect(plan.preparations[0]).toMatchObject({kind:'maintenance',startMs:8*M,endMs:9*M});
    expect(plan.slots[1]).toMatchObject({startMs:9*M,endMs:null,remainingMs:String(5*M)});
  });
  it('uses the first of both thresholds and resets counters after service',()=>{
    const c=one(M);c.stations[0]!.maintenance={enabled:true,durationMs:M,processingThresholdMs:5*M,repetitionsThreshold:2};
    const plan=schedule(c);expect(plan.preparations.slice(0,2).map(p=>[p.startMs,p.endMs])).toEqual([[2*M,3*M],[7*M,8*M]]);
  });
  it('runs maintenance before setup after a recipe change',()=>{
    const c=cyclicLine();c.stations[0]!.plan[0]!.batches=1;c.stations[0]!.setupMs=M;
    c.stations[0]!.maintenance={enabled:true,durationMs:2*M,repetitionsThreshold:1};
    const plan=schedule(c);expect(plan.preparations.slice(0,2).map(p=>[p.kind,p.startMs,p.endMs])).toEqual([['maintenance',M,3*M],['setup',3*M,4*M]]);
    expect(plan.slots[1]!.startMs).toBe(4*M);
  });
  it('retains unfinished maintenance and does not count it as useful processing',()=>{
    const c=one(M);c.stations[0]!.maintenance={enabled:true,durationMs:9*M,repetitionsThreshold:1};
    const plan=schedule(c);expect(plan.slots).toHaveLength(1);expect(plan.preparations[0]).toMatchObject({kind:'maintenance',startMs:M,endMs:null,remainingMs:String(2*M)});
    expect(activeIntervals(plan,'processing')).toBe(BigInt(M));expect(plan.lastDrumCycle).toEqual({index:0,complete:true});
  });
  it('does not add service after processing completes at the final horizon',()=>{
    const c=one(8*M);c.stations[0]!.maintenance={enabled:true,durationMs:M,repetitionsThreshold:1};const plan=schedule(c);
    expect(plan.slots).toHaveLength(1);expect(plan.slots[0]!.endMs).toBe(10*M);expect(plan.preparations).toEqual([]);
  });
  it.each([
    {distribution:{kind:'uniform' as const,minMs:1,maxMs:2},expected:2},
    {distribution:{kind:'triangular' as const,minMs:1,peakMs:1,maxMs:2},expected:1},
    {distribution:{kind:'triangular' as const,minMs:1,peakMs:2,maxMs:2},expected:2},
  ])('rounds the exact mean per operation for $distribution.kind',({distribution,expected})=>{
    const c=one(1,3);c.calendar={shiftStartMs:0,lunchStartMs:10,lunchEndMs:11,shiftEndMs:20};c.durationMs=20;
    c.stations[0]!.plan[0]!.processing={mode:'sequential',repetitions:3,distribution};
    expect(schedule(c).slots[0]!.workMs).toBe(String(expected*3));
  });
  it('uses supplied lognormal mean without drawing any seed-dependent sample',()=>{
    const c=one(M);c.stations[0]!.plan[0]!.processing={mode:'sequential',repetitions:1,distribution:{kind:'lognormal',meanMs:M,cv:1}};
    const baseline=schedule(c);for(const seed of [0,1,42,0xffffffff]){c.seed=seed;expect(schedule(c)).toEqual(baseline);}
  });
  it('keeps overflowing full-batch work exact while clipping observed work safely',()=>{
    const c=one(Number.MAX_SAFE_INTEGER,3);const plan=schedule(c);
    expect(plan.slots[0]).toMatchObject({workMs:(BigInt(Number.MAX_SAFE_INTEGER)*3n).toString(),endMs:null,remainingMs:(BigInt(Number.MAX_SAFE_INTEGER)*3n-8n*BigInt(M)).toString()});
    expect(()=>JSON.stringify(plan)).not.toThrow();
  });
  it('does not schedule invalid structure or pretend that later checks passed',()=>{
    const result=planDrumSchedule(compileConfig(one()),{});expect(result.structurallyValid).toBe(false);expect(result.schedule).toBeNull();expect(result.canStart).toBe(false);expect(result.pendingChecks).toContain('drumSchedule');
  });
  it('does not use protection, source timing, stock or seed to retime nominal slots',()=>{
    const c=one(),s=choice(c),baseline=schedule(c,s);s.bufferMs=999_999;s.maxOpenSlots=8;s.products[0]!.quantity='999';s.leadTimes=[{routeIds:['r1'],timeMs:1000}];
    c.seed=123;c.sources[0]!.intervalMs=7*M;c.initialStocks=[];expect(schedule(c,s)).toEqual(baseline);
  });
  it('is detached, JSON-compatible and stable across entity order and renaming',()=>{
    const c=cyclicLine(),s=choice(c),before=JSON.stringify(s),run=compileConfig(c),first=planDrumSchedule(run,s).schedule!;
    c.stations[0]!.name='Renamed';c.materials.reverse();c.recipes.reverse();c.sources.reverse();c.routes.reverse();s.routeIds.reverse();
    expect(schedule(c,s)).toEqual(first);s.routeIds.reverse();expect(JSON.stringify(s)).toBe(before);
    first.slots[0]!.startMs=99;expect(planDrumSchedule(run,s).schedule!.slots[0]!.startMs).toBe(0);
  });
  it.each(['sequential','simultaneous'] as const)('matches independently executed fully supplied push station for %s batches',mode=>{
    const c=one(6*M,3,mode);c.calendar={shiftStartMs:0,lunchStartMs:20*M,lunchEndMs:30*M,shiftEndMs:60*M};c.durationMs=60*M;
    c.stations[0]!.maintenance={enabled:true,durationMs:4*M,repetitionsThreshold:2};
    const run=compileConfig(c),sim=new Simulation(run);sim.advanceTo(c.durationMs);const state=sim.getSnapshot().stations[0]!;
    const plan=schedule(c);expect(BigInt(state.timeByState.processingMs)).toBe(activeIntervals(plan,'processing'));
    expect(BigInt(state.timeByState.maintenanceMs)).toBe(activeIntervals(plan,'maintenance'));expect(state.timeByState.blockedMs).toBe(0);expect(state.timeByState.starvedMs).toBe(0);
    const last=plan.slots.at(-1)!;if(last.endMs===null&&mode==='sequential') expect(state.remainingProcessingMs).toBe(Number(BigInt(last.remainingMs)%BigInt(6*M))||null);
  });
  it('matches push setup and maintenance calendars on a supplied multi-recipe station',()=>{
    const c=cyclicLine();c.stations[0]!.setupMs=M;c.stations[0]!.maintenance={enabled:true,durationMs:2*M,repetitionsThreshold:2};
    c.initialStocks.forEach(s=>s.quantity='1000');c.calendar={shiftStartMs:0,lunchStartMs:4*M,lunchEndMs:6*M,shiftEndMs:10*M};c.durationMs=DAY_MS+10*M;
    const sim=new Simulation(compileConfig(c));sim.advanceTo(c.durationMs);const state=sim.getSnapshot().stations[0]!,plan=schedule(c);
    for(const kind of ['processing','setup','maintenance'] as const) expect(BigInt(state.timeByState[`${kind}Ms`])).toBe(activeIntervals(plan,kind));
  });
  it('accepts exactly the slot limit when the final operation ends at the horizon',()=>{
    const c=one(1);c.calendar={shiftStartMs:0,lunchStartMs:50_000,lunchEndMs:50_001,shiftEndMs:MAX_DRUM_SLOTS+1};c.durationMs=c.calendar.shiftEndMs;
    const plan=schedule(c);expect(plan.slots).toHaveLength(MAX_DRUM_SLOTS);expect(plan.slots.at(-1)!.endMs).toBe(c.durationMs);
  });
  it('handles 100 days using the same repeated calendar without daily reset of the plan',()=>{
    const c=one();c.durationMs=99*DAY_MS+10*M;const plan=schedule(c);
    expect(plan.slots).toHaveLength(200);expect(plan.slots[198]!.startMs).toBe(99*DAY_MS);expect(plan.completedDrumCycles).toBe(200);
  });
  it('rejects an excessive explicit plan without returning a silently truncated success',()=>{
    const c=one(1);c.calendar={shiftStartMs:0,lunchStartMs:50_000,lunchEndMs:50_001,shiftEndMs:MAX_DRUM_SLOTS+2};c.durationMs=c.calendar.shiftEndMs;
    try{schedule(c);throw new Error('Expected resource error');}catch(error){expect(error).toBeInstanceOf(DrumScheduleError);expect((error as DrumScheduleError).code).toBe('limit');expect((error as DrumScheduleError).messages.ru).toContain('100000');}
  });
});
