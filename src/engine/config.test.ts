import { describe, expect, it } from 'vitest';
import { compileConfig, ConfigError } from './config';
import type { EditorConfig } from './config';
import { createSnapshot } from './state';
import type { EngineState } from './state';
import { line } from './test-fixtures';


function set(config: EditorConfig, path: string, value: unknown) {
  const keys = path.split('.');
  let target = config as unknown as Record<string, unknown>;
  for (const key of keys.slice(0, -1)) target = target[key] as Record<string, unknown>;
  target[keys.at(-1)!] = value;
}

function failure(config: unknown): ConfigError {
  try { compileConfig(config); } catch (error) {
    expect(error).toBeInstanceOf(ConfigError);
    return error as ConfigError;
  }
  throw new Error('Expected a validation error');
}

describe('immutable normalized RunConfig', () => {
  it('resolves exact quantities, costs, multi-unit outputs and explicit small buffers', () => {
    const run = compileConfig(line());
    expect(run.resolved.recipes.find(r => r.id === 'cut')).toMatchObject({input: {quantity: 300_000}, output: {quantity: 10_000_000}});
    expect(run.resolved.stations[0]).toMatchObject({inputBuffer: {quantity: 2_000_000}, outputBuffer: {quantity: 0}, costs: {capital: 100_000_000n}});
    expect(run.resolved.stations[1]!.inputBuffer).toEqual({kind: 'quantity', quantity: 6_000_000});
    expect(run.source.stations[0]!.inputBuffer).toEqual({kind: 'quantity', quantity: '2'});
    expect(run.engineVersion).toBe('0.2.0');
    expect(run.rngVersion).toBe('none-1');
    expect(run.schemaVersion).toBe(1);
  });

  it('detaches source and resolved data and freezes nested arrays and objects', () => {
    const config = line();
    const run = compileConfig(config);
    config.stations[0]!.plan[0]!.processing.timeMs = 1;
    config.materials[0]!.purchasePrice = '0';
    expect(run.source.stations[0]!.plan[0]!.processing.timeMs).toBe(60_000);
    expect(run.resolved.stations[0]!.timeMs).toBe(60_000);
    expect(() => { (run.resolved as unknown as {seed: number}).seed = 1; }).toThrow(TypeError);
    expect(() => { (run.source as EditorConfig).stations.pop(); }).toThrow(TypeError);
    expect(Object.isFrozen(run.resolved.stations[0]!.costs)).toBe(true);
  });

  it('ignores titles, translation, colors, display order and entity array order', () => {
    const baseline = compileConfig(line());
    const edited = line();
    edited.name = 'New name'; edited.language = 'en';
    edited.displayOrder = ['s2', 's1', 'source'];
    for (const material of edited.materials) { material.name = 'English'; material.color = 'red'; }
    for (const station of edited.stations) station.name = 'Station';
    edited.recipes[0]!.name = 'Cut'; edited.sources[0]!.name = 'Source';
    edited.materials.reverse(); edited.stations.reverse(); edited.recipes.reverse(); edited.routes.reverse();
    expect(compileConfig(edited).calculationHash).toBe(baseline.calculationHash);
    expect(compileConfig(JSON.parse(JSON.stringify(line()))).calculationHash).toBe(baseline.calculationHash);
  });

  it('normalizes equivalent decimal spelling and property insertion order', () => {
    const config = line();
    config.recipes[0]!.inputs[0]!.quantity = '000.300000';
    config.materials[0]!.purchasePrice = '10.000000';
    const reversedKeys = Object.fromEntries(Object.entries(config).reverse());
    expect(compileConfig(reversedKeys).calculationHash).toBe(compileConfig(line()).calculationHash);
  });

  it.each([
    ['seed', 43], ['durationMs', 86_400_001], ['calendar.lunchEndMs', 46_800_001],
    ['stations.0.priority', 1], ['stations.0.plan.0.processing.timeMs', 60_001],
    ['stations.0.plan.0.id', 'newPlan'], ['stations.0.inputBuffer.quantity', '2.000001'],
    ['stations.0.outputBuffer.quantity', '0.000001'], ['stations.0.costs.perShift', '6'],
    ['stations.0.costs.capital', '101'], ['sources.0.intervalMs', 60_001],
    ['sources.0.quantity', '0.5'], ['materials.0.purchasePrice', '11'],
    ['materials.2.salePrice', '31'], ['recipes.0.output.quantity', '11'],
    ['recipes.0.inputs.0.quantity', '0.4'], ['routes.0.id', 'newRoute'],
    ['initialStocks.0.quantity', '0.6'], ['initialStocks.0.cost', '6'],
  ])('includes calculation field %s in the hash', (path, value) => {
    const config = line(); set(config, path as string, value);
    expect(compileConfig(config).calculationHash).not.toBe(compileConfig(line()).calculationHash);
  });

  it('supports explicit infinite buffers and finite warehouse supply', () => {
    const config = line();
    config.stations[0]!.inputBuffer = {kind: 'infinite'};
    config.sources[0]!.availability = 'warehouse';
    config.initialStocks.push({id: 'warehouseStock', ownerId: 'warehouse', location: 'warehouse', materialId: 'raw', quantity: '5', cost: '50'});
    const run = compileConfig(config);
    expect(run.resolved.stations[0]!.inputBuffer).toEqual({kind: 'infinite'});
    expect(run.resolved.initialStocks.find(s => s.id === 'warehouseStock')!.quantity).toBe(5_000_000);
  });

  it('supports a single station and preserves explicit stock IDs across normalization', () => {
    const config = line();
    config.materials = config.materials.filter(m => m.id !== 'part');
    config.recipes = [config.recipes[0]!];
    config.recipes[0]!.output.materialId = 'product';
    config.stations = [config.stations[0]!];
    config.routes = [config.routes[0]!, {id: 'r2', fromId: 's1', toId: 'market', materialId: 'product'}];
    const run = compileConfig(config);
    expect(run.resolved.stations).toHaveLength(1);
    expect(run.resolved.initialStocks[0]!.id).toBe('initial');
  });

  it('includes stable entity IDs in calculation identity when references are updated', () => {
    const config = line();
    config.stations[0]!.id = 'renamedStation';
    config.routes[0]!.toId = 'renamedStation'; config.routes[1]!.fromId = 'renamedStation';
    config.initialStocks[0]!.ownerId = 'renamedStation';
    expect(compileConfig(config).calculationHash).not.toBe(compileConfig(line()).calculationHash);
  });
});

