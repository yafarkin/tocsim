/** Обоснование вместимости входа, вычисленной от доли смены. */
export interface BufferCalculation {
  /** ID поста. */
  stationId: string;
  /** ID материала. */
  materialId: string;
  /** Исходная доля смены в десятичной строке. */
  shifts: string;
  /** Длительность нормативного цикла в мс, строка. */
  cycleWorkMs: string;
  /** Расход за цикл в микроединицах, строка. */
  cycleConsumption: string;
  /** Округлённая вместимость в микроединицах. */
  roundedQuantity: number;
  /** Минимальный комплект одной обработки в микроединицах. */
  minimumKit: number;
  /** true, если вместимость пришлось поднять до минимального комплекта. */
  raisedToKit: boolean;
}
