import {describe,expect,it,vi} from 'vitest';
import type {EditorConfig} from '../engine/config';
import {compileConfig} from '../engine/config';
import {line} from '../engine/test-fixtures';
import {Simulation} from '../engine/simulation';
import {lesson2Config} from '../lessons/lesson-2';
import {previewConfig} from '../ui/preview';
import {bottleneckConfig,searchBottleneck,summarizeBottleneck} from './bottleneck-search';
import type {BottleneckSample} from './bottleneck-search';
import {Runner} from './runner';
const immediate=async()=>{};
function short(c:EditorConfig,ms:number) {c.durationMs=ms;c.calendar={shiftStartMs:0,lunchStartMs:ms-2,lunchEndMs:ms-1,shiftEndMs:ms};}
const search=(run:ReturnType<typeof compileConfig>)=>searchBottleneck(run,{cancelled:()=>false,onProgress:()=>{},yieldTurn:immediate});

describe('bottleneck search with independent paired runs',()=>{
  it('finds the limiting third station in lesson 2 without touching the current Runner',async()=>{
    const run=compileConfig(lesson2Config()),runner=new Runner(run);runner.step();const before=runner.getView();
    const result=await search(run);expect(result!.stationId).toBe('s3');expect(result!.outcome).toBe('candidate');
    expect(result!.samples[0]!.baseline).toEqual(['178000000']);
    expect(result!.samples[0]!.outputs.find(r=>r.stationId==='s3')!.quantities).toEqual(['198000000']);
    expect(runner.getView()).toEqual(before);runner.dispose();
  },20_000);
  it.each(['assembly','split'] as const)('tests the %s topology using the actual engine',async example=>{
    const run=compileConfig(previewConfig(example)),result=await search(run);
    expect(result!.samples).toHaveLength(1);expect(result!.samples[0]!.outputs).toHaveLength(run.resolved.stations.length);
    for(const row of result!.samples[0]!.outputs) {
      const variant=compileConfig(bottleneckConfig(run,run.resolved.seed,row.stationId)),model=new Simulation(variant).runToEnd();
      expect(row.quantities).toEqual(result!.productIds.map(id=>String(model.line!.counters.find(c=>c.materialId===id)!.sold)));
    }
    expect(result!.stationId).toBe(example==='assembly'?'work':null);
    expect(result!.outcome).toBe(example==='assembly'?'candidate':'ambiguous');
  },20_000);
  it('keeps a real mixed-product plan separate by product',async()=>{
    const run=compileConfig(previewConfig('plans')),result=await search(run),model=new Simulation(run).runToEnd();
    expect(result!.productIds).toEqual(['product-a','product-b']);
    expect(result!.samples[0]!.baseline).toEqual(result!.productIds.map(id=>String(model.line!.counters.find(c=>c.materialId===id)!.sold)));
    expect(result!.samples[0]!.outputs.every(row=>row.quantities.length===2)).toBe(true);
  },20_000);
  it('does not force a winner when supply limits output',async()=>{
    const c=line();c.initialStocks=[];c.sources[0]!.intervalMs=60*60_000;const result=await search(compileConfig(c));
    expect(result!.stationId).toBeNull();expect(result!.outcome).toBe('noGain');
  });
  it('fixes inherited buffers and changes only processing times at the selected station',()=>{
    const c=lesson2Config();c.stations.forEach(s=>{s.inputBuffer={kind:'inherit'};s.outputBuffer={kind:'inherit'};});
    c.bufferDefaults={input:{kind:'shift',shifts:'0.5'},output:{kind:'quantity',quantity:'0'}};
    const run=compileConfig(c),base=compileConfig(bottleneckConfig(run,42,null));expect(base.resolved).toEqual(run.resolved);
    const faster=compileConfig(bottleneckConfig(run,42,'s3'));
    for(const station of faster.resolved.stations) {
      const original=run.resolved.stations.find(s=>s.id===station.id)!;
      expect(station.inputBuffers).toEqual(original.inputBuffers);expect(station.outputBuffers).toEqual(original.outputBuffers);
      const restored=station.id==='s3' ? {...station,timeMs:original.timeMs,plan:station.plan.map((row,i)=>({...row,timeMs:original.plan[i]!.timeMs}))} : station;
      expect(restored).toEqual(original);
    }
    expect(run.source.stations[2]!.plan[0]!.processing.timeMs).toBe(480_000);
  });
  it.each([
    {kind:'constant',timeMs:100}, {kind:'lognormal',meanMs:100,cv:0.5},
    {kind:'uniform',minMs:10,maxMs:100}, {kind:'triangular',minMs:10,peakMs:50,maxMs:100},
  ] as const)('scales supported $kind distributions while retaining full batches',distribution=>{
    const c=line();c.stations[0]!.plan[0]!.processing={mode:'simultaneous',repetitions:3,distribution};
    const run=compileConfig(c),modified=bottleneckConfig(run,42,'s1'),p=modified.stations[0]!.plan[0]!.processing;
    expect(p.mode).toBe('simultaneous');expect(p.repetitions).toBe(3);
    expect(compileConfig(modified).resolved.stations[0]!.plan[0]!.timeMs).toBeCloseTo(run.resolved.stations[0]!.plan[0]!.timeMs*0.9,6);
  });
  it('uses three paired seeds for randomness, including unsigned wraparound',async()=>{
    const c=previewConfig('balanced',0.5,4294967295);short(c,30*60_000);
    const result=await search(compileConfig(c));expect(result!.samples.map(s=>s.seed)).toEqual([4294967295,0,1]);
    expect(result!.samples.every(s=>s.outputs.length===3)).toBe(true);
    expect(await search(compileConfig(c))).toEqual(result);
  });
  it('also samples random quality when processing is deterministic',async()=>{
    const c=line();short(c,15*60_000);c.stations[0]!.plan[0]!.processing.defectProbability=0.5;
    expect((await search(compileConfig(c)))!.samples).toHaveLength(3);
  });
  it('honours cancellation between chunks without returning a partial result',async()=>{
    const run=compileConfig(lesson2Config());let turns=0;const progress:number[]=[];
    const result=await searchBottleneck(run,{cancelled:()=>turns>2,onProgress:done=>progress.push(done),yieldTurn:async()=>{turns++;}});
    expect(result).toBeNull();expect(progress).toEqual([0]);expect(turns).toBe(3);
  });
  it('yields before beginning work so the default timer host can cancel immediately',async()=>{
    vi.useFakeTimers();
    try {
      let cancelled=false;const progress:number[]=[];
      const pending=searchBottleneck(compileConfig(lesson2Config()),{cancelled:()=>cancelled,onProgress:done=>progress.push(done)});
      expect(progress).toEqual([0]);cancelled=true;
      await vi.runAllTimersAsync();expect(await pending).toBeNull();expect(progress).toEqual([0]);
    } finally {vi.useRealTimers();}
  });
  it('reports all completed trials and returns JSON data without retaining the input',async()=>{
    const c=line();short(c,15*60_000);const run=compileConfig(c),before=JSON.stringify(c),progress:number[]=[];
    const result=await searchBottleneck(run,{cancelled:()=>false,onProgress:done=>progress.push(done),yieldTurn:immediate});
    expect(progress).toEqual([0,1,2,3]);expect(JSON.parse(JSON.stringify(result))).toEqual(result);expect(JSON.stringify(c)).toBe(before);
    result!.samples[0]!.baseline[0]='changed';expect((await search(run))!.samples[0]!.baseline[0]).not.toBe('changed');
  });
});

