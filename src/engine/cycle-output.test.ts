import { describe, expect, it } from 'vitest';
import { parseMoney, parseQuantity } from './arithmetic';
import { compileConfig } from './config';
import type { DeepReadonly } from './config';
import { Simulation } from './simulation';
import type { Snapshot } from './state';
import { blockedCyclicLine } from './test-fixtures';
const M = 60_000, Q = 1_000_000;
function totals(snapshot: DeepReadonly<Snapshot>, config: ReturnType<typeof blockedCyclicLine>) {
  const initialCost = config.initialStocks.reduce((sum, stock) => sum + parseMoney(stock.cost), 0n);
  const cost = snapshot.stocks.reduce((sum, stock) => sum + BigInt(stock.cost), 0n)
    + snapshot.line!.counters.reduce((sum, c) => sum + BigInt(c.soldCost) + BigInt(c.scrapCost), 0n);
  expect(cost).toBe(initialCost);
  for (const material of config.materials) {
    const initial = config.initialStocks.filter(stock => stock.materialId === material.id).reduce((sum, stock) => sum + parseQuantity(stock.quantity), 0);
    const current = snapshot.stocks.filter(stock => stock.materialId === material.id).reduce((sum, stock) => sum + stock.quantity, 0);
    const counter = snapshot.line!.counters.find(c => c.materialId === material.id)!;
    expect(current + counter.consumed + counter.sold + counter.scrapped).toBe(initial + counter.produced);
  }
  const recorded = snapshot.stocks.reduce((sum, stock) => sum + BigInt(stock.provenance.processingMs.s1 ?? 0), 0n);
  // Before the first sale, this also verifies the producer time split across WIP.
  return recorded;
}

