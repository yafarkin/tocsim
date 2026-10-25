import {memo, useCallback, useEffect, useState} from 'react';
import {compileConfig, ConfigError} from '../engine/config';
import type {BufferConfig, EditorConfig, InputBufferConfig, OutputBufferConfig, RunConfig, ShiftBufferConfig} from '../engine/config';
import {bufferSettings, withBuffers, simpleInputRule} from './buffers';
import type {BufferSettings} from './buffers';
import {quantityText} from './diagram';
import {nameFor} from './i18n';
import type {Labels, Language} from './i18n';
import type {UiMode} from './ui-mode';
import {useModeDisclosure} from './ui-mode';
type Rule = BufferConfig | ShiftBufferConfig;
function RuleFields({value, input, label, text, onChange}: {value: Rule; input: boolean; label: string; text: Labels; onChange: (rule: Rule) => void}) {
  return <div className="buffer-rule"><label>{label}<select aria-label={label} value={value.kind} onChange={e => onChange(e.target.value === 'shift' ? {kind: 'shift', shifts: '0.5'} : e.target.value === 'infinite' ? {kind: 'infinite'} : {kind: 'quantity', quantity: '0'})}>
    <option value="quantity">{text.quantity}</option>{input && <option value="shift">{text.shiftFraction}</option>}<option value="infinite">{text.infinite}</option>
  </select></label>{value.kind !== 'infinite' && <label>{value.kind === 'shift' ? text.shiftFraction : text.quantity}<input aria-label={`${label}: ${value.kind === 'shift' ? text.shiftFraction : text.quantity}`} inputMode="decimal" value={value.kind === 'shift' ? value.shifts : value.quantity} onChange={e => onChange(value.kind === 'shift' ? {kind: 'shift', shifts: e.target.value} : {kind: 'quantity', quantity: e.target.value})}/></label>}</div>;
}
function StationFields({value, input, materials, text, label, onChange}: {value: InputBufferConfig | OutputBufferConfig; input: boolean; materials: {id: string; name: string}[]; text: Labels; label: string; onChange: (rule: InputBufferConfig) => void}) {
  return <div className="station-buffer-fields"><label>{label}<select aria-label={label} value={value.kind} onChange={e => onChange(e.target.value === 'materials' ? {kind: 'materials', materials: materials.map(m => ({materialId: m.id, capacity: {kind: 'quantity', quantity: '30'}}))} : e.target.value === 'inherit' ? {kind: 'inherit'} : e.target.value === 'shift' ? {kind: 'shift', shifts: '0.5'} : e.target.value === 'infinite' ? {kind: 'infinite'} : {kind: 'quantity', quantity: '30'})}>
    <option value="inherit">{text.inherit}</option><option value="quantity">{text.quantity}</option>{input && <option value="shift">{text.shiftFraction}</option>}<option value="materials">{text.byMaterial}</option><option value="infinite">{text.infinite}</option>
  </select></label>
    {value.kind === 'materials' ? value.materials.map((m, i) => <RuleFields key={m.materialId} value={m.capacity} input={false} label={`${label}: ${materials.find(x => x.id === m.materialId)!.name}`} text={text} onChange={rule => onChange({...value, materials: value.materials.map((entry, j) => j === i ? {...entry, capacity: rule as BufferConfig} : entry)})}/>) : value.kind !== 'inherit' && value.kind !== 'infinite' && <label>{value.kind === 'shift' ? text.shiftFraction : text.quantity}<input aria-label={`${label}: ${value.kind === 'shift' ? text.shiftFraction : text.quantity}`} inputMode="decimal" value={value.kind === 'shift' ? value.shifts : value.quantity} onChange={e => onChange(value.kind === 'shift' ? {kind: 'shift', shifts: e.target.value} : {kind: 'quantity', quantity: e.target.value})}/></label>}
  </div>;
}
function attempt(config: EditorConfig): {run: RunConfig; error?: never} | {run?: never; error: ConfigError} {
  try {return {run: compileConfig(config)};} catch (error) {if (error instanceof ConfigError) return {error}; throw error;}
}
function Amounts({run, id, text}: {run: RunConfig; id: string; text: Labels}) {
  const station = run.resolved.stations.find(s => s.id === id)!;
  const name = (id: string) => {const m = run.source.materials.find(m => m.id === id)!; return nameFor(id, m.name, text);};
  return <>{(['input', 'output'] as const).map(direction => <div key={direction}><strong>{text[direction]}: </strong>{station[direction === 'input' ? 'inputBuffers' : 'outputBuffers'].map(b => `${name(b.materialId)} ${b.capacity.kind === 'infinite' ? '∞' : quantityText(b.capacity.quantity)}`).join('; ')}</div>)}{run.bufferCalculations.filter(c => c.stationId === id).map(c => <div className="buffer-calculation" key={c.materialId}>{name(c.materialId)}: {text.calculated} {quantityText(c.roundedQuantity)}; {text.minimumKit} {quantityText(c.minimumKit)}{c.raisedToKit && <strong> · {text.raisedKit}</strong>}</div>)}</>;
}
function StationEditor({run, id, settings, text, language, onApply, mode, simple, onIssue}: {mode: UiMode; simple: boolean; onIssue: (id: string, issue: string) => void; run: RunConfig; id: string; settings: BufferSettings; text: Labels; language: Language; onApply: (settings: BufferSettings) => void}) {
  const [draft, setDraft] = useState(() => structuredClone(settings.stations[id]!));
  const disclosure = useModeDisclosure(simple ? mode : 'expert');
  const station = run.source.stations.find(s => s.id === id)!, name = nameFor(id, station.name, text);
  const candidate = {...settings, stations: {...settings.stations, [id]: draft}}, preview = attempt(withBuffers(structuredClone(run.source) as EditorConfig, candidate));
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings.stations[id]);
  const resolved = run.resolved.stations.find(s => s.id === id)!;
  const materialNames = (direction: 'input' | 'output') => resolved[direction === 'input' ? 'inputBuffers' : 'outputBuffers'].map(b => {const m = run.source.materials.find(m => m.id === b.materialId)!; return {id: m.id, name: nameFor(m.id, m.name, text)};});
  const issue = preview.error?.messages[language] ?? '';
  useEffect(() => onIssue(id, issue), [id, issue, onIssue]);
  const canEdit = draft.input.kind === 'materials' || resolved.inputBuffers.length === 1;
  return <details className={`station-buffer-editor ${simple ? 'simple-buffer-target' : 'expert-only'}`} {...disclosure}><summary>{name} · {text.input}: {draft.input.kind === 'inherit' ? text.inherit : text.own} · {text.output}: {draft.output.kind === 'inherit' ? text.inherit : text.own}</summary>
    <div className="buffer-fields-grid expert-only">
    <StationFields value={draft.input} input materials={materialNames('input')} text={text} label={`${name}: ${text.input}`} onChange={input => setDraft({...draft, input})}/>
    <StationFields value={draft.output} input={false} materials={materialNames('output')} text={text} label={`${name}: ${text.output}`} onChange={output => setDraft({...draft, output: output as OutputBufferConfig})}/>
    </div>
    {simple && <div className="simple-only simple-buffer-fields"><h4>{name}: {text.experimentCapacity}</h4><p>{text.simpleBufferHelp}</p>
      {resolved.inputBuffers.map(buffer => {
        const rule = draft.input.kind === 'materials' ? draft.input.materials.find(m => m.materialId === buffer.materialId)?.capacity : draft.input;
        const material = materialNames('input').find(m => m.id === buffer.materialId)!;
        const previewCapacity = preview.run?.resolved.stations.find(s => s.id === id)!.inputBuffers.find(b => b.materialId === buffer.materialId)?.capacity;
        return <label key={buffer.materialId}>{material.name}, {text.unit}<input aria-label={`${name}: ${material.name}, ${text.unit}`} inputMode="decimal" disabled={!canEdit} value={rule?.kind === 'quantity' ? rule.quantity : ''} placeholder={rule ? text[rule.kind === 'inherit' ? 'inherit' : rule.kind === 'infinite' ? 'infinite' : 'shiftFraction'] : ''} onChange={e => setDraft({...draft, input: simpleInputRule(draft.input, buffer.materialId, e.target.value, resolved.inputBuffers.length)})}/>
          {rule?.kind !== 'quantity' && <span>{text.bufferPreview}: {rule?.kind === 'inherit' ? text.inherit : rule?.kind === 'infinite' ? text.infinite : text.shiftFraction}; {text.calculated}: {previewCapacity ? previewCapacity.kind === 'infinite' ? '∞' : quantityText(previewCapacity.quantity) : text.notCalculated}. {canEdit ? text.replaceBufferRule : text.commonBufferRule}</span>}</label>;
      })}
    </div>}
    {preview.error ? <p role="alert" className="buffer-error">{preview.error.messages[language]} <span className="expert-only">{preview.error.path}</span></p> : <div className="expert-only" aria-live="polite"><p>{text.bufferPreview}</p><Amounts run={preview.run} id={id} text={text}/></div>}
    <button type="button" disabled={!dirty || !!preview.error} onClick={() => onApply(candidate)}>{text.applyStation}: {name}</button>{dirty && <p className="simple-only">{text.unappliedSettings}</p>}
  </details>;
}
export const BufferPanel = memo(function BufferPanel({run, locked, text, language, onApply, mode = 'expert', simpleStationId}: {mode?: UiMode; simpleStationId?: string | undefined; run: RunConfig; locked: boolean; text: Labels; language: Language; onApply: (settings: BufferSettings) => void}) {
  const settings = bufferSettings(run.source);
  const disclosure = useModeDisclosure(simpleStationId ? mode : 'expert');
  const [issues, setIssues] = useState<Record<string, string>>({});
  const reportIssue = useCallback((id: string, issue: string) => setIssues(previous => previous[id] === issue ? previous : {...previous, [id]: issue}), []);
  const [defaults, setDefaults] = useState(settings.defaults);
  const candidate = {...settings, defaults};
  const updated = attempt(withBuffers(structuredClone(run.source) as EditorConfig, candidate));
  const reset = attempt(withBuffers(structuredClone(run.source) as EditorConfig, candidate, true));
  const changed = (next: RunConfig | undefined) => next ? run.source.stations.filter(s => JSON.stringify({input: s.inputBuffer, output: s.outputBuffer, resolved: [run.resolved.stations.find(x => x.id === s.id)!.inputBuffers, run.resolved.stations.find(x => x.id === s.id)!.outputBuffers]}) !== JSON.stringify({input: next.source.stations.find(x => x.id === s.id)!.inputBuffer, output: next.source.stations.find(x => x.id === s.id)!.outputBuffer, resolved: [next.resolved.stations.find(x => x.id === s.id)!.inputBuffers, next.resolved.stations.find(x => x.id === s.id)!.outputBuffers]})).map(s => nameFor(s.id, s.name, text)).join(', ') || text.noChanges : '—';
  const apply = (next: RunConfig) => onApply(bufferSettings(next.source));
  const hiddenIssues = [updated.error?.messages[language], reset.error?.messages[language], ...Object.entries(issues).filter(([id]) => id !== simpleStationId).map(([id, issue]) => issue ? `${nameFor(id, run.source.stations.find(s => s.id === id)!.name, text)}: ${issue}` : '')].filter(Boolean);
  return <><details className={`batch-editor buffer-editor ${simpleStationId ? 'has-simple-buffers' : 'expert-only'}`} {...disclosure}><summary>{text.bufferSettings}</summary><fieldset className="batch-settings" disabled={locked}>
    <legend>{text.bufferSettings}</legend><div className="expert-only"><p>{locked ? text.bufferLocked : text.bufferHelp}</p><p>{text.calculationHelp}</p>
    <h3>{text.globalBuffers}</h3><div className="buffer-fields-grid"><RuleFields value={defaults.input ?? {kind: 'shift', shifts: '0.5'}} input label={`${text.globalBuffers}: ${text.input}`} text={text} onChange={input => setDefaults({...defaults, input})}/>
    <RuleFields value={defaults.output ?? {kind: 'quantity', quantity: '0'}} input={false} label={`${text.globalBuffers}: ${text.output}`} text={text} onChange={output => setDefaults({...defaults, output: output as BufferConfig})}/>
    </div>
    <div className="buffer-actions"><div><p><strong>{text.updateInherited}</strong><br/>{text.changedStations}: {changed(updated.run)}</p><button type="button" disabled={!!updated.error} onClick={() => updated.run && apply(updated.run)}>{text.updateInherited}</button></div><div><p><strong>{text.resetBuffers}</strong><br/>{text.changedStations}: {changed(reset.run)}</p><button type="button" disabled={!!reset.error} onClick={() => reset.run && apply(reset.run)}>{text.resetBuffers}</button></div></div>
    {[updated.error, reset.error].map((error, i) => error && <p key={i} role="alert" className="buffer-error">{i === 0 ? text.afterUpdate : text.afterReset}: {error.messages[language]} <span>{error.path}</span></p>)}
    <div className="table-scroll" tabIndex={0} role="region" aria-label={text.bufferPreview}><table aria-label={text.bufferPreview}><thead><tr><th>{text.state}</th><th>{text.current}</th><th>{text.afterUpdate}</th><th>{text.afterReset}</th></tr></thead><tbody>{run.source.stations.map(s => <tr key={s.id}><th>{nameFor(s.id, s.name, text)}<span>{text.input}: {s.inputBuffer.kind === 'inherit' ? text.inherit : text.own}<br/>{text.output}: {s.outputBuffer.kind === 'inherit' ? text.inherit : text.own}</span></th><td><Amounts run={run} id={s.id} text={text}/></td><td>{updated.run ? <Amounts run={updated.run} id={s.id} text={text}/> : '—'}</td><td>{reset.run ? <Amounts run={reset.run} id={s.id} text={text}/> : '—'}</td></tr>)}</tbody></table></div>
    </div>
    {run.source.stations.map(s => <StationEditor key={`${s.id}-${JSON.stringify(settings.stations[s.id])}`} run={run} id={s.id} settings={settings} text={text} language={language} onApply={onApply} mode={mode} simple={s.id === simpleStationId} onIssue={reportIssue}/>)}
  </fieldset></details>{hiddenIssues.length > 0 && <div className="simple-only settings-errors" role="alert">{[...new Set(hiddenIssues)].map(issue => <p key={issue}>{issue}</p>)}<p>{text.hiddenErrorHelp}</p></div>}</>;
});
