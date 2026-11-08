/** Материал в нормализованной расчётной конфигурации. */
export interface ResolvedMaterial {
  /** ID материала. */
  id: string;
  /** Роль материала. */
  role: 'raw' | 'intermediate' | 'finished';
  /** Закупочная цена в bigint микроденежных единицах или null. */
  purchasePrice: bigint | null;
  /** Цена продажи в bigint микроденежных единицах или null. */
  salePrice: bigint | null;
}
