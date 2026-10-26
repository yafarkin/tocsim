import type {EditorConfig} from '../engine/config';
import {createCalendar} from '../engine/calendar';

export const lesson2Variants = ['base', 'faster-second', 'faster-third'] as const;
export type Lesson2Variant = typeof lesson2Variants[number];

/** Reference scenarios only. The lesson player is a separate task. */
export function lesson2Config(variant: Lesson2Variant = 'base', language: 'ru' | 'en' = 'ru'): EditorConfig {
  const calendar = {shiftStartMs: 8 * 3_600_000, lunchStartMs: 12 * 3_600_000,
    lunchEndMs: 13 * 3_600_000, shiftEndMs: 17 * 3_600_000};
  const times = [3, variant === 'faster-second' ? 2 : 4, variant === 'faster-third' ? 6 : 8, 3];
  const materials = ['raw', 'part-1', 'part-2', 'part-3', 'product'];
  const stations = ['s1', 's2', 's3', 's4'];
  return {
    schemaVersion: 1, id: 'lesson-2', name: lesson2Text[language].title, language, seed: 42,
    durationMs: createCalendar(calendar, 3).endTimeMs, policy: 'push', calendar,
    materials: materials.map((id, i) => ({id,
      name: language === 'ru' ? ['Сырьё', 'Деталь 1', 'Деталь 2', 'Деталь 3', 'Изделие'][i]! : ['Raw material', 'Part 1', 'Part 2', 'Part 3', 'Product'][i]!,
      color: ['#357dad', '#8862a5', '#b56b20', '#747a32', '#247e70'][i]!,
      role: i === 0 ? 'raw' : i === 4 ? 'finished' : 'intermediate',
      ...(i === 0 ? {purchasePrice: '10'} : i === 4 ? {salePrice: '30'} : {}),
    })),
    recipes: stations.map((id, i) => ({id: `recipe-${id}`, name: id, kind: 'production',
      inputs: [{materialId: materials[i]!, quantity: '1'}], output: {materialId: materials[i + 1]!, quantity: '1'}})),
    stations: stations.map((id, i) => ({id, name: `${language === 'ru' ? 'Пост' : 'Station'} ${i + 1}`, priority: 0,
      plan: [{id: `plan-${id}`, recipeId: `recipe-${id}`, batches: 1,
        processing: {mode: 'sequential', repetitions: 1, timeMs: times[i]! * 60_000, cv: 0}}],
      inputBuffer: {kind: 'quantity', quantity: '20'}, outputBuffer: {kind: 'quantity', quantity: '0'},
      setupMs: 0, maintenance: {enabled: false}, lunchReplacement: false,
      costs: {perShift: '0', perLunchHour: '0', capital: '0'}})),
    sources: [{id: 'source', name: language === 'ru' ? 'Источник' : 'Source', materialId: 'raw',
      availability: 'virtual', quantity: '1', intervalMs: 3 * 60_000}],
    routes: [{id: 'source-s1', fromId: 'source', toId: 's1', materialId: 'raw'},
      ...stations.map((id, i) => ({id: `${id}-next`, fromId: id, toId: stations[i + 1] ?? 'market', materialId: materials[i + 1]!}))],
    initialStocks: [],
  };
}

export const lesson2Text = {
  ru: {
    title: 'Ограничение определяет выход',
    prediction: 'Какое ускорение повысит устойчивый темп выпуска: второго поста с 4 до 2 минут или третьего с 8 до 6?',
    actions: ['Запустите исходную линию. Назовите предполагаемое ограничение и объясните причину по очередям и состояниям постов.',
      'От исходной линии ускорьте только второй пост с 4 до 2 минут и выполните полный прогон.',
      'Верните исходную линию. Ускорьте только третий пост с 8 до 6 минут и выполните полный прогон.'],
    questions: ['Как изменился выпуск по каждой смене?', 'Почему лишнее изделие за три дня ещё не доказывает рост устойчивого темпа?',
      'Какие наблюдения подтверждают, что ограничением остаётся третий пост?'],
    explanation: 'Третий пост задаёт интервал устойчивого выпуска: 8 рабочих минут в базе и при ускорении второго поста, 6 минут при ускорении третьего. Второй пост заполняет линию быстрее и даёт одно дополнительное изделие в первой смене. Во второй и третьей сменах выпуск остаётся по 60. После ускорения третьего поста выпуск составляет по 80 во второй и третьей сменах. Сопоставьте очередь перед третьим постом и голодание четвёртого. Обед и ночь приостанавливают обработку, остаток операции сохраняется.',
  },
  en: {
    title: 'The constraint determines output',
    prediction: 'Which change increases the sustained output rate: speeding up station 2 from 4 to 2 minutes or station 3 from 8 to 6?',
    actions: ['Run the original line. Identify the suspected constraint and explain your choice using queues and station states.',
      'Starting from the original line, speed up only station 2 from 4 to 2 minutes and complete the run.',
      'Restore the original line. Speed up only station 3 from 8 to 6 minutes and complete the run.'],
    questions: ['How did output change in each shift?', 'Why does one extra product over three days not prove a higher sustained rate?',
      'Which observations support station 3 remaining the constraint?'],
    explanation: 'Station 3 sets the sustained output interval: 8 working minutes in the base run and with a faster station 2, and 6 minutes with a faster station 3. A faster station 2 fills the line sooner and adds one product in the first shift. Output remains 60 in both the second and third shifts. With a faster station 3, output is 80 in both the second and third shifts. Compare the queue before station 3 and starvation at station 4. Lunch and overnight breaks pause processing and preserve the remaining operation time.',
  },
} as const;
