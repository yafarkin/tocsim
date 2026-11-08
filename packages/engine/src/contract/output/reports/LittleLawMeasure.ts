import type {FlowRatio} from './FlowRatio.js';

/** Проверка потока и приближение закона Литтла по одной шкале времени. */
export interface LittleLawMeasure {
  /** Начало окна в мс выбранной шкалы. */
  fromMs: number;
  /** Конец окна в мс выбранной шкалы. */
  toMs: number;
  /** Длительность окна в мс выбранной шкалы. */
  durationMs: number;
  /** Средний запас L как точная дробь. */
  L: FlowRatio | null;
  /** Средний темп выбытия λ как точная дробь. */
  lambda: FlowRatio | null;
  /** Среднее время W или null, если приближение недоступно. */
  W: FlowRatio | null;
  /** Произведение λW или null. */
  lambdaW: FlowRatio | null;
  /** Причина недоступности приближения или null. */
  approximationUnavailable: 'zeroPeriod' | 'noCompletions' | 'unknownHistory' | null;
  /** Интеграл остатка в микроединицах × мс, строка. */
  integralQuantityMs: string;
  /** Сумма времени пребывания с ограничением окном, строка. */
  clippedResidenceQuantityMs: string;
  /** Разность интеграла и пребывания, строка. */
  exactDifferenceQuantityMs: string;
  /** true при точном совпадении интеграла и пребывания. */
  exactMatches: boolean;
  /** Пребывание завершённых изделий или null. */
  completedResidenceQuantityMs: string | null;
  /** Время оставшихся изделий с ограничением окном, строка. */
  remainingClippedQuantityMs: string;
  /** Поправка на завершённые до окна изделия или null. */
  completedBeforeWindowQuantityMs: string | null;
  /** Краевая поправка или null. */
  edgeCorrectionQuantityMs: string | null;
  /** Исправленная сумма пребывания или null. */
  correctedResidenceQuantityMs: string | null;
  /** Результат исправленной проверки или null, если неприменимо. */
  correctedMatches: boolean | null;
  /** Разность L и λW или null. */
  approximationDifference: FlowRatio | null;
}
