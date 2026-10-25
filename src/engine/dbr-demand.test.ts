import {describe,expect,it} from 'vitest';
import {compileConfig,ConfigError} from './config';
import {planDbrDemand,DbrDemandLimitError,MAX_DBR_DEMAND_RECORDS,MAX_DBR_DEMAND_LINKS} from './dbr-demand';
import type {DbrDemandPlan} from './dbr-demand';
import type {DbrSelection} from './dbr-validation';
import {line,cyclicLine} from './test-fixtures';
import {Simulation} from './simulation';
const M=60_000;
type Spec={id:string;input:[string,string][];output:[string,string];repetitions?:number;time?:number};
function network(specs:Spec[],drum:string,horizon=5*M) {
  const c=line();c.initialStocks=[];c.durationMs=horizon;
  c.calendar={shiftStartMs:0,lunchStartMs:horizon-2,lunchEndMs:horizon-1,shiftEndMs:horizon};
  const outputs=new Set(specs.map(s=>s.output[0])),inputs=new Set(specs.flatMap(s=>s.input.map(i=>i[0])));
  const all=[...new Set([...outputs,...inputs])];
  c.materials=all.map(id=>({id,name:id,color:'red',role:!outputs.has(id)?'raw':!inputs.has(id)?'finished':'intermediate',purchasePrice:'1',salePrice:'1'}));
  const template=c.stations[0]!;
  c.recipes=specs.map(s=>({id:`recipe-${s.id}`,name:s.id,kind:'production',inputs:s.input.map(([materialId,quantity])=>({materialId,quantity})),output:{materialId:s.output[0],quantity:s.output[1]}}));
  c.stations=specs.map(s=>({...structuredClone(template),id:s.id,name:s.id,lunchReplacement:true,inputBuffer:{kind:'infinite'},outputBuffer:{kind:'infinite'},plan:[{id:`row-${s.id}`,recipeId:`recipe-${s.id}`,batches:1,processing:{mode:'sequential',repetitions:s.repetitions??1,timeMs:s.time??10*M,cv:0}}]}));
  c.sources=all.filter(id=>!outputs.has(id)).map(id=>({id:`source-${id}`,name:id,materialId:id,availability:'virtual',quantity:'1',intervalMs:M}));
  c.routes=[];
  for (const s of specs) for (const [materialId] of s.input) {
    const fromId=specs.find(p=>p.output[0]===materialId)?.id ?? `source-${materialId}`;
    c.routes.push({id:`route-${fromId}-${s.id}-${materialId}`,fromId,toId:s.id,materialId});
  }
  for (const s of specs) if (!inputs.has(s.output[0])) c.routes.push({id:`sell-${s.id}`,fromId:s.id,toId:'market',materialId:s.output[0]});
  const selection:DbrSelection={drumStationId:drum,drumCycles:1,products:c.materials.filter(m=>m.role==='finished').map(m=>({materialId:m.id,quantity:'1'})),routeIds:c.routes.map(r=>r.id),bufferMs:0,maxOpenSlots:1};
  return {c,selection};
}
function linear(horizon=5*M) {
  return network([{id:'U',input:[['R','1']],output:['A','1']},{id:'D',input:[['A','1']],output:['X','1']},{id:'F',input:[['X','1']],output:['P','1']}],'D',horizon);
}
function before(horizon=5*M) {
  return network([{id:'U',input:[['RA','1']],output:['A','1']},{id:'V',input:[['RC','1']],output:['C','1']},{id:'D',input:[['A','2'],['C','1']],output:['P','1']}],'D',horizon);
}
function after(horizon=5*M) {
  return network([{id:'D',input:[['R','1']],output:['X','1']},{id:'V',input:[['S','1']],output:['Y','1']},{id:'F',input:[['X','1'],['Y','1']],output:['P','1']}],'D',horizon);
}
function common(horizon=5*M) {
  return network([{id:'U',input:[['R','1']],output:['C','3'],repetitions:2},{id:'D',input:[['C','2']],output:['X','1']},{id:'V',input:[['C','2']],output:['Y','1']},{id:'F',input:[['X','1'],['Y','1']],output:['P','1']}],'D',horizon);
}
function partial(horizon=10*M,shared=false) {
  const fixture=shared ? common(horizon) : after(horizon),{c,selection}=fixture;
  c.materials.find(m=>m.id==='X')!.id='A';
  c.materials.push({id:'B',name:'B',color:'blue',role:'intermediate'});
  const d=c.stations.find(s=>s.id==='D')!,r=c.recipes.find(r=>r.id==='recipe-D')!;
  r.output.materialId='A';
  const rB=structuredClone(r);rB.id='recipe-B';rB.output.materialId='B';
  if (!shared) {
    c.materials.push({id:'RB',name:'RB',color:'blue',role:'raw',purchasePrice:'1'});rB.inputs=[{materialId:'RB',quantity:'1'}];
    c.sources.push({id:'source-RB',name:'RB',materialId:'RB',availability:'virtual',quantity:'1',intervalMs:M});
    c.routes.push({id:'route-RB-D',fromId:'source-RB',toId:'D',materialId:'RB'});
  }
  c.recipes.push(rB);d.plan.push({...structuredClone(d.plan[0]!),id:'row-B',recipeId:rB.id});
  const f=c.recipes.find(r=>r.id==='recipe-F')!;f.inputs=[{materialId:'A',quantity:'1'},{materialId:'B',quantity:'1'},{materialId:'Y',quantity:'1'}];
  c.routes.find(r=>r.fromId==='D')!.materialId='A';c.routes.push({id:'route-B-F',fromId:'D',toId:'F',materialId:'B'});
  selection.routeIds=c.routes.map(r=>r.id);return fixture;
}
function calculate(f=linear()) {
  const result=planDbrDemand(compileConfig(f.c),f.selection);
  expect(result.issues).toEqual([]);expect(result.demandIssues).toEqual([]);expect(result.demandValid).toBe(true);
  expect(result.canStart).toBe(false);expect(result.pendingChecks).toEqual(['quantitiesAndPlans','stockAndCapacity','slotGroups']);
  return result.demandPlan!;
}
const raw=(p:DbrDemandPlan,materialId:string)=>p.rawNeeds.filter(n=>n.materialId===materialId).reduce((sum,n)=>sum+BigInt(n.quantityUnits),0n);
const units=(n:number)=>BigInt(n)*1_000_000n;

