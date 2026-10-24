import {describe, expect, it} from 'vitest';
import {compileConfig} from './config';
import type {DeepReadonly, EditorConfig} from './config';
import {DAY_MS, createCalendar} from './calendar';
import {EventScheduler} from './events';
import {createPushState} from './sources';
import {Simulation} from './simulation';
import {integrateStockTime, stockTimeReport} from './stock-time';
import type {Snapshot, StockTime} from './state';
import {line} from './test-fixtures';
import {exampleIds, previewConfig} from '../ui/preview';
const M = 60_000, H = 60 * M, Q = 1_000_000n;

function oneStation(): EditorConfig {
  const c = line(); c.stations = [c.stations[0]!]; c.materials = c.materials.filter(m => m.id !== 'part');
  c.stations[0]!.inputBuffer = {kind: 'infinite'};
  c.recipes = [{id: 'cut', name: 'one', kind: 'production', inputs: [{materialId: 'raw', quantity: '1'}], output: {materialId: 'product', quantity: '1'}}];
  c.routes = [c.routes[0]!, {id: 'sell', fromId: 's1', toId: 'market', materialId: 'product'}];
  c.sources[0]!.availability = 'warehouse';
  c.initialStocks = [{id: 'kit', ownerId: 's1', location: 'input', materialId: 'raw', quantity: '3', cost: '30'}];
  return c;
}
function at(c: EditorConfig, timeMs: number) {
  const run = compileConfig(c), sim = new Simulation(run), model = sim.advanceTo(timeMs);
  return {run, sim, model, report: stockTimeReport(run, model)};
}
function integral(model: DeepReadonly<Snapshot>, materialId: string, location?: StockTime['location']) {
  return model.line!.stockTime.filter(r => r.materialId === materialId && (location === undefined || r.location === location))
    .reduce((sum, r) => sum + BigInt(r.calendarQuantityMs), 0n);
}

