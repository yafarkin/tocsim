import {describe, expect, it} from 'vitest';
import {ArithmeticError} from './arithmetic.js';
import {compileConfig} from './config.js';
import {EventError} from './events.js';
import {financialReport} from './financial-report.js';
import {flowReport} from './flow-report.js';
import {investmentReport} from './investment-report.js';
import {RandomError} from './random.js';
import {runSimulation, runSimulationSafely, toEngineRunError} from './run.js';
import {Simulation} from './simulation.js';
import {line} from './test-fixtures.js';

describe('standalone JSON run facade', () => {
  it('returns the same model and reports as the existing direct engine API', () => {
    const input = line();
    const result = runSimulation(input);
    const run = compileConfig(input);
    const simulation = new Simulation(run);
    const snapshot = simulation.runToEnd();

    expect(result.schemaVersion).toBe(1);
    expect(result.engineVersion).toBe(run.engineVersion);
    expect(result.rngVersion).toBe(run.rngVersion);
    expect(result.calculationHash).toBe(run.calculationHash);
    expect(result.snapshot).toEqual(snapshot);
    expect(result.reports.flow).toEqual(flowReport(run, snapshot));
    expect(result.reports.littleLaw).toEqual(simulation.getFlowReport());
    expect(result.reports.financial).toEqual(financialReport(run, snapshot));
    expect(result.reports.investment).toEqual(investmentReport(run, snapshot));
    expect(result.history).toEqual(simulation.getHistory());
    expect(result.snapshot.line!.termination).toBe('horizon');
  });

  it('is deterministic and does not mutate reusable input data', () => {
    const input = line();
    const original = structuredClone(input);
    const first = runSimulation(input);
    const second = runSimulation(input);

    expect(input).toEqual(original);
    expect(second).toEqual(first);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.reports)).toBe(true);
  });

  it('matches event stepping and irregular model-time partitions', () => {
    const expected = runSimulation(line());
    const run = compileConfig(line());
    const stepped = new Simulation(run);
    while (stepped.step() !== null) { /* through the horizon */ }
    const irregular = new Simulation(run);
    for (let timeMs = 13; timeMs < run.resolved.durationMs; timeMs += 371_119) irregular.advanceTo(timeMs);
    const final = irregular.runToEnd();

    expect(stepped.getSnapshot()).toEqual(expected.snapshot);
    expect(final).toEqual(expected.snapshot);
    expect(irregular.getHistory()).toEqual(expected.history);
  });

  it('round-trips the complete result through JSON without bigint values', () => {
    const result = runSimulation(line());
    const json = JSON.stringify(result);
    const restored = JSON.parse(json) as typeof result;

    expect(restored).toEqual(result);
    expect(JSON.stringify(restored)).toBe(json);
    expect(restored.reports.financial.netProfit).toMatch(/^-?\d+$/);
    expect(restored.history.schemaVersion).toBe(1);
  });

  it('keeps presentation metadata out of the calculation', () => {
    const baseline = runSimulation(line());
    const changed = line();
    changed.language = 'en';
    changed.name = 'Presentation only';
    changed.materials.forEach(material => {material.name = `Material ${material.id}`; material.color = '#123456';});
    changed.stations.forEach(station => {station.name = `Station ${station.id}`;});

    const actual = runSimulation(changed);
    expect(actual.calculationHash).toBe(baseline.calculationHash);
    expect(actual.snapshot).toEqual(baseline.snapshot);
    expect(actual.reports).toEqual(baseline.reports);
    expect(actual.history).toEqual(baseline.history);
  });

  it('returns a structured configuration error with path, object and RU/EN messages', () => {
    const input = line();
    input.stations[0]!.inputBuffer = {kind: 'quantity', quantity: '-1'};
    const response = runSimulationSafely(input);

    expect(response.ok).toBe(false);
    if (response.ok) throw new Error('Expected a rejected run.');
    expect(response.error).toMatchObject({code: 'value', objectId: 's1'});
    expect(response.error.path).toContain('stations');
    expect(response.error.messages.ru).not.toBe(response.error.messages.en);
  });

  it('rejects malformed roots without exposing an exception or stack', () => {
    const response = runSimulationSafely(null);
    expect(response).toEqual({ok: false, error: {
      code: 'shape', path: 'config', objectId: null,
      messages: {ru: 'Ожидается объект данных.', en: 'Expected a data object.'},
    }});
    expect(JSON.stringify(response)).not.toContain('stack');
  });

  it('normalizes arithmetic, event, random and unknown failures', () => {
    expect(toEngineRunError(new ArithmeticError('range'))).toMatchObject({code: 'range', path: null, objectId: null});
    expect(toEngineRunError(new ArithmeticError('decimal')).messages.en).toBe('Invalid exact arithmetic data.');
    expect(toEngineRunError(new EventError('limit', 'station-1', {ru: 'Лимит.', en: 'Limit.'}))).toEqual({
      code: 'limit', path: null, objectId: 'station-1', messages: {ru: 'Лимит.', en: 'Limit.'},
    });
    expect(toEngineRunError(new RandomError({ru: 'Случайность.', en: 'Randomness.'}))).toEqual({
      code: 'random', path: null, objectId: null, messages: {ru: 'Случайность.', en: 'Randomness.'},
    });
    expect(toEngineRunError(new Error('secret stack'))).toEqual({
      code: 'internal', path: null, objectId: null,
      messages: {ru: 'Не удалось выполнить прогон.', en: 'Unable to complete the run.'},
    });
  });
});
