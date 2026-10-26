import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { version as appVersion } from '../package.json';
import { clockAt, calendarForDuration } from './engine/calendar';
import { compileConfig, ConfigError } from './engine/config';
import type { DeepReadonly, MaintenanceConfig } from './engine/config';
import { Runner } from './runner/runner';
import type { PlaybackSpeed, RunnerView } from './runner/runner';
import { WarmupPanel } from './ui/WarmupPanel';
import { DurationPanel, withDuration } from './ui/DurationPanel';
import type { DurationDistribution } from './engine/random';
import { LunchPanel } from './ui/LunchPanel';
import { withLunch } from './ui/lunch';
import type { LunchSetting, LunchSettings } from './ui/lunch';
import { MaintenancePanel } from './ui/MaintenancePanel';
import { withMaintenance } from './ui/maintenance';
import { BufferPanel } from './ui/BufferPanel';
import { withBuffers } from './ui/buffers';
import type { BufferSettings } from './ui/buffers';
import { FlowDiagram } from './ui/FlowDiagram';
import { ExampleGuide } from './ui/ExampleGuide';
import {QualityPanel} from './ui/QualityPanel';
import {QualitySummary} from './ui/QualitySummary';
import {defaultQuality, withQuality} from './ui/quality';
import type {QualitySettings} from './ui/quality';
import { RunSummary } from './ui/RunSummary';
import { labels, nameFor } from './ui/i18n';
import type { Language } from './ui/i18n';
import { defaultBatchProfiles, defaultPlanProfile, exampleIds, previewConfig } from './ui/preview';
import type { ExampleId } from './ui/preview';
import { ThemePicker } from './ui/ThemePicker';
import { useTheme } from './ui/theme';
import {useUiMode} from './ui/ui-mode';
import type {UiMode} from './ui/ui-mode';
import {BatchPanel, PlanPanel} from './ui/ProductionPanels';
import {ExperimentContext} from './ui/ExperimentContext';
import {lesson2Config} from './lessons/lesson-2';
import type {Lesson2Variant} from './lessons/lesson-2';
import {Lesson2Intro, Lesson2Comparison, lesson2Labels} from './ui/Lesson2';
import type {Lesson2Results} from './ui/Lesson2';
import {lesson3Config, lesson3Result} from './lessons/lesson-3';
import type {Lesson3Buffer, Lesson3Results} from './lessons/lesson-3';
import {Lesson3Intro, Lesson3Comparison, lesson3Labels} from './ui/Lesson3';

import {lesson1Config, lesson1Result} from './lessons/lesson-1';
import type {Lesson1Variant, Lesson1Results} from './lessons/lesson-1';
import {Lesson1Intro, Lesson1Comparison, lesson1Labels} from './ui/Lesson1';

import {BottleneckSearch} from './ui/BottleneckSearch';
import type {BottleneckResult} from './runner/bottleneck-search';

