import type {ResolvedMaintenance} from './ResolvedMaintenance.js';
import type {ResolvedMaterialBuffer} from './ResolvedMaterialBuffer.js';
import type {ResolvedPlanRow} from './ResolvedPlanRow.js';
import type {ResolvedStationCosts} from './ResolvedStationCosts.js';

/** Пост в нормализованной расчётной конфигурации. */
export interface ResolvedStation {
  /** Нормализованный циклический план. */
  plan: ResolvedPlanRow[];
  /** Длительность переналадки в мс. */
  setupMs: number;
  /** Начальный рецепт после нормализации. */
  initialRecipeId: string;
  /** Настройка обслуживания. */
  maintenance: ResolvedMaintenance;
  /** Разрешение работы в общий обед. */
  lunchReplacement: boolean;
  /** ID поста. */
  id: string;
  /** Приоритет поста. */
  priority: number;
  /** ID первой строки плана, сохранённый для существующих потребителей. */
  planId: string;
  /** ID первого рецепта плана. */
  recipeId: string;
  /** Режим первой строки плана. */
  mode: 'sequential' | 'simultaneous';
  /** Повторения первой строки плана. */
  repetitions: number;
  /** Средняя длительность первой строки в мс. */
  timeMs: number;
  /** CV первой строки плана. */
  cv: number;
  /** Входные вместимости по материалам. */
  inputBuffers: ResolvedMaterialBuffer[];
  /** Выходные вместимости по материалам. */
  outputBuffers: ResolvedMaterialBuffer[];
  /** Транспортный порог в микроединицах. */
  transportThreshold: number;
  /** Затраты и капитал. */
  costs: ResolvedStationCosts;
}
