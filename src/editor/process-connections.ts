import {ConfigError} from '@toc/engine';
import type {EditorConfig} from '@toc/engine';
import type {ProcessDraft} from './process-form';

/** Shared by the route form and canvas; IDs must not collide with any entity. */
export function nextConnectionId(config: EditorConfig, routes: EditorConfig['routes']): string {
  const used = new Set([config.id, 'market', 'warehouse', ...config.materials.map(item => item.id),
    ...config.recipes.map(item => item.id), ...config.stations.map(item => item.id),
    ...config.stations.flatMap(item => item.plan.map(row => row.id)), ...config.sources.map(item => item.id),
    ...routes.map(item => item.id)]);
  let index = 1;
  while (used.has(`connection-${index}`)) index++;
  return `connection-${index}`;
}

export function outputMaterial(config: EditorConfig, draft: ProcessDraft, fromId: string): string | undefined {
  return config.sources.find(item => item.id === fromId)?.materialId
    ?? draft.stations.find(item => item.id === fromId)?.outputMaterialId;
}

/** Check one gesture even while other edges are missing. Full validation stays in compileConfig. */
export function connectionIssue(config: EditorConfig, draft: ProcessDraft, fromId: string, toId: string): {ru: string; en: string} | null {
  const materialId = outputMaterial(config, draft, fromId);
  const consumer = draft.stations.find(item => item.id === toId);
  if (!materialId || (!consumer && toId !== 'market')) return {
    ru: 'Выберите выход источника или поста и вход поста или готовой продукции.',
    en: 'Choose a source or station output and a station or finished goods input.',
  };
  if (fromId === toId) return {ru: 'Нельзя соединить пост с самим собой.', en: 'A station cannot connect to itself.'};
  if (consumer && consumer.inputMaterialId !== materialId) return {
    ru: 'Материал выхода не совпадает с входным материалом рецепта. Измените входной материал в форме рецепта.',
    en: 'The output material does not match the recipe input. Change the input material in the recipe form.',
  };
  if (toId === 'market' && draft.materials.find(item => item.id === materialId)?.role !== 'finished') return {
    ru: 'К готовой продукции можно подключить только материал с назначением «Готовый продукт».',
    en: 'Only materials with the Finished product role can connect to finished goods.',
  };
  if (draft.routes.some(route => route.fromId === fromId && route.toId === toId && route.materialId === materialId)) return {
    ru: 'Такая связь уже есть.', en: 'This connection already exists.',
  };
  const visited = new Set<string>(), pending = [toId];
  while (pending.length) {
    const id = pending.pop()!;
    if (id === fromId) return {ru: 'Эта связь создаст цикл.', en: 'This connection would create a cycle.'};
    if (visited.has(id)) continue;
    visited.add(id);
    pending.push(...draft.routes.filter(route => route.fromId === id).map(route => route.toId));
  }
  return null;
}

/** Commit only the new route; preserve all existing draft fields and route identities. */
export function connectProcessNodes(config: EditorConfig, draft: ProcessDraft, fromId: string, toId: string): EditorConfig['routes'] {
  const issue = connectionIssue(config, draft, fromId, toId);
  if (issue) throw new ConfigError('topology', 'config.routes', fromId, issue);
  return [...draft.routes.map(route => ({...route})), {id: nextConnectionId(config, draft.routes),
    fromId, toId, materialId: outputMaterial(config, draft, fromId)!}];
}
