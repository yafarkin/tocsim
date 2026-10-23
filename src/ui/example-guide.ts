import type {ExampleId} from './preview';
import type {Language} from './i18n';
export interface ExampleExperiment {question: string; action: string; watch: string; explanation: string}
const experiments: Record<Language, Record<ExampleId, ExampleExperiment>> = {
  ru: {
    quality: {
      question: 'Сколько времени медленной Обработки тратится на изделия со скрытым браком, если контроль стоит после неё?',
      action: 'Завершите исходный прогон с браком на Подготовке и ранним контролем. В новом прогоне перенесите только контроль после Обработки. Сохраните вероятность 25%, seed и остальные настройки.',
      watch: 'Смотрите на прохождение контроля и удаление списанных деталей из потока. Сравните годный выпуск и минуты Обработки на обнаруженные списанные изделия.',
      explanation: 'Ранний контроль удаляет уже плохие детали до медленного поста. Поздний обнаруживает их после того, как Обработка потратила своё время. Для границы эффекта повторите сравнение с источником дефекта на Обработке: проверка до неё не предотвращает новый дефект. Источник меняет ключ случайных исходов; при его смене это другой эксперимент.',
    },
    balanced: {
      question: 'Если среднее время каждого поста остаётся 3 минуты, сохранится ли выпуск при разбросе времени?',
      action: 'Сравните прогон с CV 0 и новый прогон с CV 0.5. Сохраните seed, буферы и остальные настройки.',
      watch: 'Наблюдайте голодание, блокировки и очереди. После завершения сравните количество изделий в готовой продукции.',
      explanation: 'Посты зависят от готовности материала и свободного места. Разброс может вызывать ожидание даже при одинаковых средних временах. Мощности последовательных постов не складываются. Конечные буферы ограничивают запас; одно значение seed показывает конкретный исход, поэтому повторите сравнение с другими значениями.',
    },
    queue: {
      question: 'Что изменится в выпуске, если сократить время Обработки с 8 до 6 минут, сохранив соседние посты по 3 минуты?',
      action: 'Завершите исходный прогон. В новом прогоне задайте постоянное время 6 минут в панели «Время обработки» и примените его. Остальные условия сохраните.',
      watch: 'Сравните очередь перед Обработкой, ожидание Отделки и итоговое количество готовых изделий.',
      explanation: 'В исходной линии Обработка задаёт самый медленный темп. Её ускорение увеличивает доступную мощность линии, пока другой участок не ограничит поток. Итог за смену учитывает заполнение линии, обед и время завершения последних изделий; он не равен сумме мощностей постов.',
    },
    blocking: {
      question: 'Если дать Подготовке больше места для выгрузки, обязательно ли станет больше готовых изделий?',
      action: 'При CV 0 сравните исходный вход Обработки на 1 деталь с входом на 8 деталей через настройки буферов. Остальные ёмкости и времена сохраните.',
      watch: 'Смотрите на блокировки Подготовки, запас перед Обработкой и количество готовых изделий в конце смены.',
      explanation: 'Больший вход позволяет Подготовке дольше работать и накапливать детали, но не ускоряет Обработку. При достаточном снабжении медленного поста дополнительная занятость предыдущего может увеличить запас без роста выпуска. Буфер защищает поток, а не создаёт мощность.',
    },
    split: {
      question: 'Получит ли Отделка материал, пока вход Обработки с высоким приоритетом ещё принимает детали?',
      action: 'Сравните исходный вход Обработки на 1 деталь с входом на 8 деталей. Приоритеты, вход Отделки и остальные параметры сохраните.',
      watch: 'Проследите стрелки передачи, очередь Обработки и время первого запуска Отделки.',
      explanation: 'Сначала материал получает Обработка с приоритетом 10. Запас в её большем входе может дольше задерживать подачу Отделке с приоритетом 0. Общий материал распределяется по правилам маршрутов и приоритетов; увеличение ёмкости само по себе не обеспечивает равное снабжение.',
    },
    assembly: {
      question: 'Если перед Сборкой накопить больше обычных деталей, поможет ли это при нехватке обработанных?',
      action: 'В настройках входа Сборки увеличьте только ёмкость для «Деталь» с 2 до 8. Ёмкость для «Обработанная деталь» оставьте 4, времена не меняйте.',
      watch: 'Смотрите на две отдельные очереди, надпись о недостающем компоненте и количество готовых изделий.',
      explanation: 'Сборке нужны одновременно 1 деталь и 2 обработанные детали. Запас одного компонента не заменяет другой. Дополнительное место для обычных деталей не ускоряет изготовление пары обработанных деталей, которая в исходном примере ограничивает комплектный поток.',
    },
    batches: {
      question: 'Начнёт ли Обработка раньше, если передавать по одной детали, но для её запуска всё ещё нужен комплект из 6?',
      action: 'В исходном последовательном режиме уменьшите только пороги передачи первых двух постов с 3 до 1. Сохраните по 6 повторений в каждой обработочной партии.',
      watch: 'Отметьте первый запуск Обработки, накопление полного комплекта на её входе и первое готовое изделие после Отделки.',
      explanation: 'Ранняя передача не отменяет ожидание полного комплекта для следующей обработочной партии. Зато Отделка с партией 1 может раньше получить первый результат Обработки. Обработочная партия и порог передачи решают разные задачи. При одновременном режиме готовых изделий нет до завершения общего цикла.',
    },
    plans: {
      question: 'Если делать более длинные серии A и B, как изменятся частота переналадок и ожидание первого B?',
      action: 'При CV 0 сравните план из 2 партий A и 1 партии B с планом 4 A и 2 B. Сохраните переналадку 7 минут, подачу B и буферы. Соотношение A:B остаётся 2:1.',
      watch: 'Смотрите на строку плана, переходы через переналадку и момент первого выпуска B. В итогах сравнивайте A и B отдельно.',
      explanation: 'Длинные серии позволяют реже менять рецепт на тот же объём смеси, но откладывают первый выпуск другого продукта. Выигрыш времени на переналадках сопоставляйте с ожиданием. Изменение только числа A без изменения B поменяло бы ещё и состав продукции, затруднив сравнение.',
    },
  },
  en: {
    quality: {
      question: 'How much of slow Processing time is spent on hidden defective items when inspection follows it?',
      action: 'Finish the original run with defects at Preparation and early inspection. In a new run, move only inspection after Processing. Keep probability at 25%, the seed and all other settings unchanged.',
      watch: 'Watch inspection and the removal of rejected parts from the flow. Compare good output and Processing minutes attributed to detected scrapped items.',
      explanation: 'Early inspection removes items already defective before the slow station. Late inspection finds them after Processing has spent time on them. To explore the limit, repeat the comparison with defects originating at Processing: an earlier check cannot prevent a new defect. Changing the defect source changes the random key and starts a different experiment.',
    },
    balanced: {
      question: 'If every station still averages 3 minutes, will output stay the same when processing times vary?',
      action: 'Compare a run at CV 0 with a new run at CV 0.5. Keep the seed, buffers and other settings unchanged.',
      watch: 'Watch starvation, blocking and queues. Compare the number of finished goods after each run ends.',
      explanation: 'Stations depend on available material and downstream space. Variation can cause waiting even when mean times are equal. Capacities of stations in series do not add up. Finite buffers bound stock; one seed gives one outcome, so repeat the comparison with other seeds.',
    },
    queue: {
      question: 'What happens to output if Processing takes 6 minutes instead of 8 while its neighbours still take 3?',
      action: 'Finish the original run. In a new run, set and apply a constant time of 6 minutes in Processing time. Keep other conditions unchanged.',
      watch: 'Compare the queue before Processing, waiting at Finishing and the final count of finished goods.',
      explanation: 'Processing sets the slowest pace in the original line. Speeding it up increases available line capacity until another part limits flow. Shift output includes line filling, lunch and the time needed to finish the last items; it is not the sum of station capacities.',
    },
    blocking: {
      question: 'Will giving Preparation more room to unload necessarily produce more finished goods?',
      action: 'At CV 0, compare the original Processing input capacity of 1 with a capacity of 8 in Buffer settings. Keep other capacities and processing times unchanged.',
      watch: 'Watch blocking at Preparation, stock before Processing and the number of finished goods at shift end.',
      explanation: 'A larger input lets Preparation work longer and accumulate parts, but does not speed up Processing. When the slow station has enough material, extra upstream activity can increase stock without raising output. A buffer protects flow rather than creating capacity.',
    },
    split: {
      question: 'Will Finishing receive material while the higher-priority Processing input can still accept parts?',
      action: 'Compare the original Processing input capacity of 1 with a capacity of 8. Keep priorities, the Finishing input and other settings unchanged.',
      watch: 'Follow transfer arrows, the Processing queue and the first start of Finishing.',
      explanation: 'Processing receives material first at priority 10. Its larger input can delay supply to Finishing at priority 0 for longer. Shared material follows explicit routes and priorities; increasing capacity alone does not ensure equal supply.',
    },
    assembly: {
      question: 'Will more ordinary parts before Assembly help when processed parts are missing?',
      action: 'In Assembly input settings, increase only the Part capacity from 2 to 8. Keep Processed part capacity at 4 and leave processing times unchanged.',
      watch: 'Watch the two separate queues, the missing-component message and the number of finished goods.',
      explanation: 'Assembly needs 1 part and 2 processed parts together. Extra stock of one component cannot replace the other. More room for ordinary parts does not speed up production of the processed pair that limits complete-kit flow in this example.',
    },
    batches: {
      question: 'Will Processing start earlier if parts are transferred one at a time but it still needs a full kit of 6?',
      action: 'In the original sequential mode, reduce only the transfer thresholds at the first two stations from 3 to 1. Keep 6 repetitions in each processing batch.',
      watch: 'Note the first start of Processing, the accumulation of its full input kit and the first finished item after Finishing.',
      explanation: 'Earlier transfer does not remove the complete-kit requirement of the next station. However, Finishing with batch size 1 can receive the first output from Processing sooner. Processing batch size and transfer threshold serve different purposes. Simultaneous mode has no ready output before the shared cycle ends.',
    },
    plans: {
      question: 'How do longer A and B runs change setup frequency and the wait for the first B?',
      action: 'At CV 0, compare 2 A batches and 1 B batch with 4 A and 2 B. Keep the 7-minute setup, B supply and buffers unchanged. The A:B ratio stays 2:1.',
      watch: 'Watch the plan row, setup transitions and the first B output. Compare A and B separately in the summary.',
      explanation: 'Longer runs require fewer recipe changes for the same product mix, but delay the first output of the other product. Weigh setup time saved against waiting. Changing only the A count would also change the product mix and make the comparison harder to interpret.',
    },
  },
};
export const experimentFor = (example: ExampleId, language: Language): ExampleExperiment => experiments[language][example];
