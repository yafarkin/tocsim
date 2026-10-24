import {describe,expect,it} from 'vitest';
import {compileConfig,ConfigError} from './config';
import type {DeepReadonly,EditorConfig} from './config';
import {completeInspection,InventoryError,receiveStock,reserveInputs} from './inventory';
import type {InventoryState,Provenance,Snapshot} from './state';
import {MAX_UNITS} from './arithmetic';
import {line} from './test-fixtures';
import {Simulation} from './simulation';
import {Runner} from '../runner/runner';
const Q=1_000_000,M=60_000,DAY=86_400_000;
function inspectionLine(late=false,mode:'sequential'|'simultaneous'='sequential',repetitions=1):EditorConfig {
  const c=line();c.durationMs=2*DAY+50*M;
  c.calendar={shiftStartMs:0,lunchStartMs:20*M,lunchEndMs:25*M,shiftEndMs:50*M};
  c.sources[0]!.availability='warehouse';c.initialStocks=[{id:'raw-kit',ownerId:'s1',location:'input',materialId:'raw',quantity:'12',cost:'120'}];
  c.recipes[0]!.inputs[0]!.quantity='1';c.recipes[0]!.output.quantity='1';
  c.stations.forEach(s=>{s.inputBuffer={kind:'infinite'};s.outputBuffer={kind:'quantity',quantity:'0'};});
  Object.assign(c.stations[0]!.plan[0]!.processing,{timeMs:M,defectProbability:0.5});
  c.stations[1]!.plan[0]!.processing.timeMs=4*M;
  const materialId=late?'product':'part';
  c.recipes.push({id:'inspect',name:'Контроль',kind:'inspection',inputs:[{materialId,quantity:'1'}],output:{materialId,quantity:'1'}});
  c.stations.push({...structuredClone(c.stations[0]!),id:'qc',name:'Контроль',plan:[{id:'check-plan',recipeId:'inspect',batches:1,processing:{mode,repetitions,timeMs:2*M,cv:0}}]});
  c.routes=late?
    [c.routes[0]!,c.routes[1]!,{id:'to-check',fromId:'s2',toId:'qc',materialId:'product'},{id:'to-market',fromId:'qc',toId:'market',materialId:'product'}]:
    [c.routes[0]!,{id:'to-check',fromId:'s1',toId:'qc',materialId:'part'},{id:'to-bottleneck',fromId:'qc',toId:'s2',materialId:'part'},c.routes[2]!];
  return c;
}
function checkBalance(c:EditorConfig,s:DeepReadonly<Snapshot>) {
  const run=compileConfig(c);
  for(const counter of s.line!.counters) {
    const initial=run.resolved.initialStocks.filter(x=>x.materialId===counter.materialId).reduce((sum,x)=>sum+x.quantity,0);
    const released=s.sources.filter(x=>run.resolved.sources.find(y=>y.id===x.sourceId)!.materialId===counter.materialId).reduce((sum,x)=>sum+x.releasedQuantity,0);
    // These fixtures have no raw warehouse stock; source release is zero.
    const stock=s.stocks.filter(x=>x.materialId===counter.materialId).reduce((sum,x)=>sum+x.quantity,0);
    expect(initial+released+counter.produced).toBe(stock+counter.consumed+counter.sold+counter.scrapped);
  }
  const initial=run.resolved.initialStocks.reduce((sum,x)=>sum+x.cost,0n),purchases=s.sources.reduce((sum,x)=>sum+BigInt(x.purchasedCost),0n);
  expect(s.stocks.reduce((sum,x)=>sum+BigInt(x.cost),0n)+s.line!.counters.reduce((sum,x)=>sum+BigInt(x.soldCost)+BigInt(x.scrapCost),0n)).toBe(initial+purchases);
  for(const count of s.line!.inspections) expect(count.checkedQuantity).toBe(count.passedQuantity+count.scrappedQuantity);
  expect(s.line!.scraps.reduce((sum,x)=>sum+BigInt(x.cost),0n)).toBe(s.line!.counters.reduce((sum,x)=>sum+BigInt(x.scrapCost),0n));
}
function receive(s:InventoryState,count:number,bad:boolean,cost:bigint,times:Record<string,bigint>) {
  const provenance:Provenance={origin:{kind:'known',startedAtMs:0}, firstProcessing: {kind: 'unknown'}, defective:bad,defectSourceIds:bad?['source-of-defect']:[],processingMs:times};
  receiveStock(s,{ownerId:'qc',location:'input'},{materialId:'A',quantity:count,cost,provenance},{kind:'infinite'});
}

