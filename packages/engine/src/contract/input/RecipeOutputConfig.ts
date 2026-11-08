/** Выход рецепта за одну обработку. */
export interface RecipeOutputConfig {
  /** ID выпускаемого материала. */
  materialId: string;
  /** Целый положительный выпуск в десятичной строке. */
  quantity: string;
}
