export type Language = 'ru' | 'en';
export const messages = {
  ru: {
    title: 'Производственная линия', subtitle: 'Наблюдайте, как материал проходит через посты и где растёт очередь.',
    language: 'Язык', diagram: 'Схема потока', diagramDescription: 'Материал движется слева направо. Входные очереди и удерживаемый результат показаны рядом с каждым постом.',
    example: 'Пример', balanced: 'Равномерный поток', queueExample: 'Очередь перед медленным постом', blocking: 'Блокировка буфера',
    balancedHint: 'Все посты: 3 минуты. Материал проходит без растущей очереди.', queueHint: 'Посты: 3 / 8 / 3 минуты. Перед обработкой растёт очередь; вход вмещает 80 деталей.', blockingHint: 'Посты: 3 / 8 / 3 минуты. Входы вмещают одну деталь: заполнение блокирует предыдущий пост.',
    stop: 'Остановить', newRun: 'Новый прогон', locked: 'Пример зафиксирован. Для выбора другого создайте новый прогон.',
    start: 'Запустить', pause: 'Пауза', resume: 'Продолжить', step: 'Одна отметка', finished: 'Завершено', speed: 'Скорость', max: 'Максимум',
    speed60: '1 мин/с', speed300: '5 мин/с', speed1800: '30 мин/с', lessMotion: 'Меньше движения', systemMotion: 'Включено в настройках устройства',
    day: 'День', source: 'Сырьё', market: 'Готовая продукция', sold: 'Выпущено', input: 'Вход', output: 'Выход',
    direct: 'Без буфера', directLong: 'Прямая передача, без выходного буфера', held: 'На посту', unit: 'шт.', minutes: 'мин',
    processing: 'Работает', starved: 'Нет материала', blocked: 'Заблокирован', paused: 'Приостановлен', idle: 'Готов', notStarted: 'Не запущен',
    lunch: 'Обед', offShift: 'Вне смены', horizon: 'Конец прогона', complete: 'Завершено',
    needs: 'Не хватает', fullInput: 'Заполнен вход', fullOutput: 'Заполнен выход', remaining: 'Осталось',
    preview: 'Одна линия: подготовка, обработка, отделка. Средний пост медленнее соседних.',
    note: 'Числа показывают состояние модели. Фишки поясняют уже учтённые передачи и не добавляют запас.',
    transfer: 'Передано за обновление', scroll: 'На узком экране прокрутите схему по горизонтали.',
    textView: 'Текстовое представление', from: 'Откуда', to: 'Куда', material: 'Материал', state: 'Состояние', queue: 'Очередь', progress: 'Обработка',
    running: 'Идёт прогон', ready: 'Готов к запуску', pausedView: 'Просмотр на паузе', stopped: 'Остановлен', error: 'Ошибка прогона',
    fraction: 'часть', prep: 'Подготовка', work: 'Обработка', finish: 'Отделка',
    raw: 'Заготовка', prepared: 'Деталь', processed: 'Обработанная деталь', product: 'Изделие',
  },
  en: {
    title: 'Production line', subtitle: 'Follow the material through each station and see where queues grow.',
    language: 'Language', diagram: 'Material flow', diagramDescription: 'Material moves from left to right. Input queues and held output appear beside each station.',
    example: 'Example', balanced: 'Balanced flow', queueExample: 'Queue before a slow station', blocking: 'Buffer blocking',
    balancedHint: 'Every station takes 3 minutes. Material flows without a growing queue.', queueHint: 'Stations: 3 / 8 / 3 minutes. A queue grows before processing; its input holds 80 parts.', blockingHint: 'Stations: 3 / 8 / 3 minutes. Inputs hold one part: a full input blocks the previous station.',
    stop: 'Stop', newRun: 'New run', locked: 'Example locked. Create a new run to select another example.',
    start: 'Start', pause: 'Pause', resume: 'Resume', step: 'One timestamp', finished: 'Finished', speed: 'Speed', max: 'Maximum',
    speed60: '1 min/s', speed300: '5 min/s', speed1800: '30 min/s', lessMotion: 'Reduce motion', systemMotion: 'Enabled by device preferences',
    day: 'Day', source: 'Raw material', market: 'Finished goods', sold: 'Output', input: 'Input', output: 'Output',
    direct: 'No buffer', directLong: 'Direct transfer, no output buffer', held: 'Held', unit: 'units', minutes: 'min',
    processing: 'Processing', starved: 'Waiting for input', blocked: 'Blocked', paused: 'Paused', idle: 'Ready', notStarted: 'Not started',
    lunch: 'Lunch', offShift: 'Off shift', horizon: 'End of run', complete: 'Completed',
    needs: 'Missing', fullInput: 'Input full', fullOutput: 'Output full', remaining: 'Remaining',
    preview: 'One line: preparation, processing, finishing. The middle station is slower than its neighbours.',
    note: 'Numbers show model state. Tokens explain transfers already accounted for; they do not add stock.',
    transfer: 'Transferred this update', scroll: 'On a narrow screen, scroll the diagram horizontally.',
    textView: 'Text view', from: 'From', to: 'To', material: 'Material', state: 'State', queue: 'Queue', progress: 'Processing',
    running: 'Running', ready: 'Ready to start', pausedView: 'Playback paused', stopped: 'Stopped', error: 'Run error',
    fraction: 'fraction', prep: 'Preparation', work: 'Processing', finish: 'Finishing',
    raw: 'Blank', prepared: 'Part', processed: 'Processed part', product: 'Product',
  },
};
export type Labels = typeof messages.ru;
export function labels(language: Language): Labels {return messages[language];}
export function nameFor(id: string, fallback: string, text: Labels): string {
  return ['source', 'prep', 'work', 'finish', 'raw', 'prepared', 'processed', 'product'].includes(id) ? text[id as keyof Labels] : fallback;
}
