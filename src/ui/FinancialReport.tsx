import {ArithmeticError} from '../engine/arithmetic';
import {financialReport} from '../engine/financial-report';
import type {DeepReadonly, RunConfig} from '../engine/config';
import type {Snapshot} from '../engine/state';
import type {Labels} from './i18n';

export function moneyText(value: string): string {
  const n = BigInt(value), absolute = n < 0n ? -n : n;
  const cents = (absolute + 5_000n) / 10_000n;
  return `${n < 0n && cents !== 0n ? '−' : ''}${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
}
export function FinancialReport({run, model, text}: {run: RunConfig; model: DeepReadonly<Snapshot>; text: Labels}) {
  let report;
  try {report = financialReport(run, model);} catch (error) {
    if (!(error instanceof ArithmeticError)) throw error;
    return <details className="financial-report"><summary>{text.financialResult}</summary><p role="alert">{text.financialRange}</p></details>;
  }
  const rows = ['revenue', 'tvcSold', 'throughput', 'scrapExpense', 'fixedExpense', 'lunchExpense', 'operatingExpense', 'netProfit'] as const;
  return <details className="financial-report" data-testid="financial-report">
    <summary>{text.financialResult}</summary><p>{text.financialHelp}</p>
    {!report.complete && <p>{text.incompleteResult}</p>}
    <div className="table-scroll" tabIndex={0} role="region" aria-label={text.financialResult}><table>
      <caption>{text.financialResult}, {text.moneyUnit}</caption>
      <thead><tr><th>{text.financialResult}</th><th>{text.financialAmount}</th></tr></thead>
      <tbody>{rows.map(key => <tr key={key}><th scope="row">{text[key]}</th><td data-money={key}>{moneyText(report[key])}</td></tr>)}</tbody>
    </table></div><p className="summary-help">{text.financialLimits}</p>
  </details>;
}
