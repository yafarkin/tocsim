import {describe, expect, it} from 'vitest';
import {compileConfig} from '../engine/config';
import {Simulation} from '../engine/simulation';
import {previewConfig} from '../ui/preview';
import {batchesLessonConfig, batchesLessonResult} from './lesson-batches';

describe('batches lesson', () => {
  it('preserves the baseline and changes only the two transfer thresholds', () => {
    const base = batchesLessonConfig(), expected = previewConfig('batches');
    expected.id = base.id; expected.name = base.name;
    expect(base).toEqual(expected);
    const changed = structuredClone(base);
    changed.stations[0]!.transportThreshold = '1'; changed.stations[1]!.transportThreshold = '1';
    expect(batchesLessonConfig(1)).toEqual(changed);
    expect(base.stations.map(s => s.plan[0]!.processing.repetitions)).toEqual([6,6,1]);
    changed.stations[0]!.plan[0]!.processing.repetitions = 1;
    expect(batchesLessonConfig(1).stations[0]!.plan[0]!.processing.repetitions).toBe(6);
  });
  it.each([[3,24],[1,20]] as const)('threshold %s preserves the full-kit start and gives first output at %s minutes', (threshold, first) => {
    const run = compileConfig(batchesLessonConfig(threshold)), sim = new Simulation(run);
    const before = sim.advanceTo(17*60_000-1);
    expect(before.stations.find(s=>s.stationId==='work')!.timeByState.processingMs).toBe(0);
    const start = sim.advanceTo(17*60_000);
    expect(start.stations.find(s=>s.stationId==='work')!.remainingProcessingMs).not.toBeNull();
    expect(sim.advanceTo(first*60_000-1).line!.counters.find(c=>c.materialId==='product')!.sold).toBe(0);
    expect(sim.advanceTo(first*60_000).line!.counters.find(c=>c.materialId==='product')!.sold).toBe(1_000_000);
    const end = sim.runToEnd(), result = batchesLessonResult(run,end);
    expect(end.line!.termination).toBe('horizon');
    expect(end.timeMs).toBe(32_400_000);
    expect(result).toEqual({firstStartMs:17*60_000,firstOutputMs:first*60_000,total:end.line!.counters.find(c=>c.materialId==='product')!.sold});
    expect(result.total).toBeGreaterThan(0);
    const straight = new Simulation(run).runToEnd();
    expect(straight).toEqual(end);
    expect(batchesLessonResult(run,straight)).toEqual(result);
  });
  it('translates without changing the calculation', () => {
    for (const threshold of [3,1] as const) {
      expect(compileConfig(batchesLessonConfig(threshold,'ru')).calculationHash).toBe(compileConfig(batchesLessonConfig(threshold,'en')).calculationHash);
    }
  });
});
