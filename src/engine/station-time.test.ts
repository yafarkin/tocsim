import {describe, expect, it} from 'vitest';
import {createCalendar, DAY_MS} from './calendar';
import {compileConfig} from './config';
import type {DeepReadonly, EditorConfig} from './config';
import {EventScheduler} from './events';
import {createPushState} from './sources';
import {Simulation} from './simulation';
import {emptyStationTime, integrateStationTime, stationTimeReport} from './station-time';
import type {Snapshot, StationTime} from './state';
import {cyclicLine, line} from './test-fixtures';
import {exampleIds, previewConfig} from '../ui/preview';
const M = 60_000;
const schedule = {shiftStartMs: 0, lunchStartMs: 10 * M, lunchEndMs: 20 * M, shiftEndMs: 30 * M};
function oneStation(): EditorConfig {
  const c = line(); c.calendar = {...schedule}; c.durationMs = 30 * M;
  c.stations = [c.stations[0]!]; c.stations[0]!.inputBuffer = {kind: 'infinite'};
  c.materials = c.materials.filter(m => m.id !== 'product');
  Object.assign(c.materials.find(m => m.id === 'part')!, {role: 'finished', salePrice: '0'});
  c.recipes = [c.recipes[0]!]; c.recipes[0]!.inputs[0]!.quantity = '1'; c.recipes[0]!.output.quantity = '1';
  c.routes = [c.routes[0]!, {...c.routes[1]!, toId: 'market'}]; c.sources[0]!.availability = 'warehouse';
  c.initialStocks = [{id: 'kit', ownerId: 's1', location: 'input', materialId: 'raw', quantity: '1', cost: '0'}];
  return c;
}
function execute(c: EditorConfig) {return new Simulation(compileConfig(c));}
function expectTimes(model: DeepReadonly<Snapshot>, expected: Partial<StationTime>, stationIndex = 0) {
  expect(model.stations[stationIndex]!.timeByState).toEqual({...emptyStationTime(), ...expected});
  checkPartition(model);
}
function checkPartition(model: DeepReadonly<Snapshot>) {
  for (const station of model.stations) {
    const t = station.timeByState;
    expect(Object.values(t).reduce((a, b) => a + b, 0)).toBe(model.timeMs);
    expect(t.processingMs + t.setupMs + t.maintenanceMs + t.starvedMs + t.blockedMs + t.idleMs).toBe(station.availableWorkMs);
    for (const value of Object.values(t)) {expect(Number.isSafeInteger(value)).toBe(true); expect(value).toBeGreaterThanOrEqual(0);}
  }
}

