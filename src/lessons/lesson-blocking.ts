import type {DeepReadonly, EditorConfig} from '../engine/config';
import type {Snapshot} from '../engine/state';
import {previewConfig} from '../ui/preview';

export const blockingBuffers = [1, 8] as const;
export type BlockingBuffer = typeof blockingBuffers[number];

export function blockingLessonConfig(buffer: BlockingBuffer = 1, language: 'ru' | 'en' = 'ru'): EditorConfig {
  const config = previewConfig('blocking');
  config.id = 'lesson-blocking';
  config.language = language;
  config.name = language === 'ru' ? 'Занятость и выпуск' : 'Activity and output';
  config.stations.find(station => station.id === 'work')!.inputBuffer = {kind: 'quantity', quantity: String(buffer)};
  return config;
}

export function blockingLessonResult(model: DeepReadonly<Snapshot>) {
  return {
    total: model.line!.counters.find(counter => counter.materialId === 'product')!.sold,
    prepared: model.line!.counters.find(counter => counter.materialId === 'prepared')!.produced,
    blockedMs: model.stations.find(station => station.stationId === 'prep')!.timeByState.blockedMs,
    queue: model.stocks.filter(stock => stock.ownerId === 'work' && stock.location === 'input' && stock.materialId === 'prepared')
      .reduce((sum, stock) => sum + stock.quantity, 0),
  };
}
export type BlockingResults = Partial<Record<BlockingBuffer, ReturnType<typeof blockingLessonResult>>>;