describe('inspection configuration and explicit routes',()=>{
  it.each([false,true])('accepts unchanged intermediate/finished material, late=%s',late=>{
    const run=compileConfig(inspectionLine(late));
    expect(run.resolved.recipes.find(r=>r.id==='inspect')).toMatchObject({kind:'inspection',inputs:[{quantity:Q}],output:{quantity:Q}});
    expect(Object.isFrozen(run.source.recipes.find(r=>r.id==='inspect'))).toBe(true);
  });
  it.each(['quantity','material','inputs','output','probability'] as const)('rejects invalid inspection %s',field=>{
    const c=inspectionLine(),r=c.recipes.find(r=>r.id==='inspect')!;
    if(field==='quantity')r.inputs[0]!.quantity='0.4';
    if(field==='material')r.output.materialId='product';
    if(field==='inputs')r.inputs.push({materialId:'raw',quantity:'1'});
    if(field==='output')r.output.quantity='2';
    if(field==='probability')c.stations.find(s=>s.id==='qc')!.plan[0]!.processing.defectProbability=0.1;
    try{compileConfig(c);throw new Error('Expected error');}catch(error){expect(error).toBeInstanceOf(ConfigError);expect((error as ConfigError).messages.ru).toBeTruthy();expect((error as ConfigError).messages.en).toBeTruthy();}
  });
  it('allows inspection of raw material without weakening the production rules',()=>{
    const c=inspectionLine(),r=c.recipes.find(r=>r.id==='inspect')!;
    r.inputs[0]!.materialId='raw';r.output.materialId='raw';
    c.routes=[{id:'source-check',fromId:'source',toId:'qc',materialId:'raw'},{id:'checked-raw',fromId:'qc',toId:'s1',materialId:'raw'},c.routes.find(r=>r.id==='r3')!,{id:'part-route',fromId:'s1',toId:'s2',materialId:'part'}];
    expect(compileConfig(c).resolved.recipes.find(r=>r.id==='inspect')!.kind).toBe('inspection');
    r.kind='production';expect(()=>compileConfig(c)).toThrow(ConfigError);
  });
  it('rejects a route cycle even though equal material IDs are valid',()=>{
    const c=inspectionLine();
    c.routes.push({id:'cycle',fromId:'qc',toId:'qc',materialId:'part'});
    expect(()=>compileConfig(c)).toThrow(ConfigError);
  });
  it('normalizes explicit zero inspection probability and preserves nominal buffer calculation',()=>{
    const c=inspectionLine(),a=compileConfig(c);
    c.stations.find(s=>s.id==='qc')!.plan[0]!.processing.defectProbability=0;
    expect(compileConfig(c).calculationHash).toBe(a.calculationHash);
    c.stations.find(s=>s.id==='qc')!.inputBuffer={kind:'shift',shifts:'0.5'};
    const calculated=compileConfig(c).bufferCalculations.find(x=>x.stationId==='qc')!;
    expect(calculated.cycleConsumption).toBe(String(Q));expect(calculated.cycleWorkMs).toBe(String(2*M));
  });
});

