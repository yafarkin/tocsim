// Development-only regression page. Not an entry point of the standalone build.
import {StrictMode, useEffect, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {App} from '../src/App';
import {Runner} from '../src/runner/runner';
import {Simulation} from '../src/engine/simulation';
import {readUiMode, UI_MODE_STORAGE_KEY, useUiMode} from '../src/ui/ui-mode';
import '../src/styles.css';

// Observe real instances without adding a test-only simulation API to App.
const instances = new Set<Runner>();
let current: Runner | undefined, disposals = 0;
const originalSpeed = Runner.prototype.setSpeed, originalDispose = Runner.prototype.dispose;
Runner.prototype.setSpeed = function(speed) {
  instances.add(this); current = this;
  return originalSpeed.call(this, speed);
};
Runner.prototype.dispose = function() {
  if (this.getView().status !== 'disposed') disposals++;
  return originalDispose.call(this);
};
const storageDescriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');
let originalPreference: string | null = null;
try {originalPreference = localStorage.getItem(UI_MODE_STORAGE_KEY);} catch { /* Optional. */ }
function restoreStorage() {
  if (storageDescriptor) Object.defineProperty(window, 'localStorage', storageDescriptor);
  try {
    if (originalPreference === null) localStorage.removeItem(UI_MODE_STORAGE_KEY);
    else localStorage.setItem(UI_MODE_STORAGE_KEY, originalPreference);
  } catch { /* Optional. */ }
}
window.addEventListener('pagehide', restoreStorage);

function serialize(value: unknown) {
  return JSON.stringify(value, (_key, item: unknown) => typeof item === 'bigint' ? {bigint: item.toString()} : item);
}
function formValues(running: boolean) {
  return JSON.stringify([...document.querySelectorAll<HTMLInputElement | HTMLSelectElement>('main input, main select')]
    .filter(element => !running || !element.closest('.flow-charts'))
    .map(element => [element.getAttribute('aria-label'), element.type, element.value,
      element instanceof HTMLInputElement ? element.checked : null, element.disabled]));
}
function alerts() {return [...document.querySelectorAll('main [role="alert"]')].map(element => element.textContent);}
function capture() {
  if (!current) throw new Error('Runner is not ready');
  const view = current.getView();
  return {runner: current, run: current.runConfig, config: serialize(current.runConfig), view,
    snapshot: serialize(view), instances: instances.size, disposals,
    fields: formValues(view.status === 'running'), alerts: JSON.stringify(alerts())};
}
function CheckPage() {
  const [mode, setMode] = useUiMode();
  const before = useRef<ReturnType<typeof capture> | null>(null);
  const [result, setResult] = useState<object>({ready: false});
  useEffect(() => {
    const previous = before.current;
    if (!previous || !current) return;
    before.current = null;
    const view = current.getView();
    const checks = {
      sameRunner: current === previous.runner, sameConfig: current.runConfig === previous.run,
      sameConfigData: serialize(current.runConfig) === previous.config,
      noNewRunner: instances.size === previous.instances, noDisposal: disposals === previous.disposals,
      sameStatus: view.status === previous.view.status, sameSpeed: view.speed === previous.view.speed,
      sameResult: previous.view.status === 'running' ? view.model.timeMs >= previous.view.model.timeMs : serialize(view) === previous.snapshot,
      sameFields: formValues(previous.view.status === 'running') === previous.fields,
      sameErrors: JSON.stringify(alerts()) === previous.alerts,
      displayedMode: document.querySelector('main')?.getAttribute('data-ui-mode') === mode,
    };
    setResult({pass: Object.values(checks).every(Boolean), mode, status: view.status, timeMs: view.model.timeMs,
      seed: current.runConfig.resolved.seed, hash: current.runConfig.calculationHash, checks});
  }, [mode]);
  return <>
    <aside aria-label="Проверка режима" style={{padding: 12, borderBottom: '2px solid currentColor'}}>
      <p>Служебная проверка № 125. В обоих режимах пока показан прежний полный экран.</p>
      <button onClick={() => {before.current = capture(); setMode(mode === 'simple' ? 'expert' : 'simple');}}>Сменить режим (проверка)</button>{' '}
      <button onClick={() => {
        if (!current || current.getView().status !== 'finished') {setResult({pass: false, reason: 'Finish the run first'}); return;}
        const reference = new Simulation(current.runConfig).runToEnd();
        setResult({pass: serialize(reference) === serialize(current.getView().model), check: 'Full final snapshot equals independent simulation'});
      }}>Проверить итог с движком</button>{' '}
      <button onClick={() => {
        if (!current) return;
        const step = Simulation.prototype.step;
        try {
          Simulation.prototype.step = () => {throw new Error('Injected regression failure');};
          current.step();
        } finally {Simulation.prototype.step = step;}
      }}>Ошибка расчёта (проверка)</button>{' '}
      <button onClick={() => {
        Object.defineProperty(window, 'localStorage', {configurable: true, get() {throw new Error('Storage blocked for regression check');}});
        setResult({pass: readUiMode() === 'simple', check: 'Blocked storage falls back to simple'});
      }}>Заблокировать хранение (проверка)</button>{' '}
      <button onClick={restoreStorage}>Восстановить хранение</button>
      <output data-testid="mode-check-result"><pre>{JSON.stringify(result, null, 2)}</pre></output>
    </aside>
    <App mode={mode}/>
  </>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><CheckPage/></StrictMode>);
