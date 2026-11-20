import {ConfigError} from '@toc/engine';
import type {EditorConfig, InputBufferConfig} from '@toc/engine';
import {calendarForDuration, DAY_MS} from '@toc/engine';
import {parseQuantity} from '@toc/engine';
import {compileEditableProcess, createProcessStation} from './linear-process';
import {layoutNodes} from './process-layout';

export interface BufferDraft {kind: 'inherit' | 'quantity' | 'shift' | 'infinite'; value: string}
type Source = EditorConfig['sources'][number];
export type SourceDraft = Omit<Source, 'intervalMs'> & {intervalSeconds: string};
export interface ProcessDraft {
  name: string; seed: string; shifts: string; input: BufferDraft; output: BufferDraft;
  materials: EditorConfig['materials'];
  sources: SourceDraft[];
  initialStocks: EditorConfig['initialStocks'];
  routes: EditorConfig['routes'];
  stations: {id: string; name: string; minutes: string; cv: string; input: BufferDraft; output: BufferDraft;
    recipeId: string; recipeName: string; inputs: EditorConfig['recipes'][number]['inputs']; outputMaterialId: string; outputQuantity: string}[];
}
function bufferDraft(rule: InputBufferConfig): BufferDraft {
  if (rule.kind === 'materials') throw new Error('Linear buffers do not use material lists');
  return {kind: rule.kind, value: rule.kind === 'quantity' ? rule.quantity : rule.kind === 'shift' ? rule.shifts : ''};
}
export function processDraft(config: EditorConfig): ProcessDraft {
  compileEditableProcess(config);
  // Use graph order, including for files with a different station array order.
  const stations: ProcessDraft['stations'] = [];
  for (const {id} of layoutNodes(config, {positions: []})) {
    if (!config.stations.some(item => item.id === id)) continue;
    const station = config.stations.find(item => item.id === id)!, processing = station.plan[0]!.processing;
    const recipe = config.recipes.find(item => item.id === station.plan[0]!.recipeId)!;
    stations.push({recipeId: recipe.id, recipeName: recipe.name, inputs: structuredClone(recipe.inputs),
      outputMaterialId: recipe.output.materialId, outputQuantity: recipe.output.quantity,
      id, name: station.name, minutes: String(processing.timeMs! / 60_000), cv: String(processing.cv!),
      input: bufferDraft(station.inputBuffer), output: bufferDraft(station.outputBuffer)});
  }
  return {routes: structuredClone(config.routes), materials: structuredClone(config.materials),
    sources: config.sources.map(({intervalMs, ...source}) => ({...source, intervalSeconds: String(intervalMs / 1000)})),
    initialStocks: structuredClone(config.initialStocks), name: config.name, seed: String(config.seed),
    shifts: String(calendarForDuration(config.calendar, config.durationMs).days),
    input: bufferDraft(config.bufferDefaults?.input ?? {kind: 'shift', shifts: '0.5'}),
    output: bufferDraft(config.bufferDefaults?.output ?? {kind: 'quantity', quantity: '0'}), stations};
}
function invalid(path: string, id: string | null, ru: string, en: string): never {
  throw new ConfigError('value', path, id, {ru, en});
}
function decimal(value: string, path: string, id: string | null): number {
  const text = value.trim().replace(',', '.');
  if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(text) || !Number.isFinite(Number(text))) {
    invalid(path, id, 'Введите неотрицательное число.', 'Enter a nonnegative number.');
  }
  return Number(text);
}
function integer(value: string, path: string): number {
  if (!/^\d+$/.test(value.trim()) || !Number.isSafeInteger(Number(value))) {
    invalid(path, null, 'Введите целое неотрицательное число.', 'Enter a nonnegative whole number.');
  }
  return Number(value);
}
function quantity(value: string): string {
  return value.trim().replace(',', '.').replace(/^\./, '0.');
}

function milliseconds(value: string, factor: number, path: string, id: string): number {
  decimal(value, path, id);
  const [whole, fraction = ''] = value.trim().replace(',', '.').split('.');
  const scale = 10n ** BigInt(fraction.length);
  const time = BigInt((whole || '0') + fraction) * BigInt(factor);
  if (time % scale !== 0n || time / scale > BigInt(Number.MAX_SAFE_INTEGER)) {
    invalid(path, id, 'Время должно задаваться с точностью до миллисекунды.', 'Time must be a whole number of milliseconds.');
  }
  return Number(time / scale);
}

export function addDraftStation(draft: ProcessDraft, id: string, name: string, outputName: string): ProcessDraft {
  const outputMaterialId = `output-${id}`;
  return {...draft, materials: [...draft.materials, {id: outputMaterialId, name: outputName, role: 'finished', color: '#247e70'}],
    stations: [...draft.stations, {id, name, minutes: '3', cv: '0', input: {kind: 'inherit', value: ''},
      output: {kind: 'inherit', value: ''}, recipeId: `recipe-${id}`, recipeName: name,
      inputs: [{materialId: draft.materials.find(material => material.role === 'raw')?.id ?? '', quantity: '1'}],
      outputMaterialId, outputQuantity: '1'}]};
}

