import {describe, expect, it} from 'vitest';
import {compileConfig} from './config';
import type {EditorConfig} from './config';
import {Simulation} from './simulation';
import {line} from './test-fixtures';
import {flowReport} from './flow-report';
import {previewConfig, defaultBatchProfiles} from '../ui/preview';
import {defaultQuality, withQuality} from '../ui/quality';
const M = 60_000, DAY = 86_400_000;
const run = (c: EditorConfig) => new Simulation(compileConfig(c));
function reportAt(c: EditorConfig, time: number) {const config=compileConfig(c);return flowReport(config,new Simulation(config).advanceTo(time));}
function oneStation(): EditorConfig {
  const c=line();c.stations=[c.stations[0]!];c.materials=c.materials.filter(m=>m.id!=='part');
  c.stations[0]!.inputBuffer={kind:'infinite'};
  c.recipes=[{id:'cut',name:'one',kind:'production',inputs:[{materialId:'raw',quantity:'1'}],output:{materialId:'product',quantity:'1'}}];
  c.routes=[c.routes[0]!,{id:'sell',fromId:'s1',toId:'market',materialId:'product'}];
  c.sources[0]!.availability='warehouse';
  c.initialStocks=[{id:'kit',ownerId:'s1',location:'input',materialId:'raw',quantity:'3',cost:'30'}];
  return c;
}

describe('output by shift from actual good deliveries',()=>{
  it('counts initial finished stock as delivery at time zero, not new production',()=>{
    const c=line();c.sources[0]!.availability='warehouse';c.initialStocks=[{id:'goods',ownerId:'s2',location:'output',materialId:'product',quantity:'1',cost:'10'}];
    const sim=run(c);expect(sim.getSnapshot().line!.shiftOutput).toEqual([]);
    const at=sim.advanceTo(0);expect(at.line!.shiftOutput).toEqual([{dayIndex:0,materialId:'product',quantity:1_000_000}]);
    expect(at.line!.counters.find(r=>r.materialId==='product')).toMatchObject({produced:0,sold:1_000_000});
  });
  it('records only good output, including the completed last operation at the horizon',()=>{
    const c=oneStation();c.calendar={shiftStartMs:0,lunchStartMs:M,lunchEndMs:2*M,shiftEndMs:3*M};c.durationMs=3*M;
    const at=run(c).runToEnd();expect(at.line!.shiftOutput).toEqual([{dayIndex:0,materialId:'product',quantity:2_000_000}]);
    c.stations[0]!.plan[0]!.processing.defectProbability=1;
    const bad=run(c).runToEnd();expect(bad.line!.shiftOutput).toEqual([]);expect(bad.line!.counters.find(r=>r.materialId==='product')!.scrapped).toBe(2_000_000);
  });
  it('uses the closing shift at 24:00, including a full midnight-to-midnight schedule',()=>{
    const c=oneStation();c.calendar={shiftStartMs:0,lunchStartMs:12*60*M,lunchEndMs:13*60*M,shiftEndMs:DAY};c.durationMs=DAY;
    c.stations[0]!.plan[0]!.processing.timeMs=23*60*M;
    expect(run(c).runToEnd().line!.shiftOutput).toEqual([{dayIndex:0,materialId:'product',quantity:1_000_000}]);
    c.calendar={shiftStartMs:20*60*M,lunchStartMs:21*60*M,lunchEndMs:22*60*M,shiftEndMs:DAY};c.durationMs=4*60*M;c.stations[0]!.plan[0]!.processing.timeMs=3*60*M;
    expect(run(c).runToEnd().line!.shiftOutput).toEqual([{dayIndex:0,materialId:'product',quantity:1_000_000}]);
  });
  it('keeps shift buckets through nights and a partial second shift without inventing future output',()=>{
    const c=oneStation();c.calendar={shiftStartMs:8*60*M,lunchStartMs:8*60*M+M,lunchEndMs:8*60*M+2*M,shiftEndMs:8*60*M+3*M};c.durationMs=DAY+3*M;
    const sim=run(c);const partial=sim.advanceTo(DAY+M/2);sim.stop();
    expect(partial.line!.shiftOutput).toEqual([{dayIndex:0,materialId:'product',quantity:2_000_000}]);
    const end=run(c).runToEnd();expect(end.line!.shiftOutput).toEqual([{dayIndex:0,materialId:'product',quantity:2_000_000},{dayIndex:1,materialId:'product',quantity:1_000_000}]);
    expect(end.timeMs).toBe(c.durationMs);expect(end.line!.shiftOutput.reduce((s,r)=>s+r.quantity,0)).toBe(end.line!.counters.find(r=>r.materialId==='product')!.sold);
  });
  it('retains separate product rows in a cyclic plan and excludes inspection rejects',()=>{
    for(const c of [previewConfig('plans'),withQuality(previewConfig('quality'),{...defaultQuality,position:'late'})]){
      const end=run(c).runToEnd();
      for(const material of c.materials.filter(m=>m.role==='finished')) expect(end.line!.shiftOutput.filter(r=>r.materialId===material.id).reduce((s,r)=>s+r.quantity,0)).toBe(end.line!.counters.find(r=>r.materialId===material.id)!.sold);
      expect(JSON.parse(JSON.stringify(end)).schemaVersion).toBe(23);expect(Object.isFrozen(end.line!.shiftOutput)).toBe(true);
    }
  });
  it('is identical under irregular advancement, step and reversed input arrays',()=>{
    const c=previewConfig('quality');const expected=run(c).runToEnd();const sim=run(c);
    for(let time=0;time<c.durationMs;time+=123457)sim.advanceTo(time);
    expect(sim.runToEnd()).toEqual(expected);
    const stepped=run(c);while(stepped.step());expect(stepped.getSnapshot()).toEqual(expected);
    c.stations.reverse();c.recipes.reverse();c.routes.reverse();c.materials.reverse();expect(run(c).runToEnd()).toEqual(expected);
  });
});

