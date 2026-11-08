/** Рекурсивно запрещает изменение объекта, массива и всех вложенных значений на уровне TypeScript. */
export type DeepReadonly<T> = T extends object
  ? {readonly [K in keyof T]: DeepReadonly<T[K]>}
  : T;
