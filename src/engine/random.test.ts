import { describe, expect, it } from 'vitest';
import { processingDuration, uniform, RandomError } from './random';
import { compileConfig } from './config';
import { Simulation } from './simulation';
import { previewConfig } from '../ui/preview';
import { Runner } from '../runner/runner';
import type { RunnerHost } from '../runner/runner';

it('pins portable rounded durations including seed zero and CV extremes', () => {
  const values = [0, 1, 2, 1000, 65536, Number.MAX_SAFE_INTEGER - 1].map(ordinal => processingDuration(300_000, 0.5, 0, 'prep', 'recipe-prep', ordinal));
  expect(values).toEqual([199827,246912,217287,363400,166050,420192]);
  expect([0,1,2,1000,65536,Number.MAX_SAFE_INTEGER-1].map(ordinal => processingDuration(300_000,2,0,'prep','recipe-prep',ordinal))).toEqual([60792,107305,76129,302958,36972,447450]);
});

describe('versioned variability', () => {
  it('keeps CV zero exactly constant and produces positive rounded milliseconds', () => {
    expect(processingDuration(12345, 0, 42, 'a', 'b', 0)).toBe(12345);
    for (let i = 0; i < 2000; i++) {
      const duration = processingDuration(1, 2, 42, 'a', 'b', i);
      expect(Number.isSafeInteger(duration)).toBe(true); expect(duration).toBeGreaterThanOrEqual(1);
      const value = uniform(0, 'a', 'b', i, 'processing', 0); expect(value).toBeGreaterThan(0); expect(value).toBeLessThan(1);
    }
  });
  it('retains tiny positive CV at large mean durations', () => {
    const values = Array.from({length:20},(_,i)=>processingDuration(1_000_000_000_000_000,1e-10,0,'a','b',i));
    expect(new Set(values).size).toBeGreaterThan(1);
    expect(values.every(value=>Math.abs(value-1_000_000_000_000_000)<1_000_000)).toBe(true);
  });
  it('separates seed, station, recipe, ordinal, purpose and sample index', () => {
    const values = [uniform(0,'a','b',0,'processing',0), uniform(1,'a','b',0,'processing',0), uniform(0,'c','b',0,'processing',0), uniform(0,'a','c',0,'processing',0), uniform(0,'a','b',1,'processing',0), uniform(0,'a','b',0,'defect',0), uniform(0,'a','b',0,'processing',1)];
    expect(new Set(values).size).toBe(values.length);
    expect(uniform(0,'a','b',0,'processing',0)).toBe(values[0]);
  });
  it('matches the requested mean and CV on a fixed large sample', () => {
    const count = 20_000, mean = 100_000, cv = 0.5;
    let sum = 0, squares = 0;
    for (let i = 0; i < count; i++) {const value = processingDuration(mean, cv, 42, 'sample', 'recipe', i); sum += value; squares += value * value;}
    const average = sum / count, observedCv = Math.sqrt(squares / count - average * average) / average;
    expect(average / mean).toBeGreaterThan(0.97); expect(average / mean).toBeLessThan(1.03);
    expect(observedCv).toBeGreaterThan(0.47); expect(observedCv).toBeLessThan(0.53);
  });
  it('rejects invalid CV and excessive sampled time instead of clamping the tail', () => {
    for (const cv of [-1, 2.01, NaN, Infinity]) expect(() => processingDuration(1,cv,0,'a','b',0)).toThrow(RandomError);
    let overflow = false;
    for (let i = 0; i < 100; i++) {
      try {processingDuration(Number.MAX_SAFE_INTEGER,2,0,'a','b',i);} catch(error) {expect(error).toBeInstanceOf(RandomError); overflow = true; break;}
    }
    expect(overflow).toBe(true);
    for (const cv of [-0.1, 3, NaN]) {const config = previewConfig(); config.stations[0]!.plan[0]!.processing.cv = cv; expect(() => compileConfig(config)).toThrow();}
  });
  it('preserves the sampled duration through lunch and counts its actual processing time once', () => {
    const config = previewConfig('balanced',0.5,42); const run = compileConfig(config), simulation = new Simulation(run);
    simulation.advanceTo(240 * 60_000);
    const paused = simulation.getSnapshot().stations.find(s => s.remainingProcessingMs !== null)!;
    const duration = paused.operationDurationMs, remaining = paused.remainingProcessingMs;
    simulation.advanceTo(300 * 60_000);
    const resumed = simulation.getSnapshot().stations.find(s => s.stationId === paused.stationId)!;
    expect(resumed.operationDurationMs).toBe(duration); expect(resumed.remainingProcessingMs).toBe(remaining);
    expect(resumed.progress).toBe(paused.progress);
  });
  it('matches full, irregular and stepped execution independently of source array order', () => {
    const config = previewConfig('assembly',0.5,0), run = compileConfig(config), a = new Simulation(run), b = new Simulation(run);
    while (a.step() !== null) {}
    for(const t of [1, 123456, 2_999_999, 18_000_000, config.durationMs]) b.advanceTo(t);
    expect(b.getSnapshot()).toEqual(a.getSnapshot());
    config.stations.reverse(); config.routes.reverse(); config.sources.reverse();
    expect(new Simulation(compileConfig(config)).runToEnd()).toEqual(a.getSnapshot());
  });
  // Repeated full executions can exceed the default five seconds on a shared CI runner.
  it('keeps all playback modes and repeat equal to the engine for a variable line', () => {
    const run = compileConfig(previewConfig('balanced',0.5,42)), expected = new Simulation(run).runToEnd();
    for (const speed of [1,60,300,1800,'max'] as const) {
      let now = 0; let callback: (() => void) | null = null;
      const host: RunnerHost = {now:()=>now, request: fn=>{callback=fn;return fn;}, cancel:()=>{callback=null;}};
      const runner = new Runner(run,undefined,host); runner.setSpeed(speed); runner.start();
      for (let i=0;callback;i++) {if(i>2000)throw new Error('No progress');now+=60_000;const next:()=>void=callback;callback=null;next();}
      expect(runner.getView().model).toEqual(expected); runner.repeat(); runner.setSpeed('max');
      for(let i=0;callback;i++){if(i>2000)throw new Error('No progress');const next:()=>void=callback;callback=null;next();}
      expect(runner.getView().model).toEqual(expected);runner.dispose();
    }
  }, 15_000);
});