describe('hand-checked physical residence and exact averages', () => {
  it('has no invented mean at zero time, before or after same-timestamp transfers', () => {
    const c = oneStation(), run = compileConfig(c), sim = new Simulation(run);
    for (const model of [sim.getSnapshot(), sim.advanceTo(0)]) {
      expect(model.line!.stockTime).toEqual([]);
      const report = stockTimeReport(run, model);
      expect(report.materials.every(m => m.calendarQuantityMs === '0' && m.workQuantityMs === '0' && m.calendarAverage === null && m.workAverage === null)).toBe(true);
      expect(report.places).toEqual([]); expect(report.complete).toBe(false);
    }
  });

  it('weights quantities by elapsed time rather than averaging event samples', () => {
    const {model, report} = at(oneStation(), 2.5 * M);
    // Raw quantities 3, 2, 1 for 1, 1, 0.5 minutes give 5.5 quantity-minutes.
    expect(integral(model, 'raw', 'input')).toBe(3n * Q * BigInt(M));
    expect(integral(model, 'raw', 'reserved')).toBe(5n * Q * BigInt(M) / 2n);
    expect(report.materials.find(m => m.materialId === 'raw')).toMatchObject({
      calendarQuantityMs: String(11n * Q * BigInt(M) / 2n),
      calendarAverage: {quantityMs: String(11n * Q * BigInt(M) / 2n), durationMs: 2.5 * M},
    });
    expect(integral(model, 'product')).toBe(0n); // Immediate market transfer has zero residence.
  });

  it('retains exact fractional averages and historical places after the last sale', () => {
    const c = oneStation(); c.calendar = {shiftStartMs: 0, lunchStartMs: 10 * M, lunchEndMs: 11 * M, shiftEndMs: 12 * M}; c.durationMs = 12 * M;
    c.initialStocks[0]!.quantity = '1'; c.stations[0]!.plan[0]!.processing.timeMs = 1;
    const {run, sim, model, report} = at(c, 3);
    expect(model.stocks).toEqual([]);
    expect(report.places).toHaveLength(1);
    expect(report.materials.find(m => m.materialId === 'raw')!.calendarAverage).toEqual({quantityMs: String(Q), durationMs: 3});
    const end = sim.runToEnd(), full = stockTimeReport(run, end);
    expect(integral(end, 'raw')).toBe(Q);
    expect(full.calendarMs).toBe(12 * M); expect(full.workMs).toBe(11 * M); expect(full.complete).toBe(true);
    expect(full.places[0]!.calendarAverage!.durationMs).toBe(12 * M);
  });

  it.each(['sequential', 'simultaneous'] as const)('counts reserved inputs and only completed %s batch output', mode => {
    const c = oneStation(); Object.assign(c.stations[0]!.plan[0]!.processing, {mode, repetitions: 3});
    c.stations[0]!.transportThreshold = '3';
    const {model} = at(c, 2.5 * M);
    if (mode === 'sequential') {
      expect(integral(model, 'raw', 'reserved')).toBe(11n * Q * BigInt(M) / 2n);
      expect(integral(model, 'product', 'held')).toBe(2n * Q * BigInt(M));
    } else {
      expect(integral(model, 'raw', 'reserved')).toBe(3n * Q * BigInt(M));
      expect(integral(model, 'product')).toBe(0n);
    }
    expect(integral(model, 'raw', 'input')).toBe(0n);
  });

  it('uses the previous state at completion and preserves finished held material as WIP until acceptance', () => {
    const c = oneStation(); c.stations[0]!.plan[0]!.processing.repetitions = 3; c.stations[0]!.transportThreshold = '3';
    const {sim, model} = at(c, M);
    expect(integral(model, 'raw')).toBe(3n * Q * BigInt(M));
    expect(integral(model, 'product')).toBe(0n);
    const end = sim.advanceTo(3 * M);
    expect(end.stocks).toEqual([]);
    expect(integral(end, 'raw')).toBe(6n * Q * BigInt(M));
    expect(integral(end, 'product', 'held')).toBe(3n * Q * BigInt(M));
    expect(integral(end, 'product', 'output')).toBe(0n);
  });

  it('excludes warehouse stock and includes it only after release to the line', () => {
    const c = oneStation(); c.initialStocks = [{id: 'warehouse-lot', ownerId: 'warehouse', location: 'warehouse', materialId: 'raw', quantity: '10', cost: '100'}];
    c.sources[0]!.intervalMs = 10 * M;
    const {model, report} = at(c, 2 * M);
    expect(model.stocks.find(s => s.location === 'warehouse')!.quantity).toBe(9_000_000);
    expect(integral(model, 'raw')).toBe(Q * BigInt(M));
    expect(report.places.every(r => r.ownerId !== 'warehouse')).toBe(true);
  });

  it('does not count virtual raw material before its first admission', () => {
    const c = oneStation(); c.sources[0]!.availability = 'virtual'; c.sources[0]!.intervalMs = 10 * M; c.initialStocks = [];
    c.stations[0]!.inputBuffer = {kind: 'quantity', quantity: '1'};
    const {model} = at(c, 5 * M);
    expect(integral(model, 'raw')).toBe(Q * BigInt(M));
    expect(model.line!.stockTime).toHaveLength(1);
  });

  it('keeps 0.3-to-10 recipe quantities separate without a fictitious global piece count', () => {
    const c = line(); c.sources[0]!.availability = 'warehouse'; c.initialStocks[0]!.quantity = '0.6';
    c.stations[1]!.inputBuffer = {kind: 'infinite'};
    const {model, report} = at(c, 1.5 * M);
    expect(integral(model, 'raw')).toBe(750_000n * BigInt(M));
    expect(integral(model, 'part')).toBe(5n * Q * BigInt(M));
    expect(report.materials.map(m => m.materialId)).toEqual(['part', 'product', 'raw']);
    expect(report).not.toHaveProperty('total');
  });

  it('keeps both assembly components in the line until each recipe completion', () => {
    const c = previewConfig('assembly'); c.sources.forEach(s => {s.availability = 'warehouse';});
    c.stations.find(s => s.id === 'assembly')!.plan[0]!.processing.timeMs = M;
    c.initialStocks = [
      {id: 'a', ownerId: 'assembly', location: 'input', materialId: 'prepared', quantity: '2', cost: '0'},
      {id: 'b', ownerId: 'assembly', location: 'input', materialId: 'processed', quantity: '4', cost: '0'},
    ];
    const {model} = at(c, 1.5 * M);
    expect(integral(model, 'prepared')).toBe(5n * Q * BigInt(M) / 2n);
    expect(integral(model, 'processed')).toBe(5n * Q * BigInt(M));
    expect(integral(model, 'product')).toBe(0n);
  });

  it('counts residence in output and two recipients independently when one material splits', () => {
    const c = previewConfig('split'); c.sources[0]!.availability = 'warehouse';
    c.stations[0]!.outputBuffer = {kind: 'quantity', quantity: '5'};
    c.initialStocks = [{id: 'parts', ownerId: 'prep', location: 'output', materialId: 'prepared', quantity: '5', cost: '0'}];
    const {model} = at(c, 2 * M);
    expect(integral(model, 'prepared')).toBe(10n * Q * BigInt(M));
    expect(model.line!.stockTime.filter(r => r.materialId === 'prepared')).toHaveLength(5);
    expect(integral(model, 'prepared', 'output')).toBe(2n * Q * BigInt(M));
    expect(integral(model, 'prepared', 'input')).toBe(4n * Q * BigInt(M));
    expect(integral(model, 'prepared', 'reserved')).toBe(4n * Q * BigInt(M));
  });

  it('keeps material under inspection until rejection and stops accruing after scrap', () => {
    const c = line(); c.sources[0]!.availability = 'warehouse';
    c.initialStocks[0]!.quantity = '1'; c.recipes[0]!.inputs[0]!.quantity = '1'; c.recipes[0]!.output.quantity = '1';
    c.stations[0]!.plan[0]!.processing.defectProbability = 1;
    c.stations[1]!.plan[0]!.processing.timeMs = M;
    c.recipes[1]!.kind = 'inspection'; c.recipes[1]!.output.materialId = 'part'; c.routes[2]!.materialId = 'part';
    c.materials = c.materials.filter(m => m.id !== 'product');
    Object.assign(c.materials.find(m => m.id === 'part')!, {role: 'finished', salePrice: '0'});
    const {model} = at(c, 3 * M);
    expect(model.stocks).toEqual([]); expect(model.line!.counters.find(r => r.materialId === 'part')!.scrapped).toBe(Number(Q));
    expect(integral(model, 'raw')).toBe(Q * BigInt(M));
    expect(integral(model, 'part')).toBe(Q * BigInt(M));
  });
});

