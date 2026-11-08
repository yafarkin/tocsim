import type {ProcessingConfig} from './processing/ProcessingConfig.js';

/** Одна строка циклического производственного плана поста. */
export interface StationPlanConfig {
  /** Уникальный ID строки плана. */
  id: string;
  /** ID рецепта, выполняемого этой строкой. */
  recipeId: string;
  /** Число партий перед переходом к следующей строке, целое не меньше 1. */
  batches: number;
  /** Режим, повторения и длительность обработки. */
  processing: ProcessingConfig;
}
