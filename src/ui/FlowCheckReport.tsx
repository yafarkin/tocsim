import type {DeepReadonly, RunConfig} from '../engine/config';
import {flowIdentityReport} from '../engine/flow-identity';
import type {RunnerView} from '../runner/runner';
import {quantityText} from './diagram';
import type {Labels} from './i18n';
import {durationText, flowRatioText, meanDurationText} from './metric-format';

type Props = {run: RunConfig; view: DeepReadonly<RunnerView>; text: Labels};
export function FlowCheckReport({run, view, text}: Props) {
  const exact = flowIdentityReport(run, view.model), report = view.flowReport;
  const unavailable = text.notCalculated;
  const area = (value: string | null) => flowRatioText(value === null ? null : {numerator: value, denominator: '1'}, unavailable, 1n, 60_000_000_000n);
  const scales = ['calendar', 'work'] as const;
  const tableHead = <thead><tr><th scope="col">{text.chartValues}</th><th scope="col">{text.chartCalendar}</th><th scope="col">{text.chartWork}</th></tr></thead>;
  const counts = (rows: readonly (readonly [string, string])[]) => <dl className="metric-periods flow-counts">{rows.map(([label, value]) => <div key={label}><dt>{label}, {text.unit}</dt><dd>{quantityText(value)}</dd></div>)}</dl>;
  return <details className="flow-check-report" data-testid="flow-check-report" data-flow-applicable={exact.applicable}>
    <summary>{text.flowCheck}</summary>
    {!exact.applicable ? <>
      <p className="chart-limitation" data-flow-unavailable={exact.reason}>{text.flowUnavailable} {exact.reason === 'assembly' ? text.cfdAssemblyReason : exact.reason === 'quantityChange' ? text.cfdQuantityReason : exact.reason === 'mixedProducts' ? text.cfdProductsReason : text.flowQualityReason}</p>
      <p>{text.flowAvailableReports}</p>
    </> : <>
      <p>{text.flowBoundary}</p>
      <section className="metric-section" aria-labelledby="flow-exact-title">
        <h3 id="flow-exact-title">{text.flowExact}</h3><p>{text.flowExactHelp}</p>
        <p>{text.flowWindow}: {durationText(0)} → {durationText(view.model.timeMs)} ({text.chartCalendar}).</p>
        <dl className="metric-periods"><div><dt>{text.calendarPeriod}</dt><dd>{durationText(exact.calendarMs)}</dd></div><div><dt>{text.commonWorkPeriod}</dt><dd>{durationText(exact.workMs)}</dd></div></dl>
        <p data-flow-exact={exact.consistent} role={exact.consistent ? undefined : 'alert'}>{exact.consistent ? text.flowExactMatch : text.flowExactMismatch}</p>
        <p data-flow-quantity-difference={exact.quantityDifference}>{text.flowQuantityBalance}: {quantityText(exact.initialQuantity)} + {quantityText(exact.admittedQuantity)} − {quantityText(exact.exitedQuantity)} − {quantityText(exact.remainingQuantity)} = {flowRatioText({numerator:exact.quantityDifference,denominator:'1'},unavailable,1n,1_000_000n)} {text.unit}.</p>
        <div className="table-scroll" tabIndex={0} role="region" aria-label={text.flowExact}><table className="metric-table"><caption>{text.flowExact}, {text.flowAreaUnit}</caption>{tableHead}<tbody>
          {([['integralQuantityMs',text.flowArea],['clippedResidenceQuantityMs',text.flowResidence],['differenceQuantityMs',text.flowExactDifference]] as const).map(([key,label]) => <tr key={key}><th scope="row">{label}</th>{scales.map(scale => <td key={scale} data-flow-exact-field={key} data-flow-scale={scale} data-exact-value={exact[scale][key]}>{area(exact[scale][key])}</td>)}</tr>)}
        </tbody></table></div>
      </section>
      <section className="metric-section" aria-labelledby="flow-little-title">
        <h3 id="flow-little-title">{text.flowApproximation}</h3><p>{text.flowApproximationHelp}</p>
        <p>{text.flowWarmup}: {durationText(run.resolved.warmupMs)} ({text.chartCalendar}).</p>
        {!report.applicable ? <p data-flow-warmup-pending>{text.flowWarmupPending}</p> : <>
          <p>{text.flowWindow}: {durationText(report.fromMs)} → {durationText(report.toMs)} ({text.chartCalendar}).</p>
          <dl className="metric-periods">{scales.map(scale => <div key={scale}><dt>{scale === 'calendar' ? text.calendarPeriod : text.commonWorkPeriod}</dt><dd data-flow-period={scale}>{durationText(report[scale].durationMs)}</dd></div>)}</dl>
          {counts([[text.flowStartQuantity,report.initialQuantity],[text.flowAdmitted,report.admittedQuantity],[text.flowExited,report.exitedQuantity],[text.flowRemaining,report.remainingQuantity],[text.flowKnownCompleted,report.knownCompletedQuantity],[text.flowUnknownCompleted,report.unknownCompletedQuantity]])}
          <p data-flow-window-exact={report.consistent} role={report.consistent ? undefined : 'alert'}>{report.consistent ? text.flowExactMatch : text.flowExactMismatch}</p>
          {scales.map(scale => {
            const reason = report[scale].approximationUnavailable;
            return reason && <p key={scale} data-flow-no-approximation={reason} data-flow-scale={scale}><strong>{scale === 'calendar' ? text.chartCalendar : text.chartWork}:</strong> {reason === 'zeroPeriod' ? text.flowZeroPeriod : reason === 'noCompletions' ? text.flowNoCompletions : text.flowUnknownHistory}</p>;
          })}
          <div className="table-scroll" tabIndex={0} role="region" aria-label={text.flowApproximation}><table className="metric-table"><caption>{text.flowApproximation}</caption>{tableHead}<tbody>
            {([['L',text.flowMeanQuantity],['lambda',text.flowRate],['W',text.flowMeanTime],['lambdaW',text.flowProduct],['approximationDifference',text.flowApproxDifference]] as const).map(([key,label]) => <tr key={key}><th scope="row">{label}</th>{scales.map(scale => {
              const value = report[scale][key];
              const formatted = key === 'W' ? (value ? meanDurationText(value.numerator,value.denominator,unavailable) : unavailable)
                : flowRatioText(value,unavailable,key === 'lambda' ? 60_000n : 1n,1_000_000n);
              return <td key={scale} data-flow-metric={key} data-flow-scale={scale} data-numerator={value?.numerator} data-denominator={value?.denominator}>{formatted}</td>;
            })}</tr>)}
          </tbody></table></div>
          {(report.emptyStart || report.hasRemaining) && <p className="summary-help">{report.emptyStart && text.flowEmptyStart} {report.hasRemaining && text.flowOpenEnd}</p>}
          <details className="flow-edge-details"><summary>{text.flowEdges}</summary><p>{text.flowEdgesHelp}</p>
            <div className="table-scroll" tabIndex={0} role="region" aria-label={text.flowEdges}><table className="metric-table"><caption>{text.flowEdges}, {text.flowAreaUnit}</caption>{tableHead}<tbody>
              {([['integralQuantityMs',text.flowWindowArea],['clippedResidenceQuantityMs',text.flowWindowResidence],['exactDifferenceQuantityMs',text.flowExactDifference],['completedResidenceQuantityMs',text.flowCompletedResidence],['remainingClippedQuantityMs',text.flowRemainingResidence],['completedBeforeWindowQuantityMs',text.flowBeforeWindow],['edgeCorrectionQuantityMs',text.flowCorrection],['correctedResidenceQuantityMs',text.flowCorrected]] as const).map(([key,label]) => <tr key={key}><th scope="row">{label}</th>{scales.map(scale => <td key={scale} data-flow-edge={key} data-flow-scale={scale} data-exact-value={report[scale][key] ?? undefined}>{area(report[scale][key])}</td>)}</tr>)}
            </tbody></table></div>
            {scales.map(scale => <p key={scale} data-flow-corrected={String(report[scale].correctedMatches)} data-flow-scale={scale}><strong>{scale === 'calendar' ? text.chartCalendar : text.chartWork}:</strong> {report[scale].correctedMatches === null ? text.flowCorrectionUnknown : report[scale].correctedMatches ? text.flowCorrectionMatch : text.flowExactMismatch}</p>)}
          </details>
        </>}
        <p className="summary-help">{text.flowNoStationarity}</p>
      </section>
      <p className="summary-help">{text.flowRounding} {text.flowTimeScrollHelp}</p>
    </>}
  </details>;
}
