import { describe, expect, it } from 'vitest';
import { compileConfig, ConfigError } from './config';
import type { EditorConfig } from './config';
import { Simulation } from './simulation';
import { createPushScheduler } from './sources';
import { line } from './test-fixtures';

function plannedLine(): EditorConfig {
  const config = line();
  config.materials.push(
    {id: 'rawB', name: 'Raw B', color: 'blue', role: 'raw', purchasePrice: '2'},
    {id: 'partB', name: 'Part B', color: 'green', role: 'intermediate'},
  );
  config.recipes.push(
    {id: 'cutB', name: 'Cut B', kind: 'production', inputs: [{materialId: 'rawB', quantity: '0.5'}], output: {materialId: 'partB', quantity: '2'}},
    {id: 'finishB', name: 'Finish B', kind: 'production', inputs: [{materialId: 'partB', quantity: '2'}], output: {materialId: 'product', quantity: '1'}},
  );
  config.stations[0]!.plan[0]!.batches = 2;
  config.stations[0]!.plan.push({id: 'planB', recipeId: 'cutB', batches: 3,
    processing: {mode: 'simultaneous', repetitions: 2, timeMs: 120_000, cv: 0.5}});
  config.stations[1]!.plan.push({id: 'finishPlanB', recipeId: 'finishB', batches: 1,
    processing: {mode: 'sequential', repetitions: 1, timeMs: 30_000, cv: 0}});
  config.sources.push({id: 'sourceB', name: 'Source B', materialId: 'rawB', availability: 'virtual', quantity: '1', intervalMs: 60_000});
  config.routes.push(
    {id: 'rawRouteB', fromId: 'sourceB', toId: 's1', materialId: 'rawB'},
    {id: 'partRouteB', fromId: 's1', toId: 's2', materialId: 'partB'},
  );
  return config;
}
function error(config: EditorConfig): ConfigError {
  try { compileConfig(config); } catch (error) {
    expect(error).toBeInstanceOf(ConfigError);
    return error as ConfigError;
  }
  throw new Error('Expected invalid plan');
}

