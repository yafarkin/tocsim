import type {EditorConfig} from '../input/EditorConfig.js';
import type {DeepReadonly} from '../shared/DeepReadonly.js';
import type {BufferCalculation} from './BufferCalculation.js';
import type {ResolvedConfig} from './ResolvedConfig.js';

/** Неизменяемая конфигурация конкретного воспроизводимого прогона. */
export interface RunConfig {
  /** Версия RunConfig; текущее значение 1. */
  readonly schemaVersion: 1;
  /** Версия алгоритмов движка. */
  readonly engineVersion: string;
  /** Версия генератора случайных чисел. */
  readonly rngVersion: string;
  /** Хеш нормализованных расчётных условий. */
  readonly calculationHash: string;
  /** Обоснования вместимостей, рассчитанных от доли смены. */
  readonly bufferCalculations: DeepReadonly<BufferCalculation[]>;
  /** Независимая копия исходного входа для редактирования и UI. */
  readonly source: DeepReadonly<EditorConfig>;
  /** Нормализованные параметры, используемые непосредственно движком. */
  readonly resolved: DeepReadonly<ResolvedConfig>;
}
