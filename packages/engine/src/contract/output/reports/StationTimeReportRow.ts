import type {StationTime} from '../snapshot/StationTime.js';
import type {TimeShare} from './TimeShare.js';

/** Время и доли состояний одного поста. */
export interface StationTimeReportRow {
  /** ID поста. */
  stationId: string;
  /** Доступное рабочее время в мс. */
  availableWorkMs: number;
  /** Непересекающиеся интервалы состояний. */
  timeByState: StationTime;
  /** Обработка, переналадка и обслуживание в мс. */
  busyMs: number;
  /** Доля обработки или null при нулевом доступном времени. */
  processingShare: TimeShare | null;
  /** Доля занятости или null. */
  busyShare: TimeShare | null;
  /** Доля голодания или null. */
  starvedShare: TimeShare | null;
  /** Доля блокировки или null. */
  blockedShare: TimeShare | null;
}
