import { ArithmeticError, moneyToJSON, parseMoney, parseQuantity } from './arithmetic';
import { CalendarError, calendarForDuration } from './calendar';

export const SCHEMA_VERSION = 1;
export const ENGINE_VERSION = '0.17.0';
import { RNG_VERSION } from './random';
export { RNG_VERSION } from './random';

export type DeepReadonly<T> = T extends object
  ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;

export type BufferConfig = { kind: 'quantity'; quantity: string } | { kind: 'infinite' };
export type MaterialBufferConfig = BufferConfig | {kind: 'materials'; materials: {materialId: string; capacity: BufferConfig}[]};
export type InputBufferConfig = MaterialBufferConfig | {kind: 'inherit'};
export type OutputBufferConfig = MaterialBufferConfig | {kind: 'inherit'};
export interface MaterialConfig {
  id: string; name: string; color: string;
  role: 'raw' | 'intermediate' | 'finished';
  purchasePrice?: string; salePrice?: string;
}
export interface RecipeConfig {
  id: string; name: string; kind: 'production';
  inputs: { materialId: string; quantity: string }[];
  output: { materialId: string; quantity: string };
}
export interface StationConfig {
  id: string; name: string; priority: number;
  plan: {
    id: string; recipeId: string; batches: number;
    processing: { mode: 'sequential' | 'simultaneous'; repetitions: number; timeMs: number; cv: number };
  }[];
  inputBuffer: InputBufferConfig; outputBuffer: OutputBufferConfig;
  transportThreshold?: string;
  initialRecipeId?: string;
  setupMs: number; maintenance: { enabled: false }; lunchReplacement: false;
  costs: { perShift: string; perLunchHour: string; capital: string };
}
export interface SourceConfig {
  id: string; name: string; materialId: string;
  availability: 'virtual' | 'warehouse'; quantity: string; intervalMs: number;
}
export interface RouteConfig { id: string; fromId: string; toId: string; materialId: string }
export interface InitialStockConfig {
  id: string; ownerId: string; location: 'warehouse' | 'input' | 'output';
  materialId: string; quantity: string; cost: string;
}
export interface EditorConfig {
  schemaVersion: 1; id: string; name: string; language: 'ru' | 'en';
  displayOrder?: string[];
  bufferDefaults?: {input?: BufferConfig; output?: BufferConfig};
  seed: number; durationMs: number; policy: 'push';
  calendar: { shiftStartMs: number; lunchStartMs: number; lunchEndMs: number; shiftEndMs: number };
  materials: MaterialConfig[]; recipes: RecipeConfig[]; stations: StationConfig[];
  sources: SourceConfig[]; routes: RouteConfig[]; initialStocks: InitialStockConfig[];
}

export type ResolvedBuffer = { kind: 'quantity'; quantity: number } | { kind: 'infinite' };
export interface ResolvedPlanRow {
  id: string; recipeId: string; batches: number;
  mode: 'sequential' | 'simultaneous'; repetitions: number; timeMs: number; cv: number;
}
export interface ResolvedConfig {
  seed: number; durationMs: number; policy: 'push'; calendar: EditorConfig['calendar'];
  materials: { id: string; role: MaterialConfig['role']; purchasePrice: bigint | null; salePrice: bigint | null }[];
  recipes: { id: string; inputs: { materialId: string; quantity: number }[]; output: { materialId: string; quantity: number } }[];
  stations: {
    plan: ResolvedPlanRow[];
    setupMs: number; initialRecipeId: string;
    // Static first-row fields remain for existing configuration consumers; execution selects from plan.
    id: string; priority: number; planId: string; recipeId: string; mode: 'sequential' | 'simultaneous'; repetitions: number; timeMs: number; cv: number;
    inputBuffers: {materialId: string; capacity: ResolvedBuffer}[]; outputBuffers: {materialId: string; capacity: ResolvedBuffer}[]; transportThreshold: number;
    costs: { perShift: bigint; perLunchHour: bigint; capital: bigint };
  }[];
  sources: { id: string; materialId: string; availability: SourceConfig['availability']; quantity: number; intervalMs: number }[];
  routes: RouteConfig[];
  initialStocks: { id: string; ownerId: string; location: InitialStockConfig['location']; materialId: string; quantity: number; cost: bigint }[];
}
export function inputCapacity(station: DeepReadonly<ResolvedConfig['stations'][number]>, materialId: string): DeepReadonly<ResolvedBuffer> {
  const buffer = station.inputBuffers.find(buffer => buffer.materialId === materialId);
  if (!buffer) throw new Error(`Input capacity is not configured: ${station.id}/${materialId}`);
  return buffer.capacity;
}