describe('invalid and unsupported configurations', () => {
  it.each([
    ['schemaVersion', 2], ['policy', 'dbr'], ['globalBuffers', {input: '0.5'}],
    ['stations.0.inputBuffer', {kind: 'inherit'}], ['stations.0.inputBuffer', {kind: 'shift', quantity: '0.5'}],
    ['stations.0.plan.0.processing.cv', 0.1], ['stations.0.plan.0.processing.mode', 'simultaneous'],
    ['stations.0.plan.0.processing.repetitions', 2], ['stations.0.plan.0.batches', 2],
    ['stations.0.setupMs', 1], ['stations.0.maintenance.enabled', true],
    ['stations.0.lunchReplacement', true], ['recipes.0.kind', 'inspection'],
    ['stations.0.transportThreshold', 10],
  ])('rejects unsupported feature %s', (path, value) => {
    const config = line(); set(config, path as string, value);
    expect(failure(config).code).toBe('unsupported');
  });

  it.each([
    ['recipes.0.inputs.0.materialId', 'missing'], ['stations.0.plan.0.recipeId', 'missing'],
    ['sources.0.materialId', 'missing'], ['routes.0.fromId', 'missing'], ['routes.0.toId', 'missing'],
    ['routes.0.materialId', 'product'], ['initialStocks.0.ownerId', 'missing'],
    ['initialStocks.0.materialId', 'product'], ['displayOrder', ['missing']],
  ])('rejects broken reference %s', (path, value) => {
    const config = line(); set(config, path as string, value);
    expect(failure(config).code).toBe('reference');
  });

  it.each([
    ['recipes.0.inputs.0.quantity', '0'], ['recipes.0.inputs.0.quantity', '0.0000001'],
    ['recipes.0.output.quantity', '0'], ['recipes.0.output.quantity', '1.5'],
    ['sources.0.quantity', '-1'], ['sources.0.intervalMs', 0],
    ['stations.0.plan.0.processing.timeMs', 0], ['durationMs', Number.MAX_SAFE_INTEGER + 1],
    ['seed', -1], ['seed', 0x100000000], ['seed', 1.5],
    ['materials.0.purchasePrice', undefined], ['materials.2.salePrice', undefined],
    ['stations.0.costs.capital', '-1'], ['initialStocks.0.cost', undefined],
    ['calendar.lunchEndMs', 61_200_000], ['calendar.shiftEndMs', 86_400_001],
  ])('rejects invalid value %s', (path, value) => {
    const config = line(); set(config, path as string, value);
    expect(failure(config).code).toBe('value');
  });

  it('reports the responsible object, field and reasons in both languages', () => {
    const config = line(); config.stations[0]!.plan[0]!.processing.timeMs = 0;
    const error = failure(config);
    expect(error.objectId).toBe('s1');
    expect(error.path).toBe('config.stations.0.plan.0.processing.timeMs');
    expect(error.messages.ru).toContain('целое');
    expect(error.messages.en).toContain('integer');
  });

  it('rejects repeated, reserved and invalid IDs without renumbering', () => {
    for (const duplicate of ['s2', 'market', 'warehouse', 'bad id', 'кириллица']) {
      const config = line(); config.stations[0]!.id = duplicate;
      expect(failure(config).code).toBe('id');
    }
  });

  it('rejects assembly and multi-row plans explicitly', () => {
    const assembly = line(); assembly.recipes[0]!.inputs.push({materialId: 'part', quantity: '1'});
    expect(failure(assembly).code).toBe('unsupported');
    const cyclicPlan = line(); cyclicPlan.stations[0]!.plan.push(structuredClone(cyclicPlan.stations[0]!.plan[0]!));
    expect(failure(cyclicPlan).code).toBe('unsupported');
  });

  it('rejects branching, duplicate routes and disconnected stations', () => {
    const branching = line(); branching.routes.push({id: 'extraRoute', fromId: 's1', toId: 's2', materialId: 'part'});
    expect(failure(branching).code).toBe('topology');
    const disconnected = line(); disconnected.routes.splice(1, 1);
    expect(failure(disconnected).code).toBe('topology');
    const noSource = line(); noSource.sources = [];
    expect(failure(noSource).code).toBe('reference');
  });

  it('rejects unused recipes and materials', () => {
    const config = line(); config.materials.push({id: 'unused', name: 'Лишний', color: '#000', role: 'intermediate'});
    expect(failure(config).code).toBe('topology');
    const unusedRecipe = line(); unusedRecipe.recipes.push({...structuredClone(unusedRecipe.recipes[0]!), id: 'unusedRecipe'});
    expect(failure(unusedRecipe).code).toBe('topology');
  });

  it('rejects a reachable route cycle before traversal can repeat forever', () => {
    const config = line();
    config.materials.push({id: 'part2', name: 'Второй полуфабрикат', role: 'intermediate', color: 'red'});
    config.recipes[1]!.output.materialId = 'part2';
    config.recipes.push({id: 'cycleRecipe', name: 'Цикл', kind: 'production', inputs: [{materialId: 'part2', quantity: '1'}], output: {materialId: 'part', quantity: '1'}});
    const station = structuredClone(config.stations[1]!);
    station.id = 's3'; station.plan[0]!.id = 'plan3'; station.plan[0]!.recipeId = 'cycleRecipe';
    config.stations.push(station);
    config.routes[2] = {id: 'r3', fromId: 's2', toId: 's3', materialId: 'part2'};
    config.routes.push({id: 'r4', fromId: 's3', toId: 's2', materialId: 'part'});
    const error = failure(config);
    expect(error.code).toBe('topology');
    expect(error.messages.en).toContain('cycle');
    expect(error.objectId).toBe('line');
  });

  it('checks full input kits and aggregate initial stocks, without increasing capacities', () => {
    const tooSmall = line(); tooSmall.stations[0]!.inputBuffer = {kind: 'quantity', quantity: '0.2'};
    expect(failure(tooSmall).code).toBe('capacity');
    const overfilled = line(); overfilled.initialStocks.push({...overfilled.initialStocks[0]!, id: 'extra', quantity: '1.6'});
    expect(failure(overfilled).code).toBe('capacity');
    const zeroOutput = line(); zeroOutput.initialStocks.push({id: 'outputStock', ownerId: 's1', location: 'output', materialId: 'part', quantity: '0.1', cost: '1'});
    expect(failure(zeroOutput).code).toBe('capacity');
  });

  it('rejects aggregate quantity and cost overflow even when each stock is valid', () => {
    const config = line();
    config.stations[0]!.inputBuffer = {kind: 'infinite'};
    config.initialStocks[0]!.quantity = '9007199254.740991';
    config.initialStocks.push({...config.initialStocks[0]!, id: 'extra'});
    expect(failure(config).code).toBe('capacity');
    config.initialStocks.forEach(s => {s.quantity = '1'; s.cost = '9007199254.740991';});
    expect(failure(config).messages.en).toContain('cost exceeds');
  });

  it('rejects a warehouse stock on virtual supply and malformed nested objects', () => {
    const config = line();
    config.initialStocks = [{id: 'stock', ownerId: 'warehouse', location: 'warehouse', materialId: 'raw', quantity: '1', cost: '1'}];
    expect(failure(config).code).toBe('reference');
    const malformed = line(); set(malformed, 'stations.0.plan.0.processing', null);
    expect(failure(malformed).code).toBe('shape');
    const unknown = line(); set(unknown, 'stations.0.breakdowns', true);
    expect(failure(unknown).objectId).toBe('s1');
  });

  it.each([null, [], 1, 'instructions', {}, {schemaVersion: 999}])('rejects invalid boundary data %j', value => {
    expect(() => compileConfig(value)).toThrow(ConfigError);
  });

  it('does not treat text as instructions or HTML', () => {
    const config = line(); config.name = '<script>throw new Error("do not execute")</script>';
    expect(compileConfig(config).source.name).toBe(config.name);
    expect(compileConfig(config).calculationHash).toBe(compileConfig(line()).calculationHash);
  });
});

