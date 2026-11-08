import {describe, expect, it} from 'vitest';
import {compileConfig, ConfigError} from '@toc/engine';
import {Simulation} from '@toc/engine';
import {blockingLessonConfig} from '../lessons/lesson-blocking';
import {previewConfig} from '../ui/preview';
import {appendLinearStation, compileLinearProcess, createLinearProcess, moveLinearStation, removeLinearStation} from './linear-process';

function product(config: ReturnType<typeof createLinearProcess>) {
  const run = compileLinearProcess(config), snapshot = new Simulation(run).runToEnd();
  const id = run.resolved.materials.find(item => item.role === 'finished')!.id;
  return snapshot.line!.counters.find(item => item.materialId === id)!.sold;
}

describe('linear process foundation', () => {
  it('uses lesson 4 conditions and matches its 59 units without changing the lesson', () => {
    const config = createLinearProcess('my-process');
    expect(config.stations.map(item => item.plan[0]!.processing.timeMs)).toEqual([180_000, 480_000, 180_000]);
    expect(product(config)).toBe(59_000_000);
    const lesson = new Simulation(compileConfig(blockingLessonConfig())).runToEnd();
    expect(lesson.line!.counters.find(item => item.materialId === 'product')!.sold).toBe(product(config));
    expect(product(config)).toBe(product(JSON.parse(JSON.stringify(config))));
    expect(compileLinearProcess(config)).toEqual(compileConfig(config));
  });

  it('preserves original data, station settings and identities when reconnecting', () => {
    const config = createLinearProcess('my-process'), before = structuredClone(config);
    config.displayOrder = ['source', 's1', 's2', 's3', 'market'];
    const moved = moveLinearStation(config, 's2', -1);
    expect(moved.stations.map(item => item.id)).toEqual(['s2', 's1', 's3']);
    expect(moved.displayOrder).toEqual(['source', 's2', 's1', 's3', 'market']);
    expect(moved.stations.find(item => item.id === 's2')).toEqual(config.stations[1]);
    expect(moved.recipes.find(item => item.id === 'recipe-s1')!.inputs[0]!.materialId).toBe('output-s2');
    expect(moved.routes.find(item => item.id === 'source-route')!.toId).toBe('s2');
    delete config.displayOrder;
    expect(config).toEqual(before);
    const added = appendLinearStation(config, 'Extra', 60_000);
    expect(added.materials.find(item => item.id === 'output-s3')!.role).toBe('intermediate');
    const removed = removeLinearStation(added, 's2');
    expect(removed.materials.some(item => item.id === 'output-s2')).toBe(false);
    expect(removed.recipes.find(item => item.id === 'recipe-s3')!.inputs[0]!.materialId).toBe('output-s1');
    expect(removeLinearStation(added, 's4')).toEqual(config);
    const lastRemoved = removeLinearStation(config, 's3');
    expect(lastRemoved.materials.find(item => item.id === 'output-s2')!.role).toBe('finished');
    const firstRemoved = removeLinearStation(config, 's1');
    expect(firstRemoved.recipes.find(item => item.id === 'recipe-s2')!.inputs[0]!.materialId).toBe('raw');
  });

  it('handles 1 and 30 stations, guards limits and follows routes rather than entity array order', () => {
    let config = removeLinearStation(removeLinearStation(createLinearProcess('process'), 's3'), 's2');
    expect(config.stations).toHaveLength(1);
    expect(() => removeLinearStation(config, 's1')).toThrow(ConfigError);
    for (let i = 1; i < 30; i++) config = appendLinearStation(config, `Station ${i}`, 180_000);
    expect(compileLinearProcess(config).resolved.stations).toHaveLength(30);
    expect(() => appendLinearStation(config, 'Too many', 180_000)).toThrow(ConfigError);
    config.stations.reverse();
    expect(removeLinearStation(config, 's2').stations[0]!.id).toBe('s1');
    expect(() => moveLinearStation(config, 's1', -1)).toThrow(ConfigError);
    expect(() => removeLinearStation(config, 'missing')).toThrow(ConfigError);
    expect(() => appendLinearStation(config, 'Bad time', 0)).toThrow(ConfigError);
  });

  it('allocates IDs without collisions across object kinds', () => {
    const config = createLinearProcess('s4');
    expect(appendLinearStation(config, 'New', 180_000).stations.at(-1)!.id).toBe('s5');
    expect(() => createLinearProcess('raw')).toThrow(ConfigError);
    expect(createLinearProcess('english', 'en').stations[0]!.name).toBe('Station 1');
  });

  it.each(['split', 'assembly', 'batches', 'plans', 'quality'] as const)('rejects %s without changing it', example => {
    const config = previewConfig(example), before = structuredClone(config);
    expect(() => compileLinearProcess(config)).toThrow(ConfigError);
    expect(config).toEqual(before);
  });

  it.each(['source', 'calendar', 'stock', 'warmup', 'cost', 'price', 'distribution', 'maintenance', 'buffer'] as const)(
    'rejects unsupported %s settings without discarding them', field => {
      const config = createLinearProcess('process');
      switch (field) {
        case 'source': config.sources[0]!.intervalMs = 60_000; break;
        case 'calendar': config.calendar.shiftStartMs = 27_000_000; break;
        case 'stock': config.initialStocks.push({id: 'stock', ownerId: 's1', location: 'input', materialId: 'raw', quantity: '1', cost: '0'}); break;
        case 'warmup': config.warmupMs = 60_000; break;
        case 'cost': config.stations[0]!.costs.capital = '1'; break;
        case 'price': config.materials[0]!.purchasePrice = '1'; break;
        case 'distribution': config.stations[0]!.plan[0]!.processing = {mode: 'sequential', repetitions: 1, distribution: {kind: 'constant', timeMs: 180_000}}; break;
        case 'maintenance': config.stations[0]!.maintenance = {enabled: true, durationMs: 60_000, repetitionsThreshold: 3}; break;
        case 'buffer': config.stations[0]!.inputBuffer = {kind: 'materials', materials: [{materialId: 'raw', capacity: {kind: 'quantity', quantity: '1'}}]}; break;
      }
      const before = structuredClone(config);
      expect(() => compileLinearProcess(config)).toThrow(ConfigError);
      expect(config).toEqual(before);
    });

  it('accepts editable times, CV, seed, horizon and inherited or overridden buffers', () => {
    const config = createLinearProcess('process');
    config.seed = 7; config.durationMs = 118_800_000;
    config.stations[0]!.name = 'Renamed';
    config.stations[0]!.plan[0]!.processing = {mode: 'sequential', repetitions: 1, timeMs: 240_000, cv: 0.5};
    config.bufferDefaults!.input = {kind: 'shift', shifts: '0.5'};
    config.stations[1]!.inputBuffer = {kind: 'quantity', quantity: '8'};
    config.stations[2]!.outputBuffer = {kind: 'infinite'};
    expect(compileLinearProcess(config).source).toEqual(config);
  });
});
