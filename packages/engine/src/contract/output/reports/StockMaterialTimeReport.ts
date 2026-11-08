import type {StockAverage} from './StockAverage.js';

/** Интегралы и средние запасы одного материала. */
export interface StockMaterialTimeReport {
  /** ID материала. */
  materialId: string;
  /** Календарный интеграл в микроединицах × мс, строка. */
  calendarQuantityMs: string;
  /** Рабочий интеграл в микроединицах × мс, строка. */
  workQuantityMs: string;
  /** Средний запас по календарю или null. */
  calendarAverage: StockAverage | null;
  /** Средний запас по рабочему времени или null. */
  workAverage: StockAverage | null;
}
