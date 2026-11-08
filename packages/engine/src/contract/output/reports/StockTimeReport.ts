import type {StockMaterialTimeReport} from './StockMaterialTimeReport.js';
import type {StockPlaceTimeReport} from './StockPlaceTimeReport.js';

/** Средние запасы и интегралы по материалам и местам. */
export interface StockTimeReport {
  /** Календарная длительность наблюдения в мс. */
  calendarMs: number;
  /** Рабочая длительность наблюдения в мс. */
  workMs: number;
  /** true после полного горизонта. */
  complete: boolean;
  /** Сводка по материалам. */
  materials: StockMaterialTimeReport[];
  /** Сводка по местам. */
  places: StockPlaceTimeReport[];
}
