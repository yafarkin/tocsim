import {compileConfig} from './config.js';
import type {EditorConfig, RunConfig} from './contract/index.js';
import {Simulation} from './simulation.js';
import {toEngineRunError} from './run.js';
import type {BottleneckSearchResponse} from './contract/index.js';

import type {BottleneckSample, BottleneckResult, BottleneckSearchOptions} from './contract/index.js';
export type {BottleneckSample, BottleneckResult, BottleneckSearchOptions} from './contract/index.js';
const shorter=(ms:number)=>Math.max(1,Number((BigInt(ms)*9n+5n)/10n));
const quantity=(units:number)=>{
  const n=BigInt(units),fraction=(n%1_000_000n).toString().padStart(6,'0').replace(/0+$/,'');
  return `${n/1_000_000n}${fraction ? `.${fraction}` : ''}`;
};
/** Fix resolved capacities before changing processing times; inherited shift buffers must not move. */
export function bottleneckConfig(run:RunConfig,seed:number,stationId:string|null):EditorConfig {
  const config=structuredClone(run.source) as EditorConfig;
  config.seed=seed;
  for (const station of config.stations) {
    const resolved=run.resolved.stations.find(s=>s.id===station.id)!;
    for (const side of ['input','output'] as const) {
      station[side==='input' ? 'inputBuffer' : 'outputBuffer']={kind:'materials',materials:resolved[side==='input' ? 'inputBuffers' : 'outputBuffers'].map(b=>({
        materialId:b.materialId,capacity:b.capacity.kind==='infinite' ? {kind:'infinite'} : {kind:'quantity',quantity:quantity(b.capacity.quantity)},
      }))};
    }
    if (station.id!==stationId) continue;
    for (const row of station.plan) {
      const p=row.processing,d=p.distribution;
      if (!d) {p.timeMs=shorter(p.timeMs);continue;}
      if (d.kind==='constant') d.timeMs=shorter(d.timeMs);
      else if (d.kind==='lognormal') d.meanMs=shorter(d.meanMs);
      else {d.minMs=shorter(d.minMs);d.maxMs=shorter(d.maxMs);if (d.kind==='triangular') d.peakMs=shorter(d.peakMs);}
    }
  }
  return config;
}
export function summarizeBottleneck(productIds:string[],samples:BottleneckSample[]):BottleneckResult {
  const ids=samples[0]!.outputs.map(row=>row.stationId);
  const greater=(a:string[],b:string[])=>a.every((q,i)=>BigInt(q)>=BigInt(b[i]!))&&a.some((q,i)=>BigInt(q)>BigInt(b[i]!));
  const leaders=ids.filter(id=>samples.every(sample=>{
    const row=sample.outputs.find(r=>r.stationId===id)!;
    return greater(row.quantities,sample.baseline)&&sample.outputs.every(other=>other.stationId===id||row.quantities.every((q,i)=>BigInt(q)>=BigInt(other.quantities[i]!)));
  }));
  const anyGain=samples.some(sample=>sample.outputs.some(row=>row.quantities.some((q,i)=>BigInt(q)>BigInt(sample.baseline[i]!))));
  return {productIds,samples,stationIds:leaders,
    outcome:leaders.length===1 ? 'candidate' : leaders.length>1 ? 'tied' : anyGain ? 'ambiguous' : 'noGain'};
}
/** Cooperative independent simulations. No DOM, shared Runner or persistent results. */
export async function searchBottleneck(run:RunConfig,options:BottleneckSearchOptions = {}):Promise<BottleneckResult|null> {
  const yieldTurn=options.yieldTurn ?? (()=>new Promise<void>(resolve=>setTimeout(resolve,0)));
  const stochastic=run.resolved.stations.some(s=>s.plan.some(p=>p.cv>0||((p.defectProbability??0)>0&&(p.defectProbability??0)<1)));
  const seeds=stochastic ? [0,1,2].map(offset=>(run.resolved.seed+offset)%4294967296) : [run.resolved.seed];
  const productIds=run.resolved.materials.filter(m=>m.role==='finished').map(m=>m.id);
  const stations=run.resolved.stations.map(s=>s.id),total=seeds.length*(stations.length+1),samples:BottleneckSample[]=[];
  let done=0;
  options.onProgress?.(0,total);
  for (const seed of seeds) {
    const sample:BottleneckSample={seed,baseline:[],outputs:[]};
    for (const stationId of [null,...stations]) {
      await yieldTurn();if ((options.cancelled?.() ?? false)) return null;
      const simulation=new Simulation(compileConfig(bottleneckConfig(run,seed,stationId)));
      while (simulation.nextEventTime()!==null) {
        const started=performance.now();
        for (let i=0;i<64&&performance.now()-started<8;i++) {
          if ((options.cancelled?.() ?? false)) return null;
          if (simulation.step()===null) break;
        }
        await yieldTurn();if ((options.cancelled?.() ?? false)) return null;
      }
      const model=simulation.runToEnd();
      if (model.line!.termination!=='horizon') throw new Error('Search run did not complete its horizon.');
      const quantities=productIds.map(id=>String(model.line!.counters.find(c=>c.materialId===id)!.sold));
      if (stationId===null) sample.baseline=quantities;
      else sample.outputs.push({stationId,quantities});
      options.onProgress?.(++done,total);
    }
    samples.push(sample);
  }
  return (options.cancelled?.() ?? false) ? null : summarizeBottleneck(productIds,samples);
}

/** Validate JSON and run a complete search; errors use the same envelope as simulation mode. */
export async function searchBottleneckJson(json: string): Promise<BottleneckSearchResponse> {
  let input: unknown;
  try {
    input = JSON.parse(json);
  } catch {
    return {ok: false, error: {code: 'json', path: null, objectId: null,
      messages: {ru: 'Входные данные не являются корректным JSON.', en: 'Input is not valid JSON.'}}};
  }
  try {
    // A complete batch needs no UI timer turns and cannot be cancelled by callbacks.
    const result = await searchBottleneck(compileConfig(input), {yieldTurn: async () => {}});
    return {ok: true, result: result!};
  } catch (error) {
    return {ok: false, error: toEngineRunError(error)};
  }
}
