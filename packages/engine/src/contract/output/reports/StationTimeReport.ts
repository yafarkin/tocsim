import type {StationTimeReportRow} from './StationTimeReportRow.js';

/** Отчёт о времени и долях состояний всех постов. */
export interface StationTimeReport {
  /** Календарная длительность наблюдения в мс. */
  calendarMs: number;
  /** true после полного горизонта. */
  complete: boolean;
  /** Строки по постам. */
  stations: StationTimeReportRow[];
}
