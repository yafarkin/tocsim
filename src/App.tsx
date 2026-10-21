import { useEffect, useMemo, useRef, useState } from 'react';
import { clockAt, calendarForDuration } from './engine/calendar';
import { compileConfig } from './engine/config';
import type { DeepReadonly } from './engine/config';
import { Runner } from './runner/runner';
import type { PlaybackSpeed, RunnerView } from './runner/runner';
import { FlowDiagram } from './ui/FlowDiagram';
import { labels, nameFor } from './ui/i18n';
import type { Language } from './ui/i18n';
import { defaultBatchProfiles, exampleIds, previewConfig } from './ui/preview';
import type { ExampleId } from './ui/preview';
import { ThemePicker } from './ui/ThemePicker';
import { useTheme } from './ui/theme';

export function App() {
  const [theme, setTheme] = useTheme();
  const [example, setExample] = useState<ExampleId>('queue');
  const [generation, setGeneration] = useState(0);
  const [batchProfiles, setBatchProfiles] = useState(() => structuredClone(defaultBatchProfiles));
  const [cv, setCv] = useState(0), [seedText, setSeedText] = useState('42');
  const seedValid = /^\d+$/.test(seedText) && Number(seedText) <= 0xffffffff;
  const seed = seedValid ? Number(seedText) : 42;
  const run = useMemo(() => compileConfig(previewConfig(example, cv, seed, batchProfiles)), [example, cv, seed, batchProfiles]);
  const [language, setLanguage] = useState<Language>('ru');
  const [view, setView] = useState<DeepReadonly<RunnerView> | null>(null);
  const [manualReduced, setManualReduced] = useState(false), [systemReduced, setSystemReduced] = useState(false);
  const preferredSpeed = useRef<PlaybackSpeed>(60);
  const runner = useRef<Runner | null>(null), text = labels(language);
  useEffect(() => {
    document.documentElement.lang = language; document.title = `TOC | ${text.title}`;
    document.querySelector('meta[name="description"]')?.setAttribute('content', text.subtitle);
  }, [language, text]);
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    setSystemReduced(media.matches);
    const changed = () => setSystemReduced(media.matches);
    media.addEventListener('change', changed);
    return () => media.removeEventListener('change', changed);
  }, []);
  useEffect(() => {
    const current = new Runner(run, setView, {now: () => performance.now(), request: callback => requestAnimationFrame(callback), cancel: id => cancelAnimationFrame(id as number)});
    runner.current = current; current.setSpeed(preferredSpeed.current); setView(current.getView());
    return () => {current.dispose(); runner.current = null;};
  }, [run, generation]);
  const calendar = calendarForDuration(run.resolved.calendar, run.resolved.durationMs);
  const time = clockAt(calendar, view?.model.timeMs ?? 0), clock = [Math.floor(time.timeOfDayMs / 3_600_000), Math.floor(time.timeOfDayMs / 60_000) % 60, Math.floor(time.timeOfDayMs / 1000) % 60].map(value => String(value).padStart(2, '0')).join(':');
  const status = view?.status ?? 'ready', terminal = ['finished', 'stopped', 'error'].includes(status);
  const locked = status !== 'ready';
  const reset = () => {runner.current?.dispose(); setView(null); setGeneration(value => value + 1);};
  const playLabel = status === 'ready' ? text.start : status === 'running' ? text.pause : status === 'paused' ? text.resume : status === 'stopped' ? text.stopped : status === 'error' ? text.error : text.finished;
  return <main>
    <header className="page-header"><a className="brand" href="#flow">TOC<span>{text.title}</span></a>
      <div className="appearance-controls"><ThemePicker value={theme} onChange={setTheme} text={text}/>
      <button type="button" className="language-toggle" title={`${text.language}: ${language === 'ru' ? 'Русский' : 'English'}`} aria-label={`${text.language}: ${language === 'ru' ? 'Русский' : 'English'}`} onClick={() => setLanguage(language === 'ru' ? 'en' : 'ru')}>{language.toUpperCase()}</button></div>
    </header>
    <div className="intro"><h1>{text.diagram}</h1><p>{text.subtitle}</p></div>
    <div className="example-picker"><label>{text.example}<select value={example} disabled={locked || !view} onChange={event => {runner.current?.dispose(); setView(null); setExample(event.target.value as ExampleId);}}>{exampleIds.map(id => <option key={id} value={id}>{id === 'queue' ? text.queueExample : id === 'assembly' ? text.assemblyExample : text[id]}</option>)}</select></label><p>{locked ? text.locked : text.ready}</p></div>
    <section id="flow" className="diagram-panel" aria-label={text.diagram} data-time-ms={view?.model.timeMs ?? 0} data-playback={status} data-speed={view?.speed ?? 60} data-reduced={manualReduced || systemReduced}>
      <div className="diagram-controls">
        <div className="playback-buttons"><button className="play-button" type="button" disabled={!view || terminal || !seedValid} onClick={() => {if (status === 'ready') runner.current?.start(); else if (status === 'running') runner.current?.pause(); else runner.current?.resume();}}>{playLabel}</button>
          <button type="button" disabled={!view || terminal || !seedValid} onClick={() => runner.current?.step()}>{text.step}</button>
          <button type="button" disabled={!view || terminal || status === 'ready'} onClick={() => runner.current?.stop()}>{text.stop}</button>
          <button type="button" disabled={!view || !locked} onClick={reset}>{text.newRun}</button>
          <label className="speed-picker">{text.speed}<select aria-label={text.speed} value={view?.speed ?? 60} onChange={event => {preferredSpeed.current = event.target.value === 'max' ? 'max' : Number(event.target.value); runner.current?.setSpeed(preferredSpeed.current);}}><option value="60">{text.speed60}</option><option value="300">{text.speed300}</option><option value="1800">{text.speed1800}</option><option value="max">{text.max}</option></select></label>
          <label className="speed-picker" title={text.cvHelp}>{text.variability}<select aria-label={text.variability} value={cv} disabled={locked || !view} onChange={event => {runner.current?.dispose(); setView(null); setCv(Number(event.target.value));}}>{[0, 0.1, 0.25, 0.5, 1, 2].map(value => <option key={value} value={value}>{value === 0 ? text.cvZero : `CV ${value}`}</option>)}</select></label>
          <label className="speed-picker">Seed<input className="seed-input" type="text" inputMode="numeric" aria-label="Seed" aria-invalid={!seedValid} value={seedText} disabled={locked || !view} onChange={event => setSeedText(event.target.value)}/></label>
        </div>
        <div className="model-clock"><span>{text.day} {time.dayIndex + 1}</span><strong>{clock}</strong><span className={`playback-state playback-${status}`}>{status === 'paused' ? text.pausedView : status === 'running' ? text.running : status === 'finished' ? text.finished : status === 'error' ? text.error : status === 'stopped' ? text.stopped : text.ready}</span></div>
      </div>
      {!seedValid && <p role="alert" className="run-error">{text.seedError}</p>}
      <p className="variability-note">{text.cvHelp}</p>
      <div className="diagram-context"><p>{example === 'batches' ? text.batchesHint : example === 'assembly' ? text.assemblyHint : example === 'split' ? text.splitHint : example === 'balanced' ? text.balancedHint : example === 'queue' ? text.queueHint : text.blockingHint}</p><label title={systemReduced ? text.systemMotion : undefined}><input type="checkbox" checked={manualReduced || systemReduced} disabled={systemReduced} onChange={event => setManualReduced(event.target.checked)}/>{text.lessMotion}</label></div>
      {example === 'batches' && <details className="batch-editor"><summary>{text.batchSettings}</summary><fieldset className="batch-settings" disabled={locked || !view}>
        <legend>{text.batchSettings}</legend>
        <p>{text.batchSettingsHelp}</p>
        <p id="batch-threshold-help" className="threshold-help"><strong>{text.threshold}.</strong> {text.thresholdHelp}</p>
        {(['prep', 'work'] as const).map(id => {
          const profile = batchProfiles[id];
          const update = (patch: Partial<typeof profile>) => {
            runner.current?.dispose(); setView(null);
            setBatchProfiles(previous => ({...previous, [id]: {...previous[id], ...patch}}));
          };
          return <div className="batch-settings-row" key={id}>
            <strong>{nameFor(id, id, text)}</strong>
            <label>{text.mode}<select aria-label={`${nameFor(id, id, text)}: ${text.mode}`} value={profile.mode} onChange={event => update({mode: event.target.value as typeof profile.mode})}><option value="sequential">{text.sequential}</option><option value="simultaneous">{text.simultaneous}</option></select></label>
            <label>{text.repetitions}<select aria-label={`${nameFor(id, id, text)}: ${text.repetitions}`} value={profile.repetitions} onChange={event => {const repetitions = Number(event.target.value); update({repetitions, transportThreshold: Math.min(profile.transportThreshold, repetitions)});}}>{Array.from({length: 10}, (_, i) => i + 1).map(n => <option key={n} value={n}>{n}</option>)}</select></label>
            <label>{text.threshold}<select aria-describedby="batch-threshold-help" aria-label={`${nameFor(id, id, text)}: ${text.threshold}`} value={profile.transportThreshold} onChange={event => update({transportThreshold: Number(event.target.value)})}>{Array.from({length: profile.repetitions}, (_, i) => i + 1).map(n => <option key={n} value={n}>{n}</option>)}</select></label>
          </div>;
        })}
      </fieldset></details>}
      {view && <FlowDiagram key={`${example}-${generation}`} run={run} view={view} text={text} reduced={manualReduced || systemReduced}/>}
      <p className="scroll-note">{text.scroll}</p>
      <div className="material-key" aria-label={text.material}>{run.source.materials.map(material => <span key={material.id}><i style={{background: material.color}}/>{nameFor(material.id, material.name, text)}</span>)}</div>
      {view?.error && <p role="alert" className="run-error">{view.error.messages[language]}</p>}
    </section>
  </main>;
}
