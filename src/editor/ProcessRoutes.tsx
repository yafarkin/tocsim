import type {EditorConfig} from '@toc/engine';
import type {Language} from '../ui/i18n';
import type {ProcessDraft} from './process-form';

const words = {
  ru: {title: 'Связи', route: 'Связь', from: 'Откуда', to: 'Куда', material: 'Материал',
    add: 'Добавить связь', remove: 'Удалить связь', market: 'Готовая продукция',
    help: 'Изменяйте начало, конец и материал связи. Входной материал получателя задаётся в рецепте. На выход готовой продукции передаются только готовые продукты. Незавершённая схема остаётся в памяти вкладки; сохранение, копирование, экспорт и запуск доступны после проверки.'},
  en: {title: 'Connections', route: 'Connection', from: 'From', to: 'To', material: 'Material',
    add: 'Add connection', remove: 'Delete connection', market: 'Finished goods',
    help: 'Edit the start, end and material of each connection. Set the receiving station’s input material in its recipe. Only finished products can go to finished goods. An incomplete graph stays in this tab; save, copy, export and run become available after validation.'},
};

/** Routes are draft data until the shared engine accepts the complete configuration. */
export function ProcessRoutes({config, draft, language, onChange}: {
  config: EditorConfig; draft: ProcessDraft; language: Language; onChange: (routes: EditorConfig['routes']) => void;
}) {
  const text = words[language];
  const producers = [...config.sources, ...draft.stations];
  const consumers = [...draft.stations, {id: 'market', name: text.market}];
  function add() {
    const used = new Set([config.id, 'market', 'warehouse', ...config.materials.map(item => item.id),
      ...config.recipes.map(item => item.id), ...config.stations.map(item => item.id),
      ...config.stations.flatMap(item => item.plan.map(row => row.id)), ...config.sources.map(item => item.id),
      ...draft.routes.map(item => item.id)]);
    let index = 1;
    while (used.has(`connection-${index}`)) index++;
    onChange([...draft.routes, {id: `connection-${index}`, fromId: config.sources[0]!.id,
      toId: draft.stations[0]!.id, materialId: config.sources[0]!.materialId}]);
  }
  return <section aria-labelledby="process-routes-title"><h2 id="process-routes-title">{text.title}</h2>
    <p className="process-help">{text.help}</p>
    {draft.routes.map((route, index) => {
      const update = (patch: Partial<typeof route>) => onChange(draft.routes.map(item => item.id === route.id ? {...item, ...patch} : item));
      return <fieldset key={route.id} className="process-route"><legend>{text.route} {index + 1}</legend>
        <div className="process-station-fields">
          <label>{text.from}<select aria-label={text.from} value={route.fromId} onChange={event => update({fromId: event.target.value})}>
            {producers.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select></label>
          <label>{text.to}<select aria-label={text.to} value={route.toId} onChange={event => update({toId: event.target.value})}>
            {consumers.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select></label>
          <label>{text.material}<select aria-label={text.material} value={route.materialId} onChange={event => update({materialId: event.target.value})}>
            {draft.materials.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select></label>
        </div><button type="button" onClick={() => onChange(draft.routes.filter(item => item.id !== route.id))}>
          {text.remove}: {index + 1}
        </button>
      </fieldset>;
    })}
    <button type="button" onClick={add}>{text.add}</button>
  </section>;
}
