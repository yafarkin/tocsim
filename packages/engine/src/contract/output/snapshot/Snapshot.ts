import type {LineSnapshot} from './LineSnapshot.js';
import type {ObservationSnapshot} from './ObservationSnapshot.js';
import type {SourceSnapshot} from './SourceSnapshot.js';
import type {SourceTransferSnapshot} from './SourceTransferSnapshot.js';
import type {StationSnapshot} from './StationSnapshot.js';
import type {StockSnapshot} from './StockSnapshot.js';

/** Полная JSON-совместимая точка наблюдения за детерминированным прогоном. */
export interface Snapshot {
  /** Версия Snapshot; текущее значение 24. */
  schemaVersion: 24;
  /** Версия алгоритмов движка, создавшего снимок. */
  engineVersion: string;
  /** Версия генератора случайных чисел. */
  rngVersion: string;
  /** Хеш нормализованных расчётных условий. */
  calculationHash: string;
  /** Текущее модельное время в миллисекундах. */
  timeMs: number;
  /** Наблюдаемый календарный и рабочий интервал. */
  observation: ObservationSnapshot;
  /** Состояния всех постов. */
  stations: StationSnapshot[];
  /** Состояние линии или null для ещё не подключённой модели. */
  line: LineSnapshot | null;
  /** Состояния источников сырья. */
  sources: SourceSnapshot[];
  /** Передачи от источников за последнюю отметку. */
  sourceTransfers: SourceTransferSnapshot[];
  /** Все физические партии материалов, включая склад и резерв. */
  stocks: StockSnapshot[];
}