describe('atomic filtering and attributed time',()=>{
  it('filters 0.6 good and 0.4 bad without poisoning the good share or creating material',()=>{
    const s:InventoryState={stocks:[],nextStockOrdinal:0};
    receive(s,600000,false,7n,{bottleneck:11n});receive(s,400000,true,5n,{bottleneck:9n});
    reserveInputs(s,'qc',[{materialId:'A',quantity:Q}]);
    const result=completeInspection(s,'qc','A',7,100);
    expect(result.passed).toHaveLength(1);expect(result.scrapped).toHaveLength(1);
    expect(result.passed[0]).toMatchObject({materialId:'A',quantity:600000,cost:7n,location:'held',readyAtMs:100,provenance:{defective:false,defectSourceIds:[],processingMs:{bottleneck:11n,qc:4n}}});
    expect(result.scrapped[0]).toMatchObject({materialId:'A',quantity:400000,cost:5n,provenance:{defective:true,defectSourceIds:['source-of-defect'],processingMs:{bottleneck:9n,qc:3n}}});
    expect(s.stocks).toHaveLength(1);expect(s.stocks[0]!.id).toBe(result.passed[0]!.id);
    result.passed[0]!.provenance.processingMs.qc=100n;expect(s.stocks[0]!.provenance.processingMs.qc).toBe(4n);
  });
  it('takes only the completed sequential volume and leaves the rest reserved',()=>{
    const s:InventoryState={stocks:[],nextStockOrdinal:0};
    receive(s,2*Q,true,7n,{prior:11n});reserveInputs(s,'qc',[{materialId:'A',quantity:2*Q}]);
    const first=completeInspection(s,'qc','A',1,1);
    expect(first.passed).toEqual([]);expect(first.scrapped[0]).toMatchObject({quantity:Q,cost:3n,provenance:{processingMs:{prior:5n,qc:1n}}});
    expect(s.stocks[0]).toMatchObject({quantity:Q,cost:4n,location:'reserved',provenance:{processingMs:{prior:6n}}});
    expect(completeInspection(s,'qc','A',2,3).scrapped[0]!.cost).toBe(4n);expect(s.stocks).toEqual([]);
  });
  it('keeps the same portions in simultaneous inspection and distributes one cycle time',()=>{
    const s:InventoryState={stocks:[],nextStockOrdinal:0};
    receive(s,Q,false,1n,{});receive(s,Q,true,2n,{});receive(s,Q,false,3n,{});reserveInputs(s,'qc',[{materialId:'A',quantity:3*Q}]);
    const result=completeInspection(s,'qc','A',2,2,3);
    expect(result.passed.map(x=>x.cost)).toEqual([1n,3n]);expect(result.scrapped[0]!.cost).toBe(2n);
    expect([...result.passed,...result.scrapped].reduce((sum,x)=>sum+x.provenance.processingMs.qc!,0n)).toBe(2n);
    expect(result.passed.map(x=>x.provenance.processingMs.qc)).toEqual([0n,1n]);
  });
  it('rolls back shortages, invalid arguments and time overflow',()=>{
    const s:InventoryState={stocks:[],nextStockOrdinal:0};receive(s,Q,true,1n,{qc:MAX_UNITS});reserveInputs(s,'qc',[{materialId:'A',quantity:Q}]);const before=structuredClone(s);
    for(const action of [()=>completeInspection(s,'qc','A',1,1,2),()=>completeInspection(s,'qc','A',0,1),()=>completeInspection(s,'qc','A',1,1),()=>completeInspection(s,'qc','A',1,1,0)]){expect(action).toThrow(InventoryError);expect(s).toEqual(before);}
  });
});

