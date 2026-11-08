import type {DisabledMaintenanceConfig} from '../input/processing/DisabledMaintenanceConfig.js';
import type {ResolvedEnabledMaintenance} from './ResolvedEnabledMaintenance.js';

/** Нормализованная настройка обслуживания. */
export type ResolvedMaintenance = DisabledMaintenanceConfig | ResolvedEnabledMaintenance;
