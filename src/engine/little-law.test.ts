import {describe, expect, it} from 'vitest';
import {compileConfig} from './config';
import type {EditorConfig} from './config';
import {DAY_MS} from './calendar';
import {littleLawReport} from './little-law';
import {flowIdentityReport} from './flow-identity';
import {Simulation} from './simulation';
import {Runner} from '../runner/runner';
import type {Snapshot} from './state';
import {line} from './test-fixtures';
import {exampleIds, previewConfig} from '../ui/preview';
const M=60_000, H=60*M, Q=1_000_000n;
function single(): EditorConfig {
  const c=line(); c.stations=[c.stations[0]!]; c.materials=c.materials.filter(m=>m.id!=='part');
  c.stations[0]!.inputBuffer={kind:'infinite'};
  c.recipes=[{id:'cut',name:'one',kind:'production',inputs:[{materialId:'raw',quantity:'1'}],output:{materialId:'product',quantity:'1'}}];
  c.routes=[c.routes[0]!,{id:'sell',fromId:'s1',toId:'market',materialId:'product'}];c.initialStocks=[]; return c;
}
function applicable(r:ReturnType<typeof littleLawReport>) {if(!r.applicable) throw new Error(r.reason); return r;}
function observe(c:EditorConfig, t:number) {
  const run=compileConfig(c), sim=new Simulation(run), model=sim.advanceTo(t);
  return {run,sim,model,r:applicable(littleLawReport(run,model,sim.getFlowWindowStart()))};
}
function quotient(r:{numerator:string;denominator:string}|null) {return r===null?null:Number(r.numerator)/Number(r.denominator);}

