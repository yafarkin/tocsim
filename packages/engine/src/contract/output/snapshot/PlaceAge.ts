import type {MaterialAge} from './MaterialAge.js';

/** Возраст запаса материала в конкретном физическом месте. */
export interface PlaceAge extends MaterialAge {
  /** ID владельца места хранения. */
  ownerId: string;
  /** Место внутри линии, исключая общий склад. */
  location: 'input' | 'output' | 'held' | 'reserved';
}
