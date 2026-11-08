import {useEffect, useMemo, useRef, useState} from 'react';
import type {DeepReadonly, RunConfig} from '@toc/engine';
import {calendarForDuration, clockAt} from '@toc/engine';
import {Runner} from '../runner/runner';
import type {PlaybackSpeed, PlaybackStatus, RunnerView} from '../runner/runner';
import type {Language} from '../ui/i18n';
import {BottleneckSearch} from '../ui/BottleneckSearch';
import type {BottleneckResult} from '../runner/bottleneck-search';
import {FlowDiagram} from '../ui/FlowDiagram';
import {RunSummary} from '../ui/RunSummary';
import {processLabels} from './process-run';

/** One fixed RunConfig per mounted experiment; form changes never reach this Runner. */
export function ProcessPlayback({run, language, active, onStatus}: {
  run: RunConfig; language: Language; active: boolean; onStatus: (status: PlaybackStatus) => void;
}) {
  const text = useMemo(() => processLabels(run, language), [run, language]);
  const runner = useRef<Runner | null>(null), section = useRef<HTMLElement>(null);
  const [view, setView] = useState<DeepReadonly<RunnerView> | null>(null);
  const [generation, setGeneration] = useState(0);
  const speed = useRef<PlaybackSpeed>(60);
  const [manualReduced, setManualReduced] = useState(false), [systemReduced, setSystemReduced] = useState(false);
  const [search, setSearch] = useState<BottleneckResult | null>(null);
  useEffect(() => {if (!active) setSearch(null);}, [active]);
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    setSystemReduced(media.matches);
    const update = () => setSystemReduced(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    const current = new Runner(run, next => {setView(next); onStatus(next.status);}, {
      now: () => performance.now(), request: callback => requestAnimationFrame(callback),
      cancel: handle => cancelAnimationFrame(handle as number),
    });
    runner.current = current; current.setSpeed(speed.current);
    setView(current.getView()); onStatus('ready');
    if (generation === 0) {current.start(); section.current?.scrollIntoView({block: 'start'});}
    return () => {current.dispose(); runner.current = null;};
  }, [run, onStatus, generation]);
  const status = view?.status ?? 'ready', terminal = ['finished', 'stopped', 'error'].includes(status);
  const calendar = calendarForDuration(run.resolved.calendar, run.resolved.durationMs);
  const time = clockAt(calendar, view?.model.timeMs ?? 0);
  const clock = [Math.floor(time.timeOfDayMs / 3_600_000), Math.floor(time.timeOfDayMs / 60_000) % 60,
    Math.floor(time.timeOfDayMs / 1000) % 60].map(value => String(value).padStart(2, '0')).join(':');
  const playLabel = status === 'ready' ? text.start : status === 'running' ? text.pause : status === 'paused' ? text.resume
    : status === 'stopped' ? text.stopped : status === 'error' ? text.error : text.finished;
  // Keep the Runner and result in memory without duplicating lesson report IDs in the DOM.
  if (!active) return null;
  return <section id="process-playback" ref={section} className="diagram-panel process-playback" aria-label={language === 'ru' ? 'Прогон своего процесса' : 'Custom process run'}
    data-time-ms={view?.model.timeMs ?? 0} data-playback={status} data-speed={view?.speed ?? 60}>
    <div className="process-run-heading"><h2>{run.source.name}</h2>
      <p>{language === 'ru' ? 'Результат относится к условиям на момент запуска. Правки формы и копии его не меняют.'
        : 'This result uses the conditions captured at launch. Editing the form or a copy does not change it.'}</p>
      <p>Seed: {run.source.seed}. {text.runHorizon}: {calendar.days} {language === 'ru' ? 'смен' : 'shifts'}.</p></div>
    <div className="diagram-controls"><div className="playback-buttons">
      <button type="button" className="play-button" disabled={!view || terminal} onClick={() => {
        if (status === 'ready') runner.current?.start(); else if (status === 'running') runner.current?.pause(); else runner.current?.resume();
      }}>{playLabel}</button>
      <button type="button" disabled={!view || terminal} onClick={() => runner.current?.step()}>{text.step}</button>
      <button type="button" disabled={!view || terminal || status === 'ready'} onClick={() => runner.current?.stop()}>{text.stop}</button>
      <button type="button" disabled={!view || status === 'ready'} onClick={() => {
        setSearch(null); setGeneration(value => value + 1);
      }}>{text.newRun}</button>
      <label className="speed-picker">{text.speed}<select aria-label={text.speed} value={view?.speed ?? 60} disabled={!view} onChange={event => {
        speed.current = event.target.value === 'max' ? 'max' : Number(event.target.value); runner.current?.setSpeed(speed.current);
      }}><option value="60">{text.speed60}</option><option value="300">{text.speed300}</option><option value="1800">{text.speed1800}</option><option value="max">{text.max}</option></select></label>
    </div><div className="model-clock"><span>{text.day} {time.dayIndex + 1}</span><strong>{clock}</strong>
      <span className={`playback-state playback-${status}`}>{status === 'paused' ? text.pausedView : status === 'running' ? text.running : status === 'finished' ? text.finished : status === 'stopped' ? text.stopped : status === 'error' ? text.error : text.ready}</span></div></div>
    <div className="diagram-context"><p>{language === 'ru' ? 'Схема и отчёты используют только выбранный процесс.' : 'The diagram and reports use only the selected process.'}</p>
      <label title={systemReduced ? text.systemMotion : undefined}><input type="checkbox" checked={manualReduced || systemReduced} disabled={systemReduced} onChange={event => setManualReduced(event.target.checked)}/>{text.lessMotion}</label></div>
    <BottleneckSearch key={`search-${generation}`} run={run} language={language} text={text} allowed={active && !!view && status !== 'running'} onResult={setSearch}/>
    {view && <><FlowDiagram key={`diagram-${generation}`} run={run} view={view} text={text} reduced={manualReduced || systemReduced} bottleneckStationIds={search?.stationIds ?? []}/>
      <RunSummary key={`reports-${generation}`} run={run} view={view} text={text} language={language} example="custom"/></>}
  </section>;
}
