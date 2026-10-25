import type {DeepReadonly, InputBufferConfig, RunConfig} from '../engine/config';
import {previewConfig} from './preview';
import type {ExampleId} from './preview';
import {CV_PRESETS} from './DurationPanel';
import {durationText} from './metric-format';
import {nameFor} from './i18n';
import type {Labels} from './i18n';

/** Differences in applied settings that the short forms do not expose. */
export function advancedSettingKeys(run: RunConfig, example: ExampleId) {
  const baseline = previewConfig(example), current = run.source;
  const keys: ('seed' | 'hiddenBuffers' | 'hiddenVariability' | 'hiddenLunch' | 'hiddenMaintenance' | 'hiddenWarmup' | 'supplyB' | 'qualitySource')[] = [];
  if (current.seed !== baseline.seed) keys.push('seed');
  const buffers = (config: typeof current | typeof baseline) => ({defaults: config.bufferDefaults ?? {}, stations: config.stations.map(s => {
    const ordinary = baseline.stations.find(b => b.id === s.id)!;
    const shortInput = (example === 'blocking' || example === 'split') && s.id === 'work' && s.inputBuffer.kind === 'quantity'
      || example === 'assembly' && s.id === 'assembly' && s.inputBuffer.kind === 'materials' && s.inputBuffer.materials.every(m => m.capacity.kind === 'quantity');
    return {id: s.id, input: shortInput ? ordinary.inputBuffer : s.inputBuffer, output: s.outputBuffer};
  })});
  if (JSON.stringify(buffers(current)) !== JSON.stringify(buffers(baseline))) keys.push('hiddenBuffers');
  if (example === 'queue') {
    const d = current.stations.find(s => s.id === 'work')!.plan[0]!.processing.distribution;
    if (d && (d.kind === 'uniform' || d.kind === 'triangular' || d.kind === 'lognormal' && !CV_PRESETS.some(cv => cv === d.cv))) keys.push('hiddenVariability');
  }
  if (example === 'batches' || example === 'plans') {
    if (current.stations.some(s => s.plan.some((p, i) => {
      const ordinary = baseline.stations.find(b => b.id === s.id)!.plan[i]!.processing;
      return p.processing.mode !== ordinary.mode || p.processing.cv !== ordinary.cv || !!p.processing.distribution;
    }))) keys.push('hiddenVariability');
  }
  if (current.stations.some(s => s.lunchReplacement || s.costs.perLunchHour !== baseline.stations.find(b => b.id === s.id)!.costs.perLunchHour)) keys.push('hiddenLunch');
  if (current.stations.some(s => JSON.stringify(s.maintenance) !== JSON.stringify(baseline.stations.find(b => b.id === s.id)!.maintenance))) keys.push('hiddenMaintenance');
  if ((current.warmupMs ?? 0) !== (baseline.warmupMs ?? 0)) keys.push('hiddenWarmup');
  if (example === 'plans' && current.sources.find(s => s.id === 'source-b')!.availability !== baseline.sources.find(s => s.id === 'source-b')!.availability) keys.push('supplyB');
  if (example === 'quality' && current.stations.some(s => s.id === 'work' && s.plan.some(p => (p.processing.defectProbability ?? 0) > 0))) keys.push('qualitySource');
  return keys;
}

export function ExperimentContext({run, example, text, qualitySource, onExpert}: {
  run: RunConfig; example: ExampleId; text: Labels; qualitySource: 'prep' | 'work'; onExpert: () => void;
}) {
  const keys = advancedSettingKeys(run, example);
  const baseline = previewConfig(example);
  if (example === 'quality' && qualitySource !== 'prep' && !keys.includes('qualitySource')) keys.push('qualitySource');
  const name = (id: string) => nameFor(id, run.source.stations.find(s => s.id === id)?.name ?? id, text);
  const rule = (value: DeepReadonly<InputBufferConfig>): string => value.kind === 'quantity' ? value.quantity
    : value.kind === 'infinite' ? text.infinite : value.kind === 'inherit' ? text.inherit
    : value.kind === 'shift' ? `${value.shifts} ${text.shiftFraction}`
    : value.materials.map(m => `${nameFor(m.materialId, run.source.materials.find(x => x.id === m.materialId)!.name, text)}: ${rule(m.capacity)}`).join(', ');
  const details = (key: typeof keys[number]): string => {
    if (key === 'seed') return String(run.resolved.seed);
    if (key === 'hiddenWarmup') return durationText(run.resolved.warmupMs);
    if (key === 'qualitySource') return name(qualitySource);
    if (key === 'supplyB') return text.unavailable;
    if (key === 'hiddenLunch') return run.source.stations.filter(s => s.lunchReplacement || s.costs.perLunchHour !== '0').map(s => `${name(s.id)}: ${s.lunchReplacement ? text.lunchOn : text.lunchOff}, ${s.costs.perLunchHour}`).join('; ');
    if (key === 'hiddenMaintenance') return run.source.stations.filter(s => s.maintenance.enabled).map(s => name(s.id)).join(', ');
    if (key === 'hiddenVariability') return run.resolved.stations.map(s => `${name(s.id)}: CV ${s.plan[0]!.cv}`).join('; ');
    const changed = run.source.stations.filter(s => {
      const b = baseline.stations.find(b => b.id === s.id)!;
      return JSON.stringify([s.inputBuffer, s.outputBuffer]) !== JSON.stringify([b.inputBuffer, b.outputBuffer]);
    }).map(s => `${name(s.id)}: ${text.input} ${rule(s.inputBuffer)}; ${text.output} ${rule(s.outputBuffer)}`);
    if (JSON.stringify(run.source.bufferDefaults ?? {}) !== JSON.stringify(baseline.bufferDefaults ?? {})) changed.unshift(`${text.globalBuffers}: ${text.input} ${rule(run.source.bufferDefaults?.input ?? {kind: 'inherit'})}; ${text.output} ${rule(run.source.bufferDefaults?.output ?? {kind: 'inherit'})}`);
    return changed.join('; ');
  };
  return <div className="simple-only experiment-context">
    <p>{text.runHorizon}: {durationText(run.resolved.durationMs)}.</p>
    {example === 'balanced' && <p>{text.simpleBalancedMean}</p>}
    {example === 'queue' && <p>{text.simpleNeighbours}</p>}
    {example === 'split' && <p>{text.simpleSplitPriority}</p>}
    {example === 'assembly' && <p>{text.simpleAssemblyKit}</p>}
    {example === 'quality' && <p>{text.qualitySource}: {name(qualitySource)}.</p>}
    {keys.length > 0 && <details className="advanced-notice"><summary>{text.hiddenSettings}</summary><dl>{keys.map(key => <div key={key}><dt>{key === 'seed' ? 'Seed' : text[key]}</dt><dd>{details(key)}</dd></div>)}</dl><button type="button" onClick={onExpert}>{text.showExpert}</button></details>}
  </div>;
}
