import {parseQuantity} from './arithmetic';
import type {RunConfig} from './config';

/** Separate planning input. This is not an EditorConfig policy or a saved format. */
export interface DbrSelection {
  drumStationId: string;
  drumCycles: number;
  products: {materialId: string; quantity: string}[];
  routeIds: string[];
  bufferMs: number;
  maxOpenSlots: number;
  /** Optional branch overrides; nominal estimates belong to the future planner. */
  leadTimes?: {routeIds: string[]; timeMs: number}[];
}
export type DbrIssueCode = 'shape' | 'value' | 'duplicate' | 'drumReference' | 'productReference'
  | 'routeReference' | 'ambiguousProducer' | 'missingInput' | 'missingOutput'
  | 'independentProduct' | 'unrelatedRoute' | 'disconnectedDrum' | 'defectRisk' | 'leadTimePath';
export interface DbrIssue {
  code: DbrIssueCode;
  path: string;
  entityIds: string[];
  messages: {ru: string; en: string};
}
const pendingChecks = ['drumSchedule', 'quantitiesAndPlans', 'stockAndCapacity', 'slotGroups'] as const;

/** Structural checks only. Neither success nor failure authorizes a DBR run.
 * run must come from compileConfig; selection is untrusted data.
 * Only explicit selected routes are followed, using recipe material dependencies.
 */
