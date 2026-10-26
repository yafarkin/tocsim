import type {DeepReadonly, EditorConfig} from '../engine/config';
import {createCalendar} from '../engine/calendar';
import type {Snapshot} from '../engine/state';

export const lesson1Variants = ['steady', 'variable', 'buffered'] as const;
export type Lesson1Variant = typeof lesson1Variants[number];

export function lesson1Config(variant: Lesson1Variant = 'steady', language: 'ru' | 'en' = 'ru', seed = 42): EditorConfig {
  const calendar = {shiftStartMs: 8 * 3_600_000, lunchStartMs: 12 * 3_600_000,
    lunchEndMs: 13 * 3_600_000, shiftEndMs: 17 * 3_600_000};
  const materials = ['raw', 'part-1', 'part-2', 'product'], stations = ['s1', 's2', 's3'];
  return {
    schemaVersion: 1, id: 'lesson-1', name: language === 'ru' ? 'Зависимые операции и вариативность' : 'Dependent operations and variability', language, seed,
    durationMs: createCalendar(calendar, 2).endTimeMs, policy: 'push', calendar,
    materials: materials.map((id, i) => ({id,
      name: (language === 'ru' ? ['Сырьё', 'Деталь 1', 'Деталь 2', 'Изделие'] : ['Raw material', 'Part 1', 'Part 2', 'Product'])[i]!,
      color: ['#357dad', '#8862a5', '#b56b20', '#247e70'][i]!,
      role: i === 0 ? 'raw' : i === 3 ? 'finished' : 'intermediate',
      ...(i === 0 ? {purchasePrice: '10'} : i === 3 ? {salePrice: '30'} : {}),
    })),
    recipes: stations.map((id, i) => ({id: `recipe-${id}`, name: id, kind: 'production',
      inputs: [{materialId: materials[i]!, quantity: '1'}], output: {materialId: materials[i + 1]!, quantity: '1'}})),
    stations: stations.map((id, i) => ({id, name: `${language === 'ru' ? 'Пост' : 'Station'} ${i + 1}`, priority: 0,
      plan: [{id: `plan-${id}`, recipeId: `recipe-${id}`, batches: 1,
        processing: {mode: 'sequential', repetitions: 1, timeMs: 5 * 60_000, cv: variant === 'steady' ? 0 : 0.5}}],
      inputBuffer: {kind: 'quantity', quantity: variant === 'buffered' ? '40' : '4'}, outputBuffer: {kind: 'quantity', quantity: '0'},
      setupMs: 0, maintenance: {enabled: false}, lunchReplacement: false,
      costs: {perShift: '0', perLunchHour: '0', capital: '0'}})),
    sources: [{id: 'source', name: language === 'ru' ? 'Источник' : 'Source', materialId: 'raw',
      availability: 'virtual', quantity: '1', intervalMs: 5 * 60_000}],
    routes: [{id: 'source-s1', fromId: 'source', toId: 's1', materialId: 'raw'},
      ...stations.map((id, i) => ({id: `${id}-next`, fromId: id, toId: stations[i + 1] ?? 'market', materialId: materials[i + 1]!}))],
    initialStocks: [],
  };
}

export function lesson1Result(model: DeepReadonly<Snapshot>) {
  return {
    total: model.line!.counters.find(counter => counter.materialId === 'product')!.sold,
    starvedMs: model.stations.find(station => station.stationId === 's3')!.timeByState.starvedMs,
    blockedMs: model.stations.find(station => station.stationId === 's1')!.timeByState.blockedMs,
  };
}
export type Lesson1Results = Partial<Record<Lesson1Variant, ReturnType<typeof lesson1Result>>>;
