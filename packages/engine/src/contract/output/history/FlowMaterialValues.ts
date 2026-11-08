/** Материальный поток одного материала в одной точке истории; количества — строки микроединиц. */
export interface FlowMaterialValues {
  /** ID материала. */
  materialId: string;
  /** Входной буфер. */
  input: string;
  /** Зарезервировано для операций. */
  reserved: string;
  /** Удерживается до выгрузки. */
  held: string;
  /** Выходной буфер. */
  output: string;
  /** Сумма input, reserved, held и output без двойного счёта. */
  wip: string;
  /** Выпущено источниками. */
  released: string;
  /** Произведено. */
  produced: string;
  /** Потреблено. */
  consumed: string;
  /** Принято рынком годного материала. */
  delivered: string;
  /** Списано. */
  scrapped: string;
}
