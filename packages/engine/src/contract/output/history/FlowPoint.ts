import type {FlowValues} from './FlowValues.js';

/** Одна точка ограниченной истории материального потока. */
export interface FlowPoint {
  /** Модельное время точки в мс. */
  timeMs: number;
  /** Отработанное общее время линии к этой точке в мс. */
  workMs: number;
  /** initial — начальное состояние, settled — завершённая атомарная отметка. */
  phase: 'initial' | 'settled';
  /** Значения по материалам и местам. */
  values: FlowValues;
}
