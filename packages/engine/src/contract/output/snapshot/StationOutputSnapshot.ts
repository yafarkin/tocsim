/** Выходной материал поста в буфере и на удержании. */
export interface StationOutputSnapshot {
  /** ID выходного материала. */
  materialId: string;
  /** Количество в выходном буфере в микроединицах. */
  quantity: number;
  /** Количество, ожидающее выгрузки на посту, в микроединицах. */
  heldQuantity: number;
}
