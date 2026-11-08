/** Буфер без явного ограничения вместимости. */
export interface InfiniteBufferConfig {
  /** Признак неограниченного буфера; числовое поле quantity отсутствует. */
  kind: 'infinite';
}
