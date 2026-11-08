import type {ResolvedRecipeInput} from './ResolvedRecipeInput.js';
import type {ResolvedRecipeOutput} from './ResolvedRecipeOutput.js';

/** Рецепт в нормализованной расчётной конфигурации. */
export interface ResolvedRecipe {
  /** ID рецепта. */
  id: string;
  /** Производство или контроль. */
  kind: 'production' | 'inspection';
  /** Входной комплект. */
  inputs: ResolvedRecipeInput[];
  /** Выход за обработку. */
  output: ResolvedRecipeOutput;
}
