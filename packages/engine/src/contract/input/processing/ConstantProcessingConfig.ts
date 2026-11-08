import type {ProcessingBase} from './ProcessingBase.js';

/** Обработка со средней длительностью и коэффициентом вариации логнормального закона. */
export interface ConstantProcessingConfig extends ProcessingBase {
  /** Средняя длительность одной обработки в целых миллисекундах, не меньше 1. */
  timeMs: number;
  /** Коэффициент вариации от 0 до 2; ноль даёт постоянную длительность. */
  cv: number;
  /** Поле отсутствует при задании средней длительности и CV. */
  distribution?: never;
}
