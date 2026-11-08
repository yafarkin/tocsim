import type {ProductionLocation} from './ProductionLocation.js';

/** Запас материала в одном месте линии. */
export interface PlaceStock {
  /** ID владельца места. */
  ownerId: string;
  /** ID материала. */
  materialId: string;
  /** Стадия внутри линии или общий сырьевой склад. */
  location: ProductionLocation | 'warehouse';
  /** Количество в микроединицах, десятичная строка. */
  quantity: string;
}
