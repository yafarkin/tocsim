import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { compileConfig } from '../engine/config';
import { Simulation } from '../engine/simulation';
import { line } from '../engine/test-fixtures';
import { Runner } from '../runner/runner';
import { exampleRuns, previewConfig } from './preview';
import { labels } from './i18n';
import { RunSummary } from './RunSummary';

describe('run summary from actual counters', () => {
  it.each(['ru', 'en'] as const)('groups reports without hiding one report inside another in %s', language => {
    const run = exampleRuns.queue, runner = new Runner(run), text = labels(language);
    const html = renderToStaticMarkup(<RunSummary run={run} view={runner.getView()} text={text} language={language}/>);
    for (const title of [text.outputGroup, text.economyGroup, text.flowGroup]) expect(html).toContain(`>${title}</h2>`);
    expect((html.match(/data-time-state="processingMs"/g) ?? []).length).toBe(1);
    expect(html).not.toContain('data-constraint-state=');
    expect(html).not.toContain('data-constraint-product=');
    expect(html).toContain('<details class="output-summary" id="output-summary">');
    const outputEnd = html.indexOf('aria-labelledby="economy-group-title"');
    expect(html.indexOf('data-testid="financial-report"')).toBeGreaterThan(outputEnd);
    expect(html.indexOf('data-testid="run-metrics"')).toBeGreaterThan(html.indexOf('aria-labelledby="flow-group-title"'));
    expect(html).toContain('id="output-summary-toggle"');
    runner.dispose();
  });
  it('shows a live incomplete report and distinguishes stopped time from the planned horizon', () => {
    const run = exampleRuns.queue, runner = new Runner(run);
    for (const status of ['ready', 'running', 'paused'] as const) {
      const markup = renderToStaticMarkup(<RunSummary run={run} view={{...runner.getView(), status}} text={labels('ru')} language="ru"/>);
      expect(markup).toContain(labels('ru').currentResult);expect(markup).toContain(labels('ru').incompleteResult);expect(markup).not.toContain(labels('ru').endedHorizon);
    }
    const sim = new Simulation(run); sim.advanceTo(300_123); sim.stop();
    for (const language of ['ru', 'en'] as const) {
      const text = labels(language), markup = renderToStaticMarkup(<RunSummary run={run} view={{...runner.getView(), model: sim.getSnapshot(), status: 'stopped'}} text={text} language={language}/>);
      expect(markup).toContain(text.endedStopped);
      expect(markup).toContain(`${text.day} 1 08:05:00.123`);
      expect(markup).not.toContain('17:00:00');
      expect(markup).not.toContain(text.endedHorizon);
    }
    runner.dispose();
  });
  it('does not count initial finished goods as newly manufactured output', () => {
    const c = line(); c.sources[0]!.availability = 'warehouse';
    c.initialStocks = [{id: 'initialGoods', ownerId: 's2', location: 'output', materialId: 'product', quantity: '1', cost: '2'}];
    const run = compileConfig(c), model = new Simulation(run).runToEnd(), runner = new Runner(run);
    expect(model.line!.counters.find(c => c.materialId === 'product')).toMatchObject({produced: 0, sold: 1_000_000});
    const markup = renderToStaticMarkup(<RunSummary run={run} view={{...runner.getView(), status: 'finished', model}} text={labels('en')} language="en"/>);
    expect(markup).toContain('<td>0</td><td data-delivered="product">1</td>');
    expect(markup).toContain(labels('en').endedHorizon);
    expect(markup).toContain('17:00:00');
    runner.dispose();
  });
  it('keeps quantities separate for different products and renders localized error detail', () => {
    const c = previewConfig('split');
    c.materials.push({id: 'product2', name: 'Second product', role: 'finished', salePrice: '10', color: '#123'});
    const recipe = structuredClone(c.recipes.find(r => r.id === 'recipe-work')!); recipe.id = 'recipe-second'; recipe.output.materialId = 'product2'; c.recipes.push(recipe);
    c.stations.find(s => s.id === 'finish')!.plan[0]!.recipeId = recipe.id;
    c.routes.find(r => r.fromId === 'finish')!.materialId = 'product2';
    const run = compileConfig(c), model = new Simulation(run).runToEnd(), runner = new Runner(run);
    for (const language of ['ru', 'en'] as const) {
      const text = labels(language), error = {code: 'limit', messages: {ru: 'Достигнут лимит переходов.', en: 'Transition limit reached.'}};
      const markup = renderToStaticMarkup(<RunSummary run={run} view={{...runner.getView(), model, status: 'error', error}} text={text} language={language}/>);
      expect(markup).toContain(text.endedError);
      expect(markup).toContain(error.messages[language]);
      expect(markup).toContain('role="alert"');
      expect(markup).toContain('data-product="product2"'); expect(markup).toContain('data-product="product"');
      for (const id of ['product2', 'product']) {
        const counter = model.line!.counters.find(c => c.materialId === id)!;
        expect(markup).toContain(`<td>${counter.produced / 1_000_000}</td><td data-delivered="${id}">${counter.sold / 1_000_000}</td>`);
      }
    }
    runner.dispose();
  });
});
