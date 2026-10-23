import type {DeepReadonly, EditorConfig} from '../engine/config';
import type {Snapshot} from '../engine/state';

export interface QualitySettings {probability: number; source: 'prep' | 'work'; position: 'early' | 'late'}
export const defaultQuality: QualitySettings = {probability: 0.25, source: 'prep', position: 'early'};
/** Move the same detector without changing processing, seed or other station settings. */
export function withQuality(config: EditorConfig, settings: QualitySettings): EditorConfig {
  const next = structuredClone(config);
  for (const station of next.stations) for (const row of station.plan) {
    row.processing.defectProbability = station.id === settings.source ? settings.probability : 0;
  }
  const materialId = settings.position === 'early' ? 'prepared' : 'processed';
  let qc = next.stations.find(s => s.id === 'qc');
  if (!qc) {
    qc = {...structuredClone(next.stations[0]!), id: 'qc', name: 'Контроль',
      plan: [{id: 'plan-qc', recipeId: 'recipe-qc', batches: 1, processing: {mode: 'sequential', repetitions: 1, timeMs: 60_000, cv: 0}}]};
    next.stations.push(qc);
  }
  // Per-material capacity follows the single material being checked when the detector moves.
  for (const buffer of [qc.inputBuffer, qc.outputBuffer]) if (buffer.kind === 'materials') {
    buffer.materials = buffer.materials.map(entry => ({...entry, materialId}));
  }
  next.recipes = next.recipes.filter(r => r.id !== 'recipe-qc');
  next.recipes.push({id: 'recipe-qc', name: 'Контроль', kind: 'inspection', inputs: [{materialId, quantity: '1'}], output: {materialId, quantity: '1'}});
  const fromId = settings.position === 'early' ? 'prep' : 'work', toId = settings.position === 'early' ? 'work' : 'finish';
  next.routes = [
    {id: 'source-prep', fromId: 'source', toId: 'prep', materialId: 'raw'},
    ...(settings.position === 'late' ? [{id: 'prep-work', fromId: 'prep', toId: 'work', materialId: 'prepared'}] : []),
    {id: 'to-qc', fromId, toId: 'qc', materialId},
    {id: 'from-qc', fromId: 'qc', toId, materialId},
    ...(settings.position === 'early' ? [{id: 'work-finish', fromId: 'work', toId: 'finish', materialId: 'processed'}] : []),
    {id: 'finish-market', fromId: 'finish', toId: 'market', materialId: 'product'},
  ];
  return next;
}
export function lostProcessingMs(model: DeepReadonly<Snapshot>, stationId: string): bigint {
  return (model.line?.scraps ?? []).reduce((sum, scrap) => sum + BigInt(Object.hasOwn(scrap.processingMs, stationId) ? scrap.processingMs[stationId]! : '0'), 0n);
}
export function minutesText(ms: bigint): string {
  // Display rounded thousandths; the underlying attributed milliseconds remain exact.
  const scaled = (ms * 1000n + 30_000n) / 60_000n;
  const fraction = String(scaled % 1000n).padStart(3, '0').replace(/0+$/, '');
  return `${scaled / 1000n}${fraction ? `.${fraction}` : ''}`;
}
