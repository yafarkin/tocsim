import {describe,expect,it} from 'vitest';
import {compileConfig} from './config';
import type {EditorConfig} from './config';
import {calendarForDuration,DAY_MS} from './calendar';
import {emptyFlowBoundaryMoments,flowIdentityReport,flowIdentityReason,recordFlowBoundary} from './flow-identity';
import {integrateStockTime} from './stock-time';
import {Simulation} from './simulation';
import {EventScheduler} from './events';
import {createPushState} from './sources';
import type {Snapshot} from './state';
import {line} from './test-fixtures';
import {exampleIds,previewConfig} from '../ui/preview';
import {globalCfdReason} from '../ui/flow-chart-data';
import {Runner} from '../runner/runner';
const M=60_000,H=60*M,Q=1_000_000n;
function single(): EditorConfig {
  const c=line();c.stations=[c.stations[0]!];c.materials=c.materials.filter(m=>m.id!=='part');
  c.stations[0]!.inputBuffer={kind:'infinite'};
  c.recipes=[{id:'cut',name:'one',kind:'production',inputs:[{materialId:'raw',quantity:'1'}],output:{materialId:'product',quantity:'1'}}];
  c.routes=[c.routes[0]!,{id:'sell',fromId:'s1',toId:'market',materialId:'product'}];
  c.sources[0]!.availability='warehouse';c.initialStocks=[{id:'kit',ownerId:'s1',location:'input',materialId:'raw',quantity:'3',cost:'30'}];return c;
}
function applicable(r:ReturnType<typeof flowIdentityReport>){if(!r.applicable)throw new Error(r.reason);return r;}
function measure(c:EditorConfig,t:number){const run=compileConfig(c),sim=new Simulation(run),model=sim.advanceTo(t);return {run,sim,model,r:applicable(flowIdentityReport(run,model))};}

