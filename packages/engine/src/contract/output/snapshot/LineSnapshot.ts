import type {FlowBoundarySnapshot} from './FlowBoundarySnapshot.js';
import type {InspectionCounterSnapshot} from './InspectionCounterSnapshot.js';
import type {LineTransferSnapshot} from './LineTransferSnapshot.js';
import type {MaterialCounterSnapshot} from './MaterialCounterSnapshot.js';
import type {ProductFlowTimeSnapshot} from './ProductFlowTimeSnapshot.js';
import type {ScrapSummarySnapshot} from './ScrapSummarySnapshot.js';
import type {ShiftOutput} from './ShiftOutput.js';
import type {StockAge} from './StockAge.js';
import type {StockTimeSnapshot} from './StockTimeSnapshot.js';
import type {StockValueSnapshot} from './StockValueSnapshot.js';

/** Состояние и накопленные показатели производственной линии. */
export interface LineSnapshot {
  /** Моменты границ потока или null для несопоставимого потока. */
  flowBoundary: FlowBoundarySnapshot | null;
  /** Стоимость запасов и её интеграл. */
  stockValue: StockValueSnapshot;
  /** Возраст запасов по материалам и местам. */
  stockAge: StockAge;
  /** Годный выпуск по сменам и материалам. */
  shiftOutput: ShiftOutput[];
  /** Время прохождения по конечным продуктам. */
  flowTime: ProductFlowTimeSnapshot[];
  /** Интегралы запасов по местам и материалам. */
  stockTime: StockTimeSnapshot[];
  /** running продолжается, horizon завершён, stopped остановлен, error завершён ошибкой. */
  termination: 'running' | 'horizon' | 'stopped' | 'error';
  /** Общая диагностика потока без выбора ограничения. */
  flow: 'normal' | 'exhausted' | 'missingInput' | 'blocked';
  /** Счётчики производства, потребления, продаж и списаний. */
  counters: MaterialCounterSnapshot[];
  /** Передачи за последнюю атомарную отметку. */
  transfers: LineTransferSnapshot[];
  /** Счётчики контроля качества. */
  inspections: InspectionCounterSnapshot[];
  /** Группированные списания. */
  scraps: ScrapSummarySnapshot[];
}
