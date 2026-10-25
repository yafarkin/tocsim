import {describe, expect, it} from 'vitest';
import {compileConfig} from './config';
import type {DeepReadonly, EditorConfig} from './config';
import {DAY_MS} from './calendar';
import {constraintFactsReport} from './constraint-facts';
import {flowReport} from './flow-report';
import {stationTimeReport} from './station-time';
import {stockTimeReport} from './stock-time';
import {Simulation} from './simulation';
import type {Snapshot} from './state';
import {cyclicLine, line} from './test-fixtures';
import {exampleIds, previewConfig} from '../ui/preview';
import {Runner} from '../runner/runner';
const M=60_000,Q=1_000_000n;
function single(): EditorConfig {
  const c=line();c.stations=[c.stations[0]!];c.materials=c.materials.filter(m=>m.id!=='part');
  c.stations[0]!.inputBuffer={kind:'infinite'};
  c.recipes=[{id:'cut',name:'one',kind:'production',inputs:[{materialId:'raw',quantity:'1'}],output:{materialId:'product',quantity:'1'}}];
  c.routes=[c.routes[0]!,{id:'sell',fromId:'s1',toId:'market',materialId:'product'}];c.sources[0]!.availability='warehouse';
  c.initialStocks=[{id:'kit',ownerId:'s1',location:'input',materialId:'raw',quantity:'3',cost:'30'}];return c;
}
function measure(c:EditorConfig,time:number) {
  const run=compileConfig(c),sim=new Simulation(run),model=sim.advanceTo(time);
  return {run,sim,model,report:constraintFactsReport(run,model)};
}
function compareExisting(run:ReturnType<typeof compileConfig>,model:DeepReadonly<Snapshot>) {
  const report=constraintFactsReport(run,model),times=stationTimeReport(model),stock=stockTimeReport(run,model),flow=flowReport(run,model);
  expect(report.stations.map(s=>s.stationId)).toEqual(run.resolved.stations.map(s=>s.id));
  expect(report.products).toEqual(flow.products.map(({materialId,delivered})=>({materialId,delivered})));
  for(const station of report.stations) {
    const {inputQueues,...time}=station;expect(time).toEqual(times.stations.find(s=>s.stationId===station.stationId));
    expect(inputQueues.map(q=>q.materialId)).toEqual(run.resolved.stations.find(s=>s.id===station.stationId)!.inputBuffers.map(b=>b.materialId));
    for(const queue of inputQueues) {
      const physical=model.stocks.filter(s=>s.ownerId===station.stationId&&s.location==='input'&&s.materialId===queue.materialId).reduce((sum,s)=>sum+BigInt(s.quantity),0n);
      expect(queue.quantity).toBe(String(physical));
      const history=stock.places.find(p=>p.ownerId===station.stationId&&p.location==='input'&&p.materialId===queue.materialId);
      expect(queue.calendarQuantityMs).toBe(history?.calendarQuantityMs??'0');expect(queue.workQuantityMs).toBe(history?.workQuantityMs??'0');
      for(const [scale,duration] of [['calendar',model.observation.calendarMs],['work',model.observation.workMs]] as const) {
        const average=queue[scale==='calendar'?'calendarAverage':'workAverage'];
        if(duration===0)expect(average).toBeNull();
        else expect(average).toEqual({quantityMs:queue[scale==='calendar'?'calendarQuantityMs':'workQuantityMs'],durationMs:duration});
      }
    }
    expect(Object.values(station.timeByState).reduce((sum,t)=>sum+t,0)).toBe(report.calendarMs);
  }
  return report;
}

