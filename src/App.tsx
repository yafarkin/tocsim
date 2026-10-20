import { useEffect, useState } from 'react';

const messages = {
  ru: {
    title: 'Учебный симулятор Теории ограничений',
    language: 'Язык интерфейса',
    status: 'Приложение находится в разработке. Симуляция пока недоступна.',
    diagram: 'Пример направления потока',
    description: 'Статичный пример: материал поступает от источника к посту, затем на выход.',
    source: 'Источник',
    station: 'Пост',
    output: 'Выход',
  },
  en: {
    title: 'Theory of Constraints learning simulator',
    language: 'Interface language',
    status: 'The application is under development. Simulation is not available yet.',
    diagram: 'Example flow direction',
    description: 'Static example: material moves from the source to the station, then to the output.',
    source: 'Source',
    station: 'Station',
    output: 'Output',
  },
};

export function App() {
  const [language, setLanguage] = useState<'ru' | 'en'>('ru');
  const text = messages[language];

  useEffect(() => {
    document.documentElement.lang = language;
    document.title = `TOC | ${text.title}`;
    document.querySelector('meta[name="description"]')?.setAttribute('content', text.title);
  }, [language, text.title]);

  return (
    <main>
      <fieldset>
        <legend>{text.language}</legend>
        <button type="button" lang="ru" aria-pressed={language === 'ru'} onClick={() => setLanguage('ru')}>
          Русский
        </button>
        <button type="button" lang="en" aria-pressed={language === 'en'} onClick={() => setLanguage('en')}>
          English
        </button>
      </fieldset>
      <h1>TOC</h1>
      <p>{text.title}</p>
      <p>{text.status}</p>
      <figure>
        <svg viewBox="0 0 600 130" role="img" aria-labelledby="flow-title flow-description">
          <title id="flow-title">{text.diagram}</title>
          <desc id="flow-description">{text.description}</desc>
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M 0 0 L 10 5 L 0 10 Z" fill="currentColor" />
            </marker>
          </defs>
          <g fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="10" y="35" width="140" height="60" rx="8" />
            <rect x="230" y="35" width="140" height="60" rx="8" />
            <rect x="450" y="35" width="140" height="60" rx="8" />
            <path d="M 150 65 H 218" markerEnd="url(#arrow)" />
            <path d="M 370 65 H 438" markerEnd="url(#arrow)" />
          </g>
          <g fill="currentColor" textAnchor="middle" dominantBaseline="middle">
            <text x="80" y="65">{text.source}</text>
            <text x="300" y="65">{text.station}</text>
            <text x="520" y="65">{text.output}</text>
          </g>
        </svg>
        <figcaption>{text.description}</figcaption>
      </figure>
    </main>
  );
}