describe('inspection simulation, scrap accounting and routing',()=>{
  it('passes 0.6 and scraps 0.4 in the real engine, preserving cost and prior/inspection time',()=>{
    const c=inspectionLine();c.initialStocks[0]!.quantity='1';c.initialStocks[0]!.cost='10';
    c.initialStocks.push({id:'good-share',ownerId:'qc',location:'input',materialId:'part',quantity:'0.6',cost:'6'});
    c.stations[0]!.plan[0]!.processing.defectProbability=1;
    c.stations.find(s=>s.id==='qc')!.plan[0]!.processing.timeMs=M;
    const sim=new Simulation(compileConfig(c));expect(sim.advanceTo(2*M-1).line!.scraps).toEqual([]);
    const done=sim.advanceTo(2*M);checkBalance(c,done);
    expect(done.line!.inspections).toEqual([{stationId:'qc',materialId:'part',completedRepetitions:1,checkedQuantity:Q,passedQuantity:600000,scrappedQuantity:400000,processingMs:String(M)}]);
    expect(done.line!.scraps).toEqual([{detectedAtId:'qc',materialId:'part',defectSourceIds:['s1'],quantity:400000,cost:'4000000',processingMs:{s1:'24000',qc:'24000'}}]);
    const part=done.line!.counters.find(x=>x.materialId==='part')!;expect(part).toMatchObject({produced:Q,consumed:0,scrapped:400000});
    expect(done.stocks.find(x=>x.ownerId==='s2'&&x.materialId==='part')).toMatchObject({quantity:600000,cost:'6000000',provenance:{defective:false,processingMs:{qc:'36000'}}});
    expect(done.line!.transfers.find(t=>t.kind==='scrap')).toMatchObject({fromId:'qc',toId:'qc',fromLocation:'reserved',quantity:400000});
  });
  it.each(['sequential','simultaneous'] as const)('counts checked repetitions and all work at every intermediate step in %s mode',mode=>{
    const c=inspectionLine(false,mode,4),sim=new Simulation(compileConfig(c));
    while(sim.step())checkBalance(c,sim.getSnapshot());
    const end=sim.getSnapshot(),qc=end.line!.inspections[0]!;
    expect(qc.completedRepetitions).toBe(12);expect(qc.checkedQuantity).toBe(12*Q);expect(qc.passedQuantity).toBeGreaterThan(0);expect(qc.scrappedQuantity).toBeGreaterThan(0);
    expect(qc.processingMs).toBe(String((mode==='sequential'?12:3)*2*M));
    expect(end.line!.scraps.every(x=>x.detectedAtId==='qc')).toBe(true);expect(end.stocks).toEqual([]);
    const json=JSON.parse(JSON.stringify(end));expect(json.schemaVersion).toBe(21);expect(Object.isFrozen(end.line!.scraps[0]!.processingMs)).toBe(true);
  });
  it('protects bottleneck time with early detection and attributes late scrap to its true detector',()=>{
    const earlyConfig=inspectionLine(),lateConfig=inspectionLine(true),early=new Simulation(compileConfig(earlyConfig)).runToEnd(),late=new Simulation(compileConfig(lateConfig)).runToEnd();
    checkBalance(earlyConfig,early);checkBalance(lateConfig,late);
    const earlyProduct=early.line!.counters.find(c=>c.materialId==='product')!,lateProduct=late.line!.counters.find(c=>c.materialId==='product')!;
    expect(earlyProduct.sold).toBe(lateProduct.sold);expect(earlyProduct.soldCost).toBe(lateProduct.soldCost);
    expect(early.line!.scraps.every(x=>!(x.processingMs.s2&&BigInt(x.processingMs.s2)>0n))).toBe(true);
    expect(late.line!.scraps.every(x=>x.detectedAtId==='qc'&&x.defectSourceIds.join()==='s1'&&BigInt(x.processingMs.s2!)>0n)).toBe(true);
    expect(late.line!.scraps.reduce((sum,x)=>sum+BigInt(x.processingMs.s2!),0n)).toBe(BigInt(lateProduct.scrapped/Q)*BigInt(4*M));
    expect(early.line!.inspections[0]!.checkedQuantity).toBe(late.line!.inspections[0]!.checkedQuantity);
  });
  it('does not let early control prevent a defect introduced by a later station; final free check earns no sale',()=>{
    const c=inspectionLine();c.stations[0]!.plan[0]!.processing.defectProbability=0;c.stations[1]!.plan[0]!.processing.defectProbability=1;
    const end=new Simulation(compileConfig(c)).runToEnd();checkBalance(c,end);
    expect(end.line!.inspections[0]).toMatchObject({checkedQuantity:12*Q,passedQuantity:12*Q,scrappedQuantity:0});
    expect(end.line!.scraps).toHaveLength(1);expect(end.line!.scraps[0]).toMatchObject({detectedAtId:'market',defectSourceIds:['s2'],quantity:12*Q,processingMs:{qc:String(24*M),s2:String(48*M)}});
    expect(end.line!.counters.find(c=>c.materialId==='product')).toMatchObject({sold:0,soldCost:'0',scrapped:12*Q});
  });
  it('aggregates multiple defect sources once per disposed portion and keeps detector separate',()=>{
    const c=inspectionLine(true);c.stations[1]!.plan[0]!.processing.defectProbability=1;
    const end=new Simulation(compileConfig(c)).runToEnd();checkBalance(c,end);
    expect(end.line!.scraps).toHaveLength(2);
    expect(end.line!.scraps.map(s=>s.defectSourceIds.join('+')).sort()).toEqual(['s1+s2','s2']);
    expect(end.line!.scraps.reduce((sum,s)=>sum+s.quantity,0)).toBe(12*Q);
    expect(end.line!.scraps.every(s=>s.detectedAtId==='qc')).toBe(true);
  });
  it.each([false,true])('treats prototype-like station IDs as data in inspection and final summaries, final=%s',final=>{
    const c=inspectionLine();c.stations[0]!.plan[0]!.processing.defectProbability=final?0:1;
    c.stations[1]!.plan[0]!.processing.defectProbability=final?1:0;
    const names=new Map([['s1','constructor'],['qc','__proto__'],['s2','toString']]),rename=(id:string)=>names.get(id)??id;
    c.stations.forEach(s=>{s.id=rename(s.id);});c.routes.forEach(r=>{r.fromId=rename(r.fromId);r.toId=rename(r.toId);});c.initialStocks.forEach(s=>{s.ownerId=rename(s.ownerId);});
    const end=new Simulation(compileConfig(c)).runToEnd();checkBalance(c,end);
    const scrap=end.line!.scraps[0]!;expect(scrap.detectedAtId).toBe(final?'market':'__proto__');
    expect(Object.hasOwn(scrap.processingMs,'__proto__')).toBe(true);expect(BigInt(scrap.processingMs.__proto__!)).toBe(BigInt(24*M));
    expect(scrap.defectSourceIds).toEqual([final?'toString':'constructor']);
    expect(Object.getPrototypeOf(scrap.processingMs)).toBe(Object.prototype);
    expect(JSON.parse(JSON.stringify(end)).line.scraps[0].processingMs.__proto__).toBe(String(24*M));
  });
  it('supports consecutive controls of the same material without double production or double scrap',()=>{
    const c=inspectionLine(),qc=c.stations.find(s=>s.id==='qc')!;
    c.stations.push({...structuredClone(qc),id:'qc2',plan:[{...structuredClone(qc.plan[0]!),id:'check2-plan'}]});
    c.routes.find(r=>r.id==='to-bottleneck')!.fromId='qc2';c.routes.push({id:'between-checks',fromId:'qc',toId:'qc2',materialId:'part'});
    const end=new Simulation(compileConfig(c)).runToEnd();checkBalance(c,end);
    const first=end.line!.inspections.find(x=>x.stationId==='qc')!,second=end.line!.inspections.find(x=>x.stationId==='qc2')!;
    expect(second.checkedQuantity).toBe(first.passedQuantity);expect(second.scrappedQuantity).toBe(0);
    expect(end.line!.counters.find(x=>x.materialId==='part')!.produced).toBe(12*Q);expect(end.line!.scraps.every(x=>x.detectedAtId==='qc')).toBe(true);
  });
  it('only bypasses control when an explicit bypass route is added',()=>{
    const c=inspectionLine();c.stations[0]!.plan[0]!.processing.defectProbability=1;c.stations[1]!.priority=10;
    const without=new Simulation(compileConfig(c)).runToEnd();expect(without.line!.counters.find(x=>x.materialId==='product')!.produced).toBe(0);
    c.routes.push({id:'bypass',fromId:'s1',toId:'s2',materialId:'part'});
    const withBypass=new Simulation(compileConfig(c)).runToEnd();checkBalance(c,withBypass);
    expect(withBypass.line!.counters.find(x=>x.materialId==='product')!.produced).toBe(12*Q);expect(withBypass.line!.scraps[0]!.detectedAtId).toBe('market');
  });
});

