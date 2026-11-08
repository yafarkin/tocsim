import type {FinancialReport} from './reports/FinancialReport.js';
import type {FlowReport} from './reports/FlowReport.js';
import type {InvestmentReport} from './reports/InvestmentReport.js';
import type {LittleLawReport} from './reports/LittleLawReport.js';

/** Набор производных отчётов, вычисленных из одного итогового Snapshot. */
export interface EngineRunReports {
  /** Выпуск, поставки и физические запасы. */
  flow: FlowReport;
  /** Сохранение потока и приближение закона Литтла. */
  littleLaw: LittleLawReport;
  /** Выручка, throughput, расходы и прибыль. */
  financial: FinancialReport;
  /** Запасы, капитал и доходность за период. */
  investment: InvestmentReport;
}
