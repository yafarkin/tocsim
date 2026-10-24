import {describe, expect, it} from 'vitest';
import {compileConfig} from '../engine/config';
import {Simulation} from '../engine/simulation';
import {line} from '../engine/test-fixtures';
import {exampleIds, previewConfig} from './preview';
import {chartGeometry, chartStationOrder, closestChartPoint, flowChartData, globalCfdReason, LINE_SCOPE, plot} from './flow-chart-data';
const M = 60_000;

describe('comparable CFD boundaries and exact chart quantities', () => {
  it.each(['balanced','queue','blocking','split','batches','quality'] as const)('accepts a conserved whole-line flow for %s', example => {
    expect(globalCfdReason(compileConfig(previewConfig(example)))).toBeNull();
  });
  it('rejects assembly, quantity conversion and mixed product totals', () => {
    expect(globalCfdReason(compileConfig(previewConfig('assembly')))).toBe('assembly');
    expect(globalCfdReason(compileConfig(line()))).toBe('quantityChange');
    expect(globalCfdReason(compileConfig(previewConfig('plans')))).toBe('mixedProducts');
    const run = compileConfig(previewConfig('assembly')), sim = new Simulation(run);
    expect(() => flowChartData(run, sim.getHistory(), LINE_SCOPE)).toThrow();
    expect(() => flowChartData(run, sim.getHistory(), 'missing')).toThrow();
  });
  it('orders station bands by routes rather than alphabetical or input-array order', () => {
    const run = compileConfig(previewConfig('queue'));
    expect(chartStationOrder(run)).toEqual(['prep','work','finish']);
    const data = flowChartData(run, new Simulation(run).getHistory(), LINE_SCOPE);
    expect(data.cfd.map(s => s.key)).toEqual(['delivered','scrapped','station-finish','station-work','station-prep']);
  });
  it('exposes the expected queue and first good delivery at minute 14', () => {
    const run = compileConfig(previewConfig('queue')), sim = new Simulation(run); sim.advanceTo(14*M);
    const data = flowChartData(run,sim.getHistory(),LINE_SCOPE), last = data.frames.at(-1)!;
    expect(last.cfd).toEqual(['1000000','0','0','3000000','1000000']);
    expect(Object.fromEntries(data.wip.map((s,i) => [s.id,last.wip[i]]))).toEqual({prepared:'3000000',processed:'0',product:'0',raw:'1000000'});
    expect(last.output).toEqual(['1000000']); expect(data.frames[0]!.point.phase).toBe('initial');
  });
  it('retains the initial point separately, without duplicating a ready state', () => {
    const c=previewConfig('queue');c.initialStocks=[{id:'old-kit',ownerId:'work',location:'input',materialId:'prepared',quantity:'2',cost:'0'}];
    const run=compileConfig(c),sim=new Simulation(run),before=flowChartData(run,sim.getHistory(),LINE_SCOPE);
    expect(before.frames).toHaveLength(1);expect(before.frames[0]!.cfd.reduce((s,q)=>s+BigInt(q),0n)).toBe(2_000_000n);
    sim.advanceTo(0);const after=flowChartData(run,sim.getHistory(),LINE_SCOPE);
    expect(after.frames.slice(0,2).map(f=>[f.point.timeMs,f.point.phase])).toEqual([[0,'initial'],[0,'settled']]);
    expect(after.frames[1]!.cfd.reduce((s,q)=>s+BigInt(q),0n)).toBe(3_000_000n);
  });
  it.each(exampleIds)('conserves the selected flow and keeps WIP/output separate in %s', example => {
    const run=compileConfig(previewConfig(example)),sim=new Simulation(run);sim.runToEnd();const h=sim.getHistory();
    const scopes=run.resolved.materials.map(m=>m.id);if(globalCfdReason(run)===null)scopes.push(LINE_SCOPE);
    for(const scope of scopes){
      const data=flowChartData(run,h,scope),initial=h.initial.values.materials.filter(m=>scope===LINE_SCOPE||m.materialId===scope).reduce((s,m)=>s+BigInt(m.wip),0n);
      for(const f of data.frames){
        const rows=f.point.values.materials.filter(m=>scope===LINE_SCOPE||m.materialId===scope);
        const incoming=rows.reduce((s,m)=>s+BigInt(m.released)+(scope===LINE_SCOPE?0n:BigInt(m.produced)),0n);
        expect(f.cfd.reduce((s,q)=>s+BigInt(q),0n)).toBe(initial+incoming);
        expect(f.output).toEqual(data.output.map(s=>f.point.values.materials.find(m=>m.materialId===s.id)!.delivered));
        expect(f.wip).toEqual(data.wip.map(s=>f.point.values.materials.find(m=>m.materialId===s.id)!.wip));
      }
    }
  });
  it('keeps detected scrap as an exit rather than a good product or station stock', () => {
    const c=previewConfig('queue');c.stations[0]!.plan[0]!.processing.defectProbability=1;
    const run=compileConfig(c),sim=new Simulation(run);sim.advanceTo(14*M);
    const data=flowChartData(run,sim.getHistory(),LINE_SCOPE),row=data.frames.at(-1)!;
    expect(row.cfd[0]).toBe('0');expect(row.cfd[1]).toBe('1000000');expect(row.output).toEqual(['0']);
  });
});

describe('step geometry and sample inspection', () => {
  it('uses only the actual interval and supports zero time without NaN', () => {
    const run=compileConfig(previewConfig('queue')),sim=new Simulation(run);
    let data=flowChartData(run,sim.getHistory(),LINE_SCOPE),g=chartGeometry(data,'cfd','calendar');
    expect(g.end).toBe(0);expect(g.paths.join('')).not.toMatch(/NaN|Infinity|undefined/);
    sim.advanceTo(4.5*60*M);data=flowChartData(run,sim.getHistory(),LINE_SCOPE);
    g=chartGeometry(data,'cfd','calendar');expect(g.end).toBe(4.5*60*M);expect(g.xs.at(-1)).toBe(plot.right);
    const work=chartGeometry(data,'cfd','work');expect(work.end).toBe(4*60*M);expect(new Set(work.xs).size).toBeLessThan(work.xs.length);
    expect(g.paths.every(p=>p.endsWith('Z')&&p.includes('H')&&p.includes('V'))).toBe(true);
    const lines=chartGeometry(data,'wip','calendar');expect(lines.paths.every(p=>!p.endsWith('Z'))).toBe(true);
  });
  it('selects nearest samples and the last observation at equal working times', () => {
    expect(closestChartPoint([0,0,10,20],0)).toBe(1);expect(closestChartPoint([0,10,10,10,20],10)).toBe(3);
    expect(closestChartPoint([0,10,10,10,20],9)).toBe(3);expect(closestChartPoint([0,10,20],14)).toBe(1);
    expect(closestChartPoint([0,10,20],16)).toBe(2);expect(closestChartPoint([0],100)).toBe(0);
  });
});
