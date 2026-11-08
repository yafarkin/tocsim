import type {InvestmentAverage} from './InvestmentAverage.js';
import type {InvestmentRoi} from './InvestmentRoi.js';

/** Вложения и доходность за фактический календарный период. */
export interface InvestmentReport {
  /** Наблюдаемая календарная длительность в мс. */
  calendarMs: number;
  /** true только после полного горизонта. */
  complete: boolean;
  /** Капитал постов в микроденежных единицах, строка. */
  capital: string;
  /** Текущая стоимость запасов в микроденежных единицах, строка. */
  stockCost: string;
  /** Сумма капитала и текущих запасов в микроденежных единицах, строка. */
  totalCost: string;
  /** Средняя стоимость запасов или null при нулевом периоде. */
  stockAverage: InvestmentAverage | null;
  /** Средние общие вложения или null при нулевом периоде. */
  totalAverage: InvestmentAverage | null;
  /** Чистая прибыль в микроденежных единицах, строка. */
  netProfit: string;
  /** Доходность за период или null при нулевом периоде/вложениях. */
  roi: InvestmentRoi | null;
}