describe('exact finite flow identity from independent boundary moments',()=>{
  it('clips unknown initial history to zero without rewriting completed lead time',()=>{
    const {model,r}=measure(single(),2.5*M);
    expect(r).toMatchObject({initialQuantity:'3000000',admittedQuantity:'0',exitedQuantity:'2000000',remainingQuantity:'1000000',quantityDifference:'0',consistent:true,complete:false});
    expect(r.calendar).toMatchObject({integralQuantityMs:String(55n*Q*BigInt(M)/10n),clippedResidenceQuantityMs:String(55n*Q*BigInt(M)/10n),admissionMomentQuantityMs:'0',exitMomentQuantityMs:String(3n*Q*BigInt(M)),remainingEndMomentQuantityMs:String(25n*Q*BigInt(M)/10n),differenceQuantityMs:'0',matches:true});
    expect(r.work).toEqual(r.calendar);
    expect(model.line!.flowTime[0]!.admission).toMatchObject({knownQuantity:0,unknownQuantity:2_000_000,calendarQuantityMs:'0',meanCalendarMs:null});
  });
  it('has exact zero integrals before and after initial finished stock is accepted at time zero',()=>{
    const c=single();c.stations[0]!.outputBuffer={kind:'infinite'};c.initialStocks=[{id:'goods',ownerId:'s1',location:'output',materialId:'product',quantity:'1',cost:'7'}];
    const run=compileConfig(c),sim=new Simulation(run),before=applicable(flowIdentityReport(run,sim.getSnapshot()));
    expect(before.initialQuantity).toBe('1000000');expect(before.remainingQuantity).toBe('1000000');
    const after=applicable(flowIdentityReport(run,sim.advanceTo(0)));expect(after.exitedQuantity).toBe('1000000');expect(after.remainingQuantity).toBe('0');
    for(const r of [before,after]){expect(r.consistent).toBe(true);expect(r.calendar.integralQuantityMs).toBe('0');expect(r.calendar.clippedResidenceQuantityMs).toBe('0');}
  });
  it('weights actual admissions and exits independently at later timestamps',()=>{
    const c=single();c.initialStocks=[];c.sources[0]!.availability='virtual';const {r}=measure(c,2.5*M);
    expect(r).toMatchObject({initialQuantity:'0',admittedQuantity:'3000000',exitedQuantity:'2000000',remainingQuantity:'1000000',consistent:true});
    expect(r.calendar).toMatchObject({admissionMomentQuantityMs:String(3n*Q*BigInt(M)),exitMomentQuantityMs:String(3n*Q*BigInt(M)),integralQuantityMs:String(25n*Q*BigInt(M)/10n)});
  });
  it('does not double count a source event that admits several sources together',()=>{
    const c=single();c.initialStocks=[];c.sources[0]!.availability='virtual';
    c.sources.push({...c.sources[0]!,id:'sourceB'});c.routes.push({id:'routeB',fromId:'sourceB',toId:'s1',materialId:'raw'});
    const {r}=measure(c,2.5*M);expect(r.admittedQuantity).toBe('6000000');expect(r.calendar.admissionMomentQuantityMs).toBe(String(6n*Q*BigInt(M)));expect(r.consistent).toBe(true);
  });
  it('excludes warehouse residence before release and includes only the successful release',()=>{
    const c=single();c.initialStocks=[{id:'warehouse-lot',ownerId:'warehouse',location:'warehouse',materialId:'raw',quantity:'10',cost:'100'}];c.sources[0]!.intervalMs=10*M;
    const {model,r}=measure(c,12*M);expect(model.stocks.find(s=>s.location==='warehouse')!.quantity).toBe(8_000_000);
    expect(r).toMatchObject({initialQuantity:'0',admittedQuantity:'2000000',exitedQuantity:'2000000',remainingQuantity:'0',consistent:true});
    expect(r.calendar).toMatchObject({integralQuantityMs:String(2n*Q*BigInt(M)),admissionMomentQuantityMs:String(10n*Q*BigInt(M)),exitMomentQuantityMs:String(12n*Q*BigInt(M))});
  });
  it('survives a 2:2 recipe merging lots admitted at different times',()=>{
    const c=single();c.initialStocks=[];c.sources[0]!.availability='virtual';c.recipes[0]!.inputs[0]!.quantity='2';c.recipes[0]!.output.quantity='2';c.stations[0]!.plan[0]!.processing.timeMs=4*M;
    const {model,r}=measure(c,5*M);
    expect(r).toMatchObject({admittedQuantity:'6000000',exitedQuantity:'2000000',remainingQuantity:'4000000',consistent:true});
    expect(r.calendar.integralQuantityMs).toBe(String(15n*Q*BigInt(M)));expect(r.calendar.clippedResidenceQuantityMs).toBe(String(15n*Q*BigInt(M)));
    // The completed-time report uses the same preserved physical origins.
    expect(model.line!.flowTime[0]!.admission.calendarQuantityMs).toBe(String(9n*Q*BigInt(M)));
  });
  it.each(['sequential','simultaneous'] as const)('counts reserved and held %s batch portions only once',mode=>{
    const c=single();Object.assign(c.stations[0]!.plan[0]!.processing,{mode,repetitions:3});c.stations[0]!.transportThreshold='3';
    const {run,sim,r}=measure(c,mode==='sequential'?2.5*M:M/2);expect(r.consistent).toBe(true);
    expect(r.calendar.integralQuantityMs).toBe(String(3n*Q*BigInt(mode==='sequential'?2.5*M:M/2)));
    const end=applicable(flowIdentityReport(run,sim.runToEnd()));expect(end.calendar.clippedResidenceQuantityMs).toBe(String(3n*Q*BigInt(mode==='sequential'?3*M:M)));expect(end.consistent).toBe(true);
  });
  it('supports fractional initial stocks and disjoint places',()=>{
    const c=single();c.initialStocks=[{id:'a',ownerId:'s1',location:'input',materialId:'raw',quantity:'0.4',cost:'0'},{id:'b',ownerId:'s1',location:'input',materialId:'raw',quantity:'0.1',cost:'0'}];
    const {r}=measure(c,7);expect(r.initialQuantity).toBe('500000');expect(r.calendar.integralQuantityMs).toBe('3500000');expect(r.consistent).toBe(true);
  });
  it.each([false,true])('uses common calendar/work clocks through lunch and night, replacement=%s',replacement=>{
    const c=single();c.durationMs+=DAY_MS;c.initialStocks[0]!.quantity='0.5';c.stations[0]!.lunchReplacement=replacement;
    const t=DAY_MS+4.5*H,{r}=measure(c,t);expect(r.consistent).toBe(true);
    expect(r.calendar.clippedResidenceQuantityMs).toBe(String(Q*BigInt(t)/2n));expect(r.work.clippedResidenceQuantityMs).toBe(String(Q*BigInt(12*H)/2n));
  });
  it('uses a flat common work clock for a completion during paid lunch',()=>{
    const c=single();c.initialStocks[0]!.quantity='1';c.stations[0]!.lunchReplacement=true;c.stations[0]!.plan[0]!.processing.timeMs=4.5*H;
    const {r}=measure(c,4.5*H);expect(r.consistent).toBe(true);expect(r.exitedQuantity).toBe(String(Q));
    expect(r.calendar.exitMomentQuantityMs).toBe(String(Q*BigInt(4.5*H)));expect(r.work.exitMomentQuantityMs).toBe(String(Q*BigInt(4*H)));
  });
  it('supports inspection without defects but does not reuse the more permissive CFD quality rule',()=>{
    const c=previewConfig('quality');c.stations.forEach(s=>s.plan.forEach(p=>p.processing.defectProbability=0));
    const run=compileConfig(c),end=new Simulation(run).runToEnd();expect(flowIdentityReport(run,end)).toMatchObject({applicable:true,consistent:true});
    const quality=compileConfig(previewConfig('quality'));expect(globalCfdReason(quality)).toBeNull();expect(flowIdentityReason(quality)).toBe('quality');
  });
  it.each([['assembly','assembly'],['plans','mixedProducts'],['quality','quality']] as const)('does not assert a whole-line identity for %s', (example,reason)=>{
    const run=compileConfig(previewConfig(example)),model=new Simulation(run).runToEnd();
    expect(model.line!.flowBoundary).toBeNull();expect(flowIdentityReport(run,model)).toEqual({applicable:false,reason});
  });
  it('rejects quantity-changing recipes while preserving the existing CFD eligibility',()=>{
    const run=compileConfig(line());expect(flowIdentityReason(run)).toBe('quantityChange');expect(flowIdentityReport(run,new Simulation(run).runToEnd())).toEqual({applicable:false,reason:'quantityChange'});
  });
  it('freezes the actual stopped interval and observes the full horizon after exhaustion',()=>{
    const run=compileConfig(single()),sim=new Simulation(run);sim.advanceTo(2.5*M);const stopped=sim.stop(),r=applicable(flowIdentityReport(run,stopped));
    expect(r.complete).toBe(false);expect(r.calendarMs).toBe(2.5*M);expect(r.consistent).toBe(true);expect(flowIdentityReport(run,sim.runToEnd())).toEqual(r);
    const full=applicable(flowIdentityReport(run,new Simulation(run).runToEnd()));expect(full.complete).toBe(true);expect(full.consistent).toBe(true);expect(full.calendar.clippedResidenceQuantityMs).toBe(String(6n*Q*BigInt(M)));
  });
  it('is exact and JSON-safe for large quantity-time products over 100 days',()=>{
    const c=single();c.durationMs+=99*DAY_MS;c.initialStocks[0]!.quantity='9007199254.740991';c.initialStocks[0]!.cost='0';c.stations[0]!.plan[0]!.processing.timeMs=c.durationMs;
    const run=compileConfig(c),model=new Simulation(run).runToEnd(),r=applicable(flowIdentityReport(run,model));
    const expected=BigInt(Number.MAX_SAFE_INTEGER)*BigInt(c.durationMs);expect(expected>BigInt(Number.MAX_SAFE_INTEGER)).toBe(true);
    expect(r.calendar.integralQuantityMs).toBe(String(expected));expect(r.calendar.clippedResidenceQuantityMs).toBe(String(expected));expect(r.consistent).toBe(true);
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);expect(JSON.parse(JSON.stringify(model)).schemaVersion).toBe(24);expect(Object.isFrozen(model.line!.flowBoundary)).toBe(true);
  });
  it('serializes boundary time moments above the safe money range without losing cancellation',()=>{
    const c=single();c.durationMs+=99*DAY_MS;c.initialStocks=[];c.sources[0]!.availability='virtual';c.sources[0]!.quantity='2';c.sources[0]!.intervalMs=8*H;c.stations[0]!.plan[0]!.processing.timeMs=1;
    const run=compileConfig(c),model=new Simulation(run).runToEnd(),r=applicable(flowIdentityReport(run,model));
    const admission=2n*Q*BigInt(DAY_MS)*4950n;
    expect(admission>BigInt(Number.MAX_SAFE_INTEGER)).toBe(true);expect(r.calendar.admissionMomentQuantityMs).toBe(String(admission));
    expect(r.calendar.exitMomentQuantityMs).toBe(String(admission+300n*Q));expect(r.calendar.integralQuantityMs).toBe(String(300n*Q));expect(r.consistent).toBe(true);
    expect(JSON.parse(JSON.stringify(model)).line.flowBoundary).toEqual(model.line!.flowBoundary);
  });
  it.each(['integral','boundary','quantity','exits'] as const)('detects a deliberately damaged %s without a tolerance',field=>{
    const run=compileConfig(single()),model=structuredClone(new Simulation(run).advanceTo(2.5*M)) as Snapshot;
    if(field==='integral')model.line!.stockTime[0]!.calendarQuantityMs=String(BigInt(model.line!.stockTime[0]!.calendarQuantityMs)+1n);
    if(field==='boundary')model.line!.flowBoundary!.admissionCalendarQuantityMs='1';
    if(field==='quantity')model.stocks[0]!.quantity+=1;
    if(field==='exits')model.line!.counters.find(c=>c.materialId==='product')!.sold+=1;
    expect(applicable(flowIdentityReport(run,model)).consistent).toBe(false);
  });
  it('rolls boundary moments back along with the rest of an unsuccessful endpoint',()=>{
    const run=compileConfig(single()),state=createPushState(run);state.line={transferPending:false,dispatchPending:false,counters:[],inspections:[],scraps:[],shiftOutput:[],flowTime:[],stockTime:[],stockCostMs:0n,flowBoundary:emptyFlowBoundaryMoments(),transfers:[]};
    const calendar=calendarForDuration(run.resolved.calendar,run.resolved.durationMs),loop=new EventScheduler(run,state,{
      integrate:(s,from,to)=>integrateStockTime(s.stocks,s.line!.stockTime,{calendarMs:to-from,workMs:to-from}),
      transfer:ctx=>{recordFlowBoundary(ctx.state.line!.flowBoundary!,'exit',1_000_000,ctx.timeMs,calendar);throw new Error('failed endpoint');},
    });loop.schedule({kind:'transfer',id:'failure',producerId:'s1',timeMs:M});const before=loop.getSnapshot();expect(()=>loop.step()).toThrow('failed endpoint');expect(loop.getSnapshot()).toBe(before);expect(before.line!.flowBoundary!.exitCalendarQuantityMs).toBe('0');
  });
  it.each(exampleIds)('agrees at every event and under irregular partitions for %s',example=>{
    const run=compileConfig(previewConfig(example)),sim=new Simulation(run);const initial=structuredClone(sim.getSnapshot());
    flowIdentityReport(run,sim.getSnapshot());expect(sim.getSnapshot()).toEqual(initial);
    while(sim.step()!==null){const r=flowIdentityReport(run,sim.getSnapshot());if(r.applicable)expect(r.consistent).toBe(true);else expect(r.reason).not.toBeNull();}
    const expected=flowIdentityReport(run,new Simulation(run).runToEnd());expect(flowIdentityReport(run,sim.getSnapshot())).toEqual(expected);
    const split=new Simulation(run);for(let t=13;t<run.resolved.durationMs;t+=1_371_119)split.advanceTo(t);expect(flowIdentityReport(run,split.runToEnd())).toEqual(expected);
  });
  it.each([60,300,1800,'max'] as const)('does not depend on speed %s, pause, step, resume or fresh replay',speed=>{
    const run=compileConfig(single());let time=0;const scheduled={callback:null as (()=>void)|null};const host={now:()=>time,request:(callback:()=>void)=>{scheduled.callback=callback;return 1;},cancel:()=>{scheduled.callback=null;}};
    const runner=new Runner(run,undefined,host);runner.setSpeed(speed);runner.start();runner.pause();runner.step();runner.resume();let turns=0;
    while(runner.getView().status==='running'){if(++turns>1000)throw new Error('Too many turns');time+=60_000;const callback=scheduled.callback;scheduled.callback=null;callback!();}
    const expected=flowIdentityReport(run,new Simulation(run).runToEnd());expect(runner.getView().status).toBe('finished');expect(flowIdentityReport(run,runner.getView().model)).toEqual(expected);runner.dispose();
    const replay=new Runner(run);while(replay.getView().status!=='finished')replay.step();expect(flowIdentityReport(run,replay.getView().model)).toEqual(expected);replay.dispose();
  });
});
