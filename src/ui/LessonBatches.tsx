import {batchThresholds} from '../lessons/lesson-batches';
import type {BatchThreshold, BatchesResults} from '../lessons/lesson-batches';
import type {Language} from './i18n';
import {quantityText} from './diagram';
import {durationText} from './metric-format';

export const batchesLabels = {
  ru: {
    name: 'Урок 5. Обработочная и транспортная партия', title: 'Обработочная и транспортная партия',
    prediction: 'Начнёт ли Обработка раньше, если передавать по одной детали, но для её запуска всё ещё нужен комплект из 6?',
    threshold: 'Порог передачи первых двух постов, шт.',
    conditions: 'Подготовка → Обработка → Отделка: 2/2/1 минуты на деталь. Первые два поста перед началом партии резервируют комплект из 6 и обрабатывают детали последовательно; Отделка работает по одной. Времена постоянные (CV 0). Подача по одной детали каждую рабочую минуту с начала смены. Входы 12/10/10, выходные буферы 0, начальных запасов нет. Одна смена 08:00–17:00, обед 12:00–13:00.',
    help: 'Предположите результат, затем завершите прогон с порогом 3. Нажмите «Новый прогон», выберите порог 1 и завершите второй прогон. Остальные условия сохраняются. Можно наблюдать схему, затем выбрать «Максимум». Сравните таблицу перед разбором.',
    watch: 'Обработочная партия задаёт комплект к началу обработки. Порог передачи задаёт, сколько готовых деталей накопить перед передачей дальше. Это разные величины. Следите за накоплением 6 деталей перед Обработкой и за первым поступлением материала в Отделку.',
    results: 'Сравнение выполненных прогонов', start: 'Первый запуск Обработки, ч:м:с от начала', first: 'Первое изделие, ч:м:с от начала', output: 'Готовые изделия, шт.', pending: 'Не выполнен', absent: 'Не произошло', explanation: 'Разбор',
    memory: 'Таблица хранит последний полный прогон каждого варианта до перезагрузки или закрытия вкладки. Остановка его не заменяет. Времена отсчитываются от открытия смены; это моменты событий, а не длительность операции.',
    explanationText: 'Уменьшение порога не меняет обработочную партию. Обработка в обоих вариантах ждёт весь комплект и впервые запускается через 17 минут. При пороге 1 её первый результат сразу поступает в Отделку, поэтому первое изделие появляется через 20 минут вместо 24. Ранняя передача не означает раннего запуска поста, которому нужен полный комплект. Сравните также общий выпуск: выигрыш начала потока сам по себе не доказывает ускорения обработки или роста устойчивого темпа.',
    question: 'Почему первый запуск Обработки не изменился, а первое готовое изделие появилось раньше? Какое из двух правил нужно менять, чтобы уменьшить комплект к запуску?',
  },
  en: {
    name: 'Lesson 5. Processing and transfer batches', title: 'Processing and transfer batches',
    prediction: 'Will Processing start earlier if parts are transferred one at a time but it still needs a full kit of 6?',
    threshold: 'Transfer threshold at the first two stations, units',
    conditions: 'Preparation → Processing → Finishing: 2/2/1 minutes per part. The first two stations reserve a kit of 6 before starting a batch and process parts sequentially; Finishing works one part at a time. Times are constant (CV 0). One part arrives every working minute from shift opening. Inputs hold 12/10/10, output buffers hold 0, with no initial inventory. One shift 08:00–17:00, lunch 12:00–13:00.',
    help: 'Predict the result, then complete a run at threshold 3. Click "New run", select threshold 1 and complete the second run. Other conditions stay the same. You can watch the diagram first, then select "Maximum". Compare the table before opening the explanation.',
    watch: 'The processing batch defines the kit needed to start processing. The transfer threshold defines how many completed parts to collect before passing them on. These are different quantities. Watch the kit of 6 build up before Processing and the first material reach Finishing.',
    results: 'Comparison of completed runs', start: 'First Processing start, h:m:s since opening', first: 'First finished item, h:m:s since opening', output: 'Finished goods, units', pending: 'Not completed', absent: 'Did not occur', explanation: 'Explanation',
    memory: 'The table keeps the last complete run of each variant until you reload or close the tab. Stopping does not replace it. Times are measured from shift opening; they are event times, not operation durations.',
    explanationText: 'Lowering the transfer threshold does not change the processing batch. Processing waits for its full kit and first starts after 17 minutes in both variants. At threshold 1 its first completed part reaches Finishing immediately, so the first finished item appears after 20 minutes instead of 24. Earlier transfer does not mean an earlier start for a station that requires a complete kit. Also compare total output: an earlier first item alone does not prove faster processing or a higher sustained rate.',
    question: 'Why did the first Processing start stay the same while the first finished item appeared earlier? Which of the two rules would you change to reduce the kit needed to start?',
  },
} as const;
export function LessonBatchesIntro({threshold, locked, language, onChange}: {threshold: BatchThreshold; locked: boolean; language: Language; onChange: (value: BatchThreshold) => void}) {
  const text = batchesLabels[language];
  return <div className="lesson-intro"><h3>{text.title}</h3><p>{text.prediction}</p>
    <label className="lesson-variant">{text.threshold}<select value={threshold} disabled={locked} onChange={event => onChange(Number(event.target.value) as BatchThreshold)}>
      {batchThresholds.map(value => <option key={value} value={value}>{value}</option>)}
    </select></label><p>{text.conditions}</p><p>{text.help}</p><p>{text.watch}</p></div>;
}
export function LessonBatchesComparison({results, language}: {results: BatchesResults; language: Language}) {
  const text = batchesLabels[language];
  const time = (value: number | null) => value === null ? text.absent : durationText(value);
  return <section className="lesson-comparison" aria-labelledby="lesson-batches-results"><h2 id="lesson-batches-results">{text.results}</h2>
    <div className="table-scroll" tabIndex={0} role="region" aria-label={text.results}><table>
      <thead><tr><th scope="col">{text.threshold}</th><th scope="col">{text.start}</th><th scope="col">{text.first}</th><th scope="col">{text.output}</th></tr></thead>
      <tbody>{batchThresholds.map(threshold => {const result = results[threshold]; return <tr key={threshold} data-batches-result={threshold}><th scope="row">{threshold}</th>{result ? <><td>{time(result.firstStartMs)}</td><td>{time(result.firstOutputMs)}</td><td data-batches-output={threshold}>{quantityText(result.total)}</td></> : <td colSpan={3}>{text.pending}</td>}</tr>;})}</tbody>
    </table></div><p className="summary-help">{text.memory}</p>
    <details className="lesson-explanation"><summary>{text.explanation}</summary><p>{text.explanationText}</p><p>{text.question}</p></details>
  </section>;
}