describe('inspection batches, calendar and maintenance',()=>{
  it.each([false,true])('counts all-bad inspection toward maintenance and paid lunch, replacement=%s',replacement=>{
    const c=inspectionLine();c.initialStocks[0]!.quantity='1';c.initialStocks[0]!.cost='10';c.stations[0]!.plan[0]!.processing.defectProbability=1;
    const qc=c.stations.find(s=>s.id==='qc')!;qc.lunchReplacement=replacement;qc.costs.perLunchHour='12';qc.plan[0]!.processing.timeMs=23*M;
    qc.maintenance={enabled:true,durationMs:8*M,processingThresholdMs:22*M,repetitionsThreshold:1};
    const sim=new Simulation(compileConfig(c)),atLunch=sim.advanceTo(20*M);
    expect(atLunch.stations.find(s=>s.stationId==='qc')).toMatchObject({status:replacement?'processing':'paused',remainingProcessingMs:4*M});
    const due=(replacement?23:28)*M,completion=(replacement?24:29)*M;
    expect(sim.advanceTo(due).stations.find(s=>s.stationId==='qc')).toMatchObject({maintenanceDueAtMs:due,maintenanceProcessingMs:22*M,maintenanceRepetitions:0});
    const done=sim.advanceTo(completion);checkBalance(c,done);
    expect(done.stations.find(s=>s.stationId==='qc')).toMatchObject({status:'maintenance',remainingMaintenanceMs:8*M,maintenanceRepetitions:1,maintenanceProcessingMs:23*M});
    expect(done.line!.inspections[0]).toMatchObject({completedRepetitions:1,passedQuantity:0,scrappedQuantity:Q,processingMs:String(23*M)});
    const service=sim.advanceTo(completion+8*M).stations.find(s=>s.stationId==='qc')!;
    expect(service).toMatchObject({status:'starved',maintenanceRepetitions:0,maintenanceProcessingMs:0,lunchBusyMs:replacement?5*M:0,lunchCost:replacement?'1000000':'0',lastMaintenance:{dueAtMs:due,startedAtMs:completion,completedAtMs:completion+8*M,repetitions:1,processingMs:23*M}});
    expect(sim.getSnapshot().line!.scraps[0]!.processingMs.qc).toBe(String(23*M));
  });
  it.each([false,true])('retains an unfinished check through night without early discovery, replacement=%s',replacement=>{
    const c=inspectionLine();c.initialStocks[0]!.quantity='1';c.initialStocks[0]!.cost='10';c.stations[0]!.plan[0]!.processing.defectProbability=1;
    const qc=c.stations.find(s=>s.id==='qc')!;qc.lunchReplacement=replacement;qc.plan[0]!.processing.timeMs=60*M;
    const sim=new Simulation(compileConfig(c));
    expect(sim.advanceTo(50*M).stations.find(s=>s.stationId==='qc')).toMatchObject({status:'paused',reason:'offShift',remainingProcessingMs:(replacement?11:16)*M});
    expect(sim.getSnapshot().line!.inspections).toEqual([]);expect(sim.getSnapshot().line!.scraps).toEqual([]);
    sim.advanceTo(DAY-1);expect(sim.getSnapshot().line!.scraps).toEqual([]);
    const done=sim.advanceTo(DAY+(replacement?11:16)*M);checkBalance(c,done);
    expect(done.line!.inspections[0]).toMatchObject({checkedQuantity:Q,scrappedQuantity:Q,processingMs:String(60*M)});
    expect(done.stations.find(s=>s.stationId==='qc')!.remainingProcessingMs).toBeNull();
  });
  it('replaces operation tokens at a 24:00 close coinciding with the next opening',()=>{
    const c=inspectionLine();c.calendar={shiftStartMs:0,lunchStartMs:720*M,lunchEndMs:780*M,shiftEndMs:DAY};c.durationMs=2*DAY;
    c.initialStocks[0]!.quantity='1';c.initialStocks[0]!.cost='10';c.stations[0]!.plan[0]!.processing.defectProbability=1;
    const qc=c.stations.find(s=>s.id==='qc')!;qc.lunchReplacement=true;qc.plan[0]!.processing.timeMs=DAY+M;
    const sim=new Simulation(compileConfig(c));
    expect(sim.advanceTo(DAY).stations.find(s=>s.stationId==='qc')).toMatchObject({status:'processing',remainingProcessingMs:2*M});
    expect(sim.advanceTo(DAY+2*M).line!.inspections[0]).toMatchObject({completedRepetitions:1,checkedQuantity:Q});
    expect(sim.runToEnd().line!.inspections[0]!.completedRepetitions).toBe(1);
  });
  it('includes a check finishing exactly at horizon and does not start maintenance beyond it',()=>{
    const c=inspectionLine();c.durationMs=50*M;c.initialStocks[0]!.quantity='1';c.initialStocks[0]!.cost='10';c.stations[0]!.plan[0]!.processing.defectProbability=1;
    const qc=c.stations.find(s=>s.id==='qc')!;qc.plan[0]!.processing.timeMs=44*M;qc.maintenance={enabled:true,durationMs:M,repetitionsThreshold:1};
    const end=new Simulation(compileConfig(c)).runToEnd();checkBalance(c,end);
    expect(end.line!.inspections[0]).toMatchObject({checkedQuantity:Q,scrappedQuantity:Q});
    expect(end.stations.find(s=>s.stationId==='qc')).toMatchObject({reason:'horizon',maintenanceDueAtMs:50*M,maintenanceStartedAtMs:null,remainingMaintenanceMs:null});
  });
  it('flushes the last good remainder below the transport threshold and waits for the whole checked batch before service',()=>{
    const c=inspectionLine(false,'sequential',3);c.initialStocks[0]!.quantity='1';c.initialStocks[0]!.cost='10';c.stations[0]!.plan[0]!.processing.defectProbability=1;c.recipes[0]!.output.quantity='2';
    c.initialStocks.push({id:'good',ownerId:'qc',location:'input',materialId:'part',quantity:'1',cost:'6'});
    const qc=c.stations.find(s=>s.id==='qc')!;qc.plan[0]!.processing.timeMs=M;qc.transportThreshold='2';qc.maintenance={enabled:true,durationMs:M,repetitionsThreshold:1};
    const sim=new Simulation(compileConfig(c));
    expect(sim.advanceTo(2*M).stations.find(s=>s.stationId==='qc')).toMatchObject({maintenanceDueAtMs:2*M,transferReady:false,output:{heldQuantity:Q}});
    expect(sim.advanceTo(3*M).stations.find(s=>s.stationId==='qc')).toMatchObject({remainingMaintenanceMs:null,output:{heldQuantity:Q}});
    const released=sim.advanceTo(4*M);checkBalance(c,released);
    expect(released.stations.find(s=>s.stationId==='qc')).toMatchObject({status:'maintenance',maintenanceStartedAtMs:4*M,output:{heldQuantity:0}});
    expect(released.line!.inspections[0]).toMatchObject({completedRepetitions:3,checkedQuantity:3*Q,passedQuantity:Q,scrappedQuantity:2*Q});
    expect(sim.advanceTo(5*M).stations.find(s=>s.stationId==='qc')!.lastMaintenance).toMatchObject({repetitions:3,deferredBy:['batch'],processingMs:3*M});
  });
  it.each(['0','1'])('waits for held inspection output, but its own output buffer %s can release the station',outputCapacity=>{
    const c=inspectionLine(false,'sequential',2);c.initialStocks[0]!.quantity='2';c.initialStocks[0]!.cost='20';c.stations[0]!.plan[0]!.processing.defectProbability=0;
    c.initialStocks.push({id:'downstream',ownerId:'s2',location:'input',materialId:'part',quantity:'2',cost:'0'});
    c.stations[1]!.inputBuffer={kind:'quantity',quantity:'2'};c.stations[1]!.plan[0]!.processing.timeMs=20*M;
    const qc=c.stations.find(s=>s.id==='qc')!;qc.transportThreshold='2';qc.outputBuffer={kind:'quantity',quantity:outputCapacity};qc.maintenance={enabled:true,durationMs:M,repetitionsThreshold:1};
    const sim=new Simulation(compileConfig(c)),at6=sim.advanceTo(6*M);checkBalance(c,at6);
    const state=at6.stations.find(s=>s.stationId==='qc')!;
    if(outputCapacity==='0')expect(state).toMatchObject({status:'blocked',remainingMaintenanceMs:null,output:{heldQuantity:Q}});
    else expect(state).toMatchObject({status:'maintenance',maintenanceStartedAtMs:6*M,output:{heldQuantity:0,quantity:Q}});
    const start=(outputCapacity==='0'?25:6)*M;
    const record=sim.advanceTo(start+M).stations.find(s=>s.stationId==='qc')!.lastMaintenance!;
    expect(record).toMatchObject({startedAtMs:start,completedAtMs:start+M,repetitions:2,processingMs:4*M});
    expect(record.deferredBy).toEqual(outputCapacity==='0'?['batch','output','calendar']:['batch']);
  });
  it.each([false,true])('keeps setup outside attributed inspection time, replacement=%s',replacement=>{
    const c=inspectionLine();c.initialStocks[0]!.quantity='1';c.initialStocks[0]!.cost='10';c.stations[0]!.plan[0]!.processing.defectProbability=1;
    const qc=c.stations.find(s=>s.id==='qc')!;
    c.recipes.push({...structuredClone(c.recipes.find(r=>r.id==='inspect')!),id:'other-check'});
    qc.plan.push({...structuredClone(qc.plan[0]!),id:'other-row',recipeId:'other-check'});qc.initialRecipeId='other-check';qc.setupMs=22*M;qc.lunchReplacement=replacement;
    const sim=new Simulation(compileConfig(c));
    expect(sim.advanceTo(20*M).stations.find(s=>s.stationId==='qc')).toMatchObject({status:replacement?'setup':'paused',remainingSetupMs:3*M});
    const done=sim.advanceTo((replacement?25:30)*M);checkBalance(c,done);
    expect(done.line!.inspections[0]!.processingMs).toBe(String(2*M));
    expect(done.line!.scraps[0]!.processingMs.qc).toBe(String(2*M));
  });
});