/** Deleting a node removes its own routes and stock. Other recipe fields stay in the draft. */
export function removeDraftNode(draft: ProcessDraft, id: string): ProcessDraft {
  return {...draft, stations: draft.stations.filter(station => station.id !== id), sources: draft.sources.filter(source => source.id !== id),
    routes: draft.routes.filter(route => route.fromId !== id && route.toId !== id),
    initialStocks: draft.initialStocks.filter(stock => stock.ownerId !== id)};
}

function buffer(rule: BufferDraft, path: string, id: string | null): InputBufferConfig {
  if (rule.kind === 'inherit' || rule.kind === 'infinite') return {kind: rule.kind};
  const value = quantity(rule.value);
  try {parseQuantity(value);} catch {invalid(path, id, 'Введите допустимое количество.', 'Enter a valid quantity.');}
  return rule.kind === 'shift' ? {kind: 'shift', shifts: value} : {kind: 'quantity', quantity: value};
}
/** Incomplete fields stay in the draft. Only a fully validated copy leaves the form. */
export function configFromDraft(base: EditorConfig, draft: ProcessDraft): EditorConfig {
  const config = structuredClone(base);
  config.name = draft.name;
  config.seed = integer(draft.seed, 'config.seed');
  const shifts = integer(draft.shifts, 'config.durationMs');
  config.durationMs = (shifts - 1) * DAY_MS + config.calendar.shiftEndMs - config.calendar.shiftStartMs;
  const previous = processDraft(base);
  if (JSON.stringify(draft.input) !== JSON.stringify(previous.input)) {
    config.bufferDefaults = {...config.bufferDefaults,
      input: buffer(draft.input, 'config.bufferDefaults.input', null) as NonNullable<NonNullable<EditorConfig['bufferDefaults']>['input']>};
  }
  if (JSON.stringify(draft.output) !== JSON.stringify(previous.output)) {
    config.bufferDefaults = {...config.bufferDefaults,
      output: buffer(draft.output, 'config.bufferDefaults.output', null) as NonNullable<NonNullable<EditorConfig['bufferDefaults']>['output']>};
  }
  config.materials = draft.materials.map(material => ({
    ...material,
    ...(material.role === 'raw' && material.purchasePrice === undefined ? {purchasePrice: '0'} : {}),
    ...(material.role === 'finished' && material.salePrice === undefined ? {salePrice: '0'} : {}),
  }));
  config.sources = draft.sources.map(({intervalSeconds, ...source}, i) => {
    const original = config.sources.find(item => item.id === source.id);
    const intervalMs = original && String(original.intervalMs / 1000) === intervalSeconds
      ? original.intervalMs : milliseconds(intervalSeconds, 1000, `config.sources.${i}.intervalMs`, source.id);
    return {...source, quantity: quantity(source.quantity), intervalMs};
  });
  config.initialStocks = draft.initialStocks.map(stock => ({...stock, quantity: quantity(stock.quantity), cost: quantity(stock.cost)}));
  const fieldsById = new Map(draft.stations.map(fields => [fields.id, fields]));
  const stationIds = [...config.stations.map(item => item.id).filter(id => fieldsById.has(id)),
    ...draft.stations.map(item => item.id).filter(id => !config.stations.some(item => item.id === id))];
  const recipes = new Map(config.recipes.map(recipe => [recipe.id, recipe]));
  config.stations = stationIds.map((id, i) => {
    const fields = fieldsById.get(id)!;
    const station = config.stations.find(item => item.id === id) ?? createProcessStation(id, fields.name);
    const priorFields = previous.stations.find(item => item.id === station.id);
    const path = `config.stations.${i}`;
    station.name = fields.name;
    station.plan[0]!.recipeId = fields.recipeId;
    recipes.set(fields.recipeId, {id: fields.recipeId, kind: 'production', name: fields.recipeName,
      inputs: fields.inputs.map(input => ({...input, quantity: quantity(input.quantity)})),
      output: {materialId: fields.outputMaterialId, quantity: quantity(fields.outputQuantity)}});
    if (fields.minutes !== priorFields?.minutes) {
      station.plan[0]!.processing.timeMs = milliseconds(fields.minutes, 60_000, `${path}.plan.0.processing.timeMs`, station.id);
    }
    if (fields.cv !== priorFields?.cv) {
      station.plan[0]!.processing.cv = decimal(fields.cv, `${path}.plan.0.processing.cv`, station.id);
    }
    station.inputBuffer = buffer(fields.input, `${path}.inputBuffer`, station.id);
    station.outputBuffer = buffer(fields.output, `${path}.outputBuffer`, station.id) as typeof station.outputBuffer;
    return station;
  });
  const usedRecipes = new Set(draft.stations.map(item => item.recipeId));
  config.recipes = [...recipes.values()].filter(recipe => usedRecipes.has(recipe.id));
  config.routes = structuredClone(draft.routes);
  if (config.displayOrder) {
    const ids = new Set([config.id, 'market', 'warehouse', ...config.stations.flatMap(station => [station.id, ...station.plan.map(row => row.id)]),
      ...[config.materials, config.recipes, config.sources, config.initialStocks, config.routes].flatMap(items => items.map(item => item.id))]);
    config.displayOrder = config.displayOrder.filter(id => ids.has(id));
  }
  compileEditableProcess(config);
  return config;
}
