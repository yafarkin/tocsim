import type {StockAverage} from './StockAverage.js';
import type {ProductionLocation} from './ProductionLocation.js';

/** Интегралы и средние запасы материала в конкретном месте. */
export interface StockPlaceTimeReport {
  /** ID владельца места. */
  ownerId: string;
  /** ID материала. */
  materialId: string;
  /** Место внутри линии. */
  location: ProductionLocation;
  /** Календарный интеграл в микроединицах × мс, строка. */
  calendarQuantityMs: string;
  /** Рабочий интеграл в микроединицах × мс, строка. */
  workQuantityMs: string;
  /** Средний запас по календарю или null. */
  calendarAverage: StockAverage | null;
  /** Средний запас по рабочему времени или null. */
  workAverage: StockAverage | null;
}
