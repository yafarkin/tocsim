import {useEffect, useRef, useState} from 'react';
import {ConfigError} from '../engine/config';
import type {EditorConfig, RunConfig} from '../engine/config';
import {calendarForDuration} from '../engine/calendar';
import type {Language} from '../ui/i18n';
import {appendLinearStation, compileLinearProcess, createLinearProcess, moveLinearStation, removeLinearStation} from './linear-process';
import {configFromDraft, processDraft} from './process-form';
import type {BufferDraft, ProcessDraft} from './process-form';
import {copyImportedProcess, exportProcessJson, readProcessJsonFile} from './process-json';
import {openProcessStorage} from './process-storage';
import type {ProcessEntry, ProcessStorageIssue} from './process-storage';
import type {PlaybackStatus} from '../runner/runner';
import {ProcessPlayback} from './ProcessPlayback';

const words = {
  ru: {title: 'Мои процессы', back: 'К урокам и примерам', create: 'Создать процесс', empty: 'Создайте процесс или откройте файл JSON.',
    library: 'Сохранённые процессы', open: 'Открыть', save: 'Сохранить', copy: 'Создать копию', remove: 'Удалить процесс',
    import: 'Импорт JSON', export: 'Экспорт JSON', name: 'Название процесса', stationName: 'Название поста', minutes: 'Время обработки, мин',
    shifts: 'Число смен', cv: 'CV', input: 'Входной буфер', output: 'Выходной буфер', defaults: 'Общие буферы',
    inherit: 'Общий буфер', quantity: 'Количество', infinite: 'Без ограничения', shift: 'Доля смены', amount: 'Значение',
    add: 'Добавить пост', up: 'Выше', down: 'Ниже', removeStation: 'Удалить пост', station: 'Пост',
    saved: 'Сохранено в браузере', unsaved: 'Есть несохранённые изменения', memory: 'Только в памяти вкладки. Экспортируйте JSON до закрытия.',
    materials: 'Материалы', materialName: 'Название материала', recipe: 'Рецепт', recipeName: 'Название рецепта',
    recipeInput: 'Входной материал', recipeOutput: 'Выходной материал', inputQuantity: 'Расход за обработку', outputQuantity: 'Выпуск за обработку',
    recipeHelp: 'Вход поступает от предыдущего поста или источника. Количество выхода должно быть целым. Время обработки относится ко всему указанному комплекту.',
    materialsHelp: 'В цепочке материалы связаны автоматически. Названия материалов сохраняются независимо от названий постов.',
    raw: 'Сырьё', intermediate: 'Промежуточный материал', finished: 'Готовый продукт', edit: 'Цепочка', select: 'Выберите процесс слева или создайте новый.', cancel: 'Отмена', discard: 'Отбросить изменения',
    leave: 'Сохранить изменения перед переходом?', deleteQuestion: 'Удалить выбранный процесс из библиотеки?', confirmDelete: 'Да, удалить',
    preview: 'Проверка импорта', accept: 'Импортировать как новый процесс', count: 'Постов', conditions: 'Условия процесса',
    calendar: 'Смена 08:00–17:00, обед 12:00–13:00. Рабочие дни повторяются.',
    fixed: 'Источник: 1 единица каждые 3 минуты. Одна обработка за раз, порог передачи 1. Количества определяются рецептами. Начальные запасы, брак, переналадки, обслуживание и затраты нулевые. Производство по готовности.',
    note: 'Создайте цепочку, задайте условия и запустите свой процесс.',
    run: 'Запустить процесс', toRun: 'К прогону', runLocked: 'Условия работающего прогона зафиксированы. Для изменений создайте копию. Перед новым запуском или переходом к урокам остановите текущий прогон.',
    loading: 'Чтение файла…', readError: 'Не удалось выполнить действие.', reload: 'Перечитать сохранённый процесс',
    reloadHelp: 'Перечитывание заменит текущую форму. Свою версию можно сначала сохранить копией.',
    fileLimit: 'Один линейный процесс, до 30 постов. Файл JSON до 2 МиБ.', bufferHelp: 'Посты наследуют общие буферы, пока вы не зададите собственные. Вход можно задать долей рабочей смены.',
    seedHelp: 'Seed задаёт повторяемую случайную последовательность. CV 0 означает постоянное время.',
    notSaved: 'Не сохранён в браузере', copied: 'Копия', deleted: 'Процесс удалён',
    deleteMemory: 'Удалён только из списка в памяти вкладки. В браузере запись могла остаться.',
  },
  en: {title: 'My processes', back: 'Lessons and examples', create: 'Create process', empty: 'Create a process or open a JSON file.',
    library: 'Saved processes', open: 'Open', save: 'Save', copy: 'Create copy', remove: 'Delete process',
    import: 'Import JSON', export: 'Export JSON', name: 'Process name', stationName: 'Station name', minutes: 'Processing time, min',
    shifts: 'Number of shifts', cv: 'CV', input: 'Input buffer', output: 'Output buffer', defaults: 'Global buffers',
    inherit: 'Global buffer', quantity: 'Quantity', infinite: 'Unlimited', shift: 'Shift fraction', amount: 'Value',
    add: 'Add station', up: 'Move up', down: 'Move down', removeStation: 'Remove station', station: 'Station',
    saved: 'Saved in browser', unsaved: 'Unsaved changes', memory: 'Only in this tab. Export JSON before closing.',
    materials: 'Materials', materialName: 'Material name', recipe: 'Recipe', recipeName: 'Recipe name',
    recipeInput: 'Input material', recipeOutput: 'Output material', inputQuantity: 'Consumed per operation', outputQuantity: 'Produced per operation',
    recipeHelp: 'Input comes from the preceding station or source. Output quantity must be a whole number. Processing time applies to the entire specified kit.',
    materialsHelp: 'Chain materials are connected automatically. Material names are saved independently of station names.',
    raw: 'Raw material', intermediate: 'Intermediate material', finished: 'Finished product', edit: 'Chain', select: 'Select a process from the list or create one.', cancel: 'Cancel', discard: 'Discard changes',
    leave: 'Save changes before leaving?', deleteQuestion: 'Delete the selected process from the library?', confirmDelete: 'Yes, delete',
    preview: 'Import preview', accept: 'Import as a new process', count: 'Stations', conditions: 'Process conditions',
    calendar: 'Shift 08:00–17:00, lunch 12:00–13:00. Working days repeat.',
    fixed: 'Source: 1 unit every 3 minutes. One operation at a time, transfer threshold 1. Quantities are defined by recipes. Zero initial stock, defects, setups, maintenance and costs. Production when ready.',
    note: 'Create a chain, set its conditions and run your process.',
    run: 'Run process', toRun: 'Go to run', runLocked: 'The active run has fixed conditions. Create a copy to edit them. Stop the current run before starting another or returning to lessons.',
    loading: 'Reading file…', readError: 'Could not complete the action.', reload: 'Reopen saved process',
    reloadHelp: 'Reopening replaces the current form. You can save your version as a copy first.',
    fileLimit: 'One linear process, up to 30 stations. JSON file up to 2 MiB.', bufferHelp: 'Stations inherit global buffers until you set their own. Input buffers can use a fraction of a working shift.',
    seedHelp: 'Seed makes the random sequence repeatable. CV 0 means constant processing time.',
    notSaved: 'Not saved in browser', copied: 'Copy', deleted: 'Process deleted',
    deleteMemory: 'Removed only from this tab’s list. The browser record may still exist.',
  },
};
type Text = typeof words[Language];
interface Session {
  id: string; revision: number; persisted: boolean; config: EditorConfig; draft: ProcessDraft; saved: EditorConfig | null;
}
function newId(): string {return `process-${crypto.randomUUID()}`;}
function fromEntry(entry: ProcessEntry): Session {
  const config = structuredClone(entry.record.config);
  return {id: entry.record.id, revision: entry.record.revision, persisted: entry.persisted,
    config, draft: processDraft(config), saved: structuredClone(config)};
}

