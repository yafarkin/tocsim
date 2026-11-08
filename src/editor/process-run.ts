import type {RunConfig} from '@toc/engine';
import {labels} from '../ui/i18n';
import type {Labels, Language} from '../ui/i18n';

/** Shared reports use the names in this configuration, including IDs used by lessons. */
export function processLabels(run: RunConfig, language: Language): Labels {
  return {...labels(language), entityNames: Object.fromEntries([
    ...run.source.stations, ...run.source.materials, ...run.source.recipes, ...run.source.sources,
  ].map(item => [item.id, item.name]))};
}
