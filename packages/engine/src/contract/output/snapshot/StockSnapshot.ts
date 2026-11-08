import type {ProvenanceSnapshot} from './ProvenanceSnapshot.js';

/** Физическая партия материала в итоговом JSON-снимке. */
export interface StockSnapshot {
  /** Стабильный ID партии внутри прогона. */
  id: string;
  /** ID поста-владельца или warehouse. */
  ownerId: string;
  /** Текущее физическое место партии. */
  location: 'warehouse' | 'input' | 'output' | 'held' | 'reserved';
  /** ID материала. */
  materialId: string;
  /** Количество в целых микроединицах. */
  quantity: number;
  /** Стоимость партии в целых микроденежных единицах, десятичная строка. */
  cost: string;
  /** Момент готовности к перемещению в мс модели. */
  readyAtMs: number;
  /** Происхождение, качество и приписанное время обработки. */
  provenance: ProvenanceSnapshot;
}
