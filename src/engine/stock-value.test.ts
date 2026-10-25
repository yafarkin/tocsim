import {describe, expect, it} from 'vitest';
import {ArithmeticError, MAX_UNITS} from './arithmetic';
import {compileConfig} from './config';
import type {DeepReadonly, EditorConfig} from './config';
import {DAY_MS} from './calendar';
import {EventScheduler} from './events';
import {createPushState} from './sources';
import {Simulation} from './simulation';
import type {Snapshot} from './state';
import {stockCost, stockCostIntegral} from './stock-value';
import {line} from './test-fixtures';
import {exampleIds, previewConfig} from '../ui/preview';
import {Runner} from '../runner/runner';

const M = 60_000, H = 60 * M, C = 1_000_000n;
function finite(): EditorConfig {
  const c = line(); c.stations = [c.stations[0]!]; c.materials = c.materials.filter(m => m.id !== 'part');
  c.stations[0]!.inputBuffer = {kind:'infinite'};
  c.recipes = [{id:'cut', name:'one', kind:'production', inputs:[{materialId:'raw', quantity:'1'}], output:{materialId:'product', quantity:'1'}}];
  c.routes = [c.routes[0]!, {id:'sell', fromId:'s1', toId:'market', materialId:'product'}];
  c.sources[0]!.availability = 'warehouse';
  c.initialStocks = [{id:'kit', ownerId:'s1', location:'input', materialId:'raw', quantity:'3', cost:'30'}];
  return c;
}
const value = (model: DeepReadonly<Snapshot>) => model.line!.stockValue;
const lotsCost = (model: DeepReadonly<Snapshot>) => model.stocks.reduce((n,s) => n + BigInt(s.cost), 0n);
function balance(run: ReturnType<typeof compileConfig>, model: DeepReadonly<Snapshot>): bigint {
  const initial = run.resolved.initialStocks.reduce((n,s) => n+s.cost, 0n);
  const purchases = model.sources.reduce((n,s) => n+BigInt(s.purchasedCost), 0n);
  const removed = model.line!.counters.reduce((n,c) => n+BigInt(c.soldCost)+BigInt(c.scrapCost), 0n);
  const cost = initial + purchases - removed;
  expect(BigInt(value(model).currentCost)).toBe(cost); expect(lotsCost(model)).toBe(cost);
  return cost;
}