describe('conservative candidate interpretation',()=>{
  function sample(a:string[],b:string[],baseline=['100','100'],seed=42):BottleneckSample {
    return {seed,baseline,outputs:[{stationId:'a',quantities:a},{stationId:'b',quantities:b}]};
  }
  it('does not sum different products or prefer a tradeoff',()=>{
    const r=summarizeBottleneck(['x','y'],[sample(['110','100'],['100','120'])]);expect(r.stationId).toBeNull();expect(r.outcome).toBe('ambiguous');
    expect(summarizeBottleneck(['x','y'],[sample(['110','100'],['101','99'])]).stationId).toBe('a');
  });
  it('rejects ties and inconsistent seed leaders',()=>{
    expect(summarizeBottleneck(['x','y'],[sample(['110','100'],['110','100'])]).outcome).toBe('ambiguous');
    const r=summarizeBottleneck(['x','y'],[sample(['110','100'],['100','100']),sample(['100','100'],['110','100'],undefined,43)]);
    expect(r.outcome).toBe('ambiguous');expect(r.stationId).toBeNull();
  });
  it('can identify positive output from a zero baseline without dividing by zero',()=>{
    expect(summarizeBottleneck(['x','y'],[sample(['1','0'],['0','0'],['0','0'])]).stationId).toBe('a');
    expect(summarizeBottleneck(['x','y'],[sample(['0','0'],['0','0'],['0','0'])]).outcome).toBe('noGain');
  });
});
