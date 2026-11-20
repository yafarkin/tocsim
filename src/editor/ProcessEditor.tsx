import {useEffect, useMemo, useRef, useState} from 'react';
import {compileConfig, ConfigError} from '@toc/engine';
import type {EditorConfig, RunConfig} from '@toc/engine';
import {calendarForDuration} from '@toc/engine';
import type {Language} from '../ui/i18n';
import {appendLinearStation, compileLinearProcess, createLinearProcess, moveLinearStation, removeLinearStation} from './linear-process';
import {configFromDraft, processDraft} from './process-form';
import type {BufferDraft, ProcessDraft} from './process-form';
import {copyImportedProcess, decodeProcessDocument, exportProcessJson, formatProcessDocument, readProcessDocumentFile} from './process-json';
import {openProcessStorage} from './process-storage';
import type {ProcessEntry, ProcessStorageIssue} from './process-storage';
import type {PlaybackStatus} from '../runner/runner';
import {ProcessPlayback} from './ProcessPlayback';
import {ProcessCanvas} from './ProcessCanvas';
import {ProcessRoutes} from './ProcessRoutes';
import {retainLayout} from './process-layout';
import type {ProcessDocument, ProcessLayout} from './process-layout';

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
    recipeHelp: 'Выберите существующий входной материал и проведите к посту связь с этим материалом. Количество выхода должно быть целым. Время обработки относится ко всему указанному комплекту.',
    materialsHelp: 'Выберите назначение материала: сырьё, промежуточный материал или готовый продукт. Названия сохраняются независимо от названий постов.',
    raw: 'Сырьё', intermediate: 'Промежуточный материал', finished: 'Готовый продукт', edit: 'Посты', select: 'Выберите процесс слева или создайте новый.', cancel: 'Отмена', discard: 'Отбросить изменения',
    leave: 'Сохранить изменения перед переходом?', deleteQuestion: 'Удалить выбранный процесс из библиотеки?', confirmDelete: 'Да, удалить',
    preview: 'Проверка импорта', accept: 'Импортировать как новый процесс', count: 'Постов', conditions: 'Условия процесса',
    calendar: 'Смена 08:00–17:00, обед 12:00–13:00. Рабочие дни повторяются.',
    fixed: 'Источник: 1 единица каждые 3 минуты. Одна обработка за раз, порог передачи 1. Количества определяются рецептами. Начальные запасы, брак, переналадки, обслуживание и затраты нулевые. Производство по готовности.',
    note: 'Создайте схему, задайте условия и запустите свой процесс.',
    run: 'Запустить процесс', toRun: 'К прогону', runLocked: 'Условия работающего прогона зафиксированы. Для изменений создайте копию. Перед новым запуском или переходом к урокам остановите текущий прогон.',
    loading: 'Чтение файла…', readError: 'Не удалось выполнить действие.', reload: 'Перечитать сохранённый процесс',
    reloadHelp: 'Перечитывание заменит текущую форму. Свою версию можно сначала сохранить копией.',
    fileLimit: 'Один процесс в файле JSON до 2 МиБ.', bufferHelp: 'Посты наследуют общие буферы, пока вы не зададите собственные. Вход можно задать долей рабочей смены.',
    role: 'Назначение материала', incomplete: 'Схема не готова. Сохранение, копирование, экспорт и запуск недоступны до исправления.',
    chainOnly: 'Добавление, удаление и перестановка постов пока доступны только для корректной цепочки. Связи можно редактировать ниже.',
    seedHelp: 'Seed задаёт повторяемую случайную последовательность. CV 0 означает постоянное время.',
    notSaved: 'Не сохранён в браузере', copied: 'Копия', deleted: 'Процесс удалён',
    deleteMemory: 'Удалён только из списка в памяти вкладки. В браузере запись могла остаться.',
    json: 'Конфигурация процесса (JSON)', jsonHelp: 'Расширенные настройки этого процесса можно менять в JSON.',
    invalidJson: 'Исправьте конфигурацию, чтобы сохранить, скопировать, экспортировать или запустить процесс.',
    sources: 'Источники', warehouse: 'Конечный запас', virtual: 'Неограниченный запас',
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
    recipeHelp: 'Select an existing input material and connect a producer of that material to this station. Output quantity must be a whole number. Processing time applies to the entire specified kit.',
    materialsHelp: 'Choose each material’s role: raw, intermediate or finished. Names are saved independently of station names.',
    raw: 'Raw material', intermediate: 'Intermediate material', finished: 'Finished product', edit: 'Stations', select: 'Select a process from the list or create one.', cancel: 'Cancel', discard: 'Discard changes',
    leave: 'Save changes before leaving?', deleteQuestion: 'Delete the selected process from the library?', confirmDelete: 'Yes, delete',
    preview: 'Import preview', accept: 'Import as a new process', count: 'Stations', conditions: 'Process conditions',
    calendar: 'Shift 08:00–17:00, lunch 12:00–13:00. Working days repeat.',
    fixed: 'Source: 1 unit every 3 minutes. One operation at a time, transfer threshold 1. Quantities are defined by recipes. Zero initial stock, defects, setups, maintenance and costs. Production when ready.',
    note: 'Create a graph, set its conditions and run your process.',
    run: 'Run process', toRun: 'Go to run', runLocked: 'The active run has fixed conditions. Create a copy to edit them. Stop the current run before starting another or returning to lessons.',
    loading: 'Reading file…', readError: 'Could not complete the action.', reload: 'Reopen saved process',
    reloadHelp: 'Reopening replaces the current form. You can save your version as a copy first.',
    fileLimit: 'One process per JSON file, up to 2 MiB.', bufferHelp: 'Stations inherit global buffers until you set their own. Input buffers can use a fraction of a working shift.',
    role: 'Material role', incomplete: 'The graph is incomplete. Save, copy, export and run are unavailable until it is fixed.',
    chainOnly: 'Adding, removing and reordering stations currently requires a valid chain. Edit connections below.',
    seedHelp: 'Seed makes the random sequence repeatable. CV 0 means constant processing time.',
    notSaved: 'Not saved in browser', copied: 'Copy', deleted: 'Process deleted',
    deleteMemory: 'Removed only from this tab’s list. The browser record may still exist.',
    json: 'Process configuration (JSON)', jsonHelp: 'You can edit this process’s advanced settings in JSON.',
    invalidJson: 'Fix the configuration to save, copy, export or run the process.',
    sources: 'Sources', warehouse: 'Finite stock', virtual: 'Unlimited stock',
  },
};
type Text = typeof words[Language];
interface Session {
  id: string; revision: number; persisted: boolean; config: EditorConfig;
  draft: ProcessDraft | string; savedDraft: ProcessDraft | string | null; savedConfig: EditorConfig | null;
  layout: ProcessLayout; savedLayout: ProcessLayout;
}
function newId(): string {return `process-${crypto.randomUUID()}`;}
function formDraft(config: EditorConfig): ProcessDraft | null {
  try {return processDraft(config);}
  catch (error) {
    if (!(error instanceof ConfigError) || error.code !== 'unsupported') throw error;
    return null;
  }
}