describe('one common flow-time account and exact finite-window Little approximation',()=>{
  it('uses 4.5 minutes for the common report and Little W when a 2:2 recipe merges arrivals',()=>{
    const c=single();c.recipes[0]!.inputs[0]!.quantity='2';c.recipes[0]!.output.quantity='2';c.stations[0]!.plan[0]!.processing.timeMs=4*M;
    const {r,model}=observe(c,5*M);
    expect(model.line!.flowTime[0]!.admission.calendarQuantityMs).toBe(String(9n*Q*BigInt(M)));
    expect(quotient(r.calendar.W)).toBe(4.5*M);
    expect(quotient(r.calendar.L)).toBe(3_000_000);
    expect(quotient(r.calendar.lambda)).toBe(2_000_000/(5*M));
    expect(quotient(r.calendar.lambdaW)).toBe(1_800_000);
    expect(r.calendar.edgeCorrectionQuantityMs).toBe(String(6n*Q*BigInt(M)));
    expect(r.calendar.correctedMatches).toBe(true);expect(r.consistent).toBe(true);
    const start=structuredClone(model);expect(JSON.parse(JSON.stringify(r))).toEqual(r);expect(model).toEqual(start);
  });
  it('keeps current ages consistent with completed times after processing merges physical portions',()=>{
    const c=single();c.recipes[0]!.inputs[0]!.quantity='2';c.recipes[0]!.output.quantity='2';c.stations[0]!.plan[0]!.processing.timeMs=4*M;
    const {model}=observe(c,5*M);
    const origins=model.stocks.filter(s=>s.location==='reserved').map(s=>s.provenance.origin);
    expect(origins).toEqual([{kind:'known',startedAtMs:2*M},{kind:'known',startedAtMs:3*M}]);
    const age=model.line!.stockAge.materials.find(m=>m.materialId==='raw')!.admission;
    expect(age.meanCalendarMs).toBe(1.5*M);
  });
  it('separates unfinished end residence from the completed-only approximation',()=>{
    const {r}=observe(single(),2.5*M);
    expect(quotient(r.calendar.L)).toBe(1_000_000);expect(quotient(r.calendar.W)).toBe(M);
    expect(quotient(r.calendar.lambdaW)).toBe(800_000);
    expect(r.calendar).toMatchObject({remainingClippedQuantityMs:String(Q*BigInt(M)/2n),completedBeforeWindowQuantityMs:'0',edgeCorrectionQuantityMs:String(Q*BigInt(M)/2n),correctedMatches:true});
    expect(r.emptyStart).toBe(true);expect(r.hasRemaining).toBe(true);
  });
  it('excludes a warmup boundary completion and includes the next completion with its full residence',()=>{
    const c=single();c.warmupMs=M;
    const {r,sim}=observe(c,2.5*M);
    expect(sim.getFlowWindowStart()!.line!.flowTime[0]!.admission.knownQuantity).toBe(1_000_000);
    expect(r).toMatchObject({fromMs:M,toMs:2.5*M,initialQuantity:'1000000',admittedQuantity:'1000000',exitedQuantity:'1000000',consistent:true});
    expect(quotient(r.calendar.W)).toBe(M);expect(r.calendar.completedBeforeWindowQuantityMs).toBe('0');
    expect(r.calendar.edgeCorrectionQuantityMs).toBe(String(Q*BigInt(M)/2n));
  });
  it('subtracts the pre-window residence of completions crossing an event-free warmup',()=>{
    const c=single();c.warmupMs=M/2;
    const {r,sim}=observe(c,2.5*M);
    expect(sim.getFlowWindowStart()!.timeMs).toBe(M/2);
    expect(r.calendar).toMatchObject({durationMs:2*M,completedBeforeWindowQuantityMs:String(Q*BigInt(M)/2n),remainingClippedQuantityMs:String(Q*BigInt(M)/2n),edgeCorrectionQuantityMs:'0',correctedMatches:true});
    expect(quotient(r.calendar.L)).toBe(1_000_000);expect(r.calendar.L).toEqual(r.calendar.lambdaW);
  });
  it('does not assume a zero age for initial unknown stock',()=>{
    const c=single();c.sources[0]!.availability='warehouse';c.initialStocks=[{id:'initial',ownerId:'s1',location:'input',materialId:'raw',quantity:'3',cost:'30'}];
    const {r}=observe(c,2.5*M);
    expect(r.unknownCompletedQuantity).toBe('2000000');expect(r.consistent).toBe(true);
    expect(r.calendar).toMatchObject({W:null,lambdaW:null,approximationUnavailable:'unknownHistory',completedResidenceQuantityMs:null,edgeCorrectionQuantityMs:null,correctedMatches:null,exactMatches:true});
  });
  it('recovers W after all unknown initial units left during warmup',()=>{
    const c=single();c.initialStocks=[{id:'initial',ownerId:'s1',location:'input',materialId:'raw',quantity:'1',cost:'10'}];c.warmupMs=2*M;
    const {r}=observe(c,4.5*M);expect(r.unknownCompletedQuantity).toBe('0');expect(quotient(r.calendar.W)).toBe(2*M);expect(r.consistent).toBe(true);
  });
  it('keeps known and unknown quantities separate when a conserving recipe processes them together',()=>{
    const c=single();c.initialStocks=[{id:'initial',ownerId:'s1',location:'input',materialId:'raw',quantity:'1',cost:'10'}];
    c.recipes[0]!.inputs[0]!.quantity='2';c.recipes[0]!.output.quantity='2';
    const {model,r}=observe(c,M);
    expect(model.line!.flowTime[0]!.admission).toMatchObject({knownQuantity:1_000_000,unknownQuantity:1_000_000,calendarQuantityMs:String(Q*BigInt(M))});
    expect(r.calendar.approximationUnavailable).toBe('unknownHistory');expect(r.consistent).toBe(true);
  });
  it.each([0, M/2])('has honest absent averages at zero duration or without completions, t=%s',t=>{
    const {r}=observe(single(),t);expect(r.calendar.W).toBeNull();expect(r.calendar.lambdaW).toBeNull();
    expect(r.calendar.approximationUnavailable).toBe(t===0?'zeroPeriod':'noCompletions');expect(r.calendar.L===null).toBe(t===0);expect(r.consistent).toBe(true);
  });
  it('includes initial good acceptance at timestamp zero only for a zero warmup window',()=>{
    const c=single();c.sources[0]!.availability='warehouse';c.initialStocks=[{id:'goods',ownerId:'s1',location:'output',materialId:'product',quantity:'1',cost:'1'}];c.stations[0]!.outputBuffer={kind:'infinite'};
    expect(observe(c,1).r.exitedQuantity).toBe('1000000');c.warmupMs=1;
    const {r}=observe(c,2);expect(r.exitedQuantity).toBe('0');expect(r.calendar.approximationUnavailable).toBe('noCompletions');expect(r.consistent).toBe(true);
  });
  it('returns warmupNotReached before the configured boundary, including a stopped run',()=>{
    const c=single();c.warmupMs=2*M;const run=compileConfig(c),sim=new Simulation(run);sim.advanceTo(M);sim.stop();
    expect(sim.getFlowWindowStart()).toBeNull();expect(littleLawReport(run,sim.getSnapshot(),sim.getFlowWindowStart())).toEqual({applicable:false,reason:'warmupNotReached'});
  });
  it('uses the exact end boundary when warmup equals the horizon',()=>{
    const c=single();c.warmupMs=c.durationMs;const {r,sim}=observe(c,c.durationMs);
    expect(sim.getFlowWindowStart()!.timeMs).toBe(c.durationMs);expect(r.calendar.L).toBeNull();expect(r.calendar.approximationUnavailable).toBe('zeroPeriod');expect(r.consistent).toBe(true);
  });
  it('keeps lambda zero and W absent after exhaustion while integrating the full horizon',()=>{
    const c=single();c.sources[0]!.availability='warehouse';c.warmupMs=2*M;
    const {r}=observe(c,c.durationMs);expect(r.complete).toBe(true);expect(quotient(r.calendar.L)).toBe(0);expect(quotient(r.calendar.lambda)).toBe(0);expect(r.calendar.W).toBeNull();expect(r.consistent).toBe(true);
  });
  it.each([false,true])('uses the common work clock through lunch and nights, replacement=%s',replacement=>{
    const c=single();c.durationMs+=DAY_MS;c.warmupMs=4.5*H;c.stations[0]!.lunchReplacement=replacement;c.sources[0]!.intervalMs=2*H;c.stations[0]!.plan[0]!.processing.timeMs=4.5*H;
    const {r}=observe(c,DAY_MS+5*H);expect(r.work.durationMs).toBe(8*H);expect(r.calendar.durationMs).toBe(DAY_MS+H/2);expect(r.consistent).toBe(true);expect(r.work.correctedMatches).toBe(true);
  });
  it('does not turn a positive calendar window inside lunch into a positive work duration',()=>{
    const c=single();c.warmupMs=4*H;const {r}=observe(c,4.5*H);expect(r.calendar.durationMs).toBe(H/2);expect(r.work.durationMs).toBe(0);expect(r.work.approximationUnavailable).toBe('zeroPeriod');expect(r.consistent).toBe(true);
  });
  it.each([1,2,10,100])('reduces the relative end effect for a stable empty-start %s-minute run',minutes=>{
    const {r}=observe(single(),(minutes+0.5)*M);
    expect(quotient(r.calendar.L)).toBe(1_000_000);
    expect(quotient(r.calendar.lambdaW)).toBe(1_000_000*minutes/(minutes+0.5));expect(r.consistent).toBe(true);
  });
  it('freezes the baseline and actual stopped observation',()=>{
    const c=single();c.warmupMs=M/2;const {run,sim}=observe(c,2.5*M),baseline=sim.getFlowWindowStart(),copy=structuredClone(baseline);
    const stopped=sim.stop(),r=littleLawReport(run,stopped,baseline);expect(littleLawReport(run,sim.runToEnd(),baseline)).toEqual(r);
    expect(sim.getFlowWindowStart()).toBe(baseline);expect(baseline).toEqual(copy);expect(Object.isFrozen(baseline!.stocks)).toBe(true);
  });
  it('rejects a baseline from a different configuration or time',()=>{
    const c=single();c.warmupMs=M;const {run,sim,model}=observe(c,3*M);const wrong=structuredClone(sim.getFlowWindowStart()) as Snapshot;wrong.timeMs=0;
    expect(()=>littleLawReport(run,model,wrong)).toThrow('same run');wrong.timeMs=M;wrong.calculationHash='other';expect(()=>littleLawReport(run,model,wrong)).toThrow('same run');
  });
  it('detects damaged common completed times independently of the boundary identity',()=>{
    const {run,sim,model}=observe(single(),2.5*M);const damaged=structuredClone(model) as Snapshot;
    damaged.line!.flowTime[0]!.admission.calendarQuantityMs='1';
    expect(flowIdentityReport(run,damaged)).toMatchObject({consistent:true});
    expect(applicable(littleLawReport(run,damaged,sim.getFlowWindowStart()))).toMatchObject({consistent:false,calendar:{exactMatches:true,correctedMatches:false}});
  });
  it.each(exampleIds)('has identical results and baseline for direct, stepped and irregular advances in %s',example=>{
    const c=previewConfig(example);c.warmupMs=13_357;const run=compileConfig(c);
    const direct=new Simulation(run);direct.runToEnd();const expected=littleLawReport(run,direct.getSnapshot(),direct.getFlowWindowStart());
    const stepped=new Simulation(run);while(stepped.step()!==null) {
      const r=littleLawReport(run,stepped.getSnapshot(),stepped.getFlowWindowStart());if(r.applicable)expect(r.consistent).toBe(true);
    }
    const split=new Simulation(run);for(let t=17;t<run.resolved.durationMs;t+=1_371_119) split.advanceTo(t);split.runToEnd();
    for(const sim of [stepped,split]) {expect(littleLawReport(run,sim.getSnapshot(),sim.getFlowWindowStart())).toEqual(expected);expect(sim.getFlowWindowStart()).toEqual(direct.getFlowWindowStart());}
  });
  it.each([-1,1.5,Infinity,NaN,'1',null])('rejects invalid warmup %s',warmup=>{
    const c=single() as unknown as Record<string,unknown>;c.warmupMs=warmup;expect(()=>compileConfig(c)).toThrow();
  });
  it('detects a damaged count in the common completed-time report',()=>{
    const {run,sim,model}=observe(single(),2.5*M);const damaged=structuredClone(model) as Snapshot;
    damaged.line!.flowTime[0]!.admission.knownQuantity--;
    expect(applicable(littleLawReport(run,damaged,sim.getFlowWindowStart()))).toMatchObject({consistent:false,completedQuantityDifference:'-1'});
  });
  it('does not change material movement or money when a warmup checkpoint splits integration',()=>{
    const c=single();const plain=new Simulation(compileConfig(c));const plainEnd=structuredClone(plain.runToEnd());
    c.warmupMs=M/2;const measured=new Simulation(compileConfig(c));const measuredEnd=structuredClone(measured.runToEnd());
    expect({...measuredEnd,calculationHash:plainEnd.calculationHash}).toEqual(plainEnd);
  });
  it('keeps exact large integrals across a 100-day observation without numeric conversion',()=>{
    const c=single();c.durationMs+=99*DAY_MS;c.warmupMs=M/2;c.sources[0]!.availability='warehouse';
    c.initialStocks=[{id:'huge',ownerId:'s1',location:'input',materialId:'raw',quantity:'9007199254.740991',cost:'0'}];
    c.stations[0]!.plan[0]!.processing.timeMs=c.durationMs;
    const {r}=observe(c,c.durationMs);const area=BigInt(Number.MAX_SAFE_INTEGER)*BigInt(c.durationMs-c.warmupMs);
    expect(area>BigInt(Number.MAX_SAFE_INTEGER)).toBe(true);expect(r.calendar.integralQuantityMs).toBe(String(area));
    expect(r.calendar.clippedResidenceQuantityMs).toBe(String(area));expect(r.consistent).toBe(true);expect(JSON.parse(JSON.stringify(r))).toEqual(r);
  });
  it.each([60,300,1800,'max'] as const)('preserves the report at playback speed %s with pause, step and resume',speed=>{
    const c=single();c.warmupMs=M/2;const run=compileConfig(c);let time=0;
    const scheduled={callback:null as (()=>void)|null};
    const host={now:()=>time,request:(callback:()=>void)=>{scheduled.callback=callback;return 1;},cancel:()=>{scheduled.callback=null;}};
    const runner=new Runner(run,undefined,host);runner.setSpeed(speed);runner.start();runner.pause();runner.step();runner.resume();
    let turns=0;while(runner.getView().status==='running') {if(++turns>1000)throw new Error('Too many turns');time+=60_000;const callback=scheduled.callback;scheduled.callback=null;callback!();}
    const direct=new Simulation(run);direct.runToEnd();expect(runner.getView().status).toBe('finished');expect(runner.getFlowReport()).toEqual(direct.getFlowReport());runner.dispose();
    const replay=new Runner(run);while(replay.getView().status!=='finished')replay.step();expect(replay.getFlowReport()).toEqual(direct.getFlowReport());replay.dispose();
  });
  it('defaults old configurations to zero warmup and fingerprints a changed warmup',()=>{
    const c=single(),run=compileConfig(c);expect(run.resolved.warmupMs).toBe(0);c.warmupMs=0;expect(compileConfig(c).calculationHash).toBe(run.calculationHash);
    c.warmupMs=1;expect(compileConfig(c).calculationHash).not.toBe(run.calculationHash);c.warmupMs=c.durationMs+1;expect(()=>compileConfig(c)).toThrow();
  });
});
