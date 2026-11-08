/** Входной материал поста и нехватка комплекта. */
export interface StationInputSnapshot {
  /** ID входного материала. */
  materialId: string;
  /** Количество во входном буфере в микроединицах. */
  quantity: number;
  /** Недостающее для ближайшей обработки количество в микроединицах. */
  missingQuantity: number;
  /** Зарезервированное для операции количество в микроединицах. */
  reservedQuantity: number;
}
