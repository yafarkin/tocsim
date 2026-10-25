import {inputCapacity, outputCapacity} from '../engine/config';
import type {EditorConfig, InputBufferConfig, OutputBufferConfig, RunConfig} from '../engine/config';
import {quantityText} from './diagram';
export interface BufferSettings {
  defaults: NonNullable<EditorConfig['bufferDefaults']>;
  stations: Record<string, {input: InputBufferConfig; output: OutputBufferConfig}>;
}
/** Patch one existing input without changing any other material or location. */
export function simpleInputRule(input: InputBufferConfig, materialId: string, quantity: string, inputCount: number): InputBufferConfig {
  if (input.kind === 'materials') return {...input, materials: input.materials.map(entry =>
    entry.materialId === materialId ? {...entry, capacity: {kind: 'quantity', quantity}} : entry)};
  if (inputCount !== 1) throw new Error('Use the expert editor for a shared multi-material rule');
  return {kind: 'quantity', quantity};
}
export function bufferSettings(config: RunConfig['source']): BufferSettings {
  return structuredClone({defaults: config.bufferDefaults ?? {}, stations: Object.fromEntries(config.stations.map(s => [s.id, {input: s.inputBuffer, output: s.outputBuffer}]))}) as BufferSettings;
}
export function withBuffers(config: EditorConfig, settings: BufferSettings, reset = false): EditorConfig {
  const result = structuredClone(config);
  result.bufferDefaults = structuredClone(settings.defaults);
  for (const station of result.stations) {
    const own = settings.stations[station.id];
    if (own) {station.inputBuffer = reset ? {kind: 'inherit'} : structuredClone(own.input); station.outputBuffer = reset ? {kind: 'inherit'} : structuredClone(own.output);}
  }
  return result;
}
export function routeCapacities(run: RunConfig, route: RunConfig['resolved']['routes'][number]) {
  const from = run.resolved.stations.find(s => s.id === route.fromId), to = run.resolved.stations.find(s => s.id === route.toId);
  const output = from ? outputCapacity(from, route.materialId) : null, input = to ? inputCapacity(to, route.materialId) : null;
  const text = (b: typeof output) => b === null ? '—' : b.kind === 'infinite' ? '∞' : quantityText(b.quantity);
  const total = !from || !to ? '—' : output?.kind === 'infinite' || input?.kind === 'infinite' ? '∞' : quantityText((BigInt(output!.quantity) + BigInt(input!.quantity)).toString());
  return {output: text(output), input: text(input), total};
}