function BufferFields({label, value, global = false, input, onChange, text, invalid}: {
  label: string; value: BufferDraft; global?: boolean; input: boolean; text: Text; invalid: boolean; onChange: (value: BufferDraft) => void;
}) {
  return <div className="process-buffer"><label>{label}<select value={value.kind} aria-label={label} onChange={event => {
    const kind = event.target.value as BufferDraft['kind'];
    onChange({kind, value: kind === 'shift' ? '0.5' : kind === 'quantity' ? '1' : ''});
  }}>{!global && <option value="inherit">{text.inherit}</option>}<option value="quantity">{text.quantity}</option>
    {input && <option value="shift">{text.shift}</option>}<option value="infinite">{text.infinite}</option></select></label>
    {(value.kind === 'quantity' || value.kind === 'shift') && <label>{text.amount}<input inputMode="decimal" value={value.value}
      aria-label={`${label}: ${text.amount}`} aria-invalid={invalid} aria-describedby={invalid ? 'process-error' : undefined}
      onChange={event => onChange({...value, value: event.target.value})}/></label>}
  </div>;
}

export function ProcessEditor({language, active = true, onBack}: {language: Language; active?: boolean; onBack: () => void}) {
  const text = words[language];
  const [store] = useState(() => openProcessStorage());
  const [entries, setEntries] = useState(() => store.list());
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<ConfigError | null>(null);
  const [storageIssue, setStorageIssue] = useState<ProcessStorageIssue | null>(null);
  const [notice, setNotice] = useState<'deleted' | 'deleteMemory' | null>(null);
  const [pending, setPending] = useState<(() => void) | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [preview, setPreview] = useState<EditorConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [experiment, setExperiment] = useState<{id: string; recordId: string; run: RunConfig} | null>(null);
  const [playbackStatus, setPlaybackStatus] = useState<PlaybackStatus>('ready');
  const runBusy = playbackStatus === 'running' || playbackStatus === 'paused';
  const locked = runBusy && experiment?.recordId === session?.id;
  const dialog = useRef<HTMLDialogElement>(null);
  const dirty = !!session && (!session.saved || JSON.stringify(session.draft) !== JSON.stringify(processDraft(session.saved)));
  const modal = !!pending || deleting || !!preview;
  useEffect(() => {
    const element = dialog.current;
    if (modal && !element?.open) element?.showModal();
    else if (!modal && element?.open) element.close();
  }, [modal]);
  useEffect(() => {
    if (!(active && dirty) && !entries.some(entry => !entry.persisted)) return;
    const warn = (event: BeforeUnloadEvent) => {event.preventDefault(); event.returnValue = '';};
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [active, dirty, entries]);

  function clearMessages() {setError(null); setStorageIssue(null); setNotice(null);}
  function guard(action: () => void) {if (dirty) setPending(() => action); else action();}
  function edit(next: ProcessDraft) {if (session) setSession({...session, draft: next}); setError(null); setNotice(null);}
  function attempt(action: () => void) {
    try {action();} catch (failure) {
      setError(failure instanceof ConfigError ? failure : new ConfigError('value', 'file', null,
        {ru: words.ru.readError, en: words.en.readError}));
    }
  }
  function start(config: EditorConfig) {
    clearMessages(); setSession({id: newId(), revision: 0, persisted: false, config, draft: processDraft(config), saved: null});
  }
  function save(): boolean {
    if (!session) return true;
    let done = false;
    attempt(() => {
      const config = configFromDraft(session.config, session.draft), result = store.save(session.id, config, session.revision);
      setStorageIssue(result.issue); setEntries(store.list());
      if (result.issue && result.issue.code !== 'unavailable') return;
      const entry = store.list().find(entry => entry.record.id === session.id)!;
      setSession(fromEntry(entry)); setError(null); done = true;
    });
    return done;
  }
  function structure(action: (config: EditorConfig) => EditorConfig) {
    if (!session) return;
    attempt(() => {
      const config = action(configFromDraft(session.config, session.draft));
      setSession({...session, config, draft: processDraft(config)}); setError(null);
    });
  }
  function discardAndContinue() {
    if (session?.saved) setSession({...session, config: structuredClone(session.saved), draft: processDraft(session.saved)});
    else setSession(null);
    const next = pending; setPending(null); clearMessages(); next?.();
  }
  function exportFile() {
    if (!session) return;
    attempt(() => {
      const config = configFromDraft(session.config, session.draft), json = exportProcessJson(config);
      const url = URL.createObjectURL(new Blob([json], {type: 'application/json'}));
      const link = document.createElement('a'); link.href = url; link.download = `${config.id}.json`;
      document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); setError(null);
    });
  }
  async function importFile(file: File) {
    clearMessages(); setBusy(true);
    try {setPreview(await readProcessJsonFile(file));}
    catch (failure) {attempt(() => {
      if (failure instanceof ConfigError) throw new ConfigError(failure.code, 'file', null,
        {ru: `Импорт: ${failure.messages.ru}`, en: `Import: ${failure.messages.en}`});
      throw failure;
    });}
    finally {setBusy(false);}
  }
  function acceptImport() {
    if (!preview) return;
    const imported = preview; setPreview(null);
    guard(() => attempt(() => {
      const config = copyImportedProcess(imported, newId()), id = newId();
      const result = store.save(id, config, 0);
      setEntries(store.list()); setSession(fromEntry(store.list().find(entry => entry.record.id === id)!));
      setStorageIssue(result.issue); setError(null);
    }));
  }
  function reopen() {
    if (!session) return;
    guard(() => {
      const result = store.read(session.id); setEntries(store.list()); setStorageIssue(result.issue);
      if (!result.issue) {setSession(result.entry ? fromEntry(result.entry) : null); setError(null);}
    });
  }
  const fieldError = (field: string, stationId: string | null = null) => !!error
    && (stationId ? error.objectId === stationId && (error.path.endsWith(field) || error.path.includes(`.${field}.`))
      : error.path === `config.${field}` || error.path.startsWith(`config.${field}.`));
  const selectedEntry = session && entries.find(entry => entry.record.id === session.id);
  const previewShifts = preview && calendarForDuration(preview.calendar, preview.durationMs).days;
  const previewDraft = preview && processDraft(preview);
  const bufferText = (rule: BufferDraft) => `${text[rule.kind === 'inherit' ? 'inherit' : rule.kind === 'infinite' ? 'infinite' : rule.kind === 'shift' ? 'shift' : 'quantity']}${rule.value ? `: ${rule.value}` : ''}`;

  return <section className="process-editor" aria-labelledby="process-title" hidden={!active}>
    <div className="process-heading"><div><h1 id="process-title">{text.title}</h1><p>{text.note}</p></div>
      <button type="button" disabled={busy || runBusy} onClick={() => guard(onBack)}>{text.back}</button></div>
    {experiment && <p className="process-help">{runBusy && <>{text.runLocked} </>}<a href="#process-playback">{text.toRun}: {experiment.run.source.name}</a></p>}
    <fieldset className="process-workspace" disabled={busy}><legend>{text.title}</legend>
      <aside className="process-library" aria-label={text.library}>
        <div className="process-actions"><button type="button" onClick={() => guard(() => start(createLinearProcess(newId(), language)))}>{text.create}</button>
          <label className="process-file">{text.import}<input type="file" accept=".json,application/json" onChange={event => {
            const file = event.target.files?.[0]; event.target.value = ''; if (file) void importFile(file);
          }}/></label></div>
        <p className="process-help">{text.fileLimit}</p><h2>{text.library}</h2>
        {entries.length === 0 ? <p>{text.empty}</p> : <ul>{entries.map(entry => <li key={entry.record.id}>
          <button type="button" aria-current={entry.record.id === session?.id ? 'true' : undefined} onClick={() => {
            if (entry.record.id === session?.id) return;
            guard(() => {clearMessages(); setSession(fromEntry(entry));});
          }}>{entry.record.config.name}<span>{entry.record.config.stations.length} {text.count.toLowerCase()}{!entry.persisted && ` · ${text.notSaved}`}</span></button>
        </li>)}</ul>}
        {store.issues().map((issue, i) => <p role="status" className="process-help" key={i}>{issue[language]}{issue.key && <span className="process-record-key">{issue.key}</span>}</p>)}
      </aside>
      <div className="process-detail">
        <div role="status" aria-live="polite">{busy ? text.loading : notice ? text[notice] : session ? dirty ? text.unsaved : session.persisted ? text.saved : text.memory : ''}</div>
        {storageIssue && notice !== 'deleteMemory' && <div className="process-warning" role="alert"><p>{storageIssue[language]}</p>
          {storageIssue.code === 'unavailable' && <p>{text.memory}</p>}
          {storageIssue.code === 'conflict' && <><p>{text.reloadHelp}</p><button type="button" onClick={reopen}>{text.reload}</button></>}
        </div>}
        {error && <p className="process-error" id="process-error" role="alert">{error.objectId && `${session?.draft.stations.find(item => item.id === error.objectId)?.name ?? session?.draft.materials.find(item => item.id === error.objectId)?.name ?? session?.draft.stations.find(item => item.recipeId === error.objectId)?.recipeName ?? error.objectId}: `}{error.messages[language]}</p>}
        {!session ? <p>{text.select}</p> : <>
          <div className="process-actions process-save"><button type="button" disabled={runBusy} onClick={() => attempt(() => {
            const run = compileLinearProcess(configFromDraft(session.config, session.draft));
            setError(null); setPlaybackStatus('running');
            setExperiment({id: newId(), recordId: session.id, run});
          })}>{text.run}</button><button type="button" disabled={locked} onClick={save}>{text.save}</button>
            <button type="button" onClick={() => attempt(() => {
              const config = copyImportedProcess(configFromDraft(session.config, session.draft), newId());
              config.name += ` (${text.copied})`; start(config);
            })}>{text.copy}</button>
            <button type="button" onClick={exportFile}>{text.export}</button>
            <button type="button" disabled={!selectedEntry || locked} onClick={() => setDeleting(true)}>{text.remove}</button></div>
          <fieldset className="process-form-fields" disabled={locked}>
          <div className="process-general">
            <label className="process-name">{text.name}<input value={session.draft.name} aria-invalid={fieldError('name')} onChange={event => edit({...session.draft, name: event.target.value})}/></label>
            <label>Seed<input inputMode="numeric" value={session.draft.seed} aria-invalid={fieldError('seed')} onChange={event => edit({...session.draft, seed: event.target.value})}/></label>
            <label>{text.shifts}<input inputMode="numeric" value={session.draft.shifts} aria-invalid={fieldError('durationMs')} onChange={event => edit({...session.draft, shifts: event.target.value})}/></label>
          </div><p className="process-help">{text.seedHelp}</p>
          <fieldset className="process-defaults"><legend>{text.defaults}</legend>
            <BufferFields global input label={text.input} text={text} value={session.draft.input} invalid={fieldError('bufferDefaults.input')} onChange={input => edit({...session.draft, input})}/>
            <BufferFields global input={false} label={text.output} text={text} value={session.draft.output} invalid={fieldError('bufferDefaults.output')} onChange={output => edit({...session.draft, output})}/>
            <p className="process-help">{text.bufferHelp}</p></fieldset>
          <h2>{text.materials}</h2><p className="process-help">{text.materialsHelp}</p>
          <div className="process-materials">{session.draft.materials.map(material => <label key={material.id}>
            {text.materialName}: {text[session.config.materials.find(item => item.id === material.id)!.role]}
            <input value={material.name} aria-invalid={fieldError('name', material.id)} onChange={event => edit({...session.draft,
              materials: session.draft.materials.map(item => item.id === material.id ? {...item, name: event.target.value} : item)})}/>
          </label>)}</div>
          <h2>{text.edit} ({session.draft.stations.length}/30)</h2>
          <ol className="process-stations">{session.draft.stations.map((station, index) => {
            const update = (patch: Partial<typeof station>) => edit({...session.draft, stations: session.draft.stations.map(item => item.id === station.id ? {...item, ...patch} : item)});
            return <li key={station.id}><fieldset><legend>{text.station} {index + 1}</legend>
              <div className="process-station-fields">
                <label className="process-name">{text.stationName}<input value={station.name} aria-invalid={fieldError('name', station.id)} onChange={event => update({name: event.target.value})}/></label>
                <label>{text.minutes}<input inputMode="decimal" value={station.minutes} aria-invalid={fieldError('timeMs', station.id)} onChange={event => update({minutes: event.target.value})}/></label>
                <label>{text.cv}<input inputMode="decimal" value={station.cv} aria-invalid={fieldError('cv', station.id)} onChange={event => update({cv: event.target.value})}/></label>
                <BufferFields input text={text} label={`${text.station} ${index + 1}: ${text.input}`} value={station.input} invalid={fieldError('inputBuffer', station.id)} onChange={input => update({input})}/>
                <BufferFields input={false} text={text} label={`${text.station} ${index + 1}: ${text.output}`} value={station.output} invalid={fieldError('outputBuffer', station.id)} onChange={output => update({output})}/>
              </div><fieldset className="process-recipe"><legend>{text.recipe}</legend>
                <label>{text.recipeName}<input value={station.recipeName} aria-invalid={fieldError('name', station.recipeId)} onChange={event => update({recipeName: event.target.value})}/></label>
                <div className="process-recipe-quantities">
                  <label>{text.recipeInput}<input readOnly value={session.draft.materials.find(item => item.id === station.inputMaterialId)!.name}/></label>
                  <label>{text.inputQuantity}<input inputMode="decimal" value={station.inputQuantity} aria-invalid={fieldError('inputs', station.recipeId)} onChange={event => update({inputQuantity: event.target.value})}/></label>
                  <label>{text.recipeOutput}<input readOnly value={session.draft.materials.find(item => item.id === station.outputMaterialId)!.name}/></label>
                  <label>{text.outputQuantity}<input inputMode="numeric" value={station.outputQuantity} aria-invalid={fieldError('output', station.recipeId)} onChange={event => update({outputQuantity: event.target.value})}/></label>
                </div><p className="process-help">{text.recipeHelp}</p>
              </fieldset><div className="process-actions">
                <button type="button" disabled={index === 0} aria-label={`${text.up}: ${station.name}`} onClick={() => structure(config => moveLinearStation(config, station.id, -1))}>{text.up}</button>
                <button type="button" disabled={index === session.draft.stations.length - 1} aria-label={`${text.down}: ${station.name}`} onClick={() => structure(config => moveLinearStation(config, station.id, 1))}>{text.down}</button>
                <button type="button" disabled={session.draft.stations.length === 1} aria-label={`${text.removeStation}: ${station.name}`} onClick={() => structure(config => removeLinearStation(config, station.id))}>{text.removeStation}</button>
              </div></fieldset></li>;
          })}</ol>
          <button type="button" disabled={session.draft.stations.length >= 30} onClick={() => structure(config => appendLinearStation(config, `${text.station} ${config.stations.length + 1}`, 180_000))}>{text.add}</button>
          <details className="process-conditions"><summary>{text.conditions}</summary><p>{text.calendar}</p><p>{text.fixed}</p></details>
          </fieldset>
        </>}
      </div>
    </fieldset>
    <dialog ref={dialog} className="process-dialog" onCancel={event => {event.preventDefault(); setPending(null); setDeleting(false); setPreview(null);}} aria-labelledby="process-dialog-title">
      <h2 id="process-dialog-title">{preview ? text.preview : deleting ? text.deleteQuestion : text.leave}</h2>
      {pending && error && <p className="process-error" role="alert">{error.messages[language]}</p>}
      {pending && storageIssue && <p className="process-warning" role="alert">{storageIssue[language]}</p>}
      {preview && <><p>{preview.name}</p><p>{text.count}: {preview.stations.length}. {text.shifts}: {previewShifts}. Seed: {preview.seed}.</p>
        <p>{text.calendar}</p><p>{text.fixed}</p>
        {previewDraft && <><ul>{previewDraft.materials.map(material => <li key={material.id}>{material.name}</li>)}</ul><p>{text.defaults}. {text.input}: {bufferText(previewDraft.input)}; {text.output}: {bufferText(previewDraft.output)}.</p>
          <ul>{previewDraft.stations.map(station => <li key={station.id}>{station.name}: {station.minutes} {language === 'ru' ? 'мин' : 'min'}, CV {station.cv}.
            {' '}{station.recipeName}: {station.inputQuantity} {previewDraft.materials.find(item => item.id === station.inputMaterialId)!.name} → {station.outputQuantity} {previewDraft.materials.find(item => item.id === station.outputMaterialId)!.name}.
            {' '}{text.input}: {bufferText(station.input)}; {text.output}: {bufferText(station.output)}.</li>)}</ul></>}</>}
      {deleting && <p>{session?.saved?.name ?? session?.draft.name}</p>}
      <div className="process-actions"><button type="button" autoFocus onClick={() => {setPending(null); setDeleting(false); setPreview(null);}}>{text.cancel}</button>
        {preview ? <button type="button" onClick={acceptImport}>{text.accept}</button> : deleting ? <button type="button" onClick={() => {
          if (!session) return;
          const result = store.remove(session.id, session.revision); setStorageIssue(result.issue); setEntries(store.list());
          if (!result.issue || result.issue.code === 'unavailable') {setSession(null); setNotice(result.issue ? 'deleteMemory' : 'deleted');}
          setDeleting(false);
        }}>{text.confirmDelete}</button> : pending && <><button type="button" onClick={() => {if (save()) {const next = pending; setPending(null); next();}}}>{text.save}</button>
          <button type="button" onClick={discardAndContinue}>{text.discard}</button></>}
      </div>
    </dialog>
    {experiment && <ProcessPlayback key={experiment.id} run={experiment.run} language={language} active={active} onStatus={setPlaybackStatus}/>}
  </section>;
}