describe('facts from the common observation period without a recommendation',()=>{
  it('distinguishes initial physical input, reserved input and absent zero-period averages',()=>{
    const run=compileConfig(single()),sim=new Simulation(run),before=constraintFactsReport(run,sim.getSnapshot());
    expect(before).toMatchObject({fromMs:0,timeMs:0,calendarMs:0,workMs:0,complete:false,termination:'running',products:[{materialId:'product',delivered:'0'}]});
    expect(before.stations[0]).toMatchObject({availableWorkMs:0,busyMs:0,processingShare:null,busyShare:null,starvedShare:null,blockedShare:null,inputQueues:[{materialId:'raw',quantity:'3000000',calendarQuantityMs:'0',workQuantityMs:'0',calendarAverage:null,workAverage:null}]});
    const dispatched=constraintFactsReport(run,sim.advanceTo(0));expect(dispatched.stations[0]!.inputQueues[0]!.quantity).toBe('2000000');expect(dispatched.stations[0]!.inputQueues[0]!.calendarAverage).toBeNull();
  });
  it('keeps an empty current input and its nonzero historical mean after FIFO processing',()=>{
    const {report}=measure(single(),2.5*M),station=report.stations[0]!;
    expect(station.inputQueues).toEqual([{materialId:'raw',quantity:'0',calendarQuantityMs:String(3n*Q*BigInt(M)),workQuantityMs:String(3n*Q*BigInt(M)),calendarAverage:{quantityMs:String(3n*Q*BigInt(M)),durationMs:2.5*M},workAverage:{quantityMs:String(3n*Q*BigInt(M)),durationMs:2.5*M}}]);
    expect(station.timeByState).toMatchObject({processingMs:2.5*M,starvedMs:0,blockedMs:0});
    expect(station.processingShare).toEqual({timeMs:2.5*M,availableWorkMs:2.5*M});expect(report.products).toEqual([{materialId:'product',delivered:'2000000'}]);
  });
  it('reports observed zero, rather than an absent mean, when an input place never held stock for positive time',()=>{
    const c=single();c.initialStocks=[];const {report}=measure(c,7),q=report.stations[0]!.inputQueues[0]!;
    expect(q).toEqual({materialId:'raw',quantity:'0',calendarQuantityMs:'0',workQuantityMs:'0',calendarAverage:{quantityMs:'0',durationMs:7},workAverage:{quantityMs:'0',durationMs:7}});
    expect(report.stations[0]!.starvedShare).toEqual({timeMs:7,availableWorkMs:7});
  });
  it.each(['sequential','simultaneous'] as const)('does not count future reserved repetitions or held output as an input queue in %s mode',mode=>{
    const c=single();Object.assign(c.stations[0]!.plan[0]!.processing,{mode,repetitions:3});c.stations[0]!.transportThreshold='3';
    const {model,report}=measure(c,mode==='sequential'?2.5*M:M/2);
    expect(model.stocks.some(s=>s.location==='reserved')).toBe(true);
    if(mode==='sequential')expect(model.stocks.some(s=>s.location==='held')).toBe(true);
    expect(report.stations[0]!.inputQueues[0]).toMatchObject({quantity:'0',calendarQuantityMs:'0',workQuantityMs:'0',calendarAverage:{quantityMs:'0'}});
  });
  it('preserves exact fractional input quantities and time integrals',()=>{
    const c=single();c.initialStocks[0]!.quantity='0.5';const {report}=measure(c,7);
    expect(report.stations[0]!.inputQueues[0]).toEqual({materialId:'raw',quantity:'500000',calendarQuantityMs:'3500000',workQuantityMs:'3500000',calendarAverage:{quantityMs:'3500000',durationMs:7},workAverage:{quantityMs:'3500000',durationMs:7}});
  });
  it('keeps assembly inputs separate without summing unlike materials',()=>{
    const c=previewConfig('assembly');c.sources.forEach(s=>s.availability='warehouse');
    c.initialStocks=[{id:'sides',ownerId:'assembly',location:'input',materialId:'prepared',quantity:'2',cost:'0'},{id:'doors',ownerId:'assembly',location:'input',materialId:'processed',quantity:'1',cost:'0'}];
    const {report}=measure(c,5*M),station=report.stations.find(s=>s.stationId==='assembly')!;
    expect(station.inputQueues.map(q=>[q.materialId,q.quantity,q.calendarQuantityMs])).toEqual([['prepared','2000000',String(10n*Q*BigInt(M))],['processed','1000000',String(5n*Q*BigInt(M))]]);
    expect(station.timeByState.starvedMs).toBe(5*M);expect(station).not.toHaveProperty('queueTotal');expect(station).not.toHaveProperty('delivered');
  });
  it.each([false,true])('uses station availability for time shares and common work time for queues, lunch replacement=%s',replacement=>{
    const c=single();c.calendar={shiftStartMs:0,lunchStartMs:M,lunchEndMs:2*M,shiftEndMs:3*M};c.durationMs=3*M;
    c.stations[0]!.lunchReplacement=replacement;c.stations[0]!.plan[0]!.processing.timeMs=10*M;
    const {report}=measure(c,1.5*M),station=report.stations[0]!,q=station.inputQueues[0]!;
    expect(report.workMs).toBe(M);expect(station.availableWorkMs).toBe(replacement?1.5*M:M);
    expect(station.processingShare).toEqual({timeMs:replacement?1.5*M:M,availableWorkMs:replacement?1.5*M:M});
    expect(q).toMatchObject({quantity:'2000000',calendarQuantityMs:String(3n*Q*BigInt(M)),workQuantityMs:String(2n*Q*BigInt(M)),calendarAverage:{durationMs:1.5*M},workAverage:{durationMs:M}});
  });
  it('keeps processing and setup separate even when occupied throughout all available work',()=>{
    const c=cyclicLine();c.calendar={shiftStartMs:0,lunchStartMs:10*M,lunchEndMs:20*M,shiftEndMs:30*M};c.durationMs=30*M;c.stations[0]!.initialRecipeId='recipeB';c.stations[0]!.setupMs=7*M;
    const {report}=measure(c,c.durationMs),station=report.stations[0]!;
    expect(station).toMatchObject({availableWorkMs:20*M,busyMs:20*M,timeByState:{processingMs:4*M,setupMs:16*M,lunchMs:10*M},processingShare:{timeMs:4*M,availableWorkMs:20*M},busyShare:{timeMs:20*M,availableWorkMs:20*M}});
    expect(report.products).toEqual([{materialId:'a',delivered:'2000000'},{materialId:'b',delivered:'1000000'}]);
  });
  it('keeps maintenance distinct from processing and retains a queued kit while service runs',()=>{
    const c=single();c.stations[0]!.maintenance={enabled:true,durationMs:M/2,repetitionsThreshold:1};
    const {report}=measure(c,2.75*M),station=report.stations[0]!;
    expect(station).toMatchObject({busyMs:2.75*M,timeByState:{processingMs:2*M,maintenanceMs:0.75*M},inputQueues:[{quantity:'1000000'}]});
    expect(station.processingShare).not.toEqual(station.busyShare);
  });
  it('retains observed blockage independently of occupancy or current input length',()=>{
    const c=previewConfig('blocking');const {report}=measure(c,90*M),prep=report.stations.find(s=>s.stationId==='prep')!;
    expect(prep.timeByState.blockedMs).toBeGreaterThan(0);expect(prep.blockedShare!.timeMs).toBe(prep.timeByState.blockedMs);
    expect(prep.busyMs+prep.timeByState.blockedMs+prep.timeByState.starvedMs+prep.timeByState.idleMs).toBe(prep.availableWorkMs);
  });
  it('excludes warehouse stock and counts initial good acceptance only as whole-line output',()=>{
    const c=single();c.stations[0]!.outputBuffer={kind:'infinite'};c.recipes[0]!.inputs[0]!.quantity='2';c.recipes[0]!.output.quantity='2';
    c.initialStocks=[{id:'warehouse-kit',ownerId:'warehouse',location:'warehouse',materialId:'raw',quantity:'7',cost:'0'},{id:'goods',ownerId:'s1',location:'output',materialId:'product',quantity:'1',cost:'0'}];
    const {report}=measure(c,0);expect(report.products).toEqual([{materialId:'product',delivered:'1000000'}]);
    expect(report.stations[0]!.inputQueues[0]!.quantity).toBe('1000000'); // One actual warehouse release, not the remaining six.
    expect(report.stations[0]).not.toHaveProperty('products');expect(report.stations[0]).not.toHaveProperty('delivered');
  });
  it('keeps the full observation period when Little warmup is configured',()=>{
    const c=single();c.warmupMs=2*M;const {report,sim}=measure(c,2.5*M);
    expect(report).toMatchObject({fromMs:0,timeMs:2.5*M,calendarMs:2.5*M,workMs:2.5*M});
    expect(sim.getFlowReport()).toMatchObject({fromMs:2*M});expect(report.products[0]!.delivered).toBe('2000000');
    expect(report.stations[0]!.inputQueues[0]!.calendarAverage!.durationMs).toBe(2.5*M);
  });
  it('freezes stopped facts while a full run includes starvation after exhaustion and overnight calendar time',()=>{
    const c=single();c.durationMs+=DAY_MS;const {run,sim}=measure(c,2.5*M);const stopped=constraintFactsReport(run,sim.stop());
    expect(stopped).toMatchObject({complete:false,termination:'stopped',timeMs:2.5*M});expect(constraintFactsReport(run,sim.runToEnd())).toEqual(stopped);
    const full=constraintFactsReport(run,new Simulation(run).runToEnd());expect(full).toMatchObject({complete:true,termination:'horizon',calendarMs:c.durationMs,workMs:16*60*M});
    expect(full.stations[0]!.timeByState).toMatchObject({processingMs:3*M,starvedMs:16*60*M-3*M,offShiftMs:DAY_MS-9*60*M});
  });
  it('does not disclose hidden quality flags, defect origins or provenance',()=>{
    const {run,model,report}=measure(previewConfig('quality'),20*M),hidden=structuredClone(model) as Snapshot;
    for(const s of hidden.stocks){s.provenance.defective=!s.provenance.defective;s.provenance.defectSourceIds=['secret'];s.provenance.origin={kind:'unknown'};}
    expect(constraintFactsReport(run,hidden)).toEqual(report);expect(JSON.stringify(report)).not.toMatch(/secret|defective|provenance/);
  });
  it('returns detached JSON-safe facts without a rank, trend or combined queue',()=>{
    const {run,model,report}=measure(single(),2.5*M),before=structuredClone(model);
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
    expect(Object.keys(report).sort()).toEqual(['fromMs','timeMs','calendarMs','workMs','complete','termination','products','stations'].sort());
    report.stations[0]!.timeByState.processingMs=999;report.stations[0]!.processingShare!.timeMs=999;report.stations[0]!.inputQueues[0]!.calendarAverage!.quantityMs='999';report.products[0]!.delivered='999';
    expect(model).toEqual(before);expect(constraintFactsReport(run,model)).not.toEqual(report);
    expect(Object.keys(report.stations[0]!).sort()).toEqual(['stationId','availableWorkMs','timeByState','busyMs','processingShare','busyShare','starvedShare','blockedShare','inputQueues'].sort());
  });
  it('joins by station and material IDs even when snapshot arrays arrive in a different order',()=>{
    const {run,model,report}=measure(previewConfig('assembly'),20*M),reordered=structuredClone(model) as Snapshot;
    reordered.stations.reverse();reordered.stocks.reverse();reordered.line!.stockTime.reverse();reordered.line!.counters.reverse();
    expect(constraintFactsReport(run,reordered)).toEqual(report);
  });
  it('preserves large integer integrals without converting them to Number',()=>{
    const c=single();c.durationMs+=99*DAY_MS;c.initialStocks[0]!.quantity='9007199254.740991';c.initialStocks[0]!.cost='0';c.stations[0]!.plan[0]!.processing.timeMs=c.durationMs;
    const {report}=measure(c,c.durationMs);const integral=(BigInt(Number.MAX_SAFE_INTEGER)-Q)*BigInt(c.durationMs);
    expect(integral>BigInt(Number.MAX_SAFE_INTEGER)).toBe(true);expect(report.stations[0]!.inputQueues[0]!.calendarQuantityMs).toBe(String(integral));
    expect(JSON.parse(JSON.stringify(report)).stations[0].inputQueues[0].calendarAverage.quantityMs).toBe(String(integral));
  });
});

