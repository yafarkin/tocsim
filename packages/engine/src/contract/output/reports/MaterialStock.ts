/** Запасы материала по стадиям линии; все количества — строки микроединиц. */
export interface MaterialStock {
  /** ID материала. */
  materialId: string;
  /** Входные буферы. */
  input: string;
  /** Резерв для операций. */
  reserved: string;
  /** Удержание до выгрузки. */
  held: string;
  /** Выходные буферы. */
  output: string;
  /** Сумма всех четырёх стадий без общего склада. */
  total: string;
}
