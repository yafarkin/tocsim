/** Нормализованный входной компонент рецепта. */
export interface ResolvedRecipeInput {
  /** ID материала. */
  materialId: string;
  /** Расход в целых микроединицах. */
  quantity: number;
}