describe('disjoint physical stock report',()=>{
  it('separates warehouse from material in the line at an unstarted time zero',()=>{
    const c=line();c.sources[0]!.availability='warehouse';c.initialStocks.push({id:'warehouse-kit',ownerId:'warehouse',location:'warehouse',materialId:'raw',quantity:'7.25',cost:'72.5'});
    const config=compileConfig(c), model=new Simulation(config).getSnapshot(), report=flowReport(config,model);
    expect(report.warehouse).toEqual([{materialId:'raw',quantity:'7250000'}]);
    expect(report.materials.find(r=>r.materialId==='raw')).toMatchObject({input:'500000',reserved:'0',held:'0',output:'0',total:'500000'});
    expect(report.complete).toBe(false);expect(report.products[0]).toMatchObject({produced:'0',delivered:'0',awaitingAcceptance:'0'});
  });
  it.each(['sequential','simultaneous'] as const)('does not count input and unfinished output twice in %s batches',mode=>{
    const profiles=structuredClone(defaultBatchProfiles);profiles.prep.mode=mode;const c=previewConfig('batches',0,42,profiles);
    const report=reportAt(c,6*M);const raw=report.materials.find(r=>r.materialId==='raw')!, part=report.materials.find(r=>r.materialId==='prepared')!;
    expect(raw.reserved).toBe('6000000');expect(part.total).toBe('0');
    const later=reportAt(c,8*M);
    if(mode==='sequential'){
      expect(later.materials.find(r=>r.materialId==='prepared')!.held).toBe('1000000');
      expect(later.materials.find(r=>r.materialId==='raw')!.reserved).toBe('5000000');
    }else{
      expect(later.materials.find(r=>r.materialId==='prepared')!.total).toBe('6000000');
      expect(later.materials.find(r=>r.materialId==='raw')!.reserved).toBe('0');
    }
  });
  it.each(['balanced','queue','blocking','split','assembly','batches','plans','quality'] as const)('matches every stock lot without reading hidden quality in %s',example=>{
    const c=previewConfig(example), config=compileConfig(c), model=new Simulation(config).advanceTo(100*M), report=flowReport(config,model);
    for(const material of config.resolved.materials){
      const row=report.materials.find(r=>r.materialId===material.id)!;
      expect(BigInt(row.total)).toBe(model.stocks.filter(s=>s.materialId===material.id&&s.location!=='warehouse').reduce((sum,s)=>sum+BigInt(s.quantity),0n));
      expect(BigInt(row.input)+BigInt(row.reserved)+BigInt(row.held)+BigInt(row.output)).toBe(BigInt(row.total));
    }
    const disguised={...model, stocks:model.stocks.map(s=>({...s, provenance:{...s.provenance,defective:!s.provenance.defective,defectSourceIds:['hidden']}}))};
    expect(flowReport(config,disguised)).toEqual(report);
  });
  it('keeps ready but blocked finished stock in the line, with the final-material total as a subset',()=>{
    const c=oneStation();c.stations[0]!.plan[0]!.processing.repetitions=3;c.stations[0]!.transportThreshold='3';
    const report=reportAt(c,M);
    expect(report.products[0]).toMatchObject({produced:'1000000',delivered:'0',awaitingAcceptance:'1000000'});
    expect(report.materials.find(r=>r.materialId==='product')!).toMatchObject({held:'1000000',total:'1000000'});
    expect(report.materials.find(r=>r.materialId==='raw')!.reserved).toBe('2000000');
  });
  it('does not round aggregate stock above the safe-number range',()=>{
    const c=oneStation(), config=compileConfig(c), initial=new Simulation(config).getSnapshot();
    const stock={...initial.stocks[0]!,quantity:Number.MAX_SAFE_INTEGER};
    const model={...initial,stocks:[stock,{...stock,id:'second',location:'reserved' as const}]};
    const report=flowReport(config,model);
    expect(report.materials.find(r=>r.materialId==='raw')!.total).toBe(String(2n*BigInt(Number.MAX_SAFE_INTEGER)));
  });
});
