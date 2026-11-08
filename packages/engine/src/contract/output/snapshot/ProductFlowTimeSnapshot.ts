import type {FlowTimeSnapshot} from './FlowTimeSnapshot.js';

/** Два начала отсчёта времени прохождения для одного конечного продукта. */
export interface ProductFlowTimeSnapshot {
  /** ID конечного материала. */
  materialId: string;
  /** Время от поступления в линию до принятия рынком. */
  admission: FlowTimeSnapshot;
  /** Время от первой обработки предка до принятия рынком. */
  firstProcessing: FlowTimeSnapshot;
}