function fromEntry(entry: ProcessEntry): Session {
  const {config, layout} = structuredClone(entry.record);
  const draft = formDraft(config) ?? formatProcessDocument({config, layout});
  return {id: entry.record.id, revision: entry.record.revision, persisted: entry.persisted,
    config, draft, savedDraft: draft, savedConfig: config, layout, savedLayout: layout};
}

function documentFromSession(session: Session): ProcessDocument {
  const {config, draft, savedDraft, layout} = session;
  if (draft === savedDraft) return {config, layout};
  if (typeof draft === 'string') return decodeProcessDocument(draft);
  return {config: configFromDraft(config, draft), layout};
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
  const [preview, setPreview] = useState<ProcessDocument | null>(null);
  const [busy, setBusy] = useState(false);
  const [experiment, setExperiment] = useState<{id: string; recordId: string; run: RunConfig} | null>(null);
  const [playbackStatus, setPlaybackStatus] = useState<PlaybackStatus>('ready');
  const runBusy = playbackStatus === 'running' || playbackStatus === 'paused';
  const locked = runBusy && experiment?.recordId === session?.id;
  const dialog = useRef<HTMLDialogElement>(null);
  const draftChanged = session && (typeof session.draft === 'string' ? session.draft !== session.savedDraft
    : JSON.stringify(session.draft) !== JSON.stringify(session.savedDraft));
  const dirty = !!session && (draftChanged
    || JSON.stringify(session.layout) !== JSON.stringify(session.savedLayout));
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
  function edit(next: ProcessDraft | string) {if (session) setSession({...session, draft: next}); setError(null); setNotice(null);}
  function attempt(action: () => void) {
    try {action();} catch (failure) {
      setError(failure instanceof ConfigError ? failure : new ConfigError('value', 'file', null,
        {ru: words.ru.readError, en: words.en.readError}));
    }
  }
  function start(config: EditorConfig, layout: ProcessLayout = {positions: []}) {
    clearMessages(); setSession({id: newId(), revision: 0, persisted: false, config, draft: formDraft(config) ?? formatProcessDocument({config, layout}),
      savedDraft: null, savedConfig: null, layout: structuredClone(layout), savedLayout: {positions: []}});
  }
  function save(): boolean {
    if (!session) return true;
    let done = false;
    attempt(() => {
      const {config, layout} = documentFromSession(session);
      const result = store.save(session.id, config, session.revision, layout);
      setStorageIssue(result.issue); setEntries(store.list());
      if (result.issue && result.issue.code !== 'unavailable') return;
      const entry = store.list().find(entry => entry.record.id === session.id)!;
      setSession(fromEntry(entry)); setError(null); done = true;
    });
    return done;
  }
  function structure(action: (config: EditorConfig) => EditorConfig) {
    if (!session || typeof session.draft === 'string') return;
    attempt(() => {
      const config = action(documentFromSession(session).config);
      const layout = retainLayout(config, session.layout);
      setSession({...session, config, draft: processDraft(config), layout}); setError(null);
    });
  }
  function discardAndContinue() {
    if (session?.savedConfig && session.savedDraft !== null) {
      setSession({...session, config: session.savedConfig, draft: session.savedDraft, layout: session.savedLayout});
    }
    else setSession(null);
    const next = pending; setPending(null); clearMessages(); next?.();
  }
  function exportFile() {
    if (!session) return;
    attempt(() => {
      const {config, layout} = documentFromSession(session);
      const json = exportProcessJson(config, layout);
      const url = URL.createObjectURL(new Blob([json], {type: 'application/json'}));
      const link = document.createElement('a'); link.href = url; link.download = `${config.id}.json`;
      document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); setError(null);
    });
  }
  async function importFile(file: File) {
    clearMessages(); setBusy(true);
    try {setPreview(await readProcessDocumentFile(file));}
    catch (failure) {attempt(() => {
      if (failure instanceof ConfigError) throw new ConfigError(failure.code, failure.path, failure.objectId,
        {ru: `Импорт: ${failure.messages.ru}`, en: `Import: ${failure.messages.en}`});
      throw failure;
    });}
    finally {setBusy(false);}
  }
  function acceptImport() {
    if (!preview) return;
    const imported = preview; setPreview(null);
    guard(() => attempt(() => {
      const config = copyImportedProcess(imported.config, newId()), id = newId();
      const result = store.save(id, config, 0, imported.layout);
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
  const {validationError, chain} = useMemo(() => {
    if (!session) return {validationError: null, chain: false};
    try {
      const {config} = documentFromSession(session);
      if (typeof session.draft === 'string') return {validationError: null, chain: false};
      try {compileLinearProcess(config); return {validationError: null, chain: true};}
      catch (failure) {if (failure instanceof ConfigError) return {validationError: null, chain: false}; throw failure;}
    } catch (failure) {
      if (failure instanceof ConfigError) return {validationError: failure, chain: false};
      throw failure;
    }
  }, [session]);
  const shownError = error ?? validationError;
  const draft = typeof session?.draft === 'string' ? null : session?.draft;
  const fieldError = (field: string, stationId: string | null = null) => !!shownError
    && (stationId ? shownError.objectId === stationId && (shownError.path.endsWith(field) || shownError.path.includes(`.${field}.`))
      : shownError.path === `config.${field}` || shownError.path.startsWith(`config.${field}.`));
  const selectedEntry = session && entries.find(entry => entry.record.id === session.id);
  const previewShifts = preview && calendarForDuration(preview.config.calendar, preview.config.durationMs).days;
  const previewDraft = useMemo(() => preview && formDraft(preview.config), [preview]);
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
        {shownError && <p className="process-error" id="process-error" role="alert">
          {shownError.objectId && `${draft?.stations.find(item => item.id === shownError.objectId)?.name ?? draft?.materials.find(item => item.id === shownError.objectId)?.name ?? draft?.stations.find(item => item.recipeId === shownError.objectId)?.recipeName ?? shownError.objectId}: `}
          {shownError.messages[language]}{(!draft || shownError.path.startsWith('file')) && <> <code>{shownError.path}</code></>}
        </p>}
        {validationError && <p className="process-help" role="status">{draft ? text.incomplete : text.invalidJson}</p>}
        {!session ? <p>{text.select}</p> : <>
          <div className="process-actions process-save"><button type="button" disabled={runBusy || !!validationError} onClick={() => attempt(() => {
            const run = compileConfig(documentFromSession(session).config);
            setError(null); setPlaybackStatus('running');
            setExperiment({id: newId(), recordId: session.id, run});
          })}>{text.run}</button><button type="button" disabled={locked || !!validationError} onClick={save}>{text.save}</button>
            <button type="button" disabled={!!validationError} onClick={() => attempt(() => {
              const document = documentFromSession(session);
              const config = copyImportedProcess(document.config, newId());
              config.name += ` (${text.copied})`; start(config, document.layout);
            })}>{text.copy}</button>
            <button type="button" disabled={!!validationError} onClick={exportFile}>{text.export}</button>
            <button type="button" disabled={!selectedEntry || locked} onClick={() => setDeleting(true)}>{text.remove}</button></div>
          {draft ? <fieldset className="process-form-fields" disabled={locked}>
          <ProcessCanvas key={session.id} config={session.config} draft={draft} layout={session.layout} language={language} locked={locked}
            onRoutesChange={routes => {if (!locked) edit({...draft, routes});}}
            onChange={layout => {if (!locked) {setSession({...session, layout}); setNotice(null);}}}/>
          <div className="process-general">
            <label className="process-name">{text.name}<input value={draft.name} aria-invalid={fieldError('name')} onChange={event => edit({...draft, name: event.target.value})}/></label>
            <label>Seed<input inputMode="numeric" value={draft.seed} aria-invalid={fieldError('seed')} onChange={event => edit({...draft, seed: event.target.value})}/></label>
            <label>{text.shifts}<input inputMode="numeric" value={draft.shifts} aria-invalid={fieldError('durationMs')} onChange={event => edit({...draft, shifts: event.target.value})}/></label>
          </div><p className="process-help">{text.seedHelp}</p>
          <fieldset className="process-defaults"><legend>{text.defaults}</legend>
            <BufferFields global input label={text.input} text={text} value={draft.input} invalid={fieldError('bufferDefaults.input')} onChange={input => edit({...draft, input})}/>
            <BufferFields global input={false} label={text.output} text={text} value={draft.output} invalid={fieldError('bufferDefaults.output')} onChange={output => edit({...draft, output})}/>
            <p className="process-help">{text.bufferHelp}</p></fieldset>
          <h2>{text.materials}</h2><p className="process-help">{text.materialsHelp}</p>
          <div className="process-materials">{draft.materials.map(material => <div key={material.id}><label>
            {text.materialName}: {text[material.role]}
            <input value={material.name} aria-invalid={fieldError('name', material.id)} onChange={event => edit({...draft,
              materials: draft.materials.map(item => item.id === material.id ? {...item, name: event.target.value} : item)})}/>
          </label><label>{text.role}: {material.name}<select aria-label={`${text.role}: ${material.name}`} value={material.role} onChange={event => edit({...draft,
            materials: draft.materials.map(item => item.id === material.id ? {...item, role: event.target.value as typeof material.role} : item)})}>
            {(['raw', 'intermediate', 'finished'] as const).map(role => <option key={role} value={role}>{text[role]}</option>)}
          </select></label></div>)}</div>
          <h2>{text.edit} ({draft.stations.length}/30)</h2>
          {!chain && <p className="process-help">{text.chainOnly}</p>}
          <ol className="process-stations">{draft.stations.map((station, index) => {
            const update = (patch: Partial<typeof station>) => edit({...draft, stations: draft.stations.map(item => item.id === station.id ? {...item, ...patch} : item)});
            return <li key={station.id} id={`process-station-${station.id}`}><fieldset><legend>{text.station} {index + 1}</legend>
              <div className="process-station-fields">
                <label className="process-name">{text.stationName}<input value={station.name} aria-invalid={fieldError('name', station.id)} onChange={event => update({name: event.target.value})}/></label>
                <label>{text.minutes}<input inputMode="decimal" value={station.minutes} aria-invalid={fieldError('timeMs', station.id)} onChange={event => update({minutes: event.target.value})}/></label>
                <label>{text.cv}<input inputMode="decimal" value={station.cv} aria-invalid={fieldError('cv', station.id)} onChange={event => update({cv: event.target.value})}/></label>
                <BufferFields input text={text} label={`${text.station} ${index + 1}: ${text.input}`} value={station.input} invalid={fieldError('inputBuffer', station.id)} onChange={input => update({input})}/>
                <BufferFields input={false} text={text} label={`${text.station} ${index + 1}: ${text.output}`} value={station.output} invalid={fieldError('outputBuffer', station.id)} onChange={output => update({output})}/>
              </div><fieldset className="process-recipe"><legend>{text.recipe}</legend>
                <label>{text.recipeName}<input value={station.recipeName} aria-invalid={fieldError('name', station.recipeId)} onChange={event => update({recipeName: event.target.value})}/></label>
                <div className="process-recipe-quantities">
                  <label>{text.recipeInput}<select aria-label={text.recipeInput} aria-invalid={fieldError('inputs', station.recipeId)} value={station.inputMaterialId} onChange={event => update({inputMaterialId: event.target.value})}>
                    {draft.materials.map(material => <option key={material.id} value={material.id}>{material.name}</option>)}
                  </select></label>
                  <label>{text.inputQuantity}<input inputMode="decimal" value={station.inputQuantity} aria-invalid={fieldError('inputs', station.recipeId)} onChange={event => update({inputQuantity: event.target.value})}/></label>
                  <label>{text.recipeOutput}<input readOnly value={draft.materials.find(item => item.id === station.outputMaterialId)!.name}/></label>
                  <label>{text.outputQuantity}<input inputMode="numeric" value={station.outputQuantity} aria-invalid={fieldError('output', station.recipeId)} onChange={event => update({outputQuantity: event.target.value})}/></label>
                </div><p className="process-help">{text.recipeHelp}</p>
              </fieldset><div className="process-actions">
                <button type="button" disabled={!chain || index === 0} aria-label={`${text.up}: ${station.name}`} onClick={() => structure(config => moveLinearStation(config, station.id, -1))}>{text.up}</button>
                <button type="button" disabled={!chain || index === draft.stations.length - 1} aria-label={`${text.down}: ${station.name}`} onClick={() => structure(config => moveLinearStation(config, station.id, 1))}>{text.down}</button>
                <button type="button" disabled={!chain || draft.stations.length === 1} aria-label={`${text.removeStation}: ${station.name}`} onClick={() => structure(config => removeLinearStation(config, station.id))}>{text.removeStation}</button>
              </div></fieldset></li>;
          })}</ol>
          <button type="button" disabled={!chain || draft.stations.length >= 30} onClick={() => structure(config => appendLinearStation(config, `${text.station} ${config.stations.length + 1}`, 180_000))}>{text.add}</button>
          <ProcessRoutes config={session.config} draft={draft} language={language}
            onChange={routes => edit({...draft, routes})}/>
          <details className="process-conditions"><summary>{text.conditions}</summary><p>{text.calendar}</p><p>{text.fixed}</p></details>
          </fieldset> : <>
            <h2>{session.config.name}</h2>
            <p id="process-json-help" className="process-help">{text.jsonHelp}</p>
            <label>{text.json}<textarea className="process-json" rows={20} spellCheck={false} disabled={locked}
              value={typeof session.draft === 'string' ? session.draft : ''}
              aria-invalid={!!validationError} aria-describedby={validationError ? 'process-json-help process-error' : 'process-json-help'}
              onChange={event => edit(event.target.value)}/></label>
          </>}
        </>}
      </div>
    </fieldset>
    <dialog ref={dialog} className="process-dialog" onCancel={event => {event.preventDefault(); setPending(null); setDeleting(false); setPreview(null);}} aria-labelledby="process-dialog-title">
      <h2 id="process-dialog-title">{preview ? text.preview : deleting ? text.deleteQuestion : text.leave}</h2>
      {pending && error && <p className="process-error" role="alert">{error.messages[language]}</p>}
      {pending && storageIssue && <p className="process-warning" role="alert">{storageIssue[language]}</p>}
      {preview && <><p>{preview.config.name}</p><p>{text.count}: {preview.config.stations.length}. {text.shifts}: {previewShifts}. Seed: {preview.config.seed}.</p>
        {previewDraft ? <><p>{text.calendar}</p><p>{text.fixed}</p>
          <ul>{previewDraft.materials.map(material => <li key={material.id}>{material.name}</li>)}</ul><p>{text.defaults}. {text.input}: {bufferText(previewDraft.input)}; {text.output}: {bufferText(previewDraft.output)}.</p>
          <ul>{previewDraft.stations.map(station => <li key={station.id}>{station.name}: {station.minutes} {language === 'ru' ? 'мин' : 'min'}, CV {station.cv}.
            {' '}{station.recipeName}: {station.inputQuantity} {previewDraft.materials.find(item => item.id === station.inputMaterialId)!.name} → {station.outputQuantity} {previewDraft.materials.find(item => item.id === station.outputMaterialId)!.name}.
            {' '}{text.input}: {bufferText(station.input)}; {text.output}: {bufferText(station.output)}.</li>)}</ul></>
          : <><h3>{text.sources}</h3><ul>{preview.config.sources.map(source => <li key={source.id}>{source.name} ({text[source.availability]})</li>)}</ul></>}</>}
      {deleting && <p>{session?.savedConfig?.name ?? draft?.name ?? session?.config.name}</p>}
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