describe('independent JSON-compatible snapshots', () => {
  it('copies mutable state and serializes costs without exposing engine references', () => {
    const run = compileConfig(line());
    const state: EngineState = {
      timeMs: 10, nextStockOrdinal: 0,
      stations: [{stationId: 's1', status: 'processing', reason: null, remainingProcessingMs: 100}],
      stocks: [{id: 'lot', ownerId: 's1', location: 'reserved', materialId: 'raw', quantity: 300_000, cost: 9_007_199_254_740_991n, provenance: {origin: {kind: 'unknown'}, defective: false, defectSourceIds: [], processingMs: {}}}],
    };
    const snapshot = createSnapshot(run, state);
    state.timeMs = 20; state.stations[0]!.remainingProcessingMs = 90; state.stocks[0]!.quantity = 0;
    expect(snapshot.timeMs).toBe(10);
    expect(snapshot.stations[0]!.remainingProcessingMs).toBe(100);
    expect(snapshot.stocks[0]!.quantity).toBe(300_000);
    expect(JSON.parse(JSON.stringify(snapshot)).stocks[0].cost).toBe('9007199254740991');
    expect(() => { (snapshot as unknown as EngineState).stocks[0]!.quantity = 1; }).toThrow(TypeError);
    expect(state.stocks[0]!.quantity).toBe(0);
    expect(snapshot.calculationHash).toBe(run.calculationHash);
  });
});