export function outputCapacity(station: DeepReadonly<ResolvedConfig['stations'][number]>, materialId: string): DeepReadonly<ResolvedBuffer> {
  const buffer = station.outputBuffers.find(buffer => buffer.materialId === materialId);
  if (!buffer) throw new Error(`Output capacity is not configured: ${station.id}/${materialId}`);
  return buffer.capacity;
}

export interface RunConfig {
  readonly schemaVersion: 1;
  readonly engineVersion: string;
  readonly rngVersion: string;
  readonly calculationHash: string;
  readonly source: DeepReadonly<EditorConfig>;
  readonly resolved: DeepReadonly<ResolvedConfig>;
}

type ErrorCode = 'shape' | 'unsupported' | 'id' | 'reference' | 'value' | 'capacity' | 'topology';
export class ConfigError extends Error {
  constructor(
    public readonly code: ErrorCode,
    public readonly path: string,
    public readonly objectId: string | null,
    public readonly messages: { ru: string; en: string },
  ) { super(`${path}: ${messages.en}`); this.name = 'ConfigError'; }
}

class Reader {
  constructor(readonly path: string, readonly objectId: string | null = null) {}
  fail(code: ErrorCode, ru: string, en: string): never {
    throw new ConfigError(code, this.path, this.objectId, { ru, en });
  }
  at(key: string | number): Reader { return new Reader(`${this.path}.${key}`, this.objectId); }
  object(value: unknown, keys: string[]): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
      return this.fail('shape', 'Ожидается объект данных.', 'Expected a data object.');
    }
    const object = value as Record<string, unknown>;
    for (const key of Object.keys(object)) {
      if (!keys.includes(key)) this.at(key).fail('unsupported', 'Поле не поддерживается текущей версией.', 'Field is not supported by this version.');
    }
    return object;
  }
  array(value: unknown): unknown[] {
    if (!Array.isArray(value)) return this.fail('shape', 'Ожидается массив.', 'Expected an array.');
    return value;
  }
  text(value: unknown): string {
    if (typeof value !== 'string' || !value.trim()) return this.fail('value', 'Ожидается непустая строка.', 'Expected a nonempty string.');
    return value;
  }
  integer(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
      return this.fail('value', `Ожидается целое число от ${min} до ${max}.`, `Expected an integer from ${min} to ${max}.`);
    }
    return value;
  }
  literal<T extends string | number | boolean>(value: unknown, expected: T): T {
    if (value !== expected) return this.fail('unsupported', `Поддерживается только значение ${expected}.`, `Only ${expected} is supported.`);
    return expected;
  }
  choice<T extends string>(value: unknown, choices: readonly T[]): T {
    if (typeof value !== 'string' || !choices.includes(value as T)) {
      return this.fail('value', `Допустимые значения: ${choices.join(', ')}.`, `Allowed values: ${choices.join(', ')}.`);
    }
    return value as T;
  }
  quantity(value: unknown, positive = false): number {
    try {
      const quantity = parseQuantity(this.text(value));
      if (positive && quantity === 0) return this.fail('value', 'Количество должно быть положительным.', 'Quantity must be positive.');
      return quantity;
    } catch (error) {
      if (!(error instanceof ArithmeticError)) throw error;
      return this.fail('value', 'Некорректное количество: до шести знаков, без отрицательных значений и переполнения.', 'Invalid quantity: up to six decimal places, nonnegative and within range.');
    }
  }
  money(value: unknown): bigint {
    try {
      const money = parseMoney(this.text(value));
      if (money < 0n) return this.fail('value', 'Стоимость не может быть отрицательной.', 'Cost cannot be negative.');
      return money;
    } catch (error) {
      if (!(error instanceof ArithmeticError)) throw error;
      return this.fail('value', 'Некорректная стоимость: до шести знаков и без переполнения.', 'Invalid cost: up to six decimal places and within range.');
    }
  }
  buffer(value: unknown): ResolvedBuffer {
    const object = this.object(value, ['kind', 'quantity']);
    if (object.kind === 'shift') {
      this.at('kind').fail('unsupported', 'Расчёт буфера по смене пока не поддерживается; задайте количество явно.', 'Shift-based capacities are not supported yet; specify a quantity explicitly.');
    }
    const kind = this.at('kind').choice(object.kind, ['quantity', 'infinite']);
    if (kind === 'infinite') {
      if ('quantity' in object) this.at('quantity').fail('shape', 'У бесконечного буфера нет числовой ёмкости.', 'An infinite buffer has no numeric capacity.');
      return { kind };
    }
    return { kind, quantity: this.at('quantity').quantity(object.quantity) };
  }
}

