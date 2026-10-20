import { ArithmeticError, moneyToJSON, parseMoney, parseQuantity } from './arithmetic';
import { CalendarError, calendarForDuration } from './calendar';

export const SCHEMA_VERSION = 1;
export const ENGINE_VERSION = '0.5.0';
// No sampling yet. Changing to a real RNG requires a new version.
export const RNG_VERSION = 'none-1';

export type DeepReadonly<T> = T extends object
  ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;

export type BufferConfig = { kind: 'quantity'; quantity: string } | { kind: 'infinite' };
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
    processing: { mode: 'sequential'; repetitions: number; timeMs: number; cv: number };
  }[];
  inputBuffer: BufferConfig; outputBuffer: BufferConfig;
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
  seed: number; durationMs: number; policy: 'push';
  calendar: { shiftStartMs: number; lunchStartMs: number; lunchEndMs: number; shiftEndMs: number };
  materials: MaterialConfig[]; recipes: RecipeConfig[]; stations: StationConfig[];
  sources: SourceConfig[]; routes: RouteConfig[]; initialStocks: InitialStockConfig[];
}

export type ResolvedBuffer = { kind: 'quantity'; quantity: number } | { kind: 'infinite' };
export interface ResolvedConfig {
  seed: number; durationMs: number; policy: 'push'; calendar: EditorConfig['calendar'];
  materials: { id: string; role: MaterialConfig['role']; purchasePrice: bigint | null; salePrice: bigint | null }[];
  recipes: { id: string; input: { materialId: string; quantity: number }; output: { materialId: string; quantity: number } }[];
  stations: {
    id: string; priority: number; planId: string; recipeId: string; timeMs: number;
    inputBuffer: ResolvedBuffer; outputBuffer: ResolvedBuffer;
    costs: { perShift: bigint; perLunchHour: bigint; capital: bigint };
  }[];
  sources: { id: string; materialId: string; availability: SourceConfig['availability']; quantity: number; intervalMs: number }[];
  routes: RouteConfig[];
  initialStocks: { id: string; ownerId: string; location: InitialStockConfig['location']; materialId: string; quantity: number; cost: bigint }[];
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
    if (object.kind === 'inherit' || object.kind === 'shift') {
      this.at('kind').fail('unsupported', 'Наследование и расчёт буфера по смене пока не поддерживаются; задайте количество явно.', 'Buffer inheritance and shift-based capacities are not supported yet; specify a quantity explicitly.');
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
  const config = root.object(value, ['schemaVersion', 'id', 'name', 'language', 'displayOrder', 'seed', 'durationMs', 'policy', 'calendar', 'materials', 'recipes', 'stations', 'sources', 'routes', 'initialStocks']);
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
    const inputs = r.at('inputs').array(recipe.inputs);
    if (inputs.length !== 1) r.at('inputs').fail('unsupported', 'Сейчас поддерживается ровно один вход рецепта.', 'Exactly one recipe input is currently supported.');
    const input = r.at('inputs').at(0).object(inputs[0], ['materialId', 'quantity']);
    const output = r.at('output').object(recipe.output, ['materialId', 'quantity']);
    const inputMaterial = material(input.materialId, r.at('inputs').at(0).at('materialId'));
    const outputMaterial = material(output.materialId, r.at('output').at('materialId'));
    if (outputMaterial.role === 'raw' || inputMaterial.role === 'finished' || inputMaterial.id === outputMaterial.id) {
      r.fail('topology', 'Производство должно вести от сырья через полуфабрикаты к конечному изделию.', 'Production must lead from raw material through intermediates to a finished material.');
    }
    const outputQuantity = r.at('output').at('quantity').quantity(output.quantity, true);
    if (outputQuantity % 1_000_000 !== 0) r.at('output').at('quantity').fail('value', 'Выход рецепта должен быть целым положительным числом.', 'Recipe output must be a positive whole number.');
    return {id, input: {materialId: inputMaterial.id, quantity: r.at('inputs').at(0).at('quantity').quantity(input.quantity, true)}, output: {materialId: outputMaterial.id, quantity: outputQuantity}};
  }));
  const stations = byId(entries('stations', ['id', 'name', 'priority', 'plan', 'inputBuffer', 'outputBuffer', 'setupMs', 'maintenance', 'lunchReplacement', 'costs']).map(({object: station, reader: r, id: stationId}) => {
    r.at('name').text(station.name);
    const plan = r.at('plan').array(station.plan);
    if (plan.length !== 1) r.at('plan').fail('unsupported', 'Сейчас поддерживается одна строка плана на пост.', 'One plan row per station is currently supported.');
    const pr = r.at('plan').at(0);
    const row = pr.object(plan[0], ['id', 'recipeId', 'batches', 'processing']);
    const planId = id(row.id, pr.at('id'));
    const recipeId = pr.at('recipeId').text(row.recipeId);
    const recipe = recipes.find(recipe => recipe.id === recipeId);
    if (!recipe) pr.at('recipeId').fail('reference', `Рецепт ${recipeId} не найден.`, `Recipe ${recipeId} was not found.`);
    pr.at('batches').literal(row.batches, 1);
    const processing = pr.at('processing').object(row.processing, ['mode', 'repetitions', 'timeMs', 'cv']);
    pr.at('processing').at('mode').literal(processing.mode, 'sequential');
    pr.at('processing').at('repetitions').literal(processing.repetitions, 1);
    pr.at('processing').at('cv').literal(processing.cv, 0);
    r.at('setupMs').literal(station.setupMs, 0);
    const maintenance = r.at('maintenance').object(station.maintenance, ['enabled']);
    r.at('maintenance').at('enabled').literal(maintenance.enabled, false);
    r.at('lunchReplacement').literal(station.lunchReplacement, false);
    const costs = r.at('costs').object(station.costs, ['perShift', 'perLunchHour', 'capital']);
    const inputBuffer = r.at('inputBuffer').buffer(station.inputBuffer);
    if (inputBuffer.kind === 'quantity' && inputBuffer.quantity < recipe!.input.quantity) r.at('inputBuffer').fail('capacity', 'Входной буфер не вмещает полный комплект рецепта.', 'Input buffer cannot hold a complete recipe kit.');
    return {id: stationId, priority: r.at('priority').integer(station.priority, -Number.MAX_SAFE_INTEGER), planId, recipeId,
      timeMs: pr.at('processing').at('timeMs').integer(processing.timeMs, 1), inputBuffer,
      outputBuffer: r.at('outputBuffer').buffer(station.outputBuffer),
      costs: {perShift: r.at('costs').at('perShift').money(costs.perShift), perLunchHour: r.at('costs').at('perLunchHour').money(costs.perLunchHour), capital: r.at('costs').at('capital').money(costs.capital)}};
  }));
  const sources = byId(entries('sources', ['id', 'name', 'materialId', 'availability', 'quantity', 'intervalMs']).map(({object: source, reader: r, id}) => {
    r.at('name').text(source.name);
    const m = material(source.materialId, r.at('materialId'));
    if (m.role !== 'raw') r.at('materialId').fail('topology', 'Источник должен выпускать сырьё.', 'Source must release raw material.');
    return {id, materialId: m.id, availability: r.at('availability').choice(source.availability, ['virtual', 'warehouse']), quantity: r.at('quantity').quantity(source.quantity, true), intervalMs: r.at('intervalMs').integer(source.intervalMs, 1)};
  }));
  const routes = byId(entries('routes', ['id', 'fromId', 'toId', 'materialId']).map(({object: route, reader: r, id}) => {
    const fromId = r.at('fromId').text(route.fromId);
    const toId = r.at('toId').text(route.toId);
    const materialId = material(route.materialId, r.at('materialId')).id;
    const producer = sources.find(s => s.id === fromId) ?? stations.find(s => s.id === fromId);
    const consumer = stations.find(s => s.id === toId);
    if (!producer) r.at('fromId').fail('reference', `Производитель ${fromId} не найден.`, `Producer ${fromId} was not found.`);
    if (!consumer && toId !== 'market') r.at('toId').fail('reference', `Получатель ${toId} не найден.`, `Consumer ${toId} was not found.`);
    const producedMaterial = 'materialId' in producer! ? producer.materialId : recipes.find(p => p.id === producer!.recipeId)!.output.materialId;
    if (producedMaterial !== materialId) r.at('materialId').fail('reference', 'Производитель не выпускает указанный материал.', 'Producer does not output this material.');
    if (consumer && recipes.find(p => p.id === consumer.recipeId)!.input.materialId !== materialId) r.at('materialId').fail('reference', 'Получатель не использует указанный материал.', 'Consumer does not use this material.');
    if (toId === 'market' && material(materialId, r).role !== 'finished') r.at('toId').fail('topology', 'На рынок передаются только конечные изделия.', 'Only finished materials can go to market.');
    return {id, fromId, toId, materialId};
  }));
  // Source fan-out/competition is supported; station chains still have one input route
  // (except multiple raw sources) and one output route. No assembly or station splitting.
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
    if (outgoing.length !== 1 || incoming.length === 0
      || (incoming.length > 1 && incoming.some(r => !sources.some(s => s.id === r.fromId)))) {
      new Reader('config.stations', station.id).fail('topology', 'Посту нужен один выход и один входной маршрут либо несколько источников того же сырья.', 'A station requires one output and one incoming route, or multiple sources of the same raw material.');
    }
  }
  if (visited.size !== sources.length + stations.length
    || new Set(stations.map(s => s.recipeId)).size !== recipes.length
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
      const recipe = recipes.find(p => p.id === station!.recipeId)!;
      const expected = location === 'input' ? recipe.input.materialId : recipe.output.materialId;
      if (materialId !== expected) r.at('materialId').fail('reference', 'Материал не соответствует буферу поста.', 'Material does not match the station buffer.');
    }
    return {id, ownerId, location, materialId, quantity, cost};
  }));
  for (const station of stations) {
    for (const location of ['input', 'output'] as const) {
      const buffer = location === 'input' ? station.inputBuffer : station.outputBuffer;
      const total = initialStocks.filter(s => s.ownerId === station.id && s.location === location).reduce((sum, s) => sum + BigInt(s.quantity), 0n);
      if (total > BigInt(Number.MAX_SAFE_INTEGER) || (buffer.kind === 'quantity' && total > BigInt(buffer.quantity))) new Reader('config.initialStocks', station.id).fail('capacity', 'Сумма начальных запасов превышает ёмкость буфера или диапазон.', 'Total initial stock exceeds buffer capacity or range.');
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
