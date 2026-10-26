import {lesson3Buffers} from '../lessons/lesson-3';
import type {Lesson3Buffer, Lesson3Results} from '../lessons/lesson-3';
import type {Language} from './i18n';
import {quantityText} from './diagram';
import {averageText, durationText} from './metric-format';

export const lesson3Labels = {
  ru: {
    name: 'Урок 3. Буфер защищает ограничение', title: 'Буфер защищает ограничение',
    prediction: 'Когда увеличение буфера с 1 до 8 и 40 защищает выпуск, а когда преимущественно добавляет запас?',
    buffer: 'Буфер перед третьим постом, шт.',
    conditions: 'Посты 3/4/6 минут. CV первых двух 0.9, третьего 0. Входы первых двух по 20, выходные буферы 0, подача каждые 3 рабочие минуты. Пять дней, смена 08:00–17:00, обед 12:00–13:00. Seed 42 одинаков для всех вариантов.',
    help: 'Запустите три варианта. Сравните выпуск, голодание третьего поста и средний запас перед ним.',
    results: 'Сравнение выполненных прогонов', output: 'Выпуск, шт.', starvation: 'Голодание поста 3, ч:м:с', queue: 'Средний входной запас, шт.',
    pending: 'Не выполнен', explanation: 'Разбор',
    memory: 'Показан последний полный прогон каждого варианта. Остановка его не заменяет. Результаты остаются в памяти до перезагрузки или закрытия вкладки.',
    averageHelp: 'Средний запас относится только к входной очереди третьего поста за рабочее время пяти дней. Деталь в обработке, обед и ночь исключены. Голодание тоже учитывает только рабочее время.',
    explanationText: 'Буфер даёт третьему посту материал, когда первые два задерживаются. Сравните, насколько уменьшилось его голодание и вырос выпуск. Дополнительное место не ускоряет обработку: третий пост по-прежнему тратит 6 рабочих минут на деталь. Когда защиты уже достаточно, дальнейшее увеличение в основном добавляет запас. Вариативность влияет на величину эффекта: в проверенной серии выигрыш 1→8 был заметнее, чем 8→40. Это наблюдение этой серии, а не гарантия для любого seed. Таблица показывает ваш фактический прогон.',
    question: 'Что изменилось при переходе 8→40: выпуск или запас? Оправдано ли увеличение буфера? Объясните ответ по таблице и состояниям третьего поста.',
  },
  en: {
    name: 'Lesson 3. A buffer protects the constraint', title: 'A buffer protects the constraint',
    prediction: 'When does increasing the buffer from 1 to 8 and 40 protect output, and when does it mainly add inventory?',
    buffer: 'Buffer before station 3, units',
    conditions: 'Stations take 3/4/6 minutes. CV is 0.9 at the first two and 0 at station 3. The first two input buffers hold 20 each, output buffers hold 0, supply arrives every 3 working minutes. Five days, shift 08:00–17:00, lunch 12:00–13:00. Seed 42 is shared by all variants.',
    help: 'Run all three variants. Compare output, starvation at station 3 and average inventory before it.',
    results: 'Comparison of completed runs', output: 'Output, units', starvation: 'Station 3 starvation, h:m:s', queue: 'Average input inventory, units',
    pending: 'Not completed', explanation: 'Explanation',
    memory: 'The table keeps the last complete run of each variant. Stopping a run does not replace it. Results remain in memory until you reload or close the tab.',
    averageHelp: 'Average inventory covers only the input queue at station 3 over five days of working time. It excludes the part being processed, lunch and nights. Starvation also counts working time only.',
    explanationText: 'A buffer supplies station 3 when the first two stations are delayed. Compare the reduction in starvation and the increase in output. More space does not speed up processing: station 3 still takes 6 working minutes per part. Once protection is sufficient, a further increase mainly adds inventory. Variability affects the size of the effect: in the tested series, the gain from 1 to 8 was larger than from 8 to 40. This is an observation from that series, not a guarantee for every seed. The table shows your actual run.',
    question: 'What changed from 8 to 40: output or inventory? Is the larger buffer justified? Explain your answer using the table and station 3 states.',
  },
} as const;

export function Lesson3Intro({buffer, locked, language, onChange}: {
  buffer: Lesson3Buffer; locked: boolean; language: Language; onChange: (buffer: Lesson3Buffer) => void;
}) {
  const text = lesson3Labels[language];
  return <div className="lesson-intro"><h3>{text.title}</h3><p>{text.prediction}</p>
    <label className="lesson-variant">{text.buffer}<select value={buffer} disabled={locked} onChange={event => onChange(Number(event.target.value) as Lesson3Buffer)}>
      {lesson3Buffers.map(value => <option key={value} value={value}>{value}</option>)}
    </select></label><p>{text.conditions}</p><p>{text.help}</p>
  </div>;
}

export function Lesson3Comparison({results, language}: {results: Lesson3Results; language: Language}) {
  const text = lesson3Labels[language];
  return <section className="lesson-comparison" aria-labelledby="lesson-3-results">
    <h2 id="lesson-3-results">{text.results}</h2>
    <div className="table-scroll" tabIndex={0} role="region" aria-label={text.results}><table>
      <thead><tr><th scope="col">{text.buffer}</th><th scope="col">{text.output}</th><th scope="col">{text.starvation}</th><th scope="col">{text.queue}</th></tr></thead>
      <tbody>{lesson3Buffers.map(buffer => {
        const result = results[buffer];
        return <tr key={buffer} data-lesson-3-result={buffer}><th scope="row">{buffer}</th>{result ? <>
          <td data-lesson-3-output={buffer}>{quantityText(result.total)}</td><td>{durationText(result.starvedMs)}</td><td>{averageText(result.queue, '—')}</td>
        </> : <td colSpan={3}>{text.pending}</td>}</tr>;
      })}</tbody>
    </table></div><p className="summary-help">{text.averageHelp}</p><p className="summary-help">{text.memory}</p>
    <details className="lesson-explanation"><summary>{text.explanation}</summary><p>{text.explanationText}</p><p>{text.question}</p></details>
  </section>;
}
