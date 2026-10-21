import { describe, expect, it } from 'vitest';
import { compileConfig, ConfigError } from './config';
import { setupDurationMs } from './setup';
import { Simulation } from './simulation';
import { createPushScheduler, createPushState } from './sources';
import { cyclicLine, line } from './test-fixtures';
import { exampleRuns } from '../ui/preview';
const M = 60_000;
function configError(config: unknown): ConfigError {
  try { compileConfig(config); } catch (error) {
    expect(error).toBeInstanceOf(ConfigError);
    return error as ConfigError;
  }
  throw new Error('Expected a configuration error');
}

describe('setup configuration and recipe transitions', () => {
  it('defaults to the first planned recipe and keeps the unmodified editor source separate', () => {
    const config = cyclicLine(), original = structuredClone(config), run = compileConfig(config);
    expect(run.resolved.stations[0]).toMatchObject({setupMs: 0, initialRecipeId: 'recipeA'});
    expect(run.source.stations[0]!.initialRecipeId).toBeUndefined();
    expect(config).toEqual(original);
    expect(Object.isFrozen(run.resolved.stations[0])).toBe(true);
    const reordered = cyclicLine(); reordered.stations[0]!.plan.reverse();
    expect(compileConfig(reordered).resolved.stations[0]!.initialRecipeId).toBe('recipeB');
  });

  it('normalizes an explicit first recipe to the same calculation identity as omission', () => {
    const omitted = cyclicLine(), explicit = cyclicLine();
    explicit.stations[0]!.initialRecipeId = 'recipeA';
    expect(compileConfig(explicit).resolved).toEqual(compileConfig(omitted).resolved);
    expect(compileConfig(explicit).calculationHash).toBe(compileConfig(omitted).calculationHash);
  });

  it('prepares the V14 transition durations from the ordered A,A,B plan, including cycle wrap', () => {
    const config = cyclicLine(); config.stations[0]!.setupMs = 7 * M;
    const station = compileConfig(config).resolved.stations[0]!;
    const expanded = station.plan.flatMap(row => Array.from({length: row.batches}, () => row.recipeId));
    const starts = [station.initialRecipeId, ...expanded];
    const destinations = [...expanded, expanded[0]!];
    expect(destinations.map((recipeId, index) => setupDurationMs(station.setupMs, starts[index]!, recipeId))).toEqual([0, 0, 7 * M, 7 * M]);
    // Only the rule is checked here; timed setup execution belongs to task 55.
  });

  it('uses recipe identity rather than row IDs, batch sizes or processing profiles', () => {
    const config = cyclicLine(), station = config.stations[0]!;
    station.plan.push({...structuredClone(station.plan[0]!), id: 'anotherA', batches: 3,
      processing: {mode: 'simultaneous', repetitions: 5, timeMs: 2 * M, cv: 0.5}});
    station.setupMs = 7 * M;
    const run = compileConfig(config), rows = run.resolved.stations[0]!.plan;
    expect(setupDurationMs(station.setupMs, rows[0]!.recipeId, rows[2]!.recipeId)).toBe(0);
    expect(setupDurationMs(station.setupMs, rows[1]!.recipeId, rows[2]!.recipeId)).toBe(7 * M);
  });

  it('resolves another initial recipe without treating it as another production plan row', () => {
    const config = line(); config.stations[0]!.initialRecipeId = 'finish'; config.stations[0]!.setupMs = 7 * M;
    const run = compileConfig(config), station = run.resolved.stations[0]!;
    expect(station.initialRecipeId).toBe('finish');
    expect(station.plan).toHaveLength(1);
    expect(station.inputBuffers.map(input => input.materialId)).toEqual(['raw']);
    expect(setupDurationMs(station.setupMs, station.initialRecipeId, station.plan[0]!.recipeId)).toBe(7 * M);
    expect(run.source.stations[0]!.initialRecipeId).toBe('finish');
    config.stations[0]!.initialRecipeId = 'cut';
    expect(run.resolved.stations[0]!.initialRecipeId).toBe('finish');
  });

  it.each([1, 7 * M, Number.MAX_SAFE_INTEGER])('accepts exact setup duration %s ms without a hidden cap', setupMs => {
    const config = cyclicLine(); config.stations[0]!.setupMs = setupMs;
    const run = compileConfig(config);
    expect(run.resolved.stations[0]!.setupMs).toBe(setupMs);
    expect(setupDurationMs(setupMs, 'recipeA', 'recipeB')).toBe(setupMs);
  });

  it.each([-1, 0.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, '420000', null, undefined])('rejects invalid setup duration %s', setupMs => {
    const config = cyclicLine(); Object.assign(config.stations[0]!, {setupMs});
    const error = configError(config);
    expect(error).toMatchObject({code: 'value', path: 'config.stations.0.setupMs', objectId: 's1'});
    expect(error.messages.ru).toBeTruthy(); expect(error.messages.en).toBeTruthy();
  });

  it.each(['missing', 'raw', 's1', 'market'])('rejects the nonexistent initial recipe reference %s', initialRecipeId => {
    const config = cyclicLine(); config.stations[0]!.initialRecipeId = initialRecipeId;
    expect(configError(config)).toMatchObject({code: 'reference', path: 'config.stations.0.initialRecipeId', objectId: 's1'});
  });

  it.each(['', ' ', null, 42])('rejects malformed initial recipe %s', initialRecipeId => {
    const config = cyclicLine(); Object.assign(config.stations[0]!, {initialRecipeId});
    expect(configError(config)).toMatchObject({code: 'value', path: 'config.stations.0.initialRecipeId'});
  });

  it('includes setup duration and initial identity in the hash while ignoring entity order', () => {
    const base = cyclicLine(), duration = cyclicLine(), initial = cyclicLine();
    duration.stations[0]!.setupMs = 7 * M;
    initial.stations[0]!.initialRecipeId = 'recipeB';
    expect(compileConfig(duration).calculationHash).not.toBe(compileConfig(base).calculationHash);
    expect(compileConfig(initial).calculationHash).not.toBe(compileConfig(base).calculationHash);
    const reordered = structuredClone(duration); reordered.recipes.reverse(); reordered.routes.reverse();
    expect(compileConfig(reordered).calculationHash).toBe(compileConfig(duration).calculationHash);
  });

  it('blocks nonzero setup before creating inventory, events or sources, with the original source path', () => {
    const config = line(); config.stations.reverse();
    config.stations[0]!.setupMs = 7 * M;
    const run = compileConfig(config);
    for (const create of [createPushState, createPushScheduler, (run: ReturnType<typeof compileConfig>) => new Simulation(run)]) {
      try { create(run); throw new Error('Expected setup guard'); } catch (error) {
        expect(error).toBeInstanceOf(ConfigError);
        expect(error).toMatchObject({code: 'unsupported', path: 'config.stations.0.setupMs', objectId: 's2'});
        const failure = error as ConfigError;
        expect(failure.messages.ru).toContain('не поддерживается');
        expect(failure.messages.en).toContain('not supported');
      }
    }
    expect(run.source).toEqual(config);
  });

  it('also blocks nonzero configured setup on an otherwise unchanged single-row station', () => {
    const config = line(); config.stations[0]!.setupMs = 1;
    expect(() => new Simulation(compileConfig(config))).toThrow(ConfigError);
  });

  it('keeps zero-duration runs unchanged even with another initial recipe', () => {
    const config = cyclicLine(); config.stations[0]!.initialRecipeId = 'recipeB';
    const changed = new Simulation(compileConfig(config)).runToEnd();
    delete config.stations[0]!.initialRecipeId;
    const original = new Simulation(compileConfig(config)).runToEnd();
    expect(changed.stocks).toEqual(original.stocks);
    expect(changed.stations).toEqual(original.stations);
    expect(changed.line).toEqual(original.line);
    expect(changed.sources).toEqual(original.sources);
    expect(changed.timeMs).toBe(original.timeMs);
    expect(setupDurationMs(0, 'recipeB', 'recipeA')).toBe(0);
  });

  it('retains compatibility of all six existing examples', () => {
    for (const run of Object.values(exampleRuns)) {
      expect(run.resolved.stations.every(station => station.setupMs === 0 && station.initialRecipeId === station.plan[0]!.recipeId)).toBe(true);
      expect(new Simulation(run).runToEnd().line!.termination).toBe('horizon');
    }
  });
});