// Mode is a viewing preference, absent from RunConfig/Runner dependencies and editor keys.
export function App({mode: controlledMode, onModeChange}: {mode?: UiMode; onModeChange?: (mode: UiMode) => void} = {}) {
  const [preferredMode, selectMode] = useUiMode();
  const mode = controlledMode ?? preferredMode;
  const changeMode = onModeChange ?? selectMode;
  const showExpert = useCallback(() => changeMode('expert'), [changeMode]);
  const [theme, setTheme] = useTheme();
  const [example, setExample] = useState<ExampleId>('queue');
  const [lesson, setLesson] = useState<'lesson-1' | 'lesson-2' | 'lesson-3' | null>(null);
  const lesson1 = lesson === 'lesson-1';
  const [variabilityVariant, setVariabilityVariant] = useState<Lesson1Variant>('steady');
  const [variabilityResults, setVariabilityResults] = useState<Lesson1Results>({});
  const lesson2 = lesson === 'lesson-2', lesson3 = lesson === 'lesson-3';
  const [lessonBuffer, setLessonBuffer] = useState<Lesson3Buffer>(1);
  const [bufferResults, setBufferResults] = useState<Lesson3Results>({});
  const [lessonVariant, setLessonVariant] = useState<Lesson2Variant>('base');
  const [lessonResults, setLessonResults] = useState<Lesson2Results>({});
  const [generation, setGeneration] = useState(0);
  const [batchProfiles, setBatchProfiles] = useState(() => structuredClone(defaultBatchProfiles));
  const [configurationError, setConfigurationError] = useState<ConfigError | null>(null);
  const [planProfile, setPlanProfile] = useState(() => ({...defaultPlanProfile}));
  const [cv, setCv] = useState(0), [seedText, setSeedText] = useState('42');
  const seedValid = /^\d+$/.test(seedText) && Number(seedText) <= 0xffffffff;
  const seed = seedValid ? Number(seedText) : 42;
  const [duration, setDuration] = useState<DurationDistribution>({kind: 'constant', timeMs: 480_000});
  const [maintenance, setMaintenance] = useState<MaintenanceConfig>({enabled: false});
  const [lunch, setLunch] = useState<LunchSettings>({});
  const [quality, setQuality] = useState<QualitySettings>(defaultQuality);
  const [warmupMs, setWarmupMs] = useState(0);
  const [buffers, setBuffers] = useState<BufferSettings | null>(null);
  const run = useMemo(() => {if (lesson1) return compileConfig(lesson1Config(variabilityVariant)); if (lesson2) return compileConfig(lesson2Config(lessonVariant)); if (lesson3) return compileConfig(lesson3Config(lessonBuffer)); let config = previewConfig(example, example === 'queue' ? 0 : cv, seed, batchProfiles, planProfile); if (example === 'queue') config = withDuration(config, duration); if (example === 'batches') config = withMaintenance(config, 'prep', maintenance); config = withLunch(config, lunch); if (buffers) config = withBuffers(config, buffers); if (example === 'quality') config = withQuality(config, quality); config.warmupMs = warmupMs; return compileConfig(config);}, [lesson1, variabilityVariant, lesson2, lesson3, lessonBuffer, lessonVariant, example, cv, seed, batchProfiles, planProfile, buffers, duration, maintenance, lunch, quality, warmupMs]);
  const [searchResult, setSearchResult] = useState<{hash:string;result:BottleneckResult|null}|null>(null);
  useEffect(() => setSearchResult(null), [run.calculationHash]);
  const acceptSearchResult = useCallback((result:BottleneckResult|null) => setSearchResult({hash:run.calculationHash,result}), [run.calculationHash]);
  const highlightedStation = searchResult?.hash===run.calculationHash ? searchResult.result?.stationId ?? null : null;
  const [language, setLanguage] = useState<Language>('ru');
  // Translate captions without replacing the running simulation when the language changes.
  const displayedRun = useMemo(() => lesson1 ? {...run, source: lesson1Config(variabilityVariant, language)} : lesson2 ? {...run, source: lesson2Config(lessonVariant, language)} : lesson3 ? {...run, source: lesson3Config(lessonBuffer, language)} : run, [run, lesson1, variabilityVariant, lesson2, lesson3, lessonBuffer, lessonVariant, language]);
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
  useEffect(() => {
    if (!lesson2 || view?.status !== 'finished' || view.model.line?.termination !== 'horizon') return;
    const line = view.model.line;
    const result = {
      total: line.counters.find(counter => counter.materialId === 'product')!.sold,
      shifts: [0, 1, 2].map(day => line.shiftOutput.find(row => row.dayIndex === day && row.materialId === 'product')?.quantity ?? 0),
    };
    setLessonResults(previous => ({...previous, [lessonVariant]: result}));
  }, [lesson2, lessonVariant, view]);
  useEffect(() => {
    if (!lesson3 || view?.status !== 'finished' || view.model.line?.termination !== 'horizon') return;
    const result = lesson3Result(run, view.model);
    setBufferResults(previous => ({...previous, [lessonBuffer]: result}));
  }, [lesson3, lessonBuffer, run, view]);
  useEffect(() => {
    if (!lesson1 || view?.status !== 'finished' || view.model.line?.termination !== 'horizon') return;
    const result = lesson1Result(view.model);
    setVariabilityResults(previous => ({...previous, [variabilityVariant]: result}));
  }, [lesson1, variabilityVariant, view]);
  const calendar = calendarForDuration(run.resolved.calendar, run.resolved.durationMs);
  const time = clockAt(calendar, view?.model.timeMs ?? 0), clock = [Math.floor(time.timeOfDayMs / 3_600_000), Math.floor(time.timeOfDayMs / 60_000) % 60, Math.floor(time.timeOfDayMs / 1000) % 60].map(value => String(value).padStart(2, '0')).join(':');
  const status = view?.status ?? 'ready', terminal = ['finished', 'stopped', 'error'].includes(status);
  const seedAllowed = !!lesson || seedValid;
  const locked = status !== 'ready';
  const changeProfiles = (nextBatches: typeof batchProfiles, nextPlan: typeof planProfile) => {
    try {
      let config = previewConfig(example, cv, seed, nextBatches, nextPlan);
      if (example === 'batches') config = withMaintenance(config, 'prep', maintenance);
      config = withLunch(config, lunch);
      compileConfig(buffers ? withBuffers(config, buffers) : config);
      setConfigurationError(null); runner.current?.dispose(); setView(null);
      setBatchProfiles(nextBatches); setPlanProfile(nextPlan);
    } catch (error) {if (!(error instanceof ConfigError)) throw error; setConfigurationError(error);}
  };
  const applyBuffers = useCallback((settings: BufferSettings) => {
    if (locked) return;
    setConfigurationError(null); runner.current?.dispose(); setView(null); setBuffers(settings);
  }, [locked]);
  const applyDuration = useCallback((next: DurationDistribution) => {
    if (locked) return;
    setConfigurationError(null); runner.current?.dispose(); setView(null); setDuration(next);
  }, [locked]);
  const applyMaintenance = useCallback((next: MaintenanceConfig) => {
    if (locked) return;
    setConfigurationError(null); runner.current?.dispose(); setView(null); setMaintenance(next);
  }, [locked]);
  const applyLunch = useCallback((id: string, setting: LunchSetting) => {
    if (locked) return;
    setConfigurationError(null); runner.current?.dispose(); setView(null); setLunch(previous => ({...previous, [id]: setting}));
  }, [locked]);
  const applyQuality = useCallback((settings: QualitySettings) => {
    if (locked) return;
    setConfigurationError(null); runner.current?.dispose(); setView(null); setQuality(settings);
  }, [locked]);
  const applyWarmup = useCallback((ms: number) => {
    if (locked) return;
    setConfigurationError(null); runner.current?.dispose(); setView(null); setWarmupMs(ms);
  }, [locked]);
  const reset = () => {runner.current?.dispose(); setView(null); setGeneration(value => value + 1);};
  const playLabel = status === 'ready' ? text.start : status === 'running' ? text.pause : status === 'paused' ? text.resume : status === 'stopped' ? text.stopped : status === 'error' ? text.error : text.finished;
  return <main data-ui-mode={mode}>
    <header className="page-header"><a className="brand" href="#flow">TOC<span>{text.title}</span></a>
      <div className="appearance-controls"><ThemePicker value={theme} onChange={setTheme} text={text}/>
      <button type="button" className="language-toggle" title={`${text.language}: ${language === 'ru' ? 'Русский' : 'English'}`} aria-label={`${text.language}: ${language === 'ru' ? 'Русский' : 'English'}`} onClick={() => setLanguage(language === 'ru' ? 'en' : 'ru')}>{language.toUpperCase()}</button>
      <button type="button" className="mode-toggle" aria-label={text.expertMode} aria-pressed={mode === 'expert'} onClick={() => changeMode(mode === 'simple' ? 'expert' : 'simple')}>{text.expertMode}: {mode === 'expert' ? text.modeOn : text.modeOff}</button></div>
    </header>
    <div className="intro"><h1>{text.diagram}</h1><p>{text.subtitle}</p></div>
    <section className="scenario-panel" aria-labelledby="scenario-title">
    <h2 id="scenario-title">{text.scenario}</h2>
    <div className="example-picker"><label>{text.example}<select value={lesson ?? example} disabled={(locked && !terminal) || !view} onChange={event => {if (event.target.value === (lesson ?? example)) return; runner.current?.dispose(); setView(null); setConfigurationError(null); setBuffers(null); setDuration({kind: 'constant', timeMs: 480_000}); setMaintenance({enabled: false}); setLunch({}); setQuality(defaultQuality); setWarmupMs(0); const next = event.target.value; setLesson(next === 'lesson-1' || next === 'lesson-2' || next === 'lesson-3' ? next : null); if (next !== 'lesson-1' && next !== 'lesson-2' && next !== 'lesson-3') setExample(next as ExampleId);}}><option value="lesson-1">{lesson1Labels[language].name}</option><option value="lesson-2">{lesson2Labels[language].name}</option><option value="lesson-3">{lesson3Labels[language].name}</option>{exampleIds.map(id => <option key={id} value={id}>{id === 'queue' ? text.queueExample : id === 'assembly' ? text.assemblyExample : text[id]}</option>)}</select></label><p className={locked && !terminal ? '' : 'expert-only'}>{locked && !terminal ? text.locked : text.ready}</p></div>
    {lesson1 ? <Lesson1Intro variant={variabilityVariant} locked={(locked && !terminal) || !view} language={language} onChange={next => {
      if (next === variabilityVariant) return;
      runner.current?.dispose(); setView(null); setVariabilityVariant(next);
    }}/> : lesson2 ? <Lesson2Intro variant={lessonVariant} locked={(locked && !terminal) || !view} language={language} onChange={next => {
      if (next === lessonVariant) return;
      runner.current?.dispose(); setView(null); setLessonVariant(next);
    }}/> : lesson3 ? <Lesson3Intro buffer={lessonBuffer} locked={(locked && !terminal) || !view} language={language} onChange={next => {
      if (next === lessonBuffer) return;
      runner.current?.dispose(); setView(null); setLessonBuffer(next);
    }}/> : <ExampleGuide key={`guide-${example}`} example={example} text={text} language={language}/>}
    </section>
    <section className="simulation-panel" aria-labelledby="simulation-title">
    <h2 id="simulation-title">{text.simulationControls}</h2>
    {!lesson && <section className="line-settings" aria-labelledby="line-settings-title">
      <div className="line-settings-header"><h3 id="line-settings-title"><span className="expert-only">{text.lineSettings}</span><span className="simple-only">{text.experimentSettings}</span></h3>
      <div className="run-settings">
          {example !== 'queue' && example !== 'quality' && <label className={`speed-picker ${example === 'plans' || example === 'batches' ? 'expert-only' : ''}`} title={text.cvHelp}>{text.variability}<select aria-label={text.variability} value={cv} disabled={locked || !view} onChange={event => {if (Number(event.target.value) === cv) return; runner.current?.dispose(); setView(null); setCv(Number(event.target.value));}}>{[0, 0.1, 0.25, 0.5, 1, 2].map(value => <option key={value} value={value}>{value === 0 ? text.cvZero : `CV ${value}`}</option>)}</select></label>}
          <label className="speed-picker expert-only">Seed<input className="seed-input" type="text" inputMode="numeric" aria-label="Seed" aria-invalid={!seedValid} value={seedText} disabled={locked || !view} onChange={event => setSeedText(event.target.value)}/></label>
      </div></div>
      {example !== 'queue' && example !== 'quality' && <p className={`variability-note ${example === 'plans' || example === 'batches' ? 'expert-only' : ''}`}><span className="expert-only">{text.cvHelp}</span><span className="simple-only">{text.simpleCvHelp}</span></p>}
      {example === 'plans' && <PlanPanel key={`plan-${example}`} run={run} applied={planProfile} locked={locked || !view} text={text} language={language} mode={mode} onApply={next => changeProfiles(batchProfiles, next)}/>}
      {example === 'batches' && <BatchPanel key={`batches-${example}`} run={run} applied={batchProfiles} locked={locked || !view} text={text} language={language} mode={mode} onApply={next => changeProfiles(next, planProfile)}/>}
      {example === 'batches' && <MaintenancePanel key={`maintenance-${JSON.stringify(run.source)}`} run={run} locked={locked || !view} text={text} language={language} onApply={applyMaintenance}/>}
      {example === 'queue' && <DurationPanel key={`duration-${JSON.stringify(run.source)}`} run={run} locked={locked || !view} text={text} language={language} onApply={applyDuration} mode={mode}/>}
      {example === 'quality' && <QualityPanel key={`quality-settings-${JSON.stringify(run.source)}`} run={run} settings={quality} locked={locked || !view} text={text} language={language} onApply={applyQuality} mode={mode}/>}
      <WarmupPanel key={`warmup-${example}-${warmupMs}`} run={run} locked={locked || !view} text={text} language={language} onApply={applyWarmup}/>
      <LunchPanel key={example} run={run} locked={locked || !view} text={text} language={language} onApply={applyLunch}/>
      <BufferPanel key={`${example}-${JSON.stringify(run.source)}`} run={run} locked={locked || !view} text={text} language={language} onApply={applyBuffers} mode={mode} simpleStationId={example === 'blocking' || example === 'split' ? 'work' : example === 'assembly' ? 'assembly' : undefined}/>
      <ExperimentContext run={run} example={example} text={text} qualitySource={quality.source} onExpert={showExpert}/>
      <button type="button" className="simple-only show-expert" onClick={showExpert}>{text.showExpert}</button>
    </section>}
    <section id="flow" className="diagram-panel" aria-label={text.diagram} data-time-ms={view?.model.timeMs ?? 0} data-playback={status} data-speed={view?.speed ?? 60} data-reduced={manualReduced || systemReduced}>
      <div className="diagram-controls">
        <div className="playback-buttons"><button className="play-button" type="button" disabled={!view || terminal || !seedAllowed || !!configurationError} onClick={() => {if (status === 'ready') runner.current?.start(); else if (status === 'running') runner.current?.pause(); else runner.current?.resume();}}>{playLabel}</button>
          <button type="button" disabled={!view || terminal || !seedAllowed || !!configurationError} onClick={() => runner.current?.step()}>{text.step}</button>
          <button type="button" disabled={!view || terminal || status === 'ready'} onClick={() => runner.current?.stop()}>{text.stop}</button>
          <button type="button" disabled={!view || !locked} onClick={reset}>{text.newRun}</button>
          <label className="speed-picker">{text.speed}<select aria-label={text.speed} value={view?.speed ?? 60} onChange={event => {preferredSpeed.current = event.target.value === 'max' ? 'max' : Number(event.target.value); runner.current?.setSpeed(preferredSpeed.current);}}><option value="60">{text.speed60}</option><option value="300">{text.speed300}</option><option value="1800">{text.speed1800}</option><option value="max">{text.max}</option></select></label>

        </div>
        <div className="model-clock"><span>{text.day} {time.dayIndex + 1}</span><strong>{clock}</strong><span className={`playback-state playback-${status}`}>{status === 'paused' ? text.pausedView : status === 'running' ? text.running : status === 'finished' ? text.finished : status === 'error' ? text.error : status === 'stopped' ? text.stopped : text.ready}</span></div>
      </div>
      {configurationError && <p role="alert" className="run-error">{configurationError.messages[language]} <span className="expert-only">{configurationError.path}</span> <button className="simple-only" onClick={showExpert}>{text.showExpert}</button></p>}
      {!seedAllowed && <p role="alert" className="run-error">{text.seedError} <button className="simple-only" onClick={showExpert}>{text.showExpert}</button></p>}
      <div className="diagram-context"><p className="expert-only">{lesson1 ? lesson1Labels[language].help : lesson2 ? lesson2Labels[language].help : lesson3 ? lesson3Labels[language].help : example === 'quality' ? text.qualityHint : example === 'plans' ? text.plansHint : example === 'batches' ? text.batchesHint : example === 'assembly' ? text.assemblyHint : example === 'split' ? text.splitHint : example === 'balanced' ? text.balancedHint : example === 'queue' ? text.queueHint : text.blockingHint}</p><label title={systemReduced ? text.systemMotion : undefined}><input type="checkbox" checked={manualReduced || systemReduced} disabled={systemReduced} onChange={event => setManualReduced(event.target.checked)}/>{text.lessMotion}</label></div>
      <BottleneckSearch key={run.calculationHash} run={displayedRun} language={language} text={text} allowed={!!view && status!=='running' && seedAllowed && !configurationError} onResult={acceptSearchResult}/>
      {view && <FlowDiagram key={`${lesson1 ? variabilityVariant : lesson2 ? lessonVariant : lesson3 ? `buffer-${lessonBuffer}` : example}-${generation}`} run={displayedRun} view={view} text={text} reduced={manualReduced || systemReduced} bottleneckStationId={highlightedStation}/>}
      {view && <RunSummary run={displayedRun} view={view} text={text} language={language} example={lesson ? 'queue' : example}/>}
      {!lesson && example === 'quality' && view && <div className="expert-only"><QualitySummary key={example} run={run} view={view} text={text}/></div>}
      {lesson1 && <Lesson1Comparison results={variabilityResults} language={language}/>}
      {lesson2 && <Lesson2Comparison results={lessonResults} language={language}/>}
      {lesson3 && <Lesson3Comparison results={bufferResults} language={language}/>}
      <p className="scroll-note">{text.scroll}</p>
      <div className="material-key" aria-label={text.material}>{displayedRun.source.materials.map(material => <span key={material.id}><i style={{background: material.color}}/>{nameFor(material.id, material.name, text)}</span>)}</div>
    </section>
    </section>
    <footer className="version-info" aria-label={text.versions}><span>{text.appVersion} {appVersion}</span>{' '}<span>{text.engineVersion} {run.engineVersion}</span></footer>
  </main>;
}