describe('multi-row plan compilation', () => {
  it('preserves ordered rows, batch counts and independent processing profiles', () => {
    const config = plannedLine();
    const run = compileConfig(config);
    expect(run.resolved.stations[0]!.plan).toEqual([
      {id: 'plan1', recipeId: 'cut', batches: 2, mode: 'sequential', repetitions: 1, timeMs: 60_000, cv: 0},
      {id: 'planB', recipeId: 'cutB', batches: 3, mode: 'simultaneous', repetitions: 2, timeMs: 120_000, cv: 0.5},
    ]);
    expect(run.resolved.stations[0]!.inputBuffers.map(input => input.materialId)).toEqual(['raw', 'rawB']);
    expect(run.resolved.stations[1]!.inputBuffers.map(input => input.materialId)).toEqual(['part', 'partB']);
    config.stations[0]!.plan[1]!.batches = 9;
    expect(run.resolved.stations[0]!.plan[1]!.batches).toBe(3);
    expect(Object.isFrozen(run.resolved.stations[0]!.plan[1])).toBe(true);
  });

  it('includes order, batches and later processing fields in the hash', () => {
    const baseline = compileConfig(plannedLine()).calculationHash;
    for (const change of [
      (c: EditorConfig) => c.stations[0]!.plan.reverse(),
      (c: EditorConfig) => { c.stations[0]!.plan[1]!.batches++; },
      (c: EditorConfig) => { c.stations[0]!.plan[1]!.processing.timeMs++; },
      (c: EditorConfig) => { c.stations[0]!.plan[1]!.processing.cv = 1; },
    ]) {
      const config = plannedLine(); change(config);
      expect(compileConfig(config).calculationHash).not.toBe(baseline);
    }
    const reordered = plannedLine();
    reordered.materials.reverse(); reordered.recipes.reverse(); reordered.routes.reverse(); reordered.stations.reverse();
    expect(compileConfig(reordered).calculationHash).toBe(baseline);
  });

  it('supports repeated recipes with unique row IDs and deduplicates input capacities', () => {
    const config = line();
    config.stations[0]!.plan.push({...structuredClone(config.stations[0]!.plan[0]!), id: 'anotherCut'});
    const run = compileConfig(config);
    expect(run.resolved.stations[0]!.plan).toHaveLength(2);
    expect(run.resolved.stations[0]!.inputBuffers).toHaveLength(1);
  });

  it('requires capacities for the union of input materials and checks every full batch', () => {
    const config = plannedLine();
    config.stations[0]!.inputBuffer = {kind: 'materials', materials: [
      {materialId: 'raw', capacity: {kind: 'quantity', quantity: '0.3'}},
      {materialId: 'rawB', capacity: {kind: 'quantity', quantity: '1'}},
    ]};
    config.initialStocks = [];
    expect(compileConfig(config).resolved.stations[0]!.inputBuffers).toHaveLength(2);
    config.stations[0]!.plan[1]!.processing.repetitions = 3;
    expect(error(config).code).toBe('capacity');
    config.stations[0]!.plan[1]!.processing.repetitions = 2;
    config.stations[0]!.inputBuffer.materials.pop();
    expect(error(config).code).toBe('capacity');
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid later batch count %s', batches => {
    const config = plannedLine(); config.stations[0]!.plan[1]!.batches = batches;
    expect(error(config)).toMatchObject({code: 'value', path: 'config.stations.0.plan.1.batches'});
  });

  it('rejects empty plans, missing later recipes and invalid later profiles', () => {
    const config = plannedLine(); config.stations[0]!.plan = [];
    expect(error(config).code).toBe('value');
    const missing = plannedLine(); missing.stations[0]!.plan[1]!.recipeId = 'missing';
    expect(error(missing).code).toBe('reference');
    const overflow = plannedLine(); overflow.stations[0]!.plan[1]!.processing.repetitions = Number.MAX_SAFE_INTEGER;
    expect(error(overflow).messages.en).toContain('range');
    const cv = plannedLine(); cv.stations[0]!.plan[1]!.processing.cv = NaN;
    expect(error(cv).path).toBe('config.stations.0.plan.1.processing.cv');
  });

  it('checks the transport threshold against every row, without multiplying by batches', () => {
    const config = plannedLine(); config.stations[0]!.transportThreshold = '5';
    expect(error(config).path).toBe('config.stations.0.transportThreshold');
    config.stations[0]!.transportThreshold = '4';
    expect(compileConfig(config).resolved.stations[0]!.transportThreshold).toBe(4_000_000);
  });

  it('requires routes for later inputs and outputs', () => {
    const config = plannedLine(); config.routes = config.routes.filter(route => route.id !== 'partRouteB');
    expect(error(config).code).toBe('topology');
    const missingInput = plannedLine(); missingInput.routes = missingInput.routes.filter(route => route.id !== 'rawRouteB');
    missingInput.sources = missingInput.sources.filter(source => source.id !== 'sourceB');
    expect(error(missingInput).messages.en).toContain('required input rawB');
  });

  it('allows different output materials to go to market and a station', () => {
    const config = plannedLine();
    config.recipes.find(recipe => recipe.id === 'cutB')!.output.materialId = 'product';
    config.recipes = config.recipes.filter(recipe => recipe.id !== 'finishB');
    config.materials = config.materials.filter(material => material.id !== 'partB');
    config.stations[1]!.plan.pop();
    const route = config.routes.find(route => route.id === 'partRouteB')!;
    route.materialId = 'product'; route.toId = 'market';
    expect(compileConfig(config).resolved.routes.find(route => route.id === 'partRouteB')!.toId).toBe('market');
  });

  it('accepts later-material initial stocks and applies separate material limits', () => {
    const config = plannedLine();
    config.stations[0]!.outputBuffer = {kind: 'quantity', quantity: '2'};
    config.initialStocks.push(
      {id: 'inputB', ownerId: 's1', location: 'input', materialId: 'rawB', quantity: '2', cost: '4'},
      {id: 'outputA', ownerId: 's1', location: 'output', materialId: 'part', quantity: '2', cost: '1'},
      {id: 'outputB', ownerId: 's1', location: 'output', materialId: 'partB', quantity: '2', cost: '1'},
    );
    expect(compileConfig(config).resolved.initialStocks).toHaveLength(4);
    config.initialStocks.find(stock => stock.id === 'outputB')!.quantity = '2.000001';
    expect(error(config).code).toBe('capacity');
  });

  it('explicitly blocks cycle execution until the execution task is complete', () => {
    const run = compileConfig(plannedLine());
    expect(() => new Simulation(run)).toThrow(ConfigError);
    expect(() => createPushScheduler(run)).toThrow(/cycle execution/);
    const single = line(); single.stations[0]!.plan[0]!.batches = 2;
    expect(() => new Simulation(compileConfig(single))).toThrow(/cycle execution/);
    expect(() => new Simulation(compileConfig(line()))).not.toThrow();
  });
});
