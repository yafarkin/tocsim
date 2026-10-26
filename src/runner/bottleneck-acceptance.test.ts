import {describe,expect,it} from 'vitest';
import {compileConfig} from '../engine/config';
import {createCalendar} from '../engine/calendar';
import {Simulation} from '../engine/simulation';
import {previewConfig} from '../ui/preview';
import type {ExampleId} from '../ui/preview';
import {bottleneckConfig,searchBottleneck} from './bottleneck-search';

type Expected={base:number[][];changed:Record<string,number[][]>;ids:string[];outcome:string};
const cases:{id:ExampleId;one:Expected;five:Expected}[]=[
  {id:'balanced',one:{base:[[158]],changed:{},ids:[],outcome:'noGain'},five:{base:[[798]],changed:{},ids:[],outcome:'noGain'}},
  {id:'queue',one:{base:[[59]],changed:{work:[[65]]},ids:['work'],outcome:'candidate'},five:{base:[[299]],changed:{work:[[332]]},ids:['work'],outcome:'candidate'}},
  {id:'blocking',one:{base:[[59]],changed:{work:[[65]]},ids:['work'],outcome:'candidate'},five:{base:[[299]],changed:{work:[[332]]},ids:['work'],outcome:'candidate'}},
  {id:'split',one:{base:[[117]],changed:{finish:[[124]],work:[[124]]},ids:['finish','work'],outcome:'tied'},five:{base:[[597]],changed:{finish:[[631]],work:[[630]]},ids:['finish'],outcome:'candidate'}},
  {id:'assembly',one:{base:[[29]],changed:{work:[[33]]},ids:['work'],outcome:'candidate'},five:{base:[[149]],changed:{work:[[166]]},ids:['work'],outcome:'candidate'}},
  {id:'batches',one:{base:[[229]],changed:{prep:[[230]]},ids:['prep'],outcome:'candidate'},five:{base:[[1189]],changed:{prep:[[1190]]},ids:['prep'],outcome:'candidate'}},
  {id:'plans',one:{base:[[38,18]],changed:{planner:[[40,19]]},ids:['planner'],outcome:'candidate'},five:{base:[[186,92]],changed:{planner:[[194,97]]},ids:['planner'],outcome:'candidate'}},
  {id:'quality',one:{base:[[58],[59],[59]],changed:{work:[[65],[65],[65]]},ids:['work'],outcome:'candidate'},five:{base:[[298],[299],[299]],changed:{work:[[331],[332],[332]]},ids:['work'],outcome:'candidate'}},
];
const units=(values:number[])=>values.map(q=>String(BigInt(q)*1_000_000n));
describe('bottleneck acceptance across all technical examples',()=>{
  it.each(cases)('$id keeps exact trial results at one and five days',async test=>{
    for(const [days,expected] of [[1,test.one],[5,test.five]] as const) {
      const config=previewConfig(test.id);config.durationMs=createCalendar(config.calendar,days).endTimeMs;
      const result=await searchBottleneck(compileConfig(config),{cancelled:()=>false,onProgress:()=>{},yieldTurn:async()=>{}});
      expect(result!.outcome).toBe(expected.outcome);expect(result!.stationIds).toEqual(expected.ids);
      expect(result!.samples.map(s=>s.baseline)).toEqual(expected.base.map(units));
      for(const [i,sample] of result!.samples.entries()) for(const row of sample.outputs) {
        expect(row.quantities).toEqual(units((expected.changed[row.stationId]??expected.base)[i]!));
      }
    }
  },60_000);
  it('separates a one-item fill advantage from unchanged later shift output in the batch example',()=>{
    const c=previewConfig('batches');c.durationMs=createCalendar(c.calendar,5).endTimeMs;const run=compileConfig(c);
    const shifts=(stationId:string|null)=>new Simulation(compileConfig(bottleneckConfig(run,42,stationId))).runToEnd().line!.shiftOutput.filter(r=>r.materialId==='product').map(r=>r.quantity/1_000_000);
    expect(shifts(null)).toEqual([229,240,240,240,240]);
    expect(shifts('prep')).toEqual([230,240,240,240,240]);
    expect(shifts('work')).toEqual([229,240,240,240,240]);
  },20_000);
});
