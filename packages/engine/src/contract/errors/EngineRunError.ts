/** Машинная и локализованная ошибка проверки входа или выполнения прогона. */
export interface EngineRunError {
  /** Стабильный код ошибки, например shape, value, topology, json, io или internal. */
  code: string;
  /** Путь к ошибочному полю входа или null, если путь неприменим. */
  path: string | null;
  /** ID связанной сущности или null, если он неизвестен/неприменим. */
  objectId: string | null;
  /** Понятные сообщения без stack trace. */
  messages: {
    /** Сообщение на русском языке. */
    ru: string;
    /** Сообщение на английском языке. */
    en: string;
  };
}
