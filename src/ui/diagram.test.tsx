import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { compileConfig } from '../engine/config';
import { Runner } from '../runner/runner';
import { Simulation } from '../engine/simulation';
import { FIRST_X, NODE_GAP, fillRatio, linearOrder, quantityText, tokenFills } from './diagram';
import { previewConfig, exampleRuns } from './preview';
import { labels } from './i18n';
import { FlowDiagram, stationReason } from './FlowDiagram';

const previewRun = exampleRuns.blocking;

describe('diagram derived from configuration and snapshot', () => {
  it('follows route IDs rather than display array order', () => {
    const config = previewConfig(); config.stations.reverse(); config.materials.reverse(); config.routes.reverse();
    expect(linearOrder(compileConfig(config))).toEqual(['prep', 'work', 'finish']);
  });
  it('bounds queue glyphs while retaining fractions and exact labels', () => {
    expect(tokenFills(0)).toEqual([]); expect(tokenFills(1_500_000)).toEqual([1, 0.5]);
    expect(tokenFills(Number.MAX_SAFE_INTEGER)).toHaveLength(6);
    expect(quantityText(Number.MAX_SAFE_INTEGER)).toBe('9007199254.740991');
    expect(quantityText('18014398509481982')).toBe('18014398509.481982');
    expect(fillRatio(0, {kind: 'quantity', quantity: 0})).toBeNull();
    expect(fillRatio(1, {kind: 'infinite'})).toBeNull();
  });
  it('shows actual blockage, missing material, quantities and an alternative text view', () => {
    const model = new Simulation(previewRun).advanceTo(46 * 60_000);
    const runner = new Runner(previewRun);
    const view = {...runner.getView(), model, status: 'paused' as const};
    const svg = renderToStaticMarkup(<FlowDiagram run={previewRun} view={view} text={labels('ru')} reduced/>);
    expect(svg).toContain('Заполнен вход: Обработка');
    expect(svg).toContain('Не хватает: 1 Обработанная деталь');
    expect(svg).toContain('Текстовое представление');
    expect(svg).toContain('На посту'); expect(svg).toContain('Без буфера');
    expect(svg).not.toMatch(/NaN|Infinity|0\/0/);
    expect(svg).toContain(`viewBox="0 0 ${FIRST_X + 3 * NODE_GAP + 130} 480"`);
    runner.dispose();
  });
  it('translates state and material reasons without changing model data', () => {
    const model = new Simulation(previewRun).advanceTo(46 * 60_000);
    const hash = model.calculationHash;
    expect(stationReason(model.stations.find(s => s.stationId === 'prep')!, previewRun, labels('en'))).toBe('Input full: Processing');
    expect(stationReason(model.stations.find(s => s.stationId === 'finish')!, previewRun, labels('en'))).toBe('Missing: 1 Processed part');
    expect(model.calculationHash).toBe(hash);
  });
});
