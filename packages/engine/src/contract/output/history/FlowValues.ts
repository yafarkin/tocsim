import type {FlowMaterialValues} from './FlowMaterialValues.js';
import type {FlowPlaceValue} from './FlowPlaceValue.js';

/** Все значения потока в одной точке истории. */
export interface FlowValues {
  /** Значения по материалам. */
  materials: FlowMaterialValues[];
  /** Значения по физическим местам. */
  places: FlowPlaceValue[];
}
