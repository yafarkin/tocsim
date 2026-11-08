import type {DeepReadonly} from '../shared/DeepReadonly.js';
import type {EngineRunReports} from './EngineRunReports.js';
import type {FlowHistory} from './history/FlowHistory.js';
import type {Snapshot} from './snapshot/Snapshot.js';

/** Полный успешный результат одного детерминированного прогона. */
export interface EngineRunResult {
  /** Версия результата фасада; текущее значение 1. */
  schemaVersion: 1;
  /** Версия алгоритмов движка. */
  engineVersion: string;
  /** Версия генератора случайных чисел. */
  rngVersion: string;
  /** Хеш нормализованных расчётных условий. */
  calculationHash: string;
  /** Итоговое состояние после достижения горизонта. */
  snapshot: DeepReadonly<Snapshot>;
  /** Материальные, финансовые и инвестиционные отчёты. */
  reports: EngineRunReports;
  /** Ограниченная история потока для графиков и анализа. */
  history: DeepReadonly<FlowHistory>;
}
