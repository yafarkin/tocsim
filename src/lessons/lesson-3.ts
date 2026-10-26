import type {DeepReadonly, EditorConfig, RunConfig} from '../engine/config';
import {createCalendar} from '../engine/calendar';
import {stockTimeReport} from '../engine/stock-time';
import type {Snapshot} from '../engine/state';

export const lesson3Buffers = [1, 8, 40] as const;
export type Lesson3Buffer = typeof lesson3Buffers[number];

export function lesson3Config(buffer: Lesson3Buffer = 1, language: 'ru' | 'en' = 'ru', seed = 42): EditorConfig {
  const calendar = {shiftStartMs: 8 * 3_600_000, lunchStartMs: 12 * 3_600_000,
    lunchEndMs: 13 * 3_600_000, shiftEndMs: 17 * 3_600_000};
  const materials = ['raw', 'part-1', 'part-2', 'product'], stations = ['s1', 's2', 's3'];
  return {
    schemaVersion: 1, id: 'lesson-3', name: language === 'ru' ? 'Буфер защищает ограничение' : 'A buffer protects the constraint', language, seed,
    durationMs: createCalendar(calendar, 5).endTimeMs, policy: 'push', calendar,
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
        processing: {mode: 'sequential', repetitions: 1, timeMs: [3, 4, 6][i]! * 60_000, cv: i < 2 ? 0.9 : 0}}],
      inputBuffer: {kind: 'quantity', quantity: String(i === 2 ? buffer : 20)}, outputBuffer: {kind: 'quantity', quantity: '0'},
      setupMs: 0, maintenance: {enabled: false}, lunchReplacement: false,
      costs: {perShift: '0', perLunchHour: '0', capital: '0'}})),
    sources: [{id: 'source', name: language === 'ru' ? 'Источник' : 'Source', materialId: 'raw',
      availability: 'virtual', quantity: '1', intervalMs: 3 * 60_000}],
    routes: [{id: 'source-s1', fromId: 'source', toId: 's1', materialId: 'raw'},
      ...stations.map((id, i) => ({id: `${id}-next`, fromId: id, toId: stations[i + 1] ?? 'market', materialId: materials[i + 1]!}))],
    initialStocks: [],
  };
}

/** Existing report facts, retained only for full runs by the UI. Work-time queue average excludes the part in processing. */
export function lesson3Result(run: RunConfig, model: DeepReadonly<Snapshot>) {
  const queue = stockTimeReport(run, model).places.find(row => row.ownerId === 's3' && row.location === 'input' && row.materialId === 'part-2');
  return {
    total: model.line!.counters.find(counter => counter.materialId === 'product')!.sold,
    starvedMs: model.stations.find(station => station.stationId === 's3')!.timeByState.starvedMs,
    queue: queue?.workAverage ?? {quantityMs: '0', durationMs: model.observation.workMs},
  };
}
export type Lesson3Result = ReturnType<typeof lesson3Result>;
export type Lesson3Results = Partial<Record<Lesson3Buffer, Lesson3Result>>;
