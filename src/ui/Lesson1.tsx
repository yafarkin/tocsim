import {lesson1Variants} from '../lessons/lesson-1';
import type {Lesson1Variant, Lesson1Results} from '../lessons/lesson-1';
import type {Language} from './i18n';
import {quantityText} from './diagram';
import {durationText} from './metric-format';

export const lesson1Labels = {
  ru: {
    name: 'Урок 1. Зависимые операции и вариативность', title: 'Зависимые операции и вариативность',
    prediction: 'Сохранится ли выпуск, если среднее время каждого поста останется прежним, но появится разброс?',
    variant: 'Вариант', variants: {steady: 'Без разброса, буферы 4', variable: 'С разбросом, буферы 4', buffered: 'С разбросом, буферы 40'},
    conditions: 'Три поста, в среднем по 5 минут на деталь. Подача каждые 5 рабочих минут, выходные буферы 0. Два дня, смена 08:00–17:00, обед 12:00–13:00. Seed 42 одинаков для всех вариантов.',
    help: 'Запустите три варианта. Вариативность CV 0.5 означает, что длительности различаются при прежнем среднем времени. Посмотрите, когда последний пост ждёт материал, а первый не может передать деталь.',
    results: 'Сравнение выполненных прогонов', output: 'Выпуск, шт.', starvation: 'Голодание поста 3, ч:м:с', blocking: 'Блокировка поста 1, ч:м:с', pending: 'Не выполнен', explanation: 'Разбор',
    memory: 'Показан последний полный прогон каждого варианта. Остановка его не заменяет. Результаты остаются до перезагрузки или закрытия вкладки. Времена учитывают только рабочее время.',
    explanationText: 'Посты зависят друг от друга. Когда предыдущий задерживается, следующий ждёт материал. Когда очередь заполнена, предыдущий не может передать готовую деталь. Поэтому одинаковые средние времена не обеспечивают ровный поток. Большие буферы дают место для очередей и смягчают часть потерь, но не ускоряют обработку. Запас можно посмотреть в существующем отчёте. В проверенной серии seeds разброс снизил выпуск, а увеличение буферов вернуло часть потерь. Один прогон не доказывает результат для любого seed.',
    question: 'Почему увеличение буферов не вернуло выпуск варианта без разброса? Объясните по схеме и таблице.',
  },
  en: {
    name: 'Lesson 1. Dependent operations and variability', title: 'Dependent operations and variability',
    prediction: 'Will output stay the same if each station keeps its average processing time but individual times vary?',
    variant: 'Variant', variants: {steady: 'No variability, buffers 4', variable: 'Variable times, buffers 4', buffered: 'Variable times, buffers 40'},
    conditions: 'Three stations average 5 minutes per part. Supply arrives every 5 working minutes, output buffers hold 0. Two days, shift 08:00–17:00, lunch 12:00–13:00. Seed 42 is shared by all variants.',
    help: 'Run all three variants. CV 0.5 means processing times vary while their mean stays the same. Watch when the last station waits for material and the first cannot pass a part onward.',
    results: 'Comparison of completed runs', output: 'Output, units', starvation: 'Station 3 starvation, h:m:s', blocking: 'Station 1 blocking, h:m:s', pending: 'Not completed', explanation: 'Explanation',
    memory: 'The table keeps the last complete run of each variant. Stopping does not replace it. Results remain until you reload or close the tab. Times count working time only.',
    explanationText: 'Stations depend on each other. When an upstream station is delayed, the next waits for material. When a queue is full, the preceding station cannot pass its completed part onward. Equal average times therefore do not ensure a steady flow. Larger buffers allow queues to form and reduce some losses, but do not speed up processing. Inventory is available in the existing report. In the tested seed series, variability reduced output and larger buffers recovered some losses. One run does not prove the result for every seed.',
    question: 'Why did larger buffers not restore the output of the variant without variability? Explain using the diagram and table.',
  },
} as const;

export function Lesson1Intro({variant, locked, language, onChange}: {variant: Lesson1Variant; locked: boolean; language: Language; onChange: (value: Lesson1Variant) => void}) {
  const text = lesson1Labels[language];
  return <div className="lesson-intro"><h3>{text.title}</h3><p>{text.prediction}</p>
    <label className="lesson-variant">{text.variant}<select value={variant} disabled={locked} onChange={event => onChange(event.target.value as Lesson1Variant)}>
      {lesson1Variants.map(value => <option key={value} value={value}>{text.variants[value]}</option>)}
    </select></label><p>{text.conditions}</p><p>{text.help}</p></div>;
}
export function Lesson1Comparison({results, language}: {results: Lesson1Results; language: Language}) {
  const text = lesson1Labels[language];
  return <section className="lesson-comparison" aria-labelledby="lesson-1-results"><h2 id="lesson-1-results">{text.results}</h2>
    <div className="table-scroll" tabIndex={0} role="region" aria-label={text.results}><table>
      <thead><tr><th scope="col">{text.variant}</th><th scope="col">{text.output}</th><th scope="col">{text.starvation}</th><th scope="col">{text.blocking}</th></tr></thead>
      <tbody>{lesson1Variants.map(variant => {const result = results[variant]; return <tr key={variant} data-lesson-1-result={variant}><th scope="row">{text.variants[variant]}</th>{result ? <><td data-lesson-1-output={variant}>{quantityText(result.total)}</td><td>{durationText(result.starvedMs)}</td><td>{durationText(result.blockedMs)}</td></> : <td colSpan={3}>{text.pending}</td>}</tr>;})}</tbody>
    </table></div><p className="summary-help">{text.memory}</p>
    <details className="lesson-explanation"><summary>{text.explanation}</summary><p>{text.explanationText}</p><p>{text.question}</p></details>
  </section>;
}
