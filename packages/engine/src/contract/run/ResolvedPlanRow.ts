import type {BoundedDistribution} from '../input/durations/BoundedDistribution.js';

/** Нормализованная строка циклического плана поста. */
export interface ResolvedPlanRow {
  /** ID строки плана. */
  id: string;
  /** ID рецепта. */
  recipeId: string;
  /** Число партий до следующей строки. */
  batches: number;
  /** Последовательный или одновременный режим. */
  mode: 'sequential' | 'simultaneous';
  /** Число повторений в партии. */
  repetitions: number;
  /** Средняя длительность в мс после нормализации распределения. */
  timeMs: number;
  /** Коэффициент вариации после нормализации. */
  cv: number;
  /** Исходное ограниченное распределение, если оно задано. */
  distribution?: BoundedDistribution;
  /** Вероятность дефекта; по умолчанию 0. */
  defectProbability?: number;
}
