import type {EditorConfig} from '@toc/engine';
import type {Language} from '../ui/i18n';
import {removeDraftNode} from './process-form';
import type {ProcessDraft, SourceDraft} from './process-form';

const words = {
  ru: {
    sources: 'Источники сырья', source: 'Источник', sourceName: 'Название источника', material: 'Материал',
    availability: 'Откуда берётся сырьё', virtual: 'Неограниченный запас', warehouse: 'Конечный склад',
    amount: 'Количество', shipment: 'Количество за поставку', interval: 'Интервал поставок, с',
    addSource: 'Добавить источник', removeSource: 'Удалить источник и его связи', noRaw: 'Сначала добавьте материал с назначением «Сырьё».',
    stock: 'Начальные запасы', stockRow: 'Запас', stockHelp: 'Конечные источники одного материала берут сырьё с общего склада.',
    location: 'Где хранится', input: 'Входной буфер', output: 'Выходной буфер', station: 'Пост',
    cost: 'Полная стоимость запаса', addStock: 'Добавить запас', removeStock: 'Удалить запас', select: 'Выберите значение',
  },
  en: {
    sources: 'Raw material sources', source: 'Source', sourceName: 'Source name', material: 'Material',
    availability: 'Supply type', virtual: 'Unlimited supply', warehouse: 'Finite warehouse',
    amount: 'Quantity', shipment: 'Quantity per delivery', interval: 'Delivery interval, s',
    addSource: 'Add source', removeSource: 'Delete source and its connections', noRaw: 'Add a material with the Raw material role first.',
    stock: 'Initial stock', stockRow: 'Stock', stockHelp: 'Finite sources of the same material draw from one shared warehouse.',
    location: 'Storage location', input: 'Input buffer', output: 'Output buffer', station: 'Station',
    cost: 'Total stock cost', addStock: 'Add initial stock', removeStock: 'Delete stock', select: 'Choose a value',
  },
};

type Stock = EditorConfig['initialStocks'][number];

function stockMaterials(draft: ProcessDraft, location: Stock['location'], ownerId: string): string[] {
  if (location === 'warehouse') return draft.sources.filter(source => source.availability === 'warehouse').map(source => source.materialId);
  const station = draft.stations.find(item => item.id === ownerId);
  if (!station) return [];
  return location === 'input' ? station.inputs.map(input => input.materialId) : [station.outputMaterialId];
}

export function ProcessSupply({draft, language, onChange}: {
  draft: ProcessDraft; language: Language; onChange: (draft: ProcessDraft) => void;
}) {
  const text = words[language];
  const raw = draft.materials.filter(material => material.role === 'raw');
  const finite = stockMaterials(draft, 'warehouse', 'warehouse');
  function updateSource(id: string, patch: Partial<SourceDraft>) {
    onChange({...draft, sources: draft.sources.map(source => source.id === id ? {...source, ...patch} : source)});
  }
  function updateStock(id: string, patch: Partial<Stock>) {
    onChange({...draft, initialStocks: draft.initialStocks.map(stock => stock.id === id ? {...stock, ...patch} : stock)});
  }
  function stockPlace(location: Stock['location'], ownerId = location === 'warehouse' ? 'warehouse' : draft.stations[0]?.id ?? '') {
    return {location, ownerId, materialId: stockMaterials(draft, location, ownerId)[0] ?? ''};
  }
  function addSource() {
    const material = raw.find(item => !draft.sources.some(source => source.materialId === item.id)) ?? raw[0];
    if (!material) return;
    const previousSource = draft.sources.find(source => source.materialId === material.id);
    onChange({...draft, sources: [...draft.sources, {
      id: `source-${crypto.randomUUID()}`, name: material.name, materialId: material.id,
      availability: previousSource?.availability ?? 'virtual', quantity: '1', intervalSeconds: '180',
    }]});
  }
  return <>
    <section aria-labelledby="process-sources-title">
      <h2 id="process-sources-title">{text.sources}</h2>
      {draft.sources.map((source, index) => <fieldset key={source.id} className="process-route">
        <legend>{text.source} {index + 1}</legend>
        <div className="process-supply-fields">
          <label>{text.sourceName}<input value={source.name} onChange={event => updateSource(source.id, {name: event.target.value})}/></label>
          <label>{text.material}<select value={source.materialId} onChange={event => updateSource(source.id, {materialId: event.target.value})}>
            {!raw.some(item => item.id === source.materialId) && <option value={source.materialId}>{text.select}</option>}
            {raw.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select></label>
          <label>{text.availability}<select value={source.availability} onChange={event => updateSource(source.id, {availability: event.target.value as SourceDraft['availability']})}>
            <option value="virtual">{text.virtual}</option><option value="warehouse">{text.warehouse}</option>
          </select></label>
          <label>{text.shipment}<input inputMode="decimal" value={source.quantity} onChange={event => updateSource(source.id, {quantity: event.target.value})}/></label>
          <label>{text.interval}<input inputMode="decimal" value={source.intervalSeconds} onChange={event => updateSource(source.id, {intervalSeconds: event.target.value})}/></label>
        </div>
        <button type="button" disabled={draft.sources.length < 2} onClick={() => onChange(removeDraftNode(draft, source.id))}>{text.removeSource}</button>
      </fieldset>)}
      {!raw.length && <p className="process-help">{text.noRaw}</p>}
      <button type="button" disabled={!raw.length} onClick={addSource}>{text.addSource}</button>
    </section>
    <section aria-labelledby="process-stocks-title">
      <h2 id="process-stocks-title">{text.stock}</h2>
      <p className="process-help">{text.stockHelp}</p>
      {draft.initialStocks.map((stock, index) => {
        const materials = draft.materials.filter(item => stockMaterials(draft, stock.location, stock.ownerId).includes(item.id));
        return <fieldset key={stock.id} className="process-route">
          <legend>{text.stockRow} {index + 1}</legend>
          <div className="process-supply-fields">
            <label>{text.location}<select value={stock.location} onChange={event => updateStock(stock.id, stockPlace(event.target.value as Stock['location']))}>
              <option value="warehouse">{text.warehouse}</option><option value="input">{text.input}</option><option value="output">{text.output}</option>
            </select></label>
            {stock.location !== 'warehouse' && <label>{text.station}<select value={stock.ownerId}
              onChange={event => updateStock(stock.id, stockPlace(stock.location, event.target.value))}>
              {draft.stations.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select></label>}
            <label>{text.material}<select value={stock.materialId} onChange={event => updateStock(stock.id, {materialId: event.target.value})}>
              {!materials.some(item => item.id === stock.materialId) && <option value={stock.materialId}>{text.select}</option>}
              {materials.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select></label>
            <label>{text.amount}<input inputMode="decimal" value={stock.quantity} onChange={event => updateStock(stock.id, {quantity: event.target.value})}/></label>
            <label>{text.cost}<input inputMode="decimal" value={stock.cost} onChange={event => updateStock(stock.id, {cost: event.target.value})}/></label>
          </div>
          <button type="button" onClick={() => onChange({...draft, initialStocks: draft.initialStocks.filter(item => item.id !== stock.id)})}>{text.removeStock}</button>
        </fieldset>;
      })}
      <button type="button" onClick={() => onChange({...draft, initialStocks: [...draft.initialStocks, {
        id: `stock-${crypto.randomUUID()}`, ...stockPlace(finite.length ? 'warehouse' : 'input'), quantity: '1', cost: '0',
      }]})}>{text.addStock}</button>
    </section>
  </>;
}
