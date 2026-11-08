/** Нормализованная конечная вместимость буфера. */
export interface ResolvedQuantityBuffer {
  /** Признак конечной вместимости. */
  kind: 'quantity';
  /** Вместимость в целых микроединицах. */
  quantity: number;
}
