import { compileConfig } from '../engine/config';
import type { EditorConfig } from '../engine/config';
export const exampleIds = ['balanced', 'queue', 'blocking', 'split', 'assembly'] as const;
export type ExampleId = typeof exampleIds[number];
export function previewConfig(example: ExampleId = 'queue', cv = 0, seed = 42): EditorConfig {
  const materialIds = ['raw', 'prepared', 'processed', 'product'];
  const ids = ['prep', 'work', 'finish'];
  const config: EditorConfig = {
    schemaVersion: 1, id: `flow-${example}`, name: 'Производственная линия', language: 'ru', seed,
    durationMs: 32_400_000, policy: 'push',
    calendar: {shiftStartMs: 28_800_000, lunchStartMs: 43_200_000, lunchEndMs: 46_800_000, shiftEndMs: 61_200_000},
    materials: [
      {id: 'raw', name: 'Заготовка', color: '#357dad', role: 'raw', purchasePrice: '10'},
      {id: 'prepared', name: 'Деталь', color: '#8862a5', role: 'intermediate'},
      {id: 'processed', name: 'Обработанная деталь', color: '#b56b20', role: 'intermediate'},
      {id: 'product', name: 'Изделие', color: '#247e70', role: 'finished', salePrice: '30'},
    ],
    recipes: ids.map((id, i) => ({id: `recipe-${id}`, name: id, kind: 'production', inputs: [{materialId: materialIds[i]!, quantity: '1'}], output: {materialId: materialIds[i + 1]!, quantity: '1'}})),
    stations: ids.map((id, i) => ({id, name: id, priority: 0,
      plan: [{id: `plan-${id}`, recipeId: `recipe-${id}`, batches: 1, processing: {mode: 'sequential', repetitions: 1, timeMs: (example === 'balanced' ? [3, 3, 3] : [3, 8, 3])[i]! * 60_000, cv}}],
      inputBuffer: {kind: 'quantity', quantity: example === 'queue' ? '80' : example === 'blocking' ? '1' : '4'}, outputBuffer: {kind: 'quantity', quantity: '0'},
      setupMs: 0, maintenance: {enabled: false}, lunchReplacement: false, costs: {perShift: '0', perLunchHour: '0', capital: '0'}})),
    sources: [{id: 'source', name: 'Сырьё', materialId: 'raw', availability: 'virtual', quantity: '1', intervalMs: 180_000}],
    routes: [{id: 'source-prep', fromId: 'source', toId: 'prep', materialId: 'raw'},
      ...ids.map((id, i) => ({id: `route-${id}`, fromId: id, toId: ids[i + 1] ?? 'market', materialId: materialIds[i + 1]!}))],
    initialStocks: [],
  };
  if (example === 'split') {
    config.materials = config.materials.filter(material => material.id !== 'processed');
    config.recipes = config.recipes.filter(recipe => recipe.id !== 'recipe-finish');
    config.recipes.find(recipe => recipe.id === 'recipe-work')!.output.materialId = 'product';
    const finish = config.stations.find(station => station.id === 'finish')!;
    finish.plan[0]!.recipeId = 'recipe-work'; finish.plan[0]!.processing.timeMs = 8 * 60_000;
    config.stations.forEach(station => {station.inputBuffer = {kind: 'quantity', quantity: '1'};});
    config.stations.find(station => station.id === 'work')!.priority = 10;
    config.routes = [
      {id: 'source-prep', fromId: 'source', toId: 'prep', materialId: 'raw'},
      {id: 'prep-work', fromId: 'prep', toId: 'work', materialId: 'prepared'},
      {id: 'prep-finish', fromId: 'prep', toId: 'finish', materialId: 'prepared'},
      {id: 'work-market', fromId: 'work', toId: 'market', materialId: 'product'},
      {id: 'finish-market', fromId: 'finish', toId: 'market', materialId: 'product'},
    ];
  }
  if (example === 'assembly') {
    config.recipes.find(recipe => recipe.id === 'recipe-work')!.inputs = [{materialId: 'raw', quantity: '1'}];
    config.recipes.find(recipe => recipe.id === 'recipe-finish')!.inputs = [{materialId: 'prepared', quantity: '1'}, {materialId: 'processed', quantity: '2'}];
    const assembly = config.stations.find(station => station.id === 'finish')!;
    assembly.id = 'assembly'; assembly.name = 'Сборка';
    config.stations.forEach(station => {station.inputBuffer = {kind: 'quantity', quantity: '1'};});
    assembly.inputBuffer = {kind: 'materials', materials: [
      {materialId: 'prepared', capacity: {kind: 'quantity', quantity: '2'}},
      {materialId: 'processed', capacity: {kind: 'quantity', quantity: '4'}},
    ]};
    config.sources.push({...config.sources[0]!, id: 'source2'});
    config.routes = [
      {id: 'source-prep', fromId: 'source', toId: 'prep', materialId: 'raw'},
      {id: 'source-work', fromId: 'source2', toId: 'work', materialId: 'raw'},
      {id: 'prep-assembly', fromId: 'prep', toId: 'assembly', materialId: 'prepared'},
      {id: 'work-assembly', fromId: 'work', toId: 'assembly', materialId: 'processed'},
      {id: 'assembly-market', fromId: 'assembly', toId: 'market', materialId: 'product'},
    ];
  }
  return config;
}

export const exampleRuns = Object.fromEntries(exampleIds.map(id => [id, compileConfig(previewConfig(id))])) as Record<ExampleId, ReturnType<typeof compileConfig>>;