export function validateDbrSelection(run: RunConfig, selection: unknown) {
  const issues: DbrIssue[] = [];
  const add = (code: DbrIssueCode, path: string, entityIds: string[], ru: string, en: string) => {
    const uniqueIds = [...new Set(entityIds)].sort();
    if (!issues.some(i => i.code === code && i.path === path && JSON.stringify(i.entityIds) === JSON.stringify(uniqueIds))) {
      issues.push({code, path, entityIds: uniqueIds, messages: {ru, en}});
    }
  };
  const result = () => ({
    structurallyValid: issues.length === 0, canStart: false as const,
    pendingChecks: [...pendingChecks],
    issues: issues.sort((a,b) => compare(a.path,b.path) || compare(a.code,b.code) || compare(JSON.stringify(a.entityIds),JSON.stringify(b.entityIds))),
  });
  const object = (value: unknown, keys: string[], path: string): Record<string, unknown> | null => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype,null].includes(Object.getPrototypeOf(value))) {
      add('shape',path,[],'Ожидается объект данных.','Expected a data object.'); return null;
    }
    const data = value as Record<string, unknown>;
    for (const key of Object.keys(data).sort()) if (!keys.includes(key)) add('shape',`${path}.${key}`,[],'Поле не поддерживается.','Field is not supported.');
    return data;
  };
  const array = (value: unknown, path: string): unknown[] => {
    if (Array.isArray(value)) return value;
    add('shape',path,[],'Ожидается массив.','Expected an array.'); return [];
  };
  const text = (value: unknown, path: string): value is string => {
    if (typeof value === 'string' && value.trim().length > 0) return true;
    add('value',path,[],'Ожидается непустой ID.','Expected a nonempty ID.'); return false;
  };
  const integer = (value: unknown, path: string, minimum: number) => {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
      add('value',path,[],`Ожидается безопасное целое число не меньше ${minimum}.`,`Expected a safe integer of at least ${minimum}.`);
    }
  };
  const ids = (value: unknown, path: string) => {
    const list = array(value,path), seen = new Set<string>();
    for (const [i,id] of list.entries()) if (text(id,`${path}[${i}]`)) {
      if (seen.has(id)) add('duplicate',at(path,id),[id],`ID ${id} указан повторно.`,`ID ${id} is repeated.`);
      seen.add(id);
    }
    return [...seen].sort();
  };
  const raw = object(selection,['drumStationId','drumCycles','products','routeIds','bufferMs','maxOpenSlots','leadTimes'],'dbr');
  if (!raw) return result();
  integer(raw.drumCycles,'dbr.drumCycles',1); integer(raw.bufferMs,'dbr.bufferMs',0); integer(raw.maxOpenSlots,'dbr.maxOpenSlots',1);
  const config = run.resolved;
  const stations = new Map(config.stations.map(s => [s.id,s]));
  const recipes = new Map(config.recipes.map(r => [r.id,r]));
  const sources = new Map(config.sources.map(s => [s.id,s]));
  const drum = text(raw.drumStationId,'dbr.drumStationId') ? stations.get(raw.drumStationId) : undefined;
  if (typeof raw.drumStationId === 'string' && !drum) add('drumReference','dbr.drumStationId',[raw.drumStationId],`Пост ${raw.drumStationId} не найден.`,`Station ${raw.drumStationId} was not found.`);
  const products = new Set<string>();
  for (const [i,item] of array(raw.products,'dbr.products').entries()) {
    const row = object(item,['materialId','quantity'],`dbr.products[${i}]`); if (!row) continue;
    const path = typeof row.materialId === 'string' ? at('dbr.products',row.materialId) : `dbr.products[${i}]`;
    if (text(row.materialId,`${path}.materialId`)) {
      if (products.has(row.materialId)) add('duplicate',path,[row.materialId],'Продукт указан повторно.','Product is repeated.');
      products.add(row.materialId);
      if (!config.materials.some(m => m.id === row.materialId && m.role === 'finished')) add('productReference',path,[row.materialId],`Конечный продукт ${row.materialId} не найден.`,`Finished product ${row.materialId} was not found.`);
    }
    try { if (typeof row.quantity !== 'string' || parseQuantity(row.quantity) === 0) throw new Error(); }
    catch { add('value',`${path}.quantity`,[],'Нужно положительное точное количество с точностью до шести знаков.','A positive exact quantity with up to six decimal places is required.'); }
  }
  if (products.size === 0) add('value','dbr.products',[],'Нужен хотя бы один конечный продукт.','At least one finished product is required.');
  const routeIds = ids(raw.routeIds,'dbr.routeIds'), routesById = new Map(config.routes.map(r => [r.id,r]));
  const selected = routeIds.flatMap(id => {
    const route = routesById.get(id);
    if (!route) add('routeReference',at('dbr.routeIds',id),[id],`Маршрут ${id} не найден.`,`Route ${id} was not found.`);
    return route ? [route] : [];
  });
  const incoming = (ownerId: string, materialId: string) => selected.filter(r => r.toId === ownerId && r.materialId === materialId);
  const planned = (stationId: string, materialId: string) => stations.get(stationId)!.plan.filter(row => recipes.get(row.recipeId)!.output.materialId === materialId);
  // Source choice is per receiving input. The same raw material may have sources on separate branches.
  for (const route of selected) {
    const competing = incoming(route.toId,route.materialId);
    if (competing[0]!.id === route.id && new Set(competing.map(r => r.fromId)).size > 1) add('ambiguousProducer',at(at('dbr.inputs',route.toId),route.materialId),competing.map(r=>r.fromId),`Для входа ${route.toId}/${route.materialId} выбрано несколько производителей.`,`Several producers were selected for input ${route.toId}/${route.materialId}.`);
  }
  for (const material of config.materials) {
    const producers = [...new Set(selected.filter(r => r.materialId === material.id && stations.has(r.fromId) && planned(r.fromId,material.id).some(row=>recipes.get(row.recipeId)!.kind === 'production')).map(r => r.fromId))];
    if (producers.length > 1) add('ambiguousProducer',at('dbr.materials',material.id),producers,`Для материала ${material.id} выберите одного производителя.`,`Select one producer for material ${material.id}.`);
  }
  const visited = new Set<string>(), controlled = new Set<string>();
  const drumDependencies = new Map<string,boolean>();
  const trace = (route: typeof selected[number]): boolean => {
    if (drumDependencies.has(route.id)) return drumDependencies.get(route.id)!;
    visited.add(route.id);
    const station = stations.get(route.fromId);
    if (!station) {drumDependencies.set(route.id,false); return false;}
    controlled.add(station.id);
    const inputIds = [...new Set(planned(station.id,route.materialId).flatMap(row => recipes.get(row.recipeId)!.inputs.map(i=>i.materialId)))].sort();
    for (const materialId of inputIds) {
      const supply = incoming(station.id,materialId);
      if (supply.length === 0) add('missingInput',at(at('dbr.inputs',station.id),materialId),[station.id,materialId],`Не выбран маршрут входа ${station.id}/${materialId}.`,`No route was selected for input ${station.id}/${materialId}.`);
      for (const input of supply) trace(input);
    }
    // Each producing recipe must depend on drum; a different recipe at the same
    // station cannot lend its dependency to an otherwise independent product.
    const viaDrum = station.id === drum?.id || planned(station.id,route.materialId).every(row =>
      recipes.get(row.recipeId)!.inputs.some(input => incoming(station.id,input.materialId).some(r=>drumDependencies.get(r.id))));
    drumDependencies.set(route.id,viaDrum); return viaDrum;
  };
  for (const materialId of [...products].sort()) {
    const outputs = incoming('market',materialId);
    if (!outputs.length) add('missingOutput',at('dbr.products',materialId),[materialId],`Не выбран выпуск продукта ${materialId}.`,`No output route was selected for product ${materialId}.`);
    let throughDrum = false;
    for (const output of outputs) {const depends = trace(output); throughDrum = throughDrum || depends;}
    if (outputs.length && drum && !throughDrum) add('independentProduct',at('dbr.products',materialId),[materialId,drum.id],`Продукт ${materialId} не связан с drum ${drum.id}.`,`Product ${materialId} is not linked to drum ${drum.id}.`);
  }
  if (drum && !controlled.has(drum.id)) add('disconnectedDrum','dbr.drumStationId',[drum.id],`Пост ${drum.id} не входит в выбранный продуктовый поток.`,`Station ${drum.id} is outside the selected product flow.`);
  for (const route of selected) if (!visited.has(route.id)) add('unrelatedRoute',at('dbr.routeIds',route.id),[route.id],'Маршрут не обеспечивает выбранный продуктовый цикл.','Route does not supply the selected product cycle.');
  // Excluding an alternative is allowed, excluding a different finished product is not.
  for (const station of config.stations) {
    for (const row of station.plan) {
      const recipe = recipes.get(row.recipeId)!;
      const outputId = recipe.output.materialId;
      if (config.materials.find(m=>m.id===outputId)!.role === 'finished' && !products.has(outputId)) add('independentProduct',at('dbr.stations',station.id)+at('.plan',row.id),[station.id,row.recipeId,outputId],`Продукт ${outputId} отсутствует в выбранном конечном цикле.`,`Product ${outputId} is absent from the selected final cycle.`);
      if (!controlled.has(station.id)) continue;
      const path = at('dbr.stations',station.id)+at('.plan',row.id);
      if ((row.defectProbability ?? 0) > 0) add('defectRisk',`${path}.defectProbability`,[station.id,row.recipeId],`В плане поста ${station.id} есть ненулевой риск брака.`,`The plan at station ${station.id} has nonzero defect risk.`);
      if (!selected.some(r=>r.fromId===station.id && r.materialId===outputId && visited.has(r.id))) add('missingOutput',path,[station.id,row.recipeId,outputId],`Не выбран путь выпуска ${outputId} из плана поста ${station.id}.`,`No output path was selected for ${outputId} in station ${station.id}'s plan.`);
      for (const input of recipe.inputs) if (!incoming(station.id,input.materialId).length) {
        const path = at(at('dbr.inputs',station.id),input.materialId);
        if (!issues.some(i=>i.code==='missingInput' && i.path===path)) add('missingInput',path,[station.id,input.materialId],`Не выбран маршрут входа ${station.id}/${input.materialId}.`,`No route was selected for input ${station.id}/${input.materialId}.`);
      }
    }
  }
  const paths = new Set<string>();
  if (raw.leadTimes !== undefined) for (const [i,item] of array(raw.leadTimes,'dbr.leadTimes').entries()) {
    const path = `dbr.leadTimes[${i}]`, row = object(item,['routeIds','timeMs'],path); if (!row) continue;
    integer(row.timeMs,`${path}.timeMs`,0);
    const branchIds = array(row.routeIds,`${path}.routeIds`);
    if (!branchIds.every((id,j)=>text(id,`${path}.routeIds[${j}]`))) continue;
    const key = JSON.stringify(branchIds);
    if (paths.has(key)) add('duplicate',path,[],'Опережение ветви указано повторно.','Branch lead time is repeated.'); paths.add(key);
    const branch = (branchIds as string[]).map(id=>selected.find(r=>r.id===id));
    let valid = branch.length > 0 && branch.every(r=>r && visited.has(r.id));
    if (valid) {
      const first = branch[0]!, last = branch.at(-1)!;
      valid = sources.has(first!.fromId) && stations.has(last!.toId) && controlled.has(last!.toId)
        && (last!.toId === drum?.id || selected.some(r=>r.fromId===last!.toId && drumDependencies.get(r.id)));
      for (let j=1;j<branch.length;j++) {
        const previous = branch[j-1]!, next = branch[j]!;
        if (previous!.toId !== next!.fromId || previous!.toId === drum?.id || !planned(next!.fromId,next!.materialId).some(row=>recipes.get(row.recipeId)!.inputs.some(input=>input.materialId===previous!.materialId))) valid=false;
      }
    }
    if (!valid) add('leadTimePath',`${path}.routeIds`,branchIds.filter((id): id is string=>typeof id==='string'),'Нужен выбранный путь от источника к drum или его последующей сборке.','A selected path from a source to drum or its downstream assembly is required.');
  }
  return result();
}
function compare(a: string,b: string) {return a < b ? -1 : a > b ? 1 : 0;}
function at(path: string,id: string) {return `${path}[${JSON.stringify(id)}]`;}
