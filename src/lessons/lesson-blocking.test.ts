import {describe, expect, it} from 'vitest';
import {compileConfig} from '../engine/config';
import {Simulation} from '../engine/simulation';
import {previewConfig} from '../ui/preview';
import {blockingLessonConfig, blockingLessonResult} from './lesson-blocking';

describe('blocking lesson', () => {
  it('preserves the technical baseline and changes only Processing input capacity', () => {
    const base = blockingLessonConfig(1), expected = previewConfig('blocking');
    expected.id = base.id; expected.name = base.name;
    expect(base).toEqual(expected);
    const large = blockingLessonConfig(8), changed = structuredClone(base);
    changed.stations.find(s => s.id === 'work')!.inputBuffer = {kind:'quantity', quantity:'8'};
    expect(large).toEqual(changed);
    large.stations[0]!.setupMs = 10;
    expect(blockingLessonConfig(8).stations[0]!.setupMs).toBe(0);
  });
  it('shows more preparation and stock without more finished output', () => {
    const models = [1, 8].map(buffer => new Simulation(compileConfig(blockingLessonConfig(buffer as 1 | 8))).runToEnd());
    const [small, large] = models.map(blockingLessonResult);
    for (const model of models) {
      expect(model.line!.termination).toBe('horizon');
      expect(model.timeMs).toBe(32_400_000);
    }
    expect(small!.total).toBe(59_000_000);
    expect(large!.total).toBe(small!.total);
    expect(large!.prepared).toBeGreaterThan(small!.prepared);
    expect(large!.queue).toBeGreaterThan(small!.queue);
    expect(large!.blockedMs).toBeLessThan(small!.blockedMs);
  });
  it('starts empty, replays exactly and preserves calculations across languages', () => {
    const run = compileConfig(blockingLessonConfig());
    expect(blockingLessonResult(new Simulation(run).getSnapshot())).toEqual({total:0, prepared:0, blockedMs:0, queue:0});
    expect(new Simulation(run).runToEnd()).toEqual(new Simulation(run).runToEnd());
    for (const buffer of [1,8] as const) {
      expect(compileConfig(blockingLessonConfig(buffer, 'ru')).calculationHash).toBe(compileConfig(blockingLessonConfig(buffer, 'en')).calculationHash);
    }
  });
});
