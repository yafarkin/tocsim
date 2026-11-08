/** Запас конкретного материала в конкретном месте в точке истории. */
export interface FlowPlaceValue {
  /** ID владельца места. */
  ownerId: string;
  /** ID материала. */
  materialId: string;
  /** Место внутри линии, исключая общий склад. */
  location: 'input' | 'output' | 'held' | 'reserved';
  /** Количество в микроединицах, десятичная строка. */
  quantity: string;
}
