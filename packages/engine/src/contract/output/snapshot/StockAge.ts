import type {MaterialAge} from './MaterialAge.js';
import type {PlaceAge} from './PlaceAge.js';

/** Возраст всех текущих запасов по материалам и местам. */
export interface StockAge {
  /** Сводка по каждому материалу. */
  materials: MaterialAge[];
  /** Сводка по каждому месту и материалу. */
  places: PlaceAge[];
}
