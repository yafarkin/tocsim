import {compileConfig, ConfigError} from '@toc/engine';
import type {EditorConfig, RunConfig, StationConfig} from '@toc/engine';

const calendar = {shiftStartMs: 28_800_000, lunchStartMs: 43_200_000,
  lunchEndMs: 46_800_000, shiftEndMs: 61_200_000};

function unsupported(path: string, objectId: string | null, ru: string, en: string): never {
  throw new ConfigError('unsupported', path, objectId,
    {ru: `Линейный MVP: ${ru}`, en: `Linear MVP: ${en}`});
}

function station(id: string, name: string, timeMs = 180_000): StationConfig {
  return {id, name, priority: 0,
    plan: [{id: `plan-${id}`, recipeId: `recipe-${id}`, batches: 1,
      processing: {mode: 'sequential', repetitions: 1, timeMs, cv: 0}}],
    inputBuffer: {kind: 'inherit'}, outputBuffer: {kind: 'inherit'},
    setupMs: 0, maintenance: {enabled: false}, lunchReplacement: false,
    costs: {perShift: '0', perLunchHour: '0', capital: '0'}};
}

/** Initial conditions of lesson 4, with zero prices as specified for the editor MVP. */
export function createLinearProcess(id: string, language: 'ru' | 'en' = 'ru'): EditorConfig {
  const config: EditorConfig = {
    schemaVersion: 1, id, name: language === 'ru' ? 'Новый процесс' : 'New process', language,
    seed: 42, durationMs: 32_400_000, policy: 'push', calendar: {...calendar},
    bufferDefaults: {input: {kind: 'quantity', quantity: '1'}, output: {kind: 'quantity', quantity: '0'}},
    materials: [{id: 'raw', name: language === 'ru' ? 'Сырьё' : 'Raw material',
      color: '#357dad', role: 'raw', purchasePrice: '0'}], recipes: [], stations: [],
    sources: [{id: 'source', name: language === 'ru' ? 'Источник' : 'Source', materialId: 'raw',
      availability: 'virtual', quantity: '1', intervalMs: 180_000}], routes: [], initialStocks: [],
  };
  for (const [i, timeMs] of [180_000, 480_000, 180_000].entries()) {
    const id = `s${i + 1}`;
    const item = station(id, `${language === 'ru' ? 'Пост' : 'Station'} ${i + 1}`, timeMs);
    config.stations.push(item);
    config.materials.push({id: `output-${id}`, name: item.name, color: '#247e70', role: 'intermediate', salePrice: '0'});
    config.recipes.push({id: `recipe-${id}`, name: item.name, kind: 'production',
      inputs: [{materialId: 'raw', quantity: '1'}], output: {materialId: `output-${id}`, quantity: '1'}});
    config.routes.push({id: `route-${id}`, fromId: id, toId: 'market', materialId: `output-${id}`});
  }
  config.routes.unshift({id: 'source-route', fromId: 'source', toId: 's1', materialId: 'raw'});
  return reconnect(config);
}

/** Uses the general validator first; returns the same immutable RunConfig contract. */
export function compileLinearProcess(value: unknown): RunConfig {
  const run = compileConfig(value), config = run.source, resolved = run.resolved;
  const check = (ok: boolean, path: string, id: string | null, ru: string, en: string) => {
    if (!ok) unsupported(`config.${path}`, id, ru, en);
  };
  check(config.stations.length <= 30 && config.sources.length === 1
    && config.recipes.length === config.stations.length
    && config.materials.length === config.stations.length + 1
    && config.routes.length === config.stations.length + 1,
  'routes', null, 'нужна одна цепочка из 1–30 постов.', 'one chain of 1–30 stations is required.');
  check(resolved.initialStocks.length === 0 && resolved.warmupMs === 0,
    'initialStocks', null, 'начальные запасы и прогрев не поддерживаются.', 'initial stock and warmup are unsupported.');
  check(Object.entries(calendar).every(([key, time]) => config.calendar[key as keyof typeof calendar] === time),
    'calendar', null, 'используется календарь 08:00–17:00 с обедом 12:00–13:00.',
    'use the 08:00–17:00 calendar with lunch 12:00–13:00.');
  const source = resolved.sources[0]!;
  check(source.availability === 'virtual' && source.quantity === 1_000_000 && source.intervalMs === 180_000,
    'sources', source.id, 'источник подаёт одну единицу каждые 3 минуты.', 'the source supplies one unit every 3 minutes.');
  const visited = new Set<string>();
  let producer = source.id, material = source.materialId;
  while (true) {
    const routes = config.routes.filter(route => route.fromId === producer);
    check(routes.length === 1 && routes[0]!.materialId === material,
      'routes', producer, 'каждый узел имеет один выход к следующему.', 'each node has one route to the next node.');
    const next = routes[0]!.toId;
    if (next === 'market') break;
    const item = config.stations.find(item => item.id === next)!;
    check(!visited.has(next) && item.plan.length === 1,
      'stations', next, 'у поста один рецепт в цепочке.', 'each station has one recipe in the chain.');
    visited.add(next);
    const row = item.plan[0]!, recipe = resolved.recipes.find(recipe => recipe.id === row.recipeId)!;
    const processing = row.processing;
    check(recipe.kind === 'production' && recipe.inputs.length === 1
      && recipe.inputs[0]!.materialId === material,
    'recipes', recipe.id, 'нужен производственный рецепт с одним входным материалом.', 'a production recipe with one input material is required.');
    const numeric = resolved.stations.find(station => station.id === next)!;
    check(row.batches === 1 && processing.mode === 'sequential' && processing.repetitions === 1
      && processing.distribution === undefined && (processing.defectProbability ?? 0) === 0
      && item.setupMs === 0 && !item.maintenance.enabled && !item.lunchReplacement
      && item.priority === 0 && (item.initialRecipeId === undefined || item.initialRecipeId === row.recipeId)
      && numeric.transportThreshold === 1_000_000,
    'stations', next, 'партии, потери, приоритеты и переналадки не поддерживаются.',
    'batches, losses, priorities and setups are unsupported.');
    check(item.inputBuffer.kind !== 'materials' && item.outputBuffer.kind !== 'materials',
      'stations', next, 'буфер задаётся общим количеством.', 'buffers use a single capacity.');
    check(Object.values(numeric.costs).every(cost => cost === 0n),
      'stations', next, 'затраты должны быть нулевыми.', 'costs must be zero.');
    material = recipe.output.materialId;
    producer = next;
  }
  check(visited.size === config.stations.length, 'routes', null,
    'все посты должны входить в одну цепочку.', 'all stations must belong to one chain.');
  check(resolved.materials.every(item => (item.purchasePrice ?? 0n) === 0n && (item.salePrice ?? 0n) === 0n),
    'materials', null, 'цены должны быть нулевыми.', 'prices must be zero.');
  return run;
}

