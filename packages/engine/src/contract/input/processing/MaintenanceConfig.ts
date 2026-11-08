import type {DisabledMaintenanceConfig} from './DisabledMaintenanceConfig.js';
import type {EnabledMaintenanceConfig} from './EnabledMaintenanceConfig.js';

/** Настройка планового обслуживания поста. */
export type MaintenanceConfig = DisabledMaintenanceConfig | EnabledMaintenanceConfig;