describe('calendar scale, precision, atomicity and reproducibility', () => {
  it.each([false, true])('uses the common work calendar for stock averages, lunch replacement=%s', replacement => {
    const c = oneStation(); c.stations[0]!.lunchReplacement = replacement;
    c.stations[0]!.plan[0]!.processing.timeMs = 20 * H;
    c.durationMs = createCalendar(c.calendar, 2).endTimeMs;
    const {model, report} = at(c, DAY_MS + 5 * H);
    const row = report.materials.find(m => m.materialId === 'raw')!;
    expect(row.calendarQuantityMs).toBe(String(3n * Q * BigInt(DAY_MS + 5 * H)));
    expect(row.workQuantityMs).toBe(String(3n * Q * BigInt(12 * H)));
    expect(row.workAverage!.durationMs).toBe(12 * H);
    expect(model.stations[0]!.availableWorkMs).toBe((replacement ? 14 : 12) * H);
  });

  it('freezes the actual numerator and denominator when stopped inside an operation', () => {
    const {run, sim, model} = at(oneStation(), M / 2);
    const before = structuredClone(model.line!.stockTime), stopped = sim.stop();
    expect(stopped.line!.stockTime).toEqual(before);
    expect(stockTimeReport(run, stopped).materials.find(m => m.materialId === 'raw')!.calendarAverage).toEqual({quantityMs: String(3n * Q * BigInt(M / 2)), durationMs: M / 2});
    expect(stockTimeReport(run, stopped).complete).toBe(false);
    expect(sim.runToEnd()).toEqual(stopped);
    expect(Object.isFrozen(stopped.line!.stockTime[0])).toBe(true);
    expect(JSON.parse(JSON.stringify(stopped)).schemaVersion).toBe(18);
  });

  it('retains products and aggregate sums beyond the safe-number and money range exactly', () => {
    const run = compileConfig(oneStation()), initial = createPushState(run), stock = initial.stocks[0]!;
    const stocks = [{...stock, quantity: Number.MAX_SAFE_INTEGER}, {...stock, id: 'second', quantity: Number.MAX_SAFE_INTEGER}];
    const rows: StockTime[] = [];
    integrateStockTime(stocks, rows, {calendarMs: Number.MAX_SAFE_INTEGER, workMs: 3});
    const expected = 2n * BigInt(Number.MAX_SAFE_INTEGER);
    expect(rows[0]!.calendarQuantityMs).toBe(expected * BigInt(Number.MAX_SAFE_INTEGER));
    expect(rows[0]!.workQuantityMs).toBe(expected * 3n);
    expect(rows).toHaveLength(1);
    const initialSnapshot = new Simulation(run).getSnapshot();
    const model = {...initialSnapshot, observation: {calendarMs: Number.MAX_SAFE_INTEGER, workMs: 3}, line: {...initialSnapshot.line!, stockTime: rows.map(r => ({...r, calendarQuantityMs: String(r.calendarQuantityMs), workQuantityMs: String(r.workQuantityMs)}))}};
    const decoded = JSON.parse(JSON.stringify(model)) as Snapshot;
    const report = stockTimeReport(run, decoded);
    const raw = report.materials.find(m => m.materialId === 'raw')!;
    expect(raw.calendarAverage).toEqual({quantityMs: String(expected * BigInt(Number.MAX_SAFE_INTEGER)), durationMs: Number.MAX_SAFE_INTEGER});
    expect(raw.workAverage).toEqual({quantityMs: String(expected * 3n), durationMs: 3});
  });

  it('does not let lot splitting or hidden quality flags change physical residence', () => {
    const run = compileConfig(oneStation()), stock = createPushState(run).stocks[0]!;
    const a: StockTime[] = [], b: StockTime[] = [];
    integrateStockTime([stock], a, {calendarMs: 7, workMs: 3});
    integrateStockTime([
      {...stock, quantity: 1_000_001},
      {...stock, id: 'bad', quantity: stock.quantity - 1_000_001, provenance: {...stock.provenance, defective: true, defectSourceIds: ['hidden']}},
    ], b, {calendarMs: 7, workMs: 3});
    expect(b).toEqual(a);
  });

  it('rolls residence integrals back with all other state if an endpoint event fails', () => {
    const run = compileConfig(oneStation()), initial = createPushState(run);
    initial.line = {transferPending: false, dispatchPending: false, counters: [], inspections: [], scraps: [], shiftOutput: [], stockTime: [], transfers: []};
    const loop = new EventScheduler(run, initial, {
      integrate: (state, from, to) => integrateStockTime(state.stocks, state.line!.stockTime, {calendarMs: to - from, workMs: to - from}),
      transfer: () => {throw new Error('failed endpoint');},
    });
    loop.schedule({kind: 'transfer', id: 'fail', producerId: 's1', timeMs: M});
    const previous = loop.getSnapshot(); expect(() => loop.step()).toThrow('failed endpoint');
    expect(loop.getSnapshot()).toBe(previous); expect(loop.getSnapshot().line!.stockTime).toEqual([]);
  });

  it.each(exampleIds)('matches independently summed physical rectangles and frame partitions in %s', example => {
    const c = previewConfig(example), run = compileConfig(c), reference = new Simulation(run);
    const rectangles = new Map<string, {calendar: bigint; work: bigint}>();
    // Independent work-time overlap by daily intervals, rather than the engine integral helper.
    function commonWork(from: number, to: number) {
      let total = 0;
      const {shiftStartMs: start, lunchStartMs: lunch, lunchEndMs: open, shiftEndMs: end} = c.calendar;
      for (let day = 0; day <= Math.floor(to / DAY_MS); day++) {
        for (const [a, b] of [[0, lunch - start], [open - start, end - start]]) total += Math.max(0, Math.min(to, day * DAY_MS + b!) - Math.max(from, day * DAY_MS + a!));
      }
      return BigInt(total);
    }
    let previous = reference.getSnapshot();
    while (reference.step() !== null) {
      const next = reference.getSnapshot(), dt = BigInt(next.timeMs - previous.timeMs), work = commonWork(previous.timeMs, next.timeMs);
      for (const stock of previous.stocks) {
        if (stock.location === 'warehouse' || dt === 0n) continue;
        const key = JSON.stringify([stock.ownerId, stock.materialId, stock.location]);
        const row = rectangles.get(key) ?? {calendar: 0n, work: 0n};
        row.calendar += BigInt(stock.quantity) * dt; row.work += BigInt(stock.quantity) * work; rectangles.set(key, row);
      }
      previous = next;
    }
    expect(previous.line!.stockTime).toHaveLength(rectangles.size);
    for (const row of previous.line!.stockTime) {
      const expected = rectangles.get(JSON.stringify([row.ownerId, row.materialId, row.location]))!;
      expect(row.calendarQuantityMs).toBe(String(expected.calendar)); expect(row.workQuantityMs).toBe(String(expected.work));
    }
    const partitioned = new Simulation(run);
    for (let t = 1; t < c.durationMs; t += 137_111) partitioned.advanceTo(t);
    expect(partitioned.runToEnd()).toEqual(previous);
    expect(new Simulation(run).runToEnd()).toEqual(previous);
    expect(previous.line!.stockTime.length).toBeLessThanOrEqual(c.stations.length * c.materials.length * 4);
    const report = stockTimeReport(run, previous);
    for (const material of report.materials) {
      const places = report.places.filter(p => p.materialId === material.materialId);
      expect(BigInt(material.calendarQuantityMs)).toBe(places.reduce((sum, p) => sum + BigInt(p.calendarQuantityMs), 0n));
      expect(BigInt(material.workQuantityMs)).toBe(places.reduce((sum, p) => sum + BigInt(p.workQuantityMs), 0n));
    }
  });
});
