/** Затраты поста в bigint микроденежных единицах. */
export interface ResolvedStationCosts {
  /** Затраты за смену. */
  perShift: bigint;
  /** Затраты за час работы в обед. */
  perLunchHour: bigint;
  /** Вложенный капитал. */
  capital: bigint;
}