// The route graph defines order; entity array order is not a calculation rule.
function orderedCopy(config: EditorConfig): EditorConfig {
  compileLinearProcess(config);
  const copy = structuredClone(config), ordered: StationConfig[] = [];
  let id = copy.sources[0]!.id;
  while (true) {
    id = copy.routes.find(route => route.fromId === id)!.toId;
    if (id === 'market') break;
    ordered.push(copy.stations.find(station => station.id === id)!);
  }
  copy.stations = ordered;
  return copy;
}

/** Reconnect existing identities; each station retains its recipe and output material. */
function reconnect(config: EditorConfig): EditorConfig {
  let previous = config.sources[0]!.id, material = config.sources[0]!.materialId;
  for (const item of config.stations) {
    const recipe = config.recipes.find(recipe => recipe.id === item.plan[0]!.recipeId)!;
    config.routes.find(route => route.fromId === previous)!.toId = item.id;
    recipe.inputs[0]!.materialId = material;
    previous = item.id; material = recipe.output.materialId;
  }
  config.routes.find(route => route.fromId === previous)!.toId = 'market';
  for (const item of config.materials) {
    item.role = item.id === config.sources[0]!.materialId ? 'raw' : item.id === material ? 'finished' : 'intermediate';
  }
  // Keep explicit diagram order consistent with the edited chain.
  if (config.displayOrder) {
    config.displayOrder = [config.sources[0]!.id, ...config.stations.map(item => item.id), 'market'];
  }
  compileLinearProcess(config);
  return config;
}

/** The caller supplies the new station's name and processing time explicitly. */
export function appendLinearStation(config: EditorConfig, name: string, timeMs: number): EditorConfig {
  const copy = orderedCopy(config);
  const used = new Set([copy.id, 'market', 'warehouse', ...copy.materials.map(item => item.id),
    ...copy.recipes.map(item => item.id), ...copy.stations.map(item => item.id),
    ...copy.stations.flatMap(item => item.plan.map(row => row.id)),
    ...copy.sources.map(item => item.id), ...copy.routes.map(item => item.id)]);
  let index = 1;
  while ([`s${index}`, `plan-s${index}`, `recipe-s${index}`, `output-s${index}`, `route-s${index}`].some(id => used.has(id))) index++;
  const item = station(`s${index}`, name, timeMs);
  copy.stations.push(item);
  copy.materials.push({id: `output-${item.id}`, name, color: '#247e70', role: 'finished', salePrice: '0'});
  copy.recipes.push({id: `recipe-${item.id}`, name, kind: 'production',
    inputs: [{materialId: 'raw', quantity: '1'}], output: {materialId: `output-${item.id}`, quantity: '1'}});
  copy.routes.push({id: `route-${item.id}`, fromId: item.id, toId: 'market', materialId: `output-${item.id}`});
  return reconnect(copy);
}

export function removeLinearStation(config: EditorConfig, stationId: string): EditorConfig {
  const copy = orderedCopy(config), item = copy.stations.find(item => item.id === stationId);
  if (!item) unsupported('config.stations', stationId, 'пост не найден.', 'station not found.');
  const recipeId = item.plan[0]!.recipeId;
  const materialId = copy.recipes.find(recipe => recipe.id === recipeId)!.output.materialId;
  copy.stations = copy.stations.filter(item => item.id !== stationId);
  copy.recipes = copy.recipes.filter(item => item.id !== recipeId);
  copy.materials = copy.materials.filter(item => item.id !== materialId);
  copy.routes = copy.routes.filter(item => item.fromId !== stationId);
  return reconnect(copy);
}

export function moveLinearStation(config: EditorConfig, stationId: string, direction: -1 | 1): EditorConfig {
  const copy = orderedCopy(config), index = copy.stations.findIndex(item => item.id === stationId);
  if (index < 0 || index + direction < 0 || index + direction >= copy.stations.length) {
    unsupported('config.stations', stationId, 'невозможно переместить пост.', 'cannot move this station.');
  }
  const other = index + direction;
  [copy.stations[index], copy.stations[other]] = [copy.stations[other]!, copy.stations[index]!];
  return reconnect(copy);
}
