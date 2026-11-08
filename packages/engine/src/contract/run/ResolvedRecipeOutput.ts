/** Нормализованный выход рецепта. */
export interface ResolvedRecipeOutput {
  /** ID материала. */
  materialId: string;
  /** Выпуск в целых микроединицах. */
  quantity: number;
}
