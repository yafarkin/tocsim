import type {RecipeInputConfig} from './RecipeInputConfig.js';
import type {RecipeOutputConfig} from './RecipeOutputConfig.js';

/** Преобразование входных материалов в выходной или контроль качества. */
export interface RecipeConfig {
  /** Уникальный стабильный ID рецепта. */
  id: string;
  /** Отображаемое название; не влияет на расчёт. */
  name: string;
  /** production создаёт материал, inspection проверяет его без изменения количества. */
  kind: 'production' | 'inspection';
  /** Непустой входной комплект. */
  inputs: RecipeInputConfig[];
  /** Выпуск за одну обработку. */
  output: RecipeOutputConfig;
}
