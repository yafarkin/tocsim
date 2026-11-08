/** Постоянная длительность без вариативности. */
export interface ConstantDistribution {
  /** Признак постоянной длительности. */
  kind: 'constant';
  /** Длительность в целых миллисекундах, не меньше 1. */
  timeMs: number;
}
