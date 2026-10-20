import type { ThemePreference } from './theme';
import type { Labels } from './i18n';

export function ThemePicker({value, onChange, text}: {value: ThemePreference; onChange: (value: ThemePreference) => void; text: Labels}) {
  const names = {system: text.themeSystem, dark: text.themeDark, light: text.themeLight};
  const description = `${text.theme}: ${names[value].toLowerCase()}`;
  return <button type="button" className="theme-picker" title={description} aria-label={description}
    onClick={() => onChange(value === 'system' ? 'dark' : value === 'dark' ? 'light' : 'system')}>
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      {value === 'system' ? <><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></>
        : value === 'dark' ? <path d="M20 14A8.5 8.5 0 0 1 10 4a8.5 8.5 0 1 0 10 10Z"/>
          : <><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></>}
    </svg>
  </button>;
}