describe('DBR demand accounting without initial stock or execution',()=>{
  it('supplies an unfinished full drum slot in a linear route without ordering drum twice',()=>{
    const f=linear(),p=calculate(f);expect(raw(p,'R')).toBe(units(1));expect(p.groups[0]!.allSlotsPresent).toBe(true);
    expect(p.works.filter(w=>w.stationId==='D')).toHaveLength(1);expect(p.works.map(w=>w.stationId)).toEqual(['D','F','U']);
    expect(p.rawNeeds[0]!.slotIds).toEqual(p.groups[0]!.slotIds);expect(p.remainders).toEqual([]);
    expect(planDbrDemand(compileConfig(f.c),f.selection).schedule!.lastProductCycle!.complete).toBe(false);
  });
  it('supplies all separate inputs of a full assembly batch before drum',()=>{
    const p=calculate(before());expect(raw(p,'RA')).toBe(units(2));expect(raw(p,'RC')).toBe(units(1));
    expect(p.works.find(w=>w.stationId==='D')!.inputs).toEqual([{materialId:'A',quantityUnits:'2000000'},{materialId:'C',quantityUnits:'1000000'}]);
  });
  it('includes a side branch after drum and links it to the product group',()=>{
    const p=calculate(after());expect(raw(p,'R')).toBe(units(1));expect(raw(p,'S')).toBe(units(1));
    expect(p.rawNeeds.every(n=>JSON.stringify(n.slotIds)===JSON.stringify(p.groups[0]!.slotIds))).toBe(true);
  });
  it('combines 2 + 2 before rounding one shared component batch of 6',()=>{
    const p=calculate(common()),u=p.works.filter(w=>w.stationId==='U');expect(u).toHaveLength(1);
    expect(u[0]).toMatchObject({batchCount:'1',repetitions:'2',output:{materialId:'C',quantityUnits:'6000000'}});
    expect(raw(p,'R')).toBe(units(2));expect(p.remainders).toEqual([{producerId:u[0]!.workId,ownerId:'U',materialId:'C',quantityUnits:'2000000'}]);
    expect(p.allocations.filter(a=>a.producerId===u[0]!.workId).map(a=>a.quantityUnits)).toEqual(['2000000','2000000']);
  });
  it('carries rounding surplus between three groups without ordering it twice',()=>{
    const p=calculate(common(30*M));expect(p.groups).toHaveLength(3);expect(raw(p,'R')).toBe(units(4));expect(p.remainders).toEqual([]);
    expect(p.rawNeeds.map(n=>n.quantityUnits)).toEqual(['2000000','2000000']);
    const u=p.works.filter(w=>w.stationId==='U');expect(u.map(w=>w.slotIds)).toEqual([p.groups.slice(0,2).flatMap(g=>g.slotIds),p.groups.slice(1,3).flatMap(g=>g.slotIds)]);
    expect(p.rawNeeds.map(n=>n.slotIds)).toEqual(u.map(w=>w.slotIds));
  });
  it('retains four C as unassigned surplus at an unfinished second group',()=>{
    const p=calculate(common(15*M));expect(raw(p,'R')).toBe(units(4));expect(p.remainders.map(r=>r.quantityUnits)).toEqual(['4000000']);
    expect(p.groups.every(g=>g.allSlotsPresent)).toBe(true);expect(p.remainders[0]!.ownerId).toBe('U');
  });
  it('supplies only existing A and excludes B and the final side component at the exact horizon',()=>{
    const p=calculate(partial());expect(p.groups[0]).toMatchObject({allSlotsPresent:false,products:[]});
    expect(raw(p,'R')).toBe(units(1));expect(raw(p,'RB')).toBe(0n);expect(raw(p,'S')).toBe(0n);
    expect(p.works.map(w=>w.stationId)).toEqual(['D']);expect(p.remainders).toMatchObject([{ownerId:'D',materialId:'A',quantityUnits:'1000000'}]);
  });
  it('uses all products when B exists but its processing is unfinished',()=>{
    const f=partial(15*M),p=calculate(f);expect(p.groups[0]!.allSlotsPresent).toBe(true);
    expect(raw(p,'R')).toBe(units(1));expect(raw(p,'RB')).toBe(units(1));expect(raw(p,'S')).toBe(units(1));
    expect(p.rawNeeds.find(n=>n.materialId==='S')!.slotIds).toEqual(p.groups[0]!.slotIds);
    expect(p.rawNeeds.find(n=>n.materialId==='R')!.slotIds).toEqual([p.groups[0]!.slotIds[0]]);
    expect(p.rawNeeds.find(n=>n.materialId==='RB')!.slotIds).toEqual([p.groups[0]!.slotIds[1]]);
    expect(planDbrDemand(compileConfig(f.c),f.selection).schedule!.lastProductCycle!.complete).toBe(false);
  });
  it('does not infer an order for B or Y from shared-component surplus in a partial group',()=>{
    const p=calculate(partial(10*M,true));expect(raw(p,'R')).toBe(units(2));
    expect(p.works.some(w=>w.stationId==='V'||w.stationId==='F')).toBe(false);
    expect(p.remainders.find(r=>r.materialId==='C')!.quantityUnits).toBe('4000000');
  });
  it('counts full multiple-cycle product groups by slot presence, not completed cycles',()=>{
    const f=linear(15*M);f.selection.drumCycles=2;f.selection.products[0]!.quantity='2';
    const p=calculate(f);expect(p.groups[0]!.allSlotsPresent).toBe(true);expect(raw(p,'R')).toBe(units(2));
    f.c.durationMs=10*M;f.c.calendar={shiftStartMs:0,lunchStartMs:10*M-2,lunchEndMs:10*M-1,shiftEndMs:10*M};const partial=calculate(f);expect(partial.groups[0]!.allSlotsPresent).toBe(false);expect(raw(partial,'R')).toBe(units(1));
  });
  it('leaves a whole final product group partial even if some of its products could be assembled',()=>{
    const f=linear(15*M);f.selection.drumCycles=3;f.selection.products[0]!.quantity='3';
    const p=calculate(f);expect(p.groups[0]!.products).toEqual([]);expect(p.works.some(w=>w.stationId==='F')).toBe(false);expect(raw(p,'R')).toBe(units(2));
  });
  it('returns an empty plan when preparation consumes the horizon without a slot',()=>{
    const f=partial(5*M),d=f.c.stations.find(s=>s.id==='D')!;d.initialRecipeId='recipe-B';d.setupMs=10*M;
    const p=calculate(f);expect(p).toEqual({groups:[],works:[],rawNeeds:[],allocations:[],remainders:[]});
  });
  it('reports a concrete bilingual shortage rather than constructing extra drum slots',()=>{
    const f=linear();f.selection.products[0]!.quantity='2';const r=planDbrDemand(compileConfig(f.c),f.selection);
    expect(r.structurallyValid).toBe(true);expect(r.demandValid).toBe(false);expect(r.demandPlan).toBeNull();expect(r.schedule!.slots).toHaveLength(1);
    expect(r.demandIssues).toMatchObject([{code:'drumShortage',productCycleIndex:0,materialId:'X',missingUnits:'1000000'}]);
    expect(r.demandIssues[0]!.messages.ru.length).toBeGreaterThan(10);expect(r.demandIssues[0]!.messages.en.length).toBeGreaterThan(10);
  });
  it('keeps surplus drum output visible and does not claim complete plan compatibility',()=>{
    const f=linear();f.c.recipes.find(r=>r.id==='recipe-D')!.output.quantity='2';const p=calculate(f);
    expect(p.remainders).toMatchObject([{ownerId:'D',materialId:'X',quantityUnits:'1000000'}]);
  });
  it('rounds recipe repetitions before full batches using exact fractional quantities',()=>{
    const f=before();f.c.recipes.find(r=>r.id==='recipe-D')!.inputs[0]!.quantity='6.000001';
    f.c.recipes.find(r=>r.id==='recipe-U')!.inputs[0]!.quantity='0.000001';
    f.c.stations.find(s=>s.id==='U')!.plan[0]!.processing.repetitions=3;
    const p=calculate(f),w=p.works.find(w=>w.stationId==='U')!;
    expect(w).toMatchObject({batchCount:'3',repetitions:'9',output:{quantityUnits:'9000000'}});expect(raw(p,'RA')).toBe(9n);
    expect(p.remainders.find(r=>r.materialId==='A')!.quantityUnits).toBe('2999999');
  });
  it('preserves micro-unit intermediate products larger than the safe-number range',()=>{
    const f=before();f.c.recipes.find(r=>r.id==='recipe-D')!.inputs[0]!.quantity='3';
    f.c.recipes.find(r=>r.id==='recipe-U')!.inputs[0]!.quantity='9007199254.740991';
    const p=calculate(f);
    expect(raw(p,'RA')).toBe(9007199254740991n*3n);expect(()=>JSON.stringify(p)).not.toThrow();
  });
  it('does not let initial physical stock change the zero-stock calculation',()=>{
    const f=linear(),baseline=calculate(f);f.c.initialStocks=[{id:'stock',ownerId:'D',location:'input',materialId:'A',quantity:'999',cost:'0'}];
    expect(calculate(f)).toEqual(baseline);
  });
  it('keeps distinct source receiving routes separate',()=>{
    const f=before();f.c.recipes.find(r=>r.id==='recipe-V')!.inputs=[{materialId:'RA',quantity:'1'}];
    f.c.sources=f.c.sources.filter(s=>s.materialId!=='RC');f.c.materials=f.c.materials.filter(m=>m.id!=='RC');
    f.c.routes.find(r=>r.toId==='V')!.fromId='source-RA';f.c.routes.find(r=>r.toId==='V')!.materialId='RA';
    const p=calculate(f);expect(p.rawNeeds).toHaveLength(2);expect(new Set(p.rawNeeds.map(n=>n.toId)).size).toBe(2);expect(raw(p,'RA')).toBe(units(3));
  });
  it('does not merge inventories at different stations for same-material inspection',()=>{
    const f=linear(),u=f.c.stations.find(s=>s.id==='U')!,inspector=structuredClone(u);inspector.id='I';inspector.plan=[{...structuredClone(u.plan[0]!),id:'row-I',recipeId:'inspect'}];
    f.c.stations.push(inspector);f.c.recipes.push({id:'inspect',name:'Inspect',kind:'inspection',inputs:[{materialId:'A',quantity:'1'}],output:{materialId:'A',quantity:'1'}});
    f.c.routes.find(r=>r.fromId==='U')!.toId='I';f.c.routes.push({id:'I-D',fromId:'I',toId:'D',materialId:'A'});f.selection.routeIds=f.c.routes.map(r=>r.id);
    const p=calculate(f);expect(p.works.some(w=>w.stationId==='I')).toBe(true);expect(raw(p,'R')).toBe(units(1));
  });
  it('retains a fixed cyclic recipe prefix rather than skipping a preceding output',()=>{
    const f=common(30*M),u=f.c.stations.find(s=>s.id==='U')!,r=f.c.recipes.find(r=>r.id==='recipe-U')!;
    // Two rows of the same recipe with different full batch sizes.
    u.plan[0]!.processing.repetitions=1;u.plan.push({...structuredClone(u.plan[0]!),id:'second-U',processing:{mode:'simultaneous',repetitions:2,timeMs:M,cv:0}});
    r.output.quantity='1';const p=calculate(f),works=p.works.filter(w=>w.stationId==='U');
    expect(works.slice(0,3).map(w=>[w.planRowId,w.repetitions])).toEqual([['row-U','1'],['second-U','2'],['row-U','1']]);
    expect(works[3]!.planRowId).toBe('second-U');expect(raw(p,'R')).toBe(units(12));
  });
  it('handles multiple recipes and multiple drum row batches without merging materials',()=>{
    const c=cyclicLine();c.durationMs=4*M;c.calendar={shiftStartMs:0,lunchStartMs:3*M,lunchEndMs:3*M+1,shiftEndMs:4*M};
    const selection:DbrSelection={drumStationId:'s1',drumCycles:1,products:[{materialId:'a',quantity:'2'},{materialId:'b',quantity:'1'}],routeIds:c.routes.map(r=>r.id),bufferMs:0,maxOpenSlots:1};
    const p=calculate({c,selection});expect(raw(p,'raw')).toBe(units(2));expect(raw(p,'rawB')).toBe(units(1));expect(p.groups[0]!.allSlotsPresent).toBe(true);
    expect(p.works.map(w=>w.drumSlotId)).toEqual(p.groups[0]!.slotIds);
  });
  it('is independent of seed, names, priorities, source timing, protection and entity order',()=>{
    const f=common(30*M),baseline=calculate(f);f.c.seed=999;f.c.materials.reverse();f.c.stations.reverse();f.c.recipes.reverse();f.c.routes.reverse();f.c.sources.reverse();
    for (const s of f.c.stations) {s.name='<script>data</script>';s.priority=17;}
    for (const s of f.c.sources) {s.quantity='99';s.intervalMs=7*M;}
    f.selection.routeIds.reverse();f.selection.bufferMs=12345;f.selection.maxOpenSlots=99;expect(calculate(f)).toEqual(baseline);
  });
  it('returns independent JSON data without mutating input or push simulation',()=>{
    const f=common(30*M),run=compileConfig(f.c),before=JSON.stringify(f.selection),sim=new Simulation(run);sim.advanceTo(M);
    const snapshot=JSON.stringify(sim.getSnapshot()),first=planDbrDemand(run,f.selection);expect(JSON.stringify(f.selection)).toBe(before);expect(JSON.stringify(sim.getSnapshot())).toBe(snapshot);
    const serialized=JSON.stringify(first);expect(JSON.parse(serialized)).toEqual(first);first.demandPlan!.works[0]!.slotIds.push('changed');expect(JSON.stringify(planDbrDemand(run,f.selection))).toBe(serialized);
    expect(run.engineVersion).toBe('0.34.0');expect(()=>compileConfig({...f.c,policy:'dbr'})).toThrow(ConfigError);
  });
  it('does not calculate demands for structurally invalid data',()=>{
    const result=planDbrDemand(compileConfig(line()),{instructions:'run DBR'});expect(result.demandPlan).toBeNull();expect(result.demandValid).toBe(false);expect(result.schedule).toBeNull();expect(result.demandIssues).toEqual([]);
  });
  it('keeps stock, capacity, temporal compatibility and slot group checks pending',()=>{
    const f=common();f.selection.maxOpenSlots=1;const r=planDbrDemand(compileConfig(f.c),f.selection);expect(r.canStart).toBe(false);expect(r.pendingChecks).toContain('slotGroups');expect(r.pendingChecks).toContain('quantitiesAndPlans');
  });
  it('preserves output, input and source balances across fractional shared flows',()=>{
    for (const amount of ['0.000001','0.3','1','2.000001','7']) {
      const f=common(50*M);f.c.recipes.find(r=>r.id==='recipe-D')!.inputs[0]!.quantity=amount;
      const p=calculate(f);
      for (const w of p.works) {
        const allocated=p.allocations.filter(a=>a.producerId===w.workId).reduce((n,a)=>n+BigInt(a.quantityUnits),0n);
        const remainder=p.remainders.filter(r=>r.producerId===w.workId).reduce((n,r)=>n+BigInt(r.quantityUnits),0n);
        expect(allocated+remainder).toBe(BigInt(w.output.quantityUnits));
        for (const input of w.inputs) expect(p.allocations.filter(a=>a.consumerId===w.workId&&a.materialId===input.materialId).reduce((n,a)=>n+BigInt(a.quantityUnits),0n)).toBe(BigInt(input.quantityUnits));
      }
      for (const n of p.rawNeeds) expect(p.allocations.filter(a=>a.producerId===n.needId).reduce((q,a)=>q+BigInt(a.quantityUnits),0n)).toBe(BigInt(n.quantityUnits));
      for (const a of p.allocations) {
        const route=f.c.routes.find(r=>r.id===a.routeId)!;expect(a.materialId).toBe(route.materialId);
        const supplier=p.works.find(w=>w.workId===a.producerId)?.stationId ?? p.rawNeeds.find(n=>n.needId===a.producerId)!.sourceId;
        const consumer=p.works.find(w=>w.workId===a.consumerId)?.stationId ?? 'market';
        expect([supplier,consumer]).toEqual([route.fromId,route.toId]);
      }
      // Each group needs amount + 2 C, supplied in full batches of 6.
      const demand=BigInt(Math.round(Number(amount)*1e6))*5n+units(10);
      expect(raw(p,'R')).toBe(((demand+units(6)-1n)/units(6))*units(2));
    }
  });
  it('follows multiple output recipes in order and retains the cursor between groups',()=>{
    const f=before(30*M),u=f.c.stations.find(s=>s.id==='U')!,v=f.c.stations.find(s=>s.id==='V')!;
    // One supplier makes C first, then A twice; both feed the drum.
    u.plan=[{...structuredClone(v.plan[0]!),id:'first-C'}, {...structuredClone(u.plan[0]!),batches:2}];
    f.c.stations=f.c.stations.filter(s=>s.id!=='V');
    f.c.routes=f.c.routes.filter(r=>r.fromId!=='V');
    f.c.routes.find(r=>r.materialId==='RC')!.toId='U';
    f.c.routes.push({id:'U-C-D',fromId:'U',toId:'D',materialId:'C'});f.selection.routeIds=f.c.routes.map(r=>r.id);
    const p=calculate(f),works=p.works.filter(w=>w.stationId==='U');
    expect(works.map(w=>[w.planRowId,w.batchCount])).toEqual([['first-C','1'],['row-U','2'],['first-C','1'],['row-U','2'],['first-C','1'],['row-U','2']]);
    expect(raw(p,'RA')).toBe(units(6));expect(raw(p,'RC')).toBe(units(3));
  });
  it('accounts for a preceding byproduct row and its raw inputs without inventing a consumer',()=>{
    const f=before(),u=f.c.stations.find(s=>s.id==='U')!,v=f.c.stations.find(s=>s.id==='V')!;
    u.plan=[{...structuredClone(v.plan[0]!),id:'first-C'}, {...structuredClone(u.plan[0]!)}];
    f.c.stations=f.c.stations.filter(s=>s.id!=='V');f.c.recipes.find(r=>r.id==='recipe-D')!.inputs=f.c.recipes.find(r=>r.id==='recipe-D')!.inputs.filter(i=>i.materialId!=='C');
    // Route C remains needed by a downstream assembly, whose demand is suppressed in a partial group.
    const fStation=structuredClone(v);fStation.id='F';fStation.plan=[{...structuredClone(v.plan[0]!),id:'final-row',recipeId:'final-recipe'}];
    f.c.materials.find(m=>m.id==='P')!.role='intermediate';f.c.materials.push({id:'Q',name:'Q',role:'finished',salePrice:'1',color:'red'});
    f.c.recipes.push({id:'final-recipe',name:'Final',kind:'production',inputs:[{materialId:'P',quantity:'1'},{materialId:'C',quantity:'1'}],output:{materialId:'Q',quantity:'1'}});f.c.stations.push(fStation);
    f.c.routes=f.c.routes.filter(r=>r.fromId!=='V');f.c.routes.find(r=>r.materialId==='RC')!.toId='U';f.c.routes.find(r=>r.toId==='market')!.toId='F';
    f.c.routes.push({id:'U-F-C',fromId:'U',toId:'F',materialId:'C'},{id:'Q-market',fromId:'F',toId:'market',materialId:'Q'});
    f.selection.products=[{materialId:'Q',quantity:'2'}];f.selection.drumCycles=2;f.selection.routeIds=f.c.routes.map(r=>r.id);
    const p=calculate(f);expect(p.groups[0]!.products).toEqual([]);expect(raw(p,'RC')).toBe(units(2));expect(p.remainders.find(r=>r.materialId==='C')!.quantityUnits).toBe('1000000');
    expect(p.works.filter(w=>w.stationId==='U'&&w.output.materialId==='C').every(w=>w.slotIds.length===1)).toBe(true);
  });
  it('throws on excessive explicit records without returning partial success',()=>{
    const f=network([{id:'D',input:[['R','1']],output:['P','1'],time:1}],'D',100_000);
    try {planDbrDemand(compileConfig(f.c),f.selection);expect.fail('Expected accounting limit');} catch (e) {expect(e).toBeInstanceOf(DbrDemandLimitError);expect((e as DbrDemandLimitError).resource).toBe('records');}
    expect(MAX_DBR_DEMAND_RECORDS).toBe(300_000);
  });
  it('bounds slot associations when a shared batch supplies many later slots through a long chain',()=>{
    const specs:Spec[]=[];
    for (let i=0;i<24;i++) specs.push({id:`U${i}`,input:[[i===0?'R':`C${i-1}`,i===0?'1':'50000']],output:[`C${i}`,'50000']});
    specs.push({id:'D',input:[['C23','1']],output:['P','1'],time:1});
    const f=network(specs,'D',50_000);
    try {planDbrDemand(compileConfig(f.c),f.selection);expect.fail('Expected association limit');} catch (e) {expect(e).toBeInstanceOf(DbrDemandLimitError);expect((e as DbrDemandLimitError).resource).toBe('slotLinks');}
    expect(MAX_DBR_DEMAND_LINKS).toBe(1_000_000);
  });
});
