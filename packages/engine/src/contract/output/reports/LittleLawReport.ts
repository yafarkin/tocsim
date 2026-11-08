import type {ApplicableLittleLawReport} from './ApplicableLittleLawReport.js';
import type {NotApplicableLittleLawReport} from './NotApplicableLittleLawReport.js';

/** Проверка сохранения потока и конечного приближения закона Литтла. */
export type LittleLawReport = ApplicableLittleLawReport | NotApplicableLittleLawReport;
