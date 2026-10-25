import type {DeepReadonly, RunConfig} from '../engine/config';
import type {RunnerView} from '../runner/runner';
import {flowReport} from '../engine/flow-report';
import {quantityText} from './diagram';
import {durationText} from './metric-format';
import {lostProcessingMs, minutesText} from './quality';
import type {ExampleId} from './preview';
import {nameFor} from './i18n';
import type {Labels, Language} from './i18n';

export function ExperimentResult({run, view, example, text, language}: {
  run: RunConfig; view: DeepReadonly<RunnerView>; example: ExampleId; text: Labels; language: Language;
}) {
  const report = flowReport(run, view.model);
  const name = (id: string) => nameFor(id, run.source.materials.find(m => m.id === id)!.name, text);
  const reason = view.status === 'finished' ? text.endedHorizon : view.status === 'stopped' ? text.endedStopped : view.status === 'error' ? text.endedError : text.currentResult;
  return <section className="simple-only experiment-result" aria-labelledby="experiment-result-title" data-testid="experiment-result">
    <h2 id="experiment-result-title">{text.simpleResult}</h2>
    <p>{reason} {!report.complete && text.incompleteResult} {text.actualInterval}: {durationText(0)} → {durationText(report.timeMs)}.</p>
    {view.error && <p role="alert" className="run-error">{view.error.messages[language]}</p>}
    <div className="result-columns"><div><h3>{text.goodOutput}, {text.unit}</h3><dl>{report.products.map(product => <div key={product.materialId}><dt>{name(product.materialId)}</dt><dd data-simple-output={product.materialId}>{quantityText(product.delivered)}</dd></div>)}</dl></div>
      <div><h3>{text.simpleWip}, {text.unit}</h3><dl>{report.materials.map(row => <div key={row.materialId}><dt>{name(row.materialId)}</dt><dd data-simple-wip={row.materialId}>{quantityText(row.total)}</dd></div>)}</dl></div></div>
    <p className="summary-help">{text.simpleWipHelp}</p>
    {example === 'blocking' && <p>{text.blockedAtPreparation}: <strong>{durationText(view.model.stations.find(s => s.stationId === 'prep')!.timeByState.blockedMs)}</strong></p>}
    {example === 'plans' && <p>{text.planSetupTime}: <strong>{durationText(view.model.stations.find(s => s.stationId === 'planner')!.timeByState.setupMs)}</strong></p>}
    {example === 'quality' && <><p>{text.detectedScraps}: <strong>{quantityText(view.model.line!.scraps.reduce((sum, scrap) => sum + BigInt(scrap.quantity), 0n).toString())} {text.unit}</strong></p><p>{text.processingLossAtWork}: <strong>{minutesText(lostProcessingMs(view.model, 'work'))} {text.minutes}</strong></p></>}
  </section>;
}
