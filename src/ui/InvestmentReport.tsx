import {ArithmeticError} from '../engine/arithmetic';
import type {DeepReadonly, RunConfig} from '../engine/config';
import {investmentReport} from '../engine/investment-report';
import type {Snapshot} from '../engine/state';
import type {Labels} from './i18n';
import {investmentAverageText, investmentMoneyText, investmentRoiText} from './metric-format';

export function InvestmentReport({run, model, text}: {run: RunConfig; model: DeepReadonly<Snapshot>; text: Labels}) {
  let report;
  try {report = investmentReport(run, model);} catch (error) {
    if (!(error instanceof ArithmeticError)) throw error;
    return <details className="investment-report" data-testid="investment-report"><summary>{text.investments}</summary><p role="alert">{text.financialRange}</p></details>;
  }
  const rows = [
    ['currentStockValue', investmentMoneyText(report.stockCost)],
    ['stationCapital', investmentMoneyText(report.capital)],
    ['currentInvestment', investmentMoneyText(report.totalCost)],
    ['meanStockValue', investmentAverageText(report.stockAverage, text.investmentNoValue)],
    ['meanInvestment', investmentAverageText(report.totalAverage, text.investmentNoValue)],
  ] as const;
  return <details className="investment-report" data-testid="investment-report">
    <summary>{text.investments}</summary><p>{text.investmentPeriod}</p>
    {!report.complete && <p>{text.incompleteResult}</p>}
    <p>{text.investmentBoundary}</p>
    <div className="table-scroll" tabIndex={0} role="region" aria-label={text.investmentAmounts}><table className="metric-table">
      <caption>{text.investmentAmounts}, {text.moneyUnit}</caption>
      <thead><tr><th scope="col">{text.investmentAmounts}</th><th scope="col">{text.financialAmount}</th></tr></thead>
      <tbody>{rows.map(([key, amount]) => <tr key={key}><th scope="row">{text[key]}</th><td data-investment={key}>{amount}</td></tr>)}</tbody>
    </table></div>
    <p className="investment-roi"><strong>{text.periodRoi}:</strong> <span data-investment="roi">{investmentRoiText(report.roi, text.investmentNoValue)}</span></p>
    {report.roi === null && <p>{report.calendarMs === 0 ? text.investmentZeroPeriod : text.investmentZeroMean}</p>}
    <p>{text.investmentRoiHelp}</p><p className="summary-help">{text.investmentRounding}</p>
  </details>;
}