describe('hand-checked time states and availability denominators', () => {
  it('starts with zero counters and no percentage denominator, including time-zero dispatch', () => {
    const sim = execute(oneStation());
    for (const model of [sim.getSnapshot(), sim.advanceTo(0)]) {
      expectTimes(model, {});
      expect(stationTimeReport(model).stations[0]).toMatchObject({availableWorkMs: 0, busyMs: 0, processingShare: null, busyShare: null, starvedShare: null, blockedShare: null});
    }
  });

  it('continues starvation through the full requested horizon after raw material runs out', () => {
    const c = oneStation(); c.initialStocks = [];
    const model = execute(c).runToEnd();
    expectTimes(model, {starvedMs: 20 * M, lunchMs: 10 * M});
    expect(model.line!.flow).toBe('exhausted'); expect(stationTimeReport(model).complete).toBe(true);
    expect(stationTimeReport(model).stations[0]!.starvedShare).toEqual({timeMs: 20 * M, availableWorkMs: 20 * M});
  });

  it.each([false, true])('counts processing and subsequent starvation with lunch replacement=%s', replacement => {
    const c = oneStation(); c.stations[0]!.lunchReplacement = replacement; c.stations[0]!.plan[0]!.processing.timeMs = 12 * M;
    const model = execute(c).runToEnd();
    expectTimes(model, {processingMs: 12 * M, starvedMs: (replacement ? 18 : 8) * M, lunchMs: replacement ? 0 : 10 * M});
    const row = stationTimeReport(model).stations[0]!;
    expect(row.processingShare).toEqual({timeMs: 12 * M, availableWorkMs: (replacement ? 30 : 20) * M});
    expect(row.busyShare).toEqual(row.processingShare);
  });

  it('pauses a retained operation without charging processing during lunch and freezes a partial stop', () => {
    const c = oneStation(); c.stations[0]!.plan[0]!.processing.timeMs = 20 * M;
    const sim = execute(c); const atLunch = sim.advanceTo(12 * M + 7);
    expect(atLunch.stations[0]).toMatchObject({status: 'paused', remainingProcessingMs: 10 * M});
    expectTimes(atLunch, {processingMs: 10 * M, lunchMs: 2 * M + 7});
    const stopped = sim.stop(); expect(stationTimeReport(stopped).complete).toBe(false);
    expect(stopped.stations[0]!.timeByState).toEqual(atLunch.stations[0]!.timeByState);
    expect(sim.runToEnd()).toEqual(stopped);
    expect(Object.isFrozen(stopped.stations[0]!.timeByState)).toBe(true);
    expect(JSON.parse(JSON.stringify(stopped)).schemaVersion).toBe(23);
  });

  it.each([false, true])('separates overnight time without a final extra night, replacement=%s', replacement => {
    const c = oneStation(); c.durationMs = createCalendar(c.calendar, 2).endTimeMs;
    c.stations[0]!.lunchReplacement = replacement; c.stations[0]!.plan[0]!.processing.timeMs = 100 * M;
    const model = execute(c).runToEnd();
    expectTimes(model, {processingMs: (replacement ? 60 : 40) * M, lunchMs: replacement ? 0 : 20 * M, offShiftMs: DAY_MS - 30 * M});
  });

  it('counts setup across lunch separately from processing and includes both in occupancy', () => {
    const c = cyclicLine(); c.calendar = {...schedule}; c.durationMs = 30 * M;
    c.stations[0]!.initialRecipeId = 'recipeB'; c.stations[0]!.setupMs = 7 * M;
    const model = execute(c).runToEnd();
    expectTimes(model, {processingMs: 4 * M, setupMs: 16 * M, lunchMs: 10 * M});
    const row = stationTimeReport(model).stations[0]!;
    expect(row.busyMs).toBe(20 * M);
    expect(row.processingShare).toEqual({timeMs: 4 * M, availableWorkMs: 20 * M});
    expect(row.busyShare).toEqual({timeMs: 20 * M, availableWorkMs: 20 * M});
  });

  it('does not invent setup time when the next recipe lacks its input kit', () => {
    const c = cyclicLine(); c.calendar = {...schedule}; c.durationMs = 30 * M; c.stations[0]!.setupMs = 7 * M;
    c.initialStocks = c.initialStocks.filter(s => s.materialId !== 'rawB');
    const model = execute(c).runToEnd();
    expectTimes(model, {processingMs: 2 * M, starvedMs: 18 * M, lunchMs: 10 * M});
  });

  it.each([false, true])('counts maintenance crossing lunch separately, replacement=%s', replacement => {
    const c = oneStation(); c.stations[0]!.lunchReplacement = replacement;
    c.stations[0]!.plan[0]!.processing.timeMs = 8 * M;
    c.stations[0]!.maintenance = {enabled: true, repetitionsThreshold: 1, durationMs: 5 * M};
    const model = execute(c).runToEnd();
    expectTimes(model, {processingMs: 8 * M, maintenanceMs: 5 * M, starvedMs: (replacement ? 17 : 7) * M, lunchMs: replacement ? 0 : 10 * M});
    expect(stationTimeReport(model).stations[0]!.busyMs).toBe(13 * M);
  });

  it('keeps a reached maintenance threshold in processing until the operation actually finishes', () => {
    const c = oneStation(); c.stations[0]!.plan[0]!.processing.timeMs = 8 * M;
    c.stations[0]!.maintenance = {enabled: true, processingThresholdMs: 3 * M, durationMs: 5 * M};
    const sim = execute(c), model = sim.advanceTo(6 * M);
    expect(model.stations[0]!.maintenanceDueAtMs).toBe(3 * M);
    expectTimes(model, {processingMs: 6 * M});
  });

  it('counts an operation finishing exactly at lunch once and defers service until reopening', () => {
    const c = oneStation(); c.stations[0]!.plan[0]!.processing.timeMs = 10 * M;
    c.stations[0]!.maintenance = {enabled: true, repetitionsThreshold: 1, durationMs: 5 * M};
    const sim = execute(c), boundary = sim.advanceTo(10 * M);
    expectTimes(boundary, {processingMs: 10 * M});
    expectTimes(sim.runToEnd(), {processingMs: 10 * M, maintenanceMs: 5 * M, starvedMs: 5 * M, lunchMs: 10 * M});
  });

  it.each(['setup', 'maintenance'] as const)('stops inside %s without charging its unfinished remainder', phase => {
    const c = phase === 'setup' ? cyclicLine() : oneStation();
    c.calendar = {...schedule}; c.durationMs = 30 * M;
    if (phase === 'setup') {c.stations[0]!.initialRecipeId = 'recipeB'; c.stations[0]!.setupMs = 7 * M;}
    else c.stations[0]!.maintenance = {enabled: true, repetitionsThreshold: 1, durationMs: 5 * M};
    const sim = execute(c); sim.advanceTo(3.25 * M); const model = sim.stop();
    expectTimes(model, phase === 'setup' ? {setupMs: 3.25 * M} : {processingMs: M, maintenanceMs: 2.25 * M});
    expect(stationTimeReport(model).calendarMs).toBe(3.25 * M); expect(stationTimeReport(model).complete).toBe(false);
  });

  it('counts blockage only during available time while downstream is full, even with maintenance due', () => {
    const c = line(); c.calendar = {...schedule}; c.durationMs = 30 * M;
    c.sources[0]!.availability = 'warehouse'; c.initialStocks[0]!.quantity = '5';
    c.stations[0]!.inputBuffer = {kind: 'infinite'};
    c.recipes[0]!.inputs[0]!.quantity = '1'; c.recipes[0]!.output.quantity = '1';
    c.stations[1]!.inputBuffer = {kind: 'quantity', quantity: '1'};
    c.stations[1]!.plan[0]!.processing.timeMs = 100 * M;
    c.stations[0]!.maintenance = {enabled: true, repetitionsThreshold: 3, durationMs: 5 * M};
    const model = execute(c).runToEnd();
    expectTimes(model, {processingMs: 3 * M, blockedMs: 17 * M, lunchMs: 10 * M});
    expectTimes(model, {processingMs: 19 * M, starvedMs: M, lunchMs: 10 * M}, 1);
    expect(stationTimeReport(model).stations[0]!.blockedShare).toEqual({timeMs: 17 * M, availableWorkMs: 20 * M});
    expect(model.stations[0]!.maintenanceDeferredBy).toContain('output');
  });

  it.each(['sequential', 'simultaneous'] as const)('counts %s batch time as station time rather than quantity × time', mode => {
    const c = oneStation(); c.initialStocks[0]!.quantity = '3';
    Object.assign(c.stations[0]!.plan[0]!.processing, {mode, repetitions: 3}); c.stations[0]!.transportThreshold = '3';
    expectTimes(execute(c).runToEnd(), {processingMs: (mode === 'sequential' ? 3 : 1) * M, starvedMs: (mode === 'sequential' ? 17 : 19) * M, lunchMs: 10 * M});
  });

  it('attributes inspection to processing even when every inspected item is scrapped', () => {
    const c = line(); c.calendar = {...schedule}; c.durationMs = 30 * M;
    c.sources[0]!.availability = 'warehouse'; c.initialStocks[0]!.quantity = '1';
    c.recipes[0]!.inputs[0]!.quantity = '1'; c.recipes[0]!.output.quantity = '1'; c.stations[0]!.plan[0]!.processing.defectProbability = 1;
    c.stations[1]!.plan[0]!.processing.timeMs = M;
    c.recipes[1]!.kind = 'inspection'; c.recipes[1]!.output.materialId = 'part'; c.routes[2]!.materialId = 'part';
    c.materials = c.materials.filter(m => m.id !== 'product'); Object.assign(c.materials.find(m => m.id === 'part')!, {role: 'finished', salePrice: '0'});
    const model = execute(c).runToEnd();
    expectTimes(model, {processingMs: M, starvedMs: 19 * M, lunchMs: 10 * M}, 1);
    expect(model.line!.counters.find(r => r.materialId === 'part')!.scrapped).toBe(1_000_000);
  });

  it('handles millisecond lunch boundaries and midnight close/open without charging a phantom pause', () => {
    const c = oneStation(); c.calendar = {shiftStartMs: 0, lunchStartMs: 1, lunchEndMs: 2, shiftEndMs: DAY_MS}; c.durationMs = 2 * DAY_MS;
    c.stations[0]!.plan[0]!.processing.timeMs = 2 * DAY_MS;
    expectTimes(execute(c).runToEnd(), {processingMs: 2 * DAY_MS - 2, lunchMs: 2});
  });

  it('does not round safe integer time counters or charge zero-length intervals', () => {
    const station = createPushState(compileConfig(oneStation())).stations[0]!;
    station.remainingProcessingMs = Number.MAX_SAFE_INTEGER;
    integrateStationTime(station, {workMs: Number.MAX_SAFE_INTEGER - 2, lunchMs: 1, offShiftMs: 1});
    integrateStationTime(station, {workMs: 0, lunchMs: 0, offShiftMs: 0});
    expect(station.timeByState).toEqual({...emptyStationTime(), processingMs: Number.MAX_SAFE_INTEGER - 2, lunchMs: 1, offShiftMs: 1});
    expect(Object.values(station.timeByState).reduce((a, b) => a + b, 0)).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('keeps the existing idle state explicit instead of assigning it to processing or input starvation', () => {
    const station = createPushState(compileConfig(oneStation())).stations[0]!;
    integrateStationTime(station, {workMs: 7, lunchMs: 2, offShiftMs: 3});
    expect(station.timeByState).toEqual({...emptyStationTime(), idleMs: 7, lunchMs: 2, offShiftMs: 3});
  });

  it('rolls all state-time counters back with an endpoint failure', () => {
    const run = compileConfig(oneStation()), initial = createPushState(run);
    const loop = new EventScheduler(run, initial, {
      integrate: (state, from, to) => integrateStationTime(state.stations[0]!, {workMs: to - from, lunchMs: 0, offShiftMs: 0}),
      transfer: () => {throw new Error('failed endpoint');},
    });
    loop.schedule({kind: 'transfer', id: 'fail', producerId: 's1', timeMs: M});
    const before = loop.getSnapshot(); expect(() => loop.step()).toThrow('failed endpoint');
    expect(loop.getSnapshot()).toBe(before); expect(loop.getSnapshot().stations[0]!.timeByState).toEqual(emptyStationTime());
  });
});

describe('independent interval sums and display partition invariance', () => {
  const cases = [...exampleIds.map(id => ({name: id, config: () => previewConfig(id)})),
    {name: 'setup-and-maintenance', config: () => {
      const c = cyclicLine(); c.calendar = {...schedule}; c.durationMs = DAY_MS + 30 * M;
      c.stations[0]!.setupMs = 7 * M; c.stations[0]!.lunchReplacement = true;
      c.stations[0]!.maintenance = {enabled: true, repetitionsThreshold: 2, durationMs: 5 * M}; return c;
    }},
  ];
  it.each(cases)('matches prior visible states and manual calendar overlaps in $name', ({config}) => {
    const c = config(), run = compileConfig(c), sim = new Simulation(run);
    const expected = new Map(run.resolved.stations.map(s => [s.id, emptyStationTime()]));
    function overlap(from: number, to: number, replacement: boolean) {
      const {shiftStartMs: start, lunchStartMs: lunch, lunchEndMs: open, shiftEndMs: end} = c.calendar;
      let total = 0;
      for (let day = 0; day <= Math.floor(to / DAY_MS); day++) {
        for (const [a, b] of replacement ? [[0, end - start]] : [[0, lunch - start], [open - start, end - start]]) total += Math.max(0, Math.min(to, day * DAY_MS + b!) - Math.max(from, day * DAY_MS + a!));
      }
      return total;
    }
    let previous = sim.getSnapshot();
    while (sim.step() !== null) {
      const next = sim.getSnapshot(), span = next.timeMs - previous.timeMs;
      const shift = overlap(previous.timeMs, next.timeMs, true);
      for (const station of previous.stations) {
        const row = expected.get(station.stationId)!;
        const replacement = run.resolved.stations.find(s => s.id === station.stationId)!.lunchReplacement;
        const work = overlap(previous.timeMs, next.timeMs, replacement);
        row.lunchMs += shift - work; row.offShiftMs += span - shift;
        if (work > 0) {
          expect(station.status).not.toBe('paused');
          const category = `${station.status}Ms` as keyof StationTime;
          row[category] += work;
        }
      }
      checkPartition(next); previous = next;
    }
    for (const station of previous.stations) expect(station.timeByState).toEqual(expected.get(station.stationId));
    const split = new Simulation(run);
    for (let t = 1; t < c.durationMs; t += 193_117) split.advanceTo(t);
    expect(split.runToEnd()).toEqual(previous);
    expect(new Simulation(run).runToEnd()).toEqual(previous);
  });
});
