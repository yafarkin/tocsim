import {lesson2Text, lesson2Variants} from '../lessons/lesson-2';
import type {Lesson2Variant} from '../lessons/lesson-2';
import type {Language} from './i18n';
import {quantityText} from './diagram';

export const lesson2Labels = {
  ru: {
    name: 'Урок 2. Ограничение определяет выход', variant: 'Вариант',
    variants: {base: 'Исходник: 3/4/8/3', 'faster-second': 'Ускорить второй: 3/2/8/3', 'faster-third': 'Ускорить третий: 3/4/6/3'},
    conditions: 'Времена указаны в минутах. CV = 0, входные буферы по 20, подача каждые 3 рабочие минуты. Три дня, смена 08:00–17:00, обед 12:00–13:00.',
    help: 'Запустите каждый вариант и сравните выпуск по сменам. Каждое ускорение начинается от исходной линии.',
    results: 'Сравнение выполненных прогонов', shift: 'Смена', total: 'Всего', pending: 'Не выполнен',
    memory: 'В таблице остаётся последний полный прогон каждого варианта. Прерванные прогоны её не заменяют. Результаты хранятся до закрытия или перезагрузки вкладки.',
    explanation: 'Разбор',
  },
  en: {
    name: 'Lesson 2. The constraint determines output', variant: 'Variant',
    variants: {base: 'Original: 3/4/8/3', 'faster-second': 'Faster station 2: 3/2/8/3', 'faster-third': 'Faster station 3: 3/4/6/3'},
    conditions: 'Times are in minutes. CV = 0, input buffers hold 20 each, supply arrives every 3 working minutes. Three days, shift 08:00–17:00, lunch 12:00–13:00.',
    help: 'Run each variant and compare output by shift. Each speed change starts from the original line.',
    results: 'Comparison of completed runs', shift: 'Shift', total: 'Total', pending: 'Not completed',
    memory: 'The table keeps the last complete run of each variant. Interrupted runs do not replace it. Results remain until you close or reload the tab.',
    explanation: 'Explanation',
  },
} as const;

// Only four numbers per finished variant; no snapshots or histories are retained here.
export interface Lesson2Result {total: number; shifts: readonly number[]}
export type Lesson2Results = Partial<Record<Lesson2Variant, Lesson2Result>>;

export function Lesson2Intro({variant, locked, language, onChange}: {
  variant: Lesson2Variant; locked: boolean; language: Language; onChange: (variant: Lesson2Variant) => void;
}) {
  const text = lesson2Labels[language];
  return <div className="lesson-intro">
    <h3>{lesson2Text[language].title}</h3>
    <p>{lesson2Text[language].prediction}</p>
    <label className="lesson-variant">{text.variant}<select value={variant} disabled={locked} onChange={event => onChange(event.target.value as Lesson2Variant)}>
      {lesson2Variants.map(value => <option key={value} value={value}>{text.variants[value]}</option>)}
    </select></label>
    <p>{text.conditions}</p><p>{text.help}</p>
  </div>;
}

export function Lesson2Comparison({results, language}: {results: Lesson2Results; language: Language}) {
  const text = lesson2Labels[language];
  return <section className="lesson-comparison" aria-labelledby="lesson-2-results">
    <h2 id="lesson-2-results">{text.results}</h2>
    <div className="table-scroll" tabIndex={0} role="region" aria-label={text.results}><table>
      <thead><tr><th scope="col">{text.variant}</th>{[1, 2, 3].map(day => <th scope="col" key={day}>{text.shift} {day}</th>)}<th scope="col">{text.total}</th></tr></thead>
      <tbody>{lesson2Variants.map(variant => {
        const result = results[variant];
        return <tr key={variant} data-lesson-result={variant}><th scope="row">{text.variants[variant]}</th>
          {result ? <>{result.shifts.map((quantity, day) => <td key={day}>{quantityText(quantity)}</td>)}<td data-lesson-total={variant}>{quantityText(result.total)}</td></> : <td colSpan={4}>{text.pending}</td>}
        </tr>;
      })}</tbody>
    </table></div>
    <p className="summary-help">{text.memory}</p>
    <details className="lesson-explanation"><summary>{text.explanation}</summary>
      <p>{lesson2Text[language].explanation}</p>
      <ul>{lesson2Text[language].questions.map(question => <li key={question}>{question}</li>)}</ul>
    </details>
  </section>;
}
