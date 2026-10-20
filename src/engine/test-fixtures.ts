// Technical test input, not a built-in lesson.
import type { EditorConfig } from './config';

export function line(): EditorConfig {
  return {
    schemaVersion: 1, id: 'line', name: 'Линия', language: 'ru',
    seed: 42, durationMs: 86_400_000, policy: 'push',
    calendar: {shiftStartMs: 28_800_000, lunchStartMs: 43_200_000, lunchEndMs: 46_800_000, shiftEndMs: 61_200_000},
    materials: [
      {id: 'raw', name: 'Сырьё', color: '#ccc', role: 'raw', purchasePrice: '10'},
      {id: 'part', name: 'Деталь', color: '#aaa', role: 'intermediate'},
      {id: 'product', name: 'Изделие', color: '#000', role: 'finished', salePrice: '30'},
    ],
    recipes: [
      {id: 'cut', name: 'Раскрой', kind: 'production', inputs: [{materialId: 'raw', quantity: '0.3'}], output: {materialId: 'part', quantity: '10'}},
      {id: 'finish', name: 'Отделка', kind: 'production', inputs: [{materialId: 'part', quantity: '1'}], output: {materialId: 'product', quantity: '1'}},
    ],
    stations: [
      {id: 's1', name: 'Первый', priority: 0, plan: [{id: 'plan1', recipeId: 'cut', batches: 1, processing: {mode: 'sequential', repetitions: 1, timeMs: 60_000, cv: 0}}], inputBuffer: {kind: 'quantity', quantity: '2'}, outputBuffer: {kind: 'quantity', quantity: '0'}, setupMs: 0, maintenance: {enabled: false}, lunchReplacement: false, costs: {perShift: '5', perLunchHour: '0', capital: '100'}},
      {id: 's2', name: 'Второй', priority: 0, plan: [{id: 'plan2', recipeId: 'finish', batches: 1, processing: {mode: 'sequential', repetitions: 1, timeMs: 90_000, cv: 0}}], inputBuffer: {kind: 'quantity', quantity: '6'}, outputBuffer: {kind: 'quantity', quantity: '2'}, setupMs: 0, maintenance: {enabled: false}, lunchReplacement: false, costs: {perShift: '5', perLunchHour: '0', capital: '100'}},
    ],
    sources: [{id: 'source', name: 'Источник', materialId: 'raw', availability: 'virtual', quantity: '1', intervalMs: 60_000}],
    routes: [
      {id: 'r1', fromId: 'source', toId: 's1', materialId: 'raw'},
      {id: 'r2', fromId: 's1', toId: 's2', materialId: 'part'},
      {id: 'r3', fromId: 's2', toId: 'market', materialId: 'product'},
    ],
    initialStocks: [{id: 'initial', ownerId: 's1', location: 'input', materialId: 'raw', quantity: '0.5', cost: '5'}],
  };
}
