import type {LittleLawMeasure} from './LittleLawMeasure.js';

/** Полный отчёт для сопоставимого потока после достижения начала окна. */
export interface ApplicableLittleLawReport {
  /** Отчёт применим. */
  applicable: true;
  /** Причина отсутствует. */
  reason: null;
  /** Граница от поступления в линию до принятия рынком. */
  boundary: 'admissionToAcceptance';
  /** Единица количества. */
  quantityUnit: 'microQuantity';
  /** Начало окна в модельных мс. */
  fromMs: number;
  /** Конец окна в модельных мс. */
  toMs: number;
  /** Настроенная граница разогрева в модельных мс. */
  warmupMs: number;
  /** true после полного горизонта. */
  complete: boolean;
  /** Запас в начале окна в микроединицах, строка. */
  initialQuantity: string;
  /** Поступление за окно в микроединицах, строка. */
  admittedQuantity: string;
  /** Выбытие за окно в микроединицах, строка. */
  exitedQuantity: string;
  /** Остаток в конце окна в микроединицах, строка. */
  remainingQuantity: string;
  /** Завершено с известной историей, строка. */
  knownCompletedQuantity: string;
  /** Завершено с неизвестной историей, строка. */
  unknownCompletedQuantity: string;
  /** Разность баланса завершений, строка. */
  completedQuantityDifference: string;
  /** Разность общего материального баланса, строка. */
  quantityDifference: string;
  /** true при пустом начальном запасе. */
  emptyStart: boolean;
  /** true при наличии остатка в конце. */
  hasRemaining: boolean;
  /** Проверка по календарной шкале. */
  calendar: LittleLawMeasure;
  /** Проверка по рабочей шкале. */
  work: LittleLawMeasure;
  /** Общий результат всех проверок согласованности. */
  consistent: boolean;
}