describe('cycle output acceptance', () => {
  it('snapshots every output independently while old A is buffered and B is current', () => {
    const run = compileConfig(blockedCyclicLine(true)), sim = new Simulation(run);
    const b = sim.advanceTo(2 * M);
    expect(b.stations[0]).toMatchObject({planIndex: 1, outputs: [
      {materialId: 'a', quantity: Q, heldQuantity: 0},
      {materialId: 'b', quantity: 0, heldQuantity: 0},
    ]});
    const blocked = sim.advanceTo(4 * M);
    expect(blocked.stations[0]).toMatchObject({planIndex: 1, status: 'blocked', outputs: [
      {materialId: 'a', quantity: Q, heldQuantity: Q},
      {materialId: 'b', quantity: 0, heldQuantity: 0},
    ]});
    expect(b.stations[0]!.outputs[0]!.heldQuantity).toBe(0);
    expect(Object.isFrozen(blocked.stations[0]!.outputs[0])).toBe(true);
    expect(JSON.parse(JSON.stringify(blocked)).schemaVersion).toBe(14);
  });

  it('partially unloads old A after switching to B and preserves cost, time and readiness', () => {
    const config = blockedCyclicLine(true);
    config.stations[1]!.inputBuffer = {kind: 'quantity', quantity: '1.5'};
    config.recipes.find(recipe => recipe.id === 'finishA')!.inputs[0]!.quantity = '1.5';
    config.initialStocks.find(stock => stock.id === 'waitingA')!.quantity = '1.5';
    config.recipes[0]!.output.quantity = '3';
    config.initialStocks[0]!.quantity = '1'; config.initialStocks[1]!.quantity = '1';
    const sim = new Simulation(compileConfig(config));
    const s = sim.advanceTo(2 * M);
    // Complete A processing advances to B, but the old A still holds the station.
    expect(s.stations[0]).toMatchObject({planIndex: 1, status: 'blocked', outputs: [
      {materialId: 'a', quantity: Q, heldQuantity: 2 * Q},
      {materialId: 'b', quantity: 0, heldQuantity: 0},
    ]});
    const parts = s.stocks.filter(stock => stock.ownerId === 's1' && stock.materialId === 'a');
    expect(parts.map(stock => [stock.quantity, stock.cost, stock.provenance.processingMs.s1, stock.readyAtMs])).toEqual([
      [2 * Q, '80000000', '40000', M], [Q, '40000000', '20000', M],
    ]);
    expect(totals(s, config)).toBe(60_000n);
    // There is no B yet: held A may not be bypassed to break this plan deadlock.
    expect(sim.runToEnd().line!.counters.find(c => c.materialId === 'b')!.produced).toBe(0);
  });

  it('drains a fractional old remainder in FIFO order and assigns the final cost/time residue exactly', () => {
    const config = blockedCyclicLine(true);
    config.stations[1]!.inputBuffer = {kind: 'quantity', quantity: '1.5'};
    config.recipes.find(recipe => recipe.id === 'finishA')!.inputs[0]!.quantity = '1.5';
    config.initialStocks.find(stock => stock.id === 'waitingA')!.quantity = '1.5';
    config.recipes[0]!.output.quantity = '3';
    config.initialStocks.push({id: 'waitingB', ownerId: 's2', location: 'input', materialId: 'b', quantity: '1', cost: '9'});
    config.initialStocks[0]!.quantity = '1'; config.initialStocks[0]!.cost = '0.000007';
    config.initialStocks[1]!.quantity = '1';
    config.stations[0]!.outputBuffer = {kind: 'quantity', quantity: '3'};
    const sim = new Simulation(compileConfig(config));
    const before = sim.advanceTo(3 * M);
    expect(before.stations[0]!.planIndex).toBe(0); // B has completed, both old outputs transferred by material.
    expect(before.stocks.filter(s => s.ownerId === 's1' && s.materialId === 'a')).toMatchObject([
      {quantity: 3 * Q, cost: '7', readyAtMs: M, provenance: {processingMs: {s1: '60000'}}},
    ]);
    const first = sim.advanceTo(13 * M);
    expect(first.stations[0]!.outputs[0]!.quantity).toBe(1.5 * Q);
    expect(first.stocks.find(s => s.ownerId === 's2' && s.location === 'input' && s.materialId === 'a')).toMatchObject({quantity: 1.5 * Q, cost: '3', provenance: {processingMs: {s1: '30000'}}});
    expect(first.stocks.find(s => s.ownerId === 's1' && s.materialId === 'a')).toMatchObject({quantity: 1.5 * Q, cost: '4', readyAtMs: M});
    totals(first, config);
    const second = sim.advanceTo(30 * M);
    expect(second.stations[0]!.outputs[0]!.quantity).toBe(0);
    expect(second.stocks.find(s => s.ownerId === 's2' && s.location === 'input' && s.materialId === 'a')).toMatchObject({quantity: 1.5 * Q, cost: '4', provenance: {processingMs: {s1: '30000'}}});
    totals(second, config);
    expect(second.line!.transfers.filter(t => t.fromId === 's1' && t.toId === 's2')).toMatchObject([{materialId: 'a', quantity: 1.5 * Q, cost: '4'}]);
  });

  it('routes different recipe outputs to a station and the market without mixing their counters', () => {
    const config = blockedCyclicLine(true);
    const b = config.materials.find(material => material.id === 'b')!;
    b.role = 'finished'; b.salePrice = '20';
    config.recipes = config.recipes.filter(recipe => recipe.id !== 'finishB');
    config.stations[1]!.plan = [config.stations[1]!.plan[1]!];
    config.routes.find(route => route.id === 'sellB')!.toId = 'market';
    const sim = new Simulation(compileConfig(config)), snapshot = sim.advanceTo(3 * M);
    expect(snapshot.line!.counters.find(counter => counter.materialId === 'b')).toMatchObject({produced: Q, sold: Q, soldCost: '2000000'});
    expect(snapshot.line!.transfers.filter(transfer => transfer.materialId === 'b' && transfer.kind === 'sale')).toMatchObject([{toId: 'market', quantity: Q}]);
    expect(snapshot.stocks.some(stock => stock.ownerId === 's2' && stock.materialId === 'b')).toBe(false);
    totals(snapshot, config);
  });

  it('orders competing producers by old material readiness despite recipe changes and producer priority', () => {
    const config = blockedCyclicLine(true), other = structuredClone(config.stations[0]!);
    other.id = 's0'; other.priority = 100;
    other.plan[0]!.id = 'otherA'; other.plan[1]!.id = 'otherB'; other.plan[0]!.processing.timeMs = 2 * M;
    config.stations.push(other);
    config.initialStocks.push({id: 'otherRaw', ownerId: 's0', location: 'input', materialId: 'raw', quantity: '1', cost: '90'});
    config.routes.push(
      {id: 'otherInputA', fromId: 'source', toId: 's0', materialId: 'raw'},
      {id: 'otherInputB', fromId: 'sourceB', toId: 's0', materialId: 'rawB'},
      {id: 'otherOutputA', fromId: 's0', toId: 's2', materialId: 'a'},
      {id: 'otherOutputB', fromId: 's0', toId: 's2', materialId: 'b'},
    );
    const run = compileConfig(config), sim = new Simulation(run);
    const first = sim.advanceTo(13 * M);
    expect(first.stocks.find(stock => stock.ownerId === 's2' && stock.location === 'input' && stock.materialId === 'a')).toMatchObject({cost: '10000000', provenance: {processingMs: {s1: '60000'}}});
    expect(first.stocks.find(stock => stock.ownerId === 's0' && stock.location === 'output' && stock.materialId === 'a')).toMatchObject({cost: '90000000', readyAtMs: 2 * M});
    const second = sim.advanceTo(33 * M);
    expect(second.stocks.find(stock => stock.ownerId === 's2' && stock.location === 'input' && stock.materialId === 'a')).toMatchObject({cost: '90000000', provenance: {processingMs: {s0: '120000'}}});
    totals(second, config);
    const permuted = structuredClone(config); permuted.stations.reverse(); permuted.routes.reverse(); permuted.initialStocks.reverse();
    expect(new Simulation(compileConfig(permuted)).advanceTo(33 * M)).toEqual(second);
  });
});
