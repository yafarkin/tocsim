import {useState} from 'react';
import type {DeepReadonly, RunConfig} from '../engine/config';
import type {RunnerView} from '../runner/runner';
import {lostProcessingMs, minutesText} from './quality';
import {quantityText} from './diagram';
import {nameFor} from './i18n';
import type {Labels} from './i18n';

export function QualitySummary({run, view, text}: {run: RunConfig; view: DeepReadonly<RunnerView>; text: Labels}) {
  const [stationId, setStationId] = useState('work');
  const name = (id: string) => id === 'market' ? text.finalInspection : nameFor(id, run.source.stations.find(s => s.id === id)?.name ?? id, text);
  const counts = view.model.line!.inspections;
  const total = (key: 'checkedQuantity' | 'passedQuantity' | 'scrappedQuantity') => counts.reduce((sum, row) => sum + row[key], 0);
  const good = view.model.line!.counters.reduce((sum, row) => sum + row.sold, 0);
  return <section className="quality-summary" aria-labelledby="quality-summary-title">
    <h2 id="quality-summary-title">{text.qualityResults}</h2><p>{text.qualityResultHelp}</p>
    <dl className="quality-totals">
      <div><dt>{text.checked}</dt><dd data-quality-total="checked">{quantityText(total('checkedQuantity'))} {text.unit}</dd></div>
      <div><dt>{text.passedInspection}</dt><dd data-quality-total="passed">{quantityText(total('passedQuantity'))} {text.unit}</dd></div>
      <div><dt>{text.scrappedInspection}</dt><dd data-quality-total="rejected">{quantityText(total('scrappedQuantity'))} {text.unit}</dd></div>
      <div><dt>{text.goodOutput}</dt><dd data-quality-total="good">{quantityText(good)} {text.unit}</dd></div>
    </dl>
    <div className="quality-loss"><label>{text.lossStation}<select aria-label={text.lossStation} value={stationId} onChange={e => setStationId(e.target.value)}>{run.source.stations.map(s => <option key={s.id} value={s.id}>{name(s.id)}</option>)}</select></label>
      <p><strong>{text.lostTime}: <span data-quality-lost-ms={String(lostProcessingMs(view.model, stationId))}>{minutesText(lostProcessingMs(view.model, stationId))} {text.minutes}</span></strong></p>
    </div>
    <p>{text.qualityLossHelp}</p>
    {view.model.line!.scraps.length ? <div className="table-scroll" tabIndex={0} role="region" aria-label={text.detectedScraps}><table><caption>{text.detectedScraps}</caption><thead><tr><th>{text.qualitySource}</th><th>{text.detectedAt}</th><th>{text.material}</th><th>{text.scrappedAmount}, {text.unit}</th><th>{text.lostTime} ({name(stationId)}), {text.minutes}</th></tr></thead><tbody>
      {view.model.line!.scraps.map((scrap, index) => <tr key={index}><td>{scrap.defectSourceIds.map(name).join(', ')}</td><td>{name(scrap.detectedAtId)}</td><td>{nameFor(scrap.materialId, run.source.materials.find(m => m.id === scrap.materialId)!.name, text)}</td><td>{quantityText(scrap.quantity)}</td><td>{minutesText(BigInt(Object.hasOwn(scrap.processingMs, stationId) ? scrap.processingMs[stationId]! : '0'))}</td></tr>)}
    </tbody></table></div> : <p>{text.noDetectedScraps}</p>}
  </section>;
}
