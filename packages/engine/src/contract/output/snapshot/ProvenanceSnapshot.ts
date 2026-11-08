import type {ProcessingOrigin} from './ProcessingOrigin.js';
import type {StockOrigin} from './StockOrigin.js';

/** JSON-представление происхождения и накопленных затрат партии материала. */
export interface ProvenanceSnapshot {
  /** Поступление партии в линию. */
  origin: StockOrigin;
  /** Первая обработка партии или её предка. */
  firstProcessing: ProcessingOrigin;
  /** Признак дефекта, известный модели; UI может скрывать его до контроля. */
  defective: boolean;
  /** ID постов, на которых возник дефект. */
  defectSourceIds: string[];
  /** Время обработки в мс по ID постов, представленное десятичными строками. */
  processingMs: Record<string, string>;
}
