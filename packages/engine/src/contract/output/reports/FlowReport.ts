import type {MaterialStock} from './MaterialStock.js';
import type {PlaceStock} from './PlaceStock.js';
import type {ProductFlowReport} from './ProductFlowReport.js';
import type {ShiftOutput} from '../snapshot/ShiftOutput.js';
import type {WarehouseStock} from './WarehouseStock.js';

/** Материальный отчёт о выпуске, поставках и физических запасах. */
export interface FlowReport {
  /** Модельное время отчёта в мс. */
  timeMs: number;
  /** true только после достижения полного горизонта. */
  complete: boolean;
  /** Выпуск и поставки по конечным продуктам. */
  products: ProductFlowReport[];
  /** Запасы по материалам и стадиям. */
  materials: MaterialStock[];
  /** Ненулевые остатки общего сырьевого склада. */
  warehouse: WarehouseStock[];
  /** Запасы по конкретным местам. */
  places: PlaceStock[];
  /** Годный выпуск по сменам. */
  shifts: readonly ShiftOutput[];
}
