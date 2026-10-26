import {describe,expect,it} from 'vitest';
import {compileConfig} from './config';
import {line} from './test-fixtures';
import {planDbrSlotGroups} from './dbr-slot-groups';
import {planDbrDemand} from './dbr-demand';
import {Simulation} from './simulation';
import type {DbrSelection} from './dbr-validation';
const M=60_000;
function fixture(batchSize=1,slots=4) {
  const c=line();c.initialStocks=[];c.durationMs=slots*M;
  c.calendar={shiftStartMs:0,lunchStartMs:c.durationMs-2,lunchEndMs:c.durationMs-1,shiftEndMs:c.durationMs};
  c.stations.forEach(s=>{s.inputBuffer={kind:'infinite'};s.outputBuffer={kind:'infinite'};s.lunchReplacement=true;s.plan[0]!.processing.timeMs=M;});
  c.recipes[0]!.output.quantity=String(batchSize);
  const selection:DbrSelection={drumStationId:'s2',drumCycles:1,products:[{materialId:'product',quantity:'1'}],routeIds:c.routes.map(r=>r.id),bufferMs:0,maxOpenSlots:1};
  return {c,selection};
}
const calculate=(f:ReturnType<typeof fixture>)=>planDbrSlotGroups(compileConfig(f.c),f.selection);

describe('DBR linked slot limit',()=>{
  it('allows independent slots with a limit of one and preserves the demand plan',()=>{
    const f=fixture(),r=calculate(f),base=planDbrDemand(compileConfig(f.c),f.selection);
    expect(r.slotGroupsValid).toBe(true);expect(r.slotGroups!.minimumOpenSlots).toBe(1);
    expect(r.slotGroups!.groups.map(g=>g.slotIds.length)).toEqual([1,1,1,1]);
    expect(r.demandPlan).toEqual(base.demandPlan);expect(r.schedule).toEqual(base.schedule);
    expect(r.pendingChecks).toEqual(['quantitiesAndPlans','stockAndCapacity']);expect(r.canStart).toBe(false);
  });
  it('rejects a limit below a shared batch group and accepts the exact boundary',()=>{
    const f=fixture(2),r=calculate(f);
    expect(r.slotGroupsValid).toBe(false);expect(r.slotGroups!.minimumOpenSlots).toBe(2);
    expect(r.slotGroups!.groups.map(g=>g.slotIds.length)).toEqual([2,2]);
    expect(r.slotGroupIssues).toHaveLength(2);
    expect(r.slotGroupIssues[0]).toMatchObject({code:'slotGroupLimit',requiredOpenSlots:2,maxOpenSlots:1});
    expect(r.slotGroupIssues[0]!.messages.ru).toContain('минимум 2');expect(r.slotGroupIssues[0]!.messages.en).toContain('at least 2');
    expect(r.pendingChecks).toContain('slotGroups');expect(r.canStart).toBe(false);
    f.selection.maxOpenSlots=2;const accepted=calculate(f);expect(accepted.slotGroupsValid).toBe(true);expect(accepted.slotGroupIssues).toEqual([]);
    expect(accepted.slotGroups).toEqual(r.slotGroups);expect(accepted.demandPlan).toEqual(r.demandPlan);
    f.selection.maxOpenSlots=3;expect(calculate(f).slotGroupsValid).toBe(true);
  });
  it('connects overlapping batch dependencies transitively',()=>{
    const f=fixture(2,5),up=structuredClone(f.c.stations[0]!);
    // Raw -> batches of 3 intermediate units -> batches of 2 parts -> drum.
    f.c.materials.push({id:'mid',name:'Mid',color:'blue',role:'intermediate'});
    f.c.recipes[0]!.inputs=[{materialId:'mid',quantity:'2'}];
    f.c.recipes.push({id:'up-recipe',name:'Up',kind:'production',inputs:[{materialId:'raw',quantity:'1'}],output:{materialId:'mid',quantity:'3'}});
    up.id='up';up.plan[0]!.id='up-row';up.plan[0]!.recipeId='up-recipe';f.c.stations.push(up);
    f.c.routes[0]!.toId='up';f.c.routes.push({id:'up-s1',fromId:'up',toId:'s1',materialId:'mid'});f.selection.routeIds=f.c.routes.map(r=>r.id);
    const r=calculate(f);expect(r.slotGroups!.groups.map(g=>g.slotIds.length)).toEqual([5]);
    expect(r.slotGroups!.minimumOpenSlots).toBe(5);f.selection.maxOpenSlots=5;expect(calculate(f).slotGroupsValid).toBe(true);
  });
  it('keeps slots without new raw needs, but does not connect them by a shared initial lot',()=>{
    const f=fixture(2);f.c.initialStocks=[{id:'ready',ownerId:'s2',location:'input',materialId:'part',quantity:'4',cost:'0'}];
    const r=calculate(f);expect(r.demandPlan!.rawNeeds).toEqual([]);expect(r.slotGroups!.groups.map(g=>g.slotIds.length)).toEqual([1,1,1,1]);
    expect(r.slotGroups!.minimumOpenSlots).toBe(1);expect(r.slotGroupsValid).toBe(true);
  });
  it('does not add slots for surplus beyond the horizon',()=>{
    const r=calculate(fixture(10,2));expect(r.slotGroups!.minimumOpenSlots).toBe(2);
    expect(r.slotGroups!.groups[0]!.slotIds).toEqual(r.schedule!.slots.map(s=>s.slotId));
    expect(r.demandPlan!.remainders[0]!.quantityUnits).toBe('8000000');
  });
  it('returns a zero minimum when preparation leaves no actual slot',()=>{
    const f=fixture();f.c.stations[1]!.setupMs=10*M;f.c.stations[1]!.initialRecipeId='cut';
    const r=calculate(f);expect(r.slotGroups).toEqual({groups:[],minimumOpenSlots:0});expect(r.slotGroupsValid).toBe(true);
  });
  it('does not claim a checked limit when structural or quantity planning fails',()=>{
    const f=fixture();const invalid=planDbrSlotGroups(compileConfig(f.c),{instructions:'start DBR'});
    expect(invalid.slotGroups).toBeNull();expect(invalid.slotGroupsValid).toBe(false);expect(invalid.slotGroupIssues).toEqual([]);
    f.selection.products[0]!.quantity='2';const shortage=calculate(f);
    expect(shortage.demandValid).toBe(false);expect(shortage.slotGroups).toBeNull();expect(shortage.pendingChecks).toContain('slotGroups');
  });
  it('is deterministic, JSON compatible and leaves inputs and the simulation unchanged',()=>{
    const f=fixture(2),run=compileConfig(f.c),sim=new Simulation(run),snapshot=JSON.stringify(sim.getSnapshot()),before=JSON.stringify(f.selection);
    const r=planDbrSlotGroups(run,f.selection),serialized=JSON.stringify(r);
    expect(JSON.parse(serialized)).toEqual(r);expect(JSON.stringify(f.selection)).toBe(before);expect(JSON.stringify(sim.getSnapshot())).toBe(snapshot);
    f.c.stations.reverse();f.c.routes.reverse();f.selection.routeIds.reverse();expect(calculate(f)).toEqual(r);
    r.slotGroups!.groups[0]!.slotIds.push('changed');r.slotGroupIssues[0]!.slotIds.push('changed');
    expect(JSON.stringify(planDbrSlotGroups(run,JSON.parse(before)))).toBe(serialized);
  });
});
