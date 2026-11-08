/** Начальный запас в нормализованной расчётной конфигурации. */
export interface ResolvedInitialStock {
  /** ID записи. */
  id: string;
  /** ID владельца или warehouse. */
  ownerId: string;
  /** Место начального хранения. */
  location: 'warehouse' | 'input' | 'output';
  /** ID материала. */
  materialId: string;
  /** Количество в микроединицах. */
  quantity: number;
  /** Стоимость в bigint микроденежных единицах. */
  cost: bigint;
}
