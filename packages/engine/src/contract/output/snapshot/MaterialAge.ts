import type {AgeSummary} from './AgeSummary.js';

/** Возраст запаса одного материала по двум началам отсчёта. */
export interface MaterialAge {
  /** ID материала. */
  materialId: string;
  /** Текущее физическое количество в микроединицах, строка. */
  quantity: string;
  /** Возраст от поступления в линию. */
  admission: AgeSummary;
  /** Возраст от первой обработки предка. */
  firstProcessing: AgeSummary;
}