describe('agreement with existing reports and deterministic playback',()=>{
  it.each(exampleIds)('agrees at every endpoint and across direct/stepped/irregular execution in %s',example=>{
    const run=compileConfig(previewConfig(example)),direct=new Simulation(run);const initial=structuredClone(direct.getSnapshot());compareExisting(run,direct.getSnapshot());expect(direct.getSnapshot()).toEqual(initial);
    while(direct.step()!==null)compareExisting(run,direct.getSnapshot());
    const expected=compareExisting(run,new Simulation(run).runToEnd());expect(constraintFactsReport(run,direct.getSnapshot())).toEqual(expected);
    const split=new Simulation(run);for(let t=13;t<run.resolved.durationMs;t+=1_371_119)split.advanceTo(t);expect(constraintFactsReport(run,split.runToEnd())).toEqual(expected);
  },15_000);
  it.each([60,300,1800,'max'] as const)('keeps facts identical at speed %s with pause, step and repeat',speed=>{
    const run=compileConfig(previewConfig('queue'));let time=0;const scheduled={callback:null as (()=>void)|null};
    const host={now:()=>time,request:(callback:()=>void)=>{scheduled.callback=callback;return 1;},cancel:()=>{scheduled.callback=null;}};
    const runner=new Runner(run,undefined,host);runner.setSpeed(speed);runner.start();runner.pause();const paused=constraintFactsReport(run,runner.getView().model);
    runner.setSpeed(speed);expect(constraintFactsReport(run,runner.getView().model)).toEqual(paused);runner.step();runner.resume();
    let turns=0;while(runner.getView().status==='running'){if(++turns>1000)throw new Error('Too many turns');time+=60_000;const callback=scheduled.callback;scheduled.callback=null;callback!();}
    expect(runner.getView().status).toBe('finished');const expected=constraintFactsReport(run,new Simulation(run).runToEnd());expect(constraintFactsReport(run,runner.getView().model)).toEqual(expected);
    runner.repeat();runner.pause();while(runner.getView().status!=='finished')runner.step();expect(constraintFactsReport(run,runner.getView().model)).toEqual(expected);runner.dispose();
  });
});
