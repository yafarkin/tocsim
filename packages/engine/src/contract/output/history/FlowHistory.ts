import type {FlowPoint} from './FlowPoint.js';
import type {FlowSampling} from './FlowSampling.js';

/** Ограниченная временная серия материальных потоков без хранения всех событий. */
export interface FlowHistory {
  /** Версия истории; текущее значение 1. */
  schemaVersion: 1;
  /** Версия движка. */
  engineVersion: string;
  /** Версия генератора случайных чисел. */
  rngVersion: string;
  /** Хеш расчётных условий. */
  calculationHash: string;
  /** История ведётся отдельно по материалам. */
  scope: 'per-material';
  /** Единица всех количеств. */
  unit: 'micro-unit';
  /** Граница учёта: линия без общего сырьевого склада. */
  boundary: 'line-excluding-warehouse';
  /** Порядок физических стадий материала. */
  stages: readonly ['input', 'reserved', 'held', 'output'];
  /** Правило дискретизации точек. */
  sampling: FlowSampling;
  /** Начальная точка до событий. */
  initial: FlowPoint;
  /** Сохранённые точки истории. */
  points: FlowPoint[];
  /** Модельное время последнего состояния в мс. */
  timeMs: number;
  /** Состояние завершения прогона. */
  termination: 'running' | 'horizon' | 'stopped' | 'error';
}
