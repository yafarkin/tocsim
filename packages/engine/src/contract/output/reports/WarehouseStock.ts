/** Ненулевой остаток материала на общем сырьевом складе. */
export interface WarehouseStock {
  /** ID материала. */
  materialId: string;
  /** Количество в микроединицах, десятичная строка. */
  quantity: string;
}
