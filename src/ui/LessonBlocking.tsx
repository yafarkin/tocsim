import {blockingBuffers} from '../lessons/lesson-blocking';
import type {BlockingBuffer, BlockingResults} from '../lessons/lesson-blocking';
import type {Language} from './i18n';
import {quantityText} from './diagram';
import {durationText} from './metric-format';

export const blockingLabels = {
  ru: {
    name: 'Урок 4. Занятость и выпуск', title: 'Занятость и выпуск',
    prediction: 'Если Подготовка будет реже ждать свободного места, станет ли больше готовых изделий?',
    buffer: 'Вместимость входа Обработки, шт.',
    conditions: 'Подготовка → Обработка → Отделка: 3/8/3 минуты на деталь. Время постоянное, без разброса (CV 0). Одна смена 08:00–17:00, обед 12:00–13:00. Подача по одной детали каждые 3 рабочие минуты. Входы Подготовки и Отделки по 1, выходные буферы 0. Линия начинает пустой; 1 и 8 задают вместимость, а не начальный запас.',
    help: 'Сначала предположите результат. Запустите вариант 1 до завершения. Нажмите «Новый прогон», выберите 8 и завершите второй прогон. Можно сначала наблюдать схему, затем выбрать скорость «Максимум». Сравните таблицу, затем откройте разбор.',
    watch: 'Блокировка означает, что пост удерживает готовую деталь и ждёт места для передачи. Следите, как часто Подготовка блокируется, сколько деталей она изготовила и сколько изделий вышло со всей линии.',
    results: 'Сравнение выполненных прогонов', output: 'Готовые изделия, шт.', prepared: 'Изготовлено Подготовкой, шт.', blocking: 'Блокировка Подготовки, ч:м:с', queue: 'Входной запас Обработки в конце, шт.',
    pending: 'Не выполнен', explanation: 'Разбор',
    memory: 'Таблица хранит последний полный прогон каждого варианта до перезагрузки или закрытия вкладки. Остановка его не заменяет. Блокировка учитывает только рабочее время; запас относится только к входной очереди, без детали в обработке.',
    explanationText: 'Обработка тратит 8 минут на деталь и определяет темп этой линии. Даже маленький вход обеспечивает её материалом после запуска. Больший вход позволяет Подготовке изготовить больше деталей и реже блокироваться, но не ускоряет Обработку. За эту смену выпуск готовых изделий остаётся прежним, а запас перед Обработкой растёт. Дополнительная работа Подготовки ещё не означает улучшение результата всей линии. В отличие от урока 3 здесь нет случайных задержек, от которых нужно защищать ограничение.',
    question: 'Какое изменение таблицы показывает рост местной активности, а какое показывает результат всей линии? Почему меньшая блокировка здесь не дала больше готовых изделий?',
  },
  en: {
    name: 'Lesson 4. Activity and output', title: 'Activity and output',
    prediction: 'If Preparation waits less for space downstream, will the line produce more finished goods?',
    buffer: 'Processing input capacity, units',
    conditions: 'Preparation → Processing → Finishing: 3/8/3 minutes per part. Times are constant, without variation (CV 0). One shift 08:00–17:00, lunch 12:00–13:00. One part arrives every 3 working minutes. Preparation and Finishing inputs hold 1 each, output buffers hold 0. The line starts empty; 1 and 8 specify capacity, not initial inventory.',
    help: 'Predict the result first. Run capacity 1 to completion. Click "New run", select 8 and complete the second run. You can watch the diagram first, then select "Maximum" speed. Compare the table before opening the explanation.',
    watch: 'Blocking means a station holds a finished part and waits for space to pass it on. Watch how often Preparation is blocked, how many parts it makes and how many finished goods leave the whole line.',
    results: 'Comparison of completed runs', output: 'Finished goods, units', prepared: 'Made by Preparation, units', blocking: 'Preparation blocking, h:m:s', queue: 'Processing input inventory at the end, units',
    pending: 'Not completed', explanation: 'Explanation',
    memory: 'The table keeps the last complete run of each variant until you reload or close the tab. Stopping does not replace it. Blocking counts working time only; inventory covers only the input queue and excludes the part being processed.',
    explanationText: 'Processing takes 8 minutes per part and sets the pace of this line. Even the small input keeps it supplied after startup. A larger input lets Preparation make more parts and spend less time blocked, but does not speed up Processing. Finished output over this shift stays the same while inventory before Processing grows. Extra work at Preparation does not yet mean a better result for the whole line. Unlike lesson 3, this experiment has no random delays to protect the constraint against.',
    question: 'Which table value shows increased local activity, and which shows the result of the whole line? Why did less blocking fail to produce more finished goods here?',
  },
} as const;

export function LessonBlockingIntro({buffer, locked, language, onChange}: {buffer: BlockingBuffer; locked: boolean; language: Language; onChange: (value: BlockingBuffer) => void}) {
  const text = blockingLabels[language];
  return <div className="lesson-intro"><h3>{text.title}</h3><p>{text.prediction}</p>
    <label className="lesson-variant">{text.buffer}<select value={buffer} disabled={locked} onChange={event => onChange(Number(event.target.value) as BlockingBuffer)}>
      {blockingBuffers.map(value => <option key={value} value={value}>{value}</option>)}
    </select></label><p>{text.conditions}</p><p>{text.help}</p><p>{text.watch}</p></div>;
}
export function LessonBlockingComparison({results, language}: {results: BlockingResults; language: Language}) {
  const text = blockingLabels[language];
  return <section className="lesson-comparison" aria-labelledby="lesson-blocking-results"><h2 id="lesson-blocking-results">{text.results}</h2>
    <div className="table-scroll" tabIndex={0} role="region" aria-label={text.results}><table>
      <thead><tr><th scope="col">{text.buffer}</th><th scope="col">{text.output}</th><th scope="col">{text.prepared}</th><th scope="col">{text.blocking}</th><th scope="col">{text.queue}</th></tr></thead>
      <tbody>{blockingBuffers.map(buffer => {const result = results[buffer]; return <tr key={buffer} data-blocking-result={buffer}><th scope="row">{buffer}</th>{result ? <><td data-blocking-output={buffer}>{quantityText(result.total)}</td><td>{quantityText(result.prepared)}</td><td>{durationText(result.blockedMs)}</td><td>{quantityText(result.queue)}</td></> : <td colSpan={4}>{text.pending}</td>}</tr>;})}</tbody>
    </table></div><p className="summary-help">{text.memory}</p>
    <details className="lesson-explanation"><summary>{text.explanation}</summary><p>{text.explanationText}</p><p>{text.question}</p></details>
  </section>;
}