export function freezeData<T>(value: T): DeepReadonly<T> {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freezeData(child);
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}

const byId = <T extends { id: string }>(items: T[]): T[] => items.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Portable deterministic fingerprint, not a security or uniqueness guarantee. */
function calculationHash(config: ResolvedConfig): string {
  const canonical = JSON.stringify({ schemaVersion: SCHEMA_VERSION, engineVersion: ENGINE_VERSION, rngVersion: RNG_VERSION, config },
    (_key, value: unknown) => typeof value === 'bigint' ? moneyToJSON(value) : value);
  let hash = 0xcbf29ce484222325n;
  for (let i = 0; i < canonical.length; i++) {
    hash = BigInt.asUintN(64, (hash ^ BigInt(canonical.charCodeAt(i))) * 0x100000001b3n);
  }
  return `fnv1a64:${hash.toString(16).padStart(16, '0')}`;
}

/** Strict boundary for untrusted data. No migrations or implicit feature fallback. */
export function compileConfig(value: unknown): RunConfig {
  const root = new Reader('config',
    value && typeof value === 'object' && 'id' in value && typeof value.id === 'string' ? value.id : null);
  const config = root.object(value, ['schemaVersion', 'id', 'name', 'language', 'displayOrder', 'seed', 'durationMs', 'policy', 'calendar', 'materials', 'recipes', 'stations', 'sources', 'routes', 'initialStocks', 'bufferDefaults']);
  root.at('schemaVersion').literal(config.schemaVersion, SCHEMA_VERSION);
  const seen = new Set<string>(['market', 'warehouse']);
  function id(value: unknown, reader: Reader): string {
    const name = reader.text(value);
    if (!/^[A-Za-z0-9_-]+$/.test(name) || seen.has(name)) reader.fail('id', 'ID должен быть уникальным и состоять из латинских букв, цифр, _ или -.', 'ID must be unique and use ASCII letters, digits, _ or -.');
    seen.add(name);
    return name;
  }
  function entries(key: string, keys: string[]) {
    return root.at(key).array(config[key]).map((item, index) => {
      const path = new Reader(root.at(key).at(index).path,
        item && typeof item === 'object' && 'id' in item && typeof item.id === 'string' ? item.id : null);
      const object = path.object(item, keys);
      const objectId = id(object.id, path.at('id'));
      return { object, reader: new Reader(path.path, objectId), id: objectId };
    });
  }
  id(config.id, root.at('id'));
  root.at('name').text(config.name);
  root.at('language').choice(config.language, ['ru', 'en']);
  const seed = root.at('seed').integer(config.seed, 0, 0xffffffff);
  const durationMs = root.at('durationMs').integer(config.durationMs, 1);
  const policy = root.at('policy').literal(config.policy, 'push');
  const calReader = root.at('calendar');
  const cal = calReader.object(config.calendar, ['shiftStartMs', 'lunchStartMs', 'lunchEndMs', 'shiftEndMs']);
  const calendar = {
    shiftStartMs: calReader.at('shiftStartMs').integer(cal.shiftStartMs, 0, 86_400_000),
    lunchStartMs: calReader.at('lunchStartMs').integer(cal.lunchStartMs, 0, 86_400_000),
    lunchEndMs: calReader.at('lunchEndMs').integer(cal.lunchEndMs, 0, 86_400_000),
    shiftEndMs: calReader.at('shiftEndMs').integer(cal.shiftEndMs, 0, 86_400_000),
  };
  if (!(calendar.shiftStartMs < calendar.lunchStartMs && calendar.lunchStartMs < calendar.lunchEndMs && calendar.lunchEndMs < calendar.shiftEndMs)) {
    calReader.fail('value', 'Обед должен находиться строго внутри одной смены.', 'Lunch must be strictly inside a single shift.');
  }
  try { calendarForDuration(calendar, durationMs); } catch (error) {
    if (!(error instanceof CalendarError)) throw error;
    root.at('durationMs').fail('value', error.messages.ru, error.messages.en);
  }
  const materials = byId(entries('materials', ['id', 'name', 'color', 'role', 'purchasePrice', 'salePrice']).map(({object: m, reader: r, id}) => {
    r.at('name').text(m.name); r.at('color').text(m.color);
    const role = r.at('role').choice(m.role, ['raw', 'intermediate', 'finished']);
    const purchasePrice = m.purchasePrice === undefined ? null : r.at('purchasePrice').money(m.purchasePrice);
    const salePrice = m.salePrice === undefined ? null : r.at('salePrice').money(m.salePrice);
    if (role === 'raw' && purchasePrice === null) r.at('purchasePrice').fail('value', 'Для сырья нужна закупочная цена.', 'Raw material requires a purchase price.');
    if (role === 'finished' && salePrice === null) r.at('salePrice').fail('value', 'Для конечного изделия нужна цена продажи.', 'Finished material requires a sale price.');
    return {id, role, purchasePrice, salePrice};
  }));
  function material(value: unknown, r: Reader) {
    const materialId = r.text(value);
    const found = materials.find(m => m.id === materialId);
    if (!found) return r.fail('reference', `Материал ${materialId} не найден.`, `Material ${materialId} was not found.`);
    return found;
  }
  const recipes = byId(entries('recipes', ['id', 'name', 'kind', 'inputs', 'output']).map(({object: recipe, reader: r, id}) => {
    r.at('name').text(recipe.name); r.at('kind').literal(recipe.kind, 'production');
    const inputReader = r.at('inputs');
    const rows = inputReader.array(recipe.inputs);
    if (rows.length === 0) inputReader.fail('value', 'Рецепту нужен хотя бы один вход.', 'A recipe requires at least one input.');
    const output = r.at('output').object(recipe.output, ['materialId', 'quantity']);
    const outputMaterial = material(output.materialId, r.at('output').at('materialId'));
    if (outputMaterial.role === 'raw') r.at('output').fail('topology', 'Производство не может выпускать сырьё.', 'Production cannot output raw material.');
    const seenInputs = new Set<string>();
    const inputs = rows.map((value, index) => {
      const ir = inputReader.at(index), input = ir.object(value, ['materialId', 'quantity']);
      const inputMaterial = material(input.materialId, ir.at('materialId'));
      if (inputMaterial.role === 'finished' || inputMaterial.id === outputMaterial.id) ir.fail('topology', 'Производство должно вести от сырья через полуфабрикаты к конечному изделию.', 'Production must lead from raw material through intermediates to a finished material.');
      if (seenInputs.has(inputMaterial.id)) ir.at('materialId').fail('reference', 'Материал повторяется во входах рецепта.', 'Duplicate input material in recipe.');
      seenInputs.add(inputMaterial.id);
      return {materialId: inputMaterial.id, quantity: ir.at('quantity').quantity(input.quantity, true)};
    }).sort((a, b) => a.materialId < b.materialId ? -1 : a.materialId > b.materialId ? 1 : 0);
    const outputQuantity = r.at('output').at('quantity').quantity(output.quantity, true);
    if (outputQuantity % 1_000_000 !== 0) r.at('output').at('quantity').fail('value', 'Выход рецепта должен быть целым положительным числом.', 'Recipe output must be a positive whole number.');
    return {id, inputs, output: {materialId: outputMaterial.id, quantity: outputQuantity}};
  }));
  const defaultsReader = root.at('bufferDefaults');
  const defaults = config.bufferDefaults === undefined ? {} : defaultsReader.object(config.bufferDefaults, ['input', 'output']);
  const defaultInput = defaults.input === undefined ? null : defaultsReader.at('input').buffer(defaults.input);
  const defaultOutput = defaults.output === undefined ? {kind: 'quantity' as const, quantity: 0} : defaultsReader.at('output').buffer(defaults.output);
  function resolveBuffers(value: unknown, reader: Reader, materialIds: string[], inherited: ResolvedBuffer | null) {
    if (value && typeof value === 'object' && 'kind' in value && value.kind === 'inherit') {
      reader.object(value, ['kind']);
      if (!inherited) reader.fail('unsupported', 'Для наследуемого входа пока нужно явно задать глобальную ёмкость; расчёт на долю смены ещё не поддерживается.', 'Inherited input currently requires an explicit global capacity; shift-based calculation is not supported yet.');
      return materialIds.map(materialId => ({materialId, capacity: {...inherited!}}));
    }
    if (value && typeof value === 'object' && 'kind' in value && value.kind === 'materials') {
      const object = reader.object(value, ['kind', 'materials']);
      const seenMaterials = new Set<string>();
      const buffers = reader.at('materials').array(object.materials).map((value, index) => {
        const mr = reader.at('materials').at(index), entry = mr.object(value, ['materialId', 'capacity']);
        const materialId = mr.at('materialId').text(entry.materialId);
        if (!materialIds.includes(materialId) || seenMaterials.has(materialId)) mr.at('materialId').fail('reference', 'Ёмкости должны соответствовать уникальным материалам буфера поста.', 'Capacities must match unique station buffer materials.');
        seenMaterials.add(materialId);
        return {materialId, capacity: mr.at('capacity').buffer(entry.capacity)};
      });
      if (buffers.length !== materialIds.length) reader.fail('capacity', 'Нужна ёмкость для каждого материала буфера поста.', 'Every station buffer material requires a capacity.');
      return buffers.sort((a, b) => a.materialId < b.materialId ? -1 : a.materialId > b.materialId ? 1 : 0);
    }
    const capacity = reader.buffer(value);
    return materialIds.map(materialId => ({materialId, capacity: {...capacity}}));
  }
  const stations = byId(entries('stations', ['id', 'name', 'priority', 'plan', 'inputBuffer', 'outputBuffer', 'transportThreshold', 'setupMs', 'initialRecipeId', 'maintenance', 'lunchReplacement', 'costs']).map(({object: station, reader: r, id: stationId}) => {
    r.at('name').text(station.name);
    const rows = r.at('plan').array(station.plan);
    if (rows.length === 0) r.at('plan').fail('value', 'План должен содержать хотя бы одну строку.', 'Plan requires at least one row.');
    const tr = r.at('transportThreshold');
    const transportThreshold = tr.quantity(station.transportThreshold === undefined ? '1' : station.transportThreshold, true);
    const plan = rows.map((value, index): ResolvedPlanRow => {
      const pr = r.at('plan').at(index);
      const row = pr.object(value, ['id', 'recipeId', 'batches', 'processing']);
      const planId = id(row.id, pr.at('id'));
      const recipeId = pr.at('recipeId').text(row.recipeId);
      const recipe = recipes.find(recipe => recipe.id === recipeId);
      if (!recipe) pr.at('recipeId').fail('reference', `Рецепт ${recipeId} не найден.`, `Recipe ${recipeId} was not found.`);
      const batches = pr.at('batches').integer(row.batches, 1);
      const processing = pr.at('processing').object(row.processing, ['mode', 'repetitions', 'timeMs', 'cv']);
      const mode = pr.at('processing').at('mode').choice(processing.mode, ['sequential', 'simultaneous']);
      const repetitions = pr.at('processing').at('repetitions').integer(processing.repetitions, 1);
      for (const amount of [...recipe!.inputs, recipe!.output]) {
        if (BigInt(amount.quantity) * BigInt(repetitions) > BigInt(Number.MAX_SAFE_INTEGER)) pr.at('processing').at('repetitions').fail('value', 'Количество полной партии превышает диапазон.', 'Full batch quantity exceeds range.');
      }
      if (transportThreshold % 1_000_000 !== 0 || transportThreshold > recipe!.output.quantity * repetitions) tr.fail('value', 'Транспортный порог должен быть целым числом изделий от 1 до полного выхода каждой партии плана.', 'Transport threshold must be a whole number of items from 1 to the full output of every batch in the plan.');
      const cv = processing.cv;
      if (typeof cv !== 'number' || !Number.isFinite(cv) || cv < 0 || cv > 2) pr.at('processing').at('cv').fail('value', 'CV должен быть числом от 0 до 2.', 'CV must be a number from 0 to 2.');
      return {id: planId, recipeId, batches, mode, repetitions,
        timeMs: pr.at('processing').at('timeMs').integer(processing.timeMs, 1), cv: cv as number};
    });
    const first = plan[0]!;
    const plannedRecipes = plan.map(row => recipes.find(recipe => recipe.id === row.recipeId)!);
    const inputIds = [...new Set(plannedRecipes.flatMap(recipe => recipe.inputs.map(input => input.materialId)))].sort();
    const setupMs = r.at('setupMs').integer(station.setupMs);
    const initialRecipeId = station.initialRecipeId === undefined ? first.recipeId : r.at('initialRecipeId').text(station.initialRecipeId);
    if (!recipes.some(recipe => recipe.id === initialRecipeId)) r.at('initialRecipeId').fail('reference', `Начальный рецепт ${initialRecipeId} не найден.`, `Initial recipe ${initialRecipeId} was not found.`);
    const maintenance = r.at('maintenance').object(station.maintenance, ['enabled']);
    r.at('maintenance').at('enabled').literal(maintenance.enabled, false);
    r.at('lunchReplacement').literal(station.lunchReplacement, false);
    const costs = r.at('costs').object(station.costs, ['perShift', 'perLunchHour', 'capital']);
    const br = r.at('inputBuffer');
    const inputBuffers = resolveBuffers(station.inputBuffer, br, inputIds, defaultInput);
    const outputIds = [...new Set(plannedRecipes.map(recipe => recipe.output.materialId))].sort();
    const outputBuffers = resolveBuffers(station.outputBuffer, r.at('outputBuffer'), outputIds, defaultOutput);
    for (const row of plan) for (const input of recipes.find(recipe => recipe.id === row.recipeId)!.inputs) {
      const capacity = inputBuffers.find(buffer => buffer.materialId === input.materialId)!.capacity;
      if (capacity.kind === 'quantity' && capacity.quantity < input.quantity * row.repetitions) br.fail('capacity', `Входной буфер ${input.materialId} не вмещает полный комплект партии.`, `Input buffer ${input.materialId} cannot hold a complete batch kit.`);
    }
    return {id: stationId, priority: r.at('priority').integer(station.priority, -Number.MAX_SAFE_INTEGER), transportThreshold, setupMs, initialRecipeId, plan, planId: first.id, recipeId: first.recipeId, mode: first.mode, repetitions: first.repetitions,
      timeMs: first.timeMs, cv: first.cv, inputBuffers,
      outputBuffers,
      costs: {perShift: r.at('costs').at('perShift').money(costs.perShift), perLunchHour: r.at('costs').at('perLunchHour').money(costs.perLunchHour), capital: r.at('costs').at('capital').money(costs.capital)}};
  }));
  const sources = byId(entries('sources', ['id', 'name', 'materialId', 'availability', 'quantity', 'intervalMs']).map(({object: source, reader: r, id}) => {
    r.at('name').text(source.name);
    const m = material(source.materialId, r.at('materialId'));
    if (m.role !== 'raw') r.at('materialId').fail('topology', 'Источник должен выпускать сырьё.', 'Source must release raw material.');
    return {id, materialId: m.id, availability: r.at('availability').choice(source.availability, ['virtual', 'warehouse']), quantity: r.at('quantity').quantity(source.quantity, true), intervalMs: r.at('intervalMs').integer(source.intervalMs, 1)};
  }));
  const stationRecipes = (station: typeof stations[number]) => station.plan.map(row => recipes.find(recipe => recipe.id === row.recipeId)!);
  const routes = byId(entries('routes', ['id', 'fromId', 'toId', 'materialId']).map(({object: route, reader: r, id}) => {
    const fromId = r.at('fromId').text(route.fromId);
    const toId = r.at('toId').text(route.toId);
    const materialId = material(route.materialId, r.at('materialId')).id;
    const producer = sources.find(s => s.id === fromId) ?? stations.find(s => s.id === fromId);
    const consumer = stations.find(s => s.id === toId);
    if (!producer) r.at('fromId').fail('reference', `Производитель ${fromId} не найден.`, `Producer ${fromId} was not found.`);
    if (!consumer && toId !== 'market') r.at('toId').fail('reference', `Получатель ${toId} не найден.`, `Consumer ${toId} was not found.`);
    const producedMaterials = 'materialId' in producer! ? [producer.materialId] : stationRecipes(producer!).map(recipe => recipe.output.materialId);
    if (!producedMaterials.includes(materialId)) r.at('materialId').fail('reference', 'Производитель не выпускает указанный материал.', 'Producer does not output this material.');
    if (consumer && !consumer.inputBuffers.some(input => input.materialId === materialId)) r.at('materialId').fail('reference', 'Получатель не использует указанный материал.', 'Consumer does not use this material.');
    if (toId === 'market' && material(materialId, r).role !== 'finished') r.at('toId').fail('topology', 'На рынок передаются только конечные изделия.', 'Only finished materials can go to market.');
    return {id, fromId, toId, materialId};
  }));
  // Explicit acyclic routes; multiple producers may supply the same input material.
  // Each required component has its own input capacity and explicit route.
  if (sources.length === 0 || stations.length === 0) root.fail('topology', 'Нужны источники сырья и хотя бы один пост.', 'Raw sources and at least one station are required.');
  for (const source of sources) {
    const siblings = sources.filter(s => s.materialId === source.materialId);
    if (siblings.some(s => s.availability !== source.availability)) new Reader('config.sources', source.id).fail('value', 'Все источники одного сырья должны использовать один вид доступности.', 'All sources of the same raw material must use the same availability kind.');
  }
  const routeKeys = new Set<string>();
  for (const route of routes) {
    const key = JSON.stringify([route.fromId, route.toId, route.materialId]);
    if (routeKeys.has(key)) new Reader('config.routes', route.id).fail('topology', 'Повторный маршрут между теми же объектами.', 'Duplicate route between the same objects.');
    routeKeys.add(key);
  }
  for (const source of sources) {
    if (!routes.some(r => r.fromId === source.id)) new Reader('config.sources', source.id).fail('topology', 'Источник должен иметь маршрут к посту.', 'Source must have a route to a station.');
  }
  const visited = new Set<string>(), visiting = new Set<string>();
  function visit(id: string) {
    if (visiting.has(id)) root.at('routes').fail('topology', 'Обнаружен цикл маршрутов.', 'A route cycle was found.');
    if (id === 'market' || visited.has(id)) return;
    visiting.add(id);
    for (const route of routes.filter(r => r.fromId === id)) visit(route.toId);
    visiting.delete(id); visited.add(id);
  }
  for (const source of sources) visit(source.id);
  for (const station of stations) {
    const outgoing = routes.filter(r => r.fromId === station.id);
    const incoming = routes.filter(r => r.toId === station.id);
    for (const input of station.inputBuffers) {
      if (!incoming.some(route => route.materialId === input.materialId)) new Reader('config.stations', station.id).fail('topology', `Нет маршрута для входа ${input.materialId}.`, `No route for required input ${input.materialId}.`);
    }
    if (outgoing.length === 0 || incoming.length === 0) {
      new Reader('config.stations', station.id).fail('topology', 'Посту нужны входные и выходные маршруты.', 'A station requires incoming and outgoing routes.');
    }
    for (const materialId of new Set(stationRecipes(station).map(recipe => recipe.output.materialId))) {
      const materialRoutes = outgoing.filter(route => route.materialId === materialId);
      if (materialRoutes.length === 0) new Reader('config.stations', station.id).fail('topology', `Нет маршрута для выхода ${materialId}.`, `No route for required output ${materialId}.`);
      if (materialRoutes.some(r => r.toId === 'market') && materialRoutes.some(r => r.toId !== 'market')) {
        new Reader('config.stations', station.id).fail('topology', 'Нельзя одновременно передавать один выпуск в рынок и на посты.', 'One output cannot go both to market and to stations.');
      }
    }
  }
  if (visited.size !== sources.length + stations.length
    || new Set(stations.flatMap(s => s.plan.map(row => row.recipeId))).size !== recipes.length
    || new Set([...sources.map(s => s.materialId), ...recipes.map(r => r.output.materialId)]).size !== materials.length) {
    root.fail('topology', 'Сеть должна использовать все посты, рецепты и материалы.', 'Network must use all stations, recipes and materials.');
  }
  const initialStocks = byId(entries('initialStocks', ['id', 'ownerId', 'location', 'materialId', 'quantity', 'cost']).map(({object: stock, reader: r, id}) => {
    const ownerId = r.at('ownerId').text(stock.ownerId);
    const location = r.at('location').choice(stock.location, ['warehouse', 'input', 'output']);
    const materialId = material(stock.materialId, r.at('materialId')).id;
    const quantity = r.at('quantity').quantity(stock.quantity, true);
    const cost = r.at('cost').money(stock.cost);
    if (location === 'warehouse') {
      if (ownerId !== 'warehouse' || !sources.some(source => source.materialId === materialId && source.availability === 'warehouse')) r.fail('reference', 'Запас склада должен соответствовать конечному сырьевому складу источника.', 'Warehouse stock must match the source finite raw warehouse.');
    } else {
      const station = stations.find(s => s.id === ownerId);
      if (!station) r.at('ownerId').fail('reference', `Пост ${ownerId} не найден.`, `Station ${ownerId} was not found.`);
      const matches = location === 'input' ? station!.inputBuffers.some(input => input.materialId === materialId) : stationRecipes(station!).some(recipe => materialId === recipe.output.materialId);
      if (!matches) r.at('materialId').fail('reference', 'Материал не соответствует буферу поста.', 'Material does not match the station buffer.');
    }
    return {id, ownerId, location, materialId, quantity, cost};
  }));
  for (const station of stations) {
    for (const location of ['input', 'output'] as const) {
      for (const materialId of location === 'input' ? station.inputBuffers.map(input => input.materialId) : new Set(stationRecipes(station).map(recipe => recipe.output.materialId))) {
        const buffer = location === 'input' ? inputCapacity(station, materialId) : outputCapacity(station, materialId);
        const total = initialStocks.filter(s => s.ownerId === station.id && s.location === location && s.materialId === materialId).reduce((sum, s) => sum + BigInt(s.quantity), 0n);
        if (total > BigInt(Number.MAX_SAFE_INTEGER) || (buffer.kind === 'quantity' && total > BigInt(buffer.quantity))) new Reader('config.initialStocks', station.id).fail('capacity', `Запас ${materialId} превышает ёмкость буфера или диапазон.`, `Stock ${materialId} exceeds buffer capacity or range.`);
      }
    }
  }
  for (const material of materials.filter(m => m.role === 'raw')) {
    const warehouseTotal = initialStocks.filter(s => s.location === 'warehouse' && s.materialId === material.id).reduce((sum, s) => sum + BigInt(s.quantity), 0n);
    if (warehouseTotal > BigInt(Number.MAX_SAFE_INTEGER)) root.at('initialStocks').fail('capacity', 'Складской запас превышает диапазон количества.', 'Warehouse stock exceeds quantity range.');
  }
  const totalCost = initialStocks.reduce((sum, s) => sum + s.cost, 0n);
  if (totalCost > BigInt(Number.MAX_SAFE_INTEGER)) root.at('initialStocks').fail('value', 'Суммарная стоимость запасов превышает диапазон.', 'Total initial stock cost exceeds range.');
  if (config.displayOrder !== undefined) {
    const order = root.at('displayOrder').array(config.displayOrder);
    const unique = new Set<string>();
    order.forEach((entry, i) => {
      const item = root.at('displayOrder').at(i).text(entry);
      if (!seen.has(item) || unique.has(item)) root.at('displayOrder').at(i).fail('reference', 'Порядок отображения содержит неизвестный или повторный ID.', 'Display order contains an unknown or duplicate ID.');
      unique.add(item);
    });
  }
  const resolved: ResolvedConfig = {seed, durationMs, policy, calendar, materials, recipes, stations, sources, routes, initialStocks};
  // Validation constructed independent numeric data; source is separately cloned for editing a copy.
  const source = structuredClone(value) as EditorConfig;
  return freezeData({schemaVersion: SCHEMA_VERSION, engineVersion: ENGINE_VERSION, rngVersion: RNG_VERSION,
    calculationHash: calculationHash(resolved), source, resolved});
}
