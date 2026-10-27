import type {DeepReadonly, EditorConfig, RunConfig} from '../engine/config';
import type {Snapshot} from '../engine/state';
import {Simulation} from '../engine/simulation';
import {previewConfig, defaultBatchProfiles} from '../ui/preview';

export const batchThresholds = [3, 1] as const;
export type BatchThreshold = typeof batchThresholds[number];
export function batchesLessonConfig(threshold: BatchThreshold = 3, language: 'ru' | 'en' = 'ru'): EditorConfig {
  const profiles = structuredClone(defaultBatchProfiles);
  profiles.prep.transportThreshold = threshold;
  profiles.work.transportThreshold = threshold;
  const config = previewConfig('batches', 0, 42, profiles);
  config.id = 'lesson-batches'; config.language = language;
  config.name = language === 'ru' ? 'Обработочная и транспортная партия' : 'Processing and transfer batches';
  return config;
}

/** Replay only the deterministic beginning: playback frames and sampled history cannot give exact event times. */
export function batchesLessonResult(run: RunConfig, model: DeepReadonly<Snapshot>) {
  const probe = new Simulation(run);
  let firstStartMs: number | null = null, firstOutputMs: number | null = null;
  while (probe.step()) {
    const state = probe.getSnapshot();
    if (firstStartMs === null && state.stations.find(s => s.stationId === 'work')!.remainingProcessingMs !== null) firstStartMs = state.timeMs;
    if (state.line!.counters.find(c => c.materialId === 'product')!.sold > 0) {
      firstOutputMs = state.timeMs;
      break;
    }
  }
  return {firstStartMs, firstOutputMs, total: model.line!.counters.find(c => c.materialId === 'product')!.sold};
}
export type BatchesResults = Partial<Record<BatchThreshold, ReturnType<typeof batchesLessonResult>>>;
