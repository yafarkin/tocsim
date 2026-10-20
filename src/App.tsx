import { useEffect, useRef, useState } from 'react';
import { clockAt, calendarForDuration } from './engine/calendar';
import type { DeepReadonly } from './engine/config';
import { Runner } from './runner/runner';
import type { RunnerView } from './runner/runner';
import { FlowDiagram } from './ui/FlowDiagram';
import { labels, nameFor } from './ui/i18n';
import type { Language } from './ui/i18n';
import { previewRun } from './ui/preview';

export function App() {
  const [language, setLanguage] = useState<Language>('ru');
  const [view, setView] = useState<DeepReadonly<RunnerView> | null>(null);
  const [manualReduced, setManualReduced] = useState(false), [systemReduced, setSystemReduced] = useState(false);
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
    const current = new Runner(previewRun, setView, {now: () => performance.now(), request: callback => requestAnimationFrame(callback), cancel: id => cancelAnimationFrame(id as number)});
    runner.current = current; current.setSpeed(60); setView(current.getView());
    return () => {current.dispose(); runner.current = null;};
  }, []);
  const calendar = calendarForDuration(previewRun.resolved.calendar, previewRun.resolved.durationMs);
  const time = clockAt(calendar, view?.model.timeMs ?? 0), clock = [Math.floor(time.timeOfDayMs / 3_600_000), Math.floor(time.timeOfDayMs / 60_000) % 60, Math.floor(time.timeOfDayMs / 1000) % 60].map(value => String(value).padStart(2, '0')).join(':');
  const status = view?.status ?? 'ready', terminal = ['finished', 'stopped', 'error'].includes(status);
  const playLabel = status === 'ready' ? text.start : status === 'running' ? text.pause : status === 'paused' ? text.resume : text.finished;
  return <main>
    <header className="page-header"><a className="brand" href="#flow">TOC<span>{text.title}</span></a>
      <fieldset className="language-picker"><legend>{text.language}</legend><button type="button" lang="ru" aria-pressed={language === 'ru'} onClick={() => setLanguage('ru')}>Русский</button><button type="button" lang="en" aria-pressed={language === 'en'} onClick={() => setLanguage('en')}>English</button></fieldset>
    </header>
    <div className="intro"><h1>{text.diagram}</h1><p>{text.subtitle}</p></div>
    <section id="flow" className="diagram-panel" aria-label={text.diagram} data-time-ms={view?.model.timeMs ?? 0} data-playback={status} data-speed={view?.speed ?? 60} data-reduced={manualReduced || systemReduced}>
      <div className="diagram-controls">
        <div className="playback-buttons"><button className="play-button" type="button" disabled={!view || terminal} onClick={() => {if (status === 'ready') runner.current?.start(); else if (status === 'running') runner.current?.pause(); else runner.current?.resume();}}>{playLabel}</button>
          <button type="button" disabled={!view || terminal} onClick={() => runner.current?.step()}>{text.step}</button>
          <label className="speed-picker">{text.speed}<select aria-label={text.speed} value={view?.speed ?? 60} onChange={event => runner.current?.setSpeed(event.target.value === 'max' ? 'max' : Number(event.target.value))}><option value="60">{text.speed60}</option><option value="300">{text.speed300}</option><option value="1800">{text.speed1800}</option><option value="max">{text.max}</option></select></label>
        </div>
        <div className="model-clock"><span>{text.day} {time.dayIndex + 1}</span><strong>{clock}</strong><span className={`playback-state playback-${status}`}>{status === 'paused' ? text.pausedView : status === 'running' ? text.running : status === 'finished' ? text.finished : status === 'error' ? text.error : text.ready}</span></div>
      </div>
      <div className="diagram-context"><p>{text.preview}</p><label title={systemReduced ? text.systemMotion : undefined}><input type="checkbox" checked={manualReduced || systemReduced} disabled={systemReduced} onChange={event => setManualReduced(event.target.checked)}/>{text.lessMotion}</label></div>
      {view && <FlowDiagram run={previewRun} view={view} text={text} reduced={manualReduced || systemReduced}/>}
      <p className="scroll-note">{text.scroll}</p>
      <div className="material-key" aria-label={text.material}>{previewRun.source.materials.map(material => <span key={material.id}><i style={{background: material.color}}/>{nameFor(material.id, material.name, text)}</span>)}</div>
      {view?.error && <p role="alert" className="run-error">{view.error.messages[language]}</p>}
    </section>
  </main>;
}
