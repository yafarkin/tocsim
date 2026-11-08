/** Перемещение материала внутри линии или на рынок за текущую отметку. */
export interface LineTransferSnapshot {
  /** ID поста-отправителя. */
  fromId: string;
  /** ID поста-получателя или market. */
  toId: string;
  /** Место, из которого взята партия. */
  fromLocation: 'held' | 'output' | 'reserved';
  /** ID материала. */
  materialId: string;
  /** Количество в микроединицах. */
  quantity: number;
  /** Стоимость перемещённой партии в микроденежных единицах, строка. */
  cost: string;
  /** buffer — выгрузка, route — маршрут, sale — продажа, scrap — списание. */
  kind: 'buffer' | 'route' | 'sale' | 'scrap';
}