describe('physical inventory value over calendar time', () => {
  it('starts with actual initial cost and zero residence before and after time-zero transfers', () => {
    const run = compileConfig(finite()), sim = new Simulation(run);
    for (const model of [sim.getSnapshot(), sim.advanceTo(0)]) {
      expect(value(model)).toEqual({currentCost:'30000000', calendarCostMs:'0'});balance(run,model);
    }
  });
  it('integrates exact rectangles before right-end sales, including event-free tails', () => {
    const sim = new Simulation(compileConfig(finite()));
    expect(value(sim.advanceTo(M))).toEqual({currentCost:'20000000', calendarCostMs:String(30n*C*BigInt(M))});
    expect(value(sim.advanceTo(2.5*M))).toEqual({currentCost:'10000000', calendarCostMs:String(55n*C*BigInt(M))});
    expect(value(sim.advanceTo(3*M))).toEqual({currentCost:'0', calendarCostMs:String(60n*C*BigInt(M))});
    expect(value(sim.runToEnd()).calendarCostMs).toBe(String(60n*C*BigInt(M)));
  });
  it.each(['sequential','simultaneous'] as const)('counts the %s full-batch reserve and held output once', mode => {
    const c = finite(); Object.assign(c.stations[0]!.plan[0]!.processing, {mode, repetitions:3});
    c.stations[0]!.transportThreshold = '3';
    const run = compileConfig(c), sim = new Simulation(run), model = sim.advanceTo(mode === 'sequential' ? 2.5*M : M/2);
    expect(value(model).currentCost).toBe('30000000');balance(run,model);
    if (mode === 'sequential') expect(new Set(model.stocks.map(s=>s.location))).toEqual(new Set(['reserved','held']));
    const end = sim.runToEnd(); expect(value(end).currentCost).toBe('0');
    expect(value(end).calendarCostMs).toBe(String(30n*C*BigInt(mode === 'sequential' ? 3*M : M)));
  });
  it('includes finite warehouse value before release and does not count transfer as purchase', () => {
    const c = finite(); c.initialStocks = [{id:'wh-lot', ownerId:'warehouse', location:'warehouse', materialId:'raw', quantity:'10', cost:'100'}];
    c.sources[0]!.intervalMs = 10*M;
    const run=compileConfig(c), sim=new Simulation(run), model=sim.advanceTo(2*M);
    expect(value(model)).toEqual({currentCost:'90000000', calendarCostMs:String(190n*C*BigInt(M))});
    expect(model.sources[0]!.purchasedCost).toBe('0'); balance(run,model);
    expect(model.stocks.some(s=>s.location==='warehouse')).toBe(true);
  });
  it('values virtual supply only after actual purchase and release', () => {
    const c=finite(); c.initialStocks=[];c.sources[0]!.availability='virtual';c.sources[0]!.intervalMs=10*M;
    const run=compileConfig(c), sim=new Simulation(run);
    expect(value(sim.getSnapshot())).toEqual({currentCost:'0',calendarCostMs:'0'});
    expect(value(sim.advanceTo(0))).toEqual({currentCost:'10000000',calendarCostMs:'0'});
    expect(value(sim.advanceTo(2*M))).toEqual({currentCost:'0',calendarCostMs:String(10n*C*BigInt(M))});balance(run,sim.getSnapshot());
  });
  it('keeps unreleased warehouse stock even when the line is empty or lacks a complete kit', () => {
    const c=finite();c.initialStocks=[{id:'wh-lot',ownerId:'warehouse',location:'warehouse',materialId:'raw',quantity:'0.5',cost:'17'}];
    const run=compileConfig(c), sim=new Simulation(run), end=sim.runToEnd();
    expect(value(end)).toEqual({currentCost:'17000000',calendarCostMs:String(17n*C*BigInt(c.durationMs))});balance(run,end);
  });
  it('preserves inherited cost through assembly and a fractional split without revaluation', () => {
    const c=finite();c.materials.push({id:'rawB',name:'B',role:'raw',color:'#123',purchasePrice:'999'});
    c.sources.push({id:'sourceB',name:'B',materialId:'rawB',availability:'warehouse',quantity:'1',intervalMs:M});c.routes.push({id:'routeB',fromId:'sourceB',toId:'s1',materialId:'rawB'});
    c.recipes[0]!.inputs.push({materialId:'rawB',quantity:'0.2'});c.recipes[0]!.inputs[0]!.quantity='0.3';c.recipes[0]!.output.quantity='3';
    c.initialStocks=[{id:'a',ownerId:'s1',location:'input',materialId:'raw',quantity:'0.3',cost:'0.000007'},{id:'b',ownerId:'s1',location:'input',materialId:'rawB',quantity:'0.2',cost:'0.000004'}];
    const run=compileConfig(c), sim=new Simulation(run);
    expect(value(sim.advanceTo(M-1)).currentCost).toBe('11');
    expect(value(sim.advanceTo(M))).toEqual({currentCost:'0',calendarCostMs:String(11n*BigInt(M))});
    expect(sim.getSnapshot().line!.counters.find(c=>c.materialId==='product')!.soldCost).toBe('11');balance(run,sim.getSnapshot());
  });
  it('preserves micro-money remainders through partial FIFO sales of a 1:10 output', () => {
    const c=line();c.sources[0]!.availability='warehouse';c.initialStocks[0]!.cost='0.000007';
    const run=compileConfig(c), sim=new Simulation(run);
    expect(value(sim.advanceTo(M))).toEqual({currentCost:'7',calendarCostMs:String(7n*BigInt(M))});
    expect(value(sim.advanceTo(2.5*M)).currentCost).toBe('7'); // The first tiny sold share rounds down to zero.
    let previous=sim.getSnapshot(), expected=BigInt(value(previous).calendarCostMs);
    while(sim.step()!==null){const next=sim.getSnapshot();expected+=balance(run,previous)*BigInt(next.timeMs-previous.timeMs);expect(value(next).calendarCostMs).toBe(String(expected));previous=next;}
    expect(value(previous).currentCost).toBe('3');
    expect(previous.line!.counters.find(c=>c.materialId==='product')!.soldCost).toBe('4');balance(run,previous);
  });
  it('includes initial finished stock until its time-zero acceptance, without fabricated residence', () => {
    const c=finite();c.stations[0]!.outputBuffer={kind:'infinite'};c.initialStocks=[{id:'goods',ownerId:'s1',location:'output',materialId:'product',quantity:'1',cost:'17'}];
    const run=compileConfig(c), sim=new Simulation(run);
    expect(value(sim.getSnapshot()).currentCost).toBe('17000000');
    expect(value(sim.advanceTo(0))).toEqual({currentCost:'0',calendarCostMs:'0'});balance(run,sim.runToEnd());
  });
  it('keeps hidden defective WIP until paid inspection discovers it', () => {
    const c=finite();c.stations[0]!.plan[0]!.processing.defectProbability=1;
    c.recipes.push({id:'inspect',name:'check',kind:'inspection',inputs:[{materialId:'product',quantity:'1'}],output:{materialId:'product',quantity:'1'}});
    c.stations.push({...structuredClone(c.stations[0]!),id:'qc',name:'check',plan:[{id:'check-plan',recipeId:'inspect',batches:1,processing:{mode:'sequential',repetitions:1,timeMs:2*M,cv:0}}]});
    c.routes=[c.routes[0]!,{id:'to-check',fromId:'s1',toId:'qc',materialId:'product'},{id:'sell',fromId:'qc',toId:'market',materialId:'product'}];
    const run=compileConfig(c), sim=new Simulation(run);
    expect(value(sim.advanceTo(2*M))).toEqual({currentCost:'30000000',calendarCostMs:String(60n*C*BigInt(M))});
    expect(value(sim.advanceTo(3*M))).toEqual({currentCost:'20000000',calendarCostMs:String(90n*C*BigInt(M))});
    const end=sim.runToEnd();expect(value(end)).toEqual({currentCost:'0',calendarCostMs:String(150n*C*BigInt(M))});balance(run,end);
  });
  it('removes cost once on the free final check', () => {
    const c=finite();c.stations[0]!.plan[0]!.processing.defectProbability=1;
    const run=compileConfig(c), end=new Simulation(run).runToEnd();
    expect(value(end)).toEqual({currentCost:'0',calendarCostMs:String(60n*C*BigInt(M))});
    expect(end.line!.counters.find(c=>c.materialId==='product')).toMatchObject({soldCost:'0',scrapCost:'30000000'});balance(run,end);
  });
  it.each([false,true])('includes lunch and nights with replacement=%s and stops at the actual time', replacement => {
    const c=finite();c.durationMs+=DAY_MS;c.stations[0]!.lunchReplacement=replacement;c.initialStocks[0]!.quantity='0.5';c.initialStocks[0]!.cost='17';
    const sim=new Simulation(compileConfig(c));const at=DAY_MS+4.5*H+7;
    expect(value(sim.advanceTo(at))).toEqual({currentCost:'17000000',calendarCostMs:String(17n*C*BigInt(at))});
    const stopped=sim.stop();expect(stopped.line!.termination).toBe('stopped');
    expect(sim.runToEnd()).toBe(stopped);expect(value(stopped).calendarCostMs).toBe(String(17n*C*BigInt(at)));
  });
  it('handles zero-valued physical stock and an empty exhausted line without invented cost', () => {
    const c=finite();c.initialStocks[0]!.cost='0';const run=compileConfig(c), end=new Simulation(run).runToEnd();
    expect(value(end)).toEqual({currentCost:'0',calendarCostMs:'0'});balance(run,end);
    c.initialStocks=[];expect(value(new Simulation(compileConfig(c)).runToEnd())).toEqual({currentCost:'0',calendarCostMs:'0'});
  });
  it('retains exact, immutable JSON integrals beyond the money range over 100 days', () => {
    const c=finite();c.durationMs+=99*DAY_MS;c.initialStocks[0]!.quantity='0.5';c.initialStocks[0]!.cost='9007199254.740991';
    const model=new Simulation(compileConfig(c)).runToEnd(), integral=MAX_UNITS*BigInt(c.durationMs);
    expect(value(model)).toEqual({currentCost:String(MAX_UNITS),calendarCostMs:String(integral)});
    expect(integral>MAX_UNITS).toBe(true);expect(model.schemaVersion).toBe(24);expect(model.engineVersion).toBe('0.34.0');
    expect(JSON.parse(JSON.stringify(model)).line.stockValue).toEqual(value(model));expect(Object.isFrozen(value(model))).toBe(true);
  });
  it('does not charge station capital or operating expenses to inventory', () => {
    const c=finite(), run=compileConfig(c);c.stations[0]!.costs={capital:'9999',perShift:'999',perLunchHour:'999'};
    expect(value(new Simulation(compileConfig(c)).runToEnd())).toEqual(value(new Simulation(run).runToEnd()));
  });
  it('checks the money range but never applies it to cost multiplied by time', () => {
    expect(stockCost([{cost:3n},{cost:7n}])).toBe(10n);
    expect(stockCostIntegral([{cost:MAX_UNITS}],2)).toBe(MAX_UNITS*2n);
    expect(stockCostIntegral([{cost:11n}],0)).toBe(0n);
    expect(()=>stockCost([{cost:MAX_UNITS},{cost:1n}])).toThrow(ArithmeticError);
    for(const duration of [-1,0.5,Infinity,Number.MAX_SAFE_INTEGER+1]) expect(()=>stockCostIntegral([],duration)).toThrow(ArithmeticError);
  });
  it('rolls the integral back when an endpoint event fails', () => {
    const run=compileConfig(finite()), state=createPushState(run);
    state.line={transferPending:false,dispatchPending:false,counters:[],inspections:[],scraps:[],shiftOutput:[],flowTime:[],stockTime:[],stockCostMs:0n,flowBoundary:null,transfers:[]};
    const loop=new EventScheduler(run,state,{
      integrate:(s,from,to)=>{s.line!.stockCostMs+=stockCostIntegral(s.stocks,to-from);},
      transfer:()=>{throw new Error('failed endpoint');},
    });
    loop.schedule({kind:'transfer',id:'fail',producerId:'s1',timeMs:M});const before=loop.getSnapshot();
    expect(()=>loop.step()).toThrow('failed endpoint');expect(loop.getSnapshot()).toBe(before);expect(value(before).calendarCostMs).toBe('0');
  });
  it.each(exampleIds)('matches conservation-based rectangles, event steps and irregular partitions for %s', example => {
    const run=compileConfig(previewConfig(example)), sim=new Simulation(run);
    let before=sim.getSnapshot(), expected=0n;
    while(sim.step()!==null){
      const model=sim.getSnapshot();expected+=balance(run,before)*BigInt(model.timeMs-before.timeMs);
      expect(value(model).calendarCostMs).toBe(String(expected));balance(run,model);before=model;
    }
    const direct=new Simulation(run).runToEnd();expect(direct).toEqual(before);
    const split=new Simulation(run);for(let t=13;t<run.resolved.durationMs;t+=1_371_119)split.advanceTo(t);
    expect(split.runToEnd()).toEqual(direct);
  });
  it.each([60,300,1800,'max'] as const)('does not depend on playback speed %s, pause or a fresh replay', speed => {
    const run=compileConfig(finite());let time=0;const scheduled={callback:null as (()=>void)|null};
    const host={now:()=>time,request:(callback:()=>void)=>{scheduled.callback=callback;return 1;},cancel:()=>{scheduled.callback=null;}};
    const runner=new Runner(run,undefined,host);runner.setSpeed(speed);runner.start();runner.pause();runner.step();runner.resume();
    let turns=0;
    while(runner.getView().status==='running'){
      if(++turns>1000)throw new Error('Runner failed to finish');
      time+=60_000;const callback=scheduled.callback;scheduled.callback=null;expect(callback).not.toBeNull();callback!();
    }
    const expected=value(new Simulation(run).runToEnd());expect(runner.getView().status).toBe('finished');expect(value(runner.getView().model)).toEqual(expected);runner.dispose();
    const replay=new Runner(run);while(replay.getView().status!=='finished')replay.step();
    expect(value(replay.getView().model)).toEqual(expected);replay.dispose();
  });
});