describe('inspection reproducibility and bounded records',()=>{
  it.each(['sequential','simultaneous'] as const)('matches snapshots through random profiles, setup, maintenance, pauses, speeds and repeat in %s mode',mode=>{
    const c=inspectionLine(false,mode,3),qc=c.stations.find(s=>s.id==='qc')!;
    c.stations.forEach(s=>{s.plan[0]!.processing.cv=0.25;});
    c.recipes.push({...structuredClone(c.recipes.find(r=>r.id==='inspect')!),id:'check-other'});
    qc.plan.push({...structuredClone(qc.plan[0]!),id:'other-row',recipeId:'check-other'});qc.setupMs=M;qc.lunchReplacement=true;
    qc.maintenance={enabled:true,durationMs:M,repetitionsThreshold:3};
    const run=compileConfig(c),expected=new Simulation(run).runToEnd();checkBalance(c,expected);
    const split=new Simulation(run);for(const t of [0,1,M,20*M,25*M,50*M,DAY,DAY+12345,c.durationMs])split.advanceTo(t);
    expect(split.getSnapshot()).toEqual(expected);
    c.stations.reverse();c.recipes.reverse();c.routes.reverse();c.materials.reverse();c.initialStocks.reverse();
    expect(new Simulation(compileConfig(c)).runToEnd()).toEqual(expected);
    expect(expected.line!.inspections).toHaveLength(1);expect(expected.line!.scraps).toHaveLength(1);
    for(const speed of [1,60,300,1800,'max'] as const){
      let now=0,callback:(()=>void)|null=null;
      const runner=new Runner(run,undefined,{now:()=>now,request:cb=>{callback=cb;return cb;},cancel:()=>{callback=null;}});
      const drain=()=>{let n=0;while(callback){if(++n>10000)throw new Error('No progress');const cb=callback;callback=null;now+=M;cb();}};
      runner.setSpeed(speed);runner.step();runner.resume();runner.pause();const paused=runner.getView();now+=M;expect(runner.getView()).toBe(paused);
      runner.resume();drain();expect(runner.getView().model).toEqual(expected);runner.repeat();drain();expect(runner.getView().model).toEqual(expected);runner.dispose();
    }
  });
});
