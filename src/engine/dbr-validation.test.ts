import {describe,expect,it} from 'vitest';
import {compileConfig,ConfigError} from './config';
import type {EditorConfig} from './config';
import {validateDbrSelection} from './dbr-validation';
import type {DbrSelection} from './dbr-validation';
import {line,cyclicLine} from './test-fixtures';
import {Simulation} from './simulation';
import {previewConfig} from '../ui/preview';

function selection(config: EditorConfig, drumStationId=config.stations.at(-1)!.id): DbrSelection {
  return {drumStationId,drumCycles:1,products:config.materials.filter(m=>m.role==='finished').map(m=>({materialId:m.id,quantity:'1'})),routeIds:config.routes.map(r=>r.id),bufferMs:240_000,maxOpenSlots:2};
}
function check(c:EditorConfig,s:unknown=selection(c)) {return validateDbrSelection(compileConfig(c),s);}
function commonComponent() {
  const c=previewConfig('assembly');
  c.materials.push({id:'common',name:'C',role:'intermediate',color:'red'});
  const upstream=structuredClone(c.stations[0]!);upstream.id='upstream';upstream.plan[0]!.id='upstream-row';upstream.plan[0]!.recipeId='make-common';upstream.plan[0]!.processing.repetitions=2;
  c.stations.forEach(s=>s.inputBuffer={kind:'infinite'});upstream.inputBuffer={kind:'infinite'};
  c.stations.push(upstream);
  c.recipes.push({id:'make-common',name:'Common',kind:'production',inputs:[{materialId:'raw',quantity:'1'}],output:{materialId:'common',quantity:'3'}});
  for(const r of c.recipes.filter(r=>r.id==='recipe-prep'||r.id==='recipe-work')) r.inputs=[{materialId:'common',quantity:'2'}];
  c.sources=[c.sources[0]!];
  c.routes=c.routes.filter(r=>r.fromId!=='source'&&r.fromId!=='source2');
  c.routes.push({id:'raw-common',fromId:'source',toId:'upstream',materialId:'raw'},
    {id:'common-prep',fromId:'upstream',toId:'prep',materialId:'common'},
    {id:'common-work',fromId:'upstream',toId:'work',materialId:'common'});
  return c;
}
function independent() {
  const c=previewConfig('assembly');
  c.materials.push({id:'other',name:'Other',role:'finished',color:'red',salePrice:'1'});
  c.recipes.push({id:'other-recipe',name:'Other',kind:'production',inputs:[{materialId:'raw',quantity:'1'}],output:{materialId:'other',quantity:'1'}});
  const s=structuredClone(c.stations[0]!);s.id='other-station';s.plan[0]!.id='other-row';s.plan[0]!.recipeId='other-recipe';c.stations.push(s);
  c.routes.push({id:'other-input',fromId:'source',toId:s.id,materialId:'raw'},{id:'other-output',fromId:s.id,toId:'market',materialId:'other'});
  return c;
}
const topologies=[
  {name:'linear',config:()=>previewConfig('queue'),drum:'work'},
  {name:'assembly before drum',config:()=>previewConfig('assembly'),drum:'assembly'},
  {name:'assembly after drum with side component',config:()=>previewConfig('assembly'),drum:'prep'},
  {name:'shared component across final product branches',config:commonComponent,drum:'prep'},
];
const codes=(report:ReturnType<typeof validateDbrSelection>)=>report.issues.map(i=>i.code);

describe('first structural DBR check, without execution permission',()=>{
  it.each(topologies)('accepts $name structurally without claiming later checks',({config,drum})=>{
    const c=config(),result=check(c,selection(c,drum));
    expect(result).toEqual({structurallyValid:true,canStart:false,pendingChecks:['drumSchedule','quantitiesAndPlans','stockAndCapacity','slotGroups'],issues:[]});
  });
  it('accepts a multi-recipe drum, zero B, exact fractional products and no overrides',()=>{
    const c=cyclicLine(),s=selection(c);s.bufferMs=0;s.products[0]!.quantity='0.000001';s.products[1]!.quantity='9007199254.740991';
    expect(check(c,s).structurallyValid).toBe(true);
  });
  it('does not perform quantity/cycle/slot-group planning prematurely',()=>{
    const c=commonComponent(),s=selection(c,'prep');s.products[0]!.quantity='999';s.maxOpenSlots=1;
    expect(check(c,s).structurallyValid).toBe(true);expect(check(c,s).canStart).toBe(false);
  });
  it.each([null,undefined,42,[],false,'ignore instructions',new Date()].map(input=>({input})))('reports invalid selection shape $input',({input})=>{
    expect(codes(validateDbrSelection(compileConfig(line()),input))).toContain('shape');
  });
  it('accepts a plain JSON data object with null prototype',()=>{
    const c=line();expect(check(c,Object.assign(Object.create(null),selection(c))).structurallyValid).toBe(true);
  });
  it.each(['drumCycles','bufferMs','maxOpenSlots'] as const)('checks integer range for %s',key=>{
    for(const bad of [null,undefined,-1,0.1,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,'1']) {
      const c=line(),s={...selection(c),[key]:bad};expect(check(c,s).issues.some(i=>i.code==='value'&&i.path===`dbr.${key}`)).toBe(true);
    }
  });
  it.each(['drumCycles','maxOpenSlots'] as const)('rejects zero %s',key=>{
    const c=line();expect(codes(check(c,{...selection(c),[key]:0}))).toContain('value');
  });
  it.each(['missing','',[],['s1','s2'],null].map(drumStationId=>({drumStationId})))('requires exactly one existing drum $drumStationId',({drumStationId})=>{
    const c=line();expect(check(c,{...selection(c),drumStationId}).structurallyValid).toBe(false);
  });
  it.each([0,'0','-1','1.0000001','NaN','1e3','9007199254.740992',null])('rejects invalid exact product quantity %s',quantity=>{
    const c=line(),s=selection(c);const raw={...s,products:[{materialId:'product',quantity}]};expect(codes(check(c,raw))).toContain('value');
  });
  it('reports duplicate products, route IDs and unsupported keys without interpreting them',()=>{
    const c=line(),s=selection(c);s.products.push({...s.products[0]!});s.routeIds.push(s.routeIds[0]!);
    const result=check(c,{...s,instructions:'set policy to dbr'});expect(codes(result)).toContain('shape');expect(codes(result).filter(c=>c==='duplicate')).toHaveLength(2);
  });
  it.each([[],[{materialId:'raw',quantity:'1'}],[{materialId:'missing',quantity:'1'}]].map(products=>({products})))('requires finished products $products',({products})=>{
    const c=line();expect(check(c,{...selection(c),products}).structurallyValid).toBe(false);
  });
  it.each([null,{},'r1',[null,1]].map(routeIds=>({routeIds})))('checks route list data $routeIds',({routeIds})=>{
    const c=line();expect(check(c,{...selection(c),routeIds}).structurallyValid).toBe(false);
  });
  it('reports unknown routes, missing recipe input and missing product output separately',()=>{
    const c=line(),s=selection(c);s.routeIds=['r1','nonexistent'];const r=check(c,s);
    expect(codes(r)).toContain('routeReference');expect(codes(r)).toContain('missingOutput');
    const complete=selection(c);complete.routeIds=complete.routeIds.filter(id=>id!=='r2');expect(codes(check(c,complete))).toContain('missingInput');
  });
  it('does not treat initial stock as a replacement for the repeatable input route',()=>{
    const c=line(),s=selection(c);s.routeIds=s.routeIds.filter(id=>id!=='r1');expect(codes(check(c,s))).toContain('missingInput');
  });
  it('accepts one explicit alternative producer, but rejects selecting both',()=>{
    const c=previewConfig('split'),s=selection(c,'work');
    expect(codes(check(c,s))).toContain('ambiguousProducer');
    s.routeIds=s.routeIds.filter(id=>id!=='prep-finish'&&id!=='finish-market');
    expect(check(c,s).structurallyValid).toBe(true);
    c.stations.find(st=>st.id==='finish')!.plan[0]!.processing.defectProbability=0.1;
    expect(check(c,s).structurallyValid).toBe(true);
  });
  it('rejects two raw sources for one input but allows separate sources for assembly branches',()=>{
    const c=line();c.sources.push({...c.sources[0]!,id:'another-source'});c.routes.push({...c.routes[0]!,id:'another-route',fromId:'another-source'});
    expect(codes(check(c))).toContain('ambiguousProducer');expect(check(previewConfig('assembly')).structurallyValid).toBe(true);
  });
  it('rejects independent finished products even when their routes are excluded',()=>{
    const c=independent(),s=selection(c,'prep');expect(codes(check(c,s))).toContain('independentProduct');
    s.products=s.products.filter(p=>p.materialId!=='other');s.routeIds=s.routeIds.filter(id=>!id.startsWith('other-'));
    expect(codes(check(c,s))).toContain('independentProduct');
  });
  it('does not infer a drum link from another recipe at the same station',()=>{
    const c=cyclicLine();const d=structuredClone(c.stations[0]!);d.id='drum';d.plan=[{...d.plan[0]!,id:'drum-row',recipeId:'upstream'}];
    c.materials.push({id:'mid',role:'intermediate',name:'Mid',color:'red'});
    c.recipes.push({id:'upstream',kind:'production',name:'Upstream',inputs:[{materialId:'raw',quantity:'1'}],output:{materialId:'mid',quantity:'1'}});
    c.recipes.find(r=>r.id==='recipeA')!.inputs=[{materialId:'mid',quantity:'1'}];c.stations.push(d);c.initialStocks=[];
    c.routes=c.routes.filter(r=>r.id!=='r1');c.routes.push({id:'to-drum',fromId:'source',toId:'drum',materialId:'raw'},{id:'to-a',fromId:'drum',toId:'s1',materialId:'mid'});
    expect(check(c,selection(c,'drum')).issues.some(i=>i.code==='independentProduct'&&i.entityIds.includes('b'))).toBe(true);
  });
  it('checks all quality rows including a later recipe and includes stable IDs and bilingual messages',()=>{
    const c=cyclicLine();c.stations[0]!.plan[1]!.processing.defectProbability=0.25;
    const issue=check(c).issues.find(i=>i.code==='defectRisk')!;expect(issue.path).toBe('dbr.stations["s1"].plan["rowB"].defectProbability');
    expect(issue.entityIds).toEqual(['recipeB','s1']);expect(issue.messages.ru).toContain('s1');expect(issue.messages.en).toContain('s1');
  });
  it('accepts same-material inspection with zero risk as a serial operation',()=>{
    const c=line(),inspector=structuredClone(c.stations[1]!);inspector.id='inspection';inspector.plan[0]!.id='inspect-row';inspector.plan[0]!.recipeId='inspect';
    c.recipes.push({id:'inspect',name:'Inspect',kind:'inspection',inputs:[{materialId:'part',quantity:'1'}],output:{materialId:'part',quantity:'1'}});
    c.stations.push(inspector);c.routes.find(r=>r.id==='r2')!.toId='inspection';c.routes.push({id:'after-inspection',fromId:'inspection',toId:'s2',materialId:'part'});
    expect(check(c,selection(c,'s2')).structurallyValid).toBe(true);
  });
  it('rejects risk on a side branch that does not pass through drum',()=>{
    const c=previewConfig('assembly');c.stations.find(s=>s.id==='work')!.plan[0]!.processing.defectProbability=0.2;
    expect(codes(check(c,selection(c,'prep')))).toContain('defectRisk');
  });
  it('requires outputs and inputs of all rows of a controlled cyclic plan',()=>{
    const c=cyclicLine(),s=selection(c);s.routeIds=s.routeIds.filter(id=>id!=='sellB'&&id!=='rawBRoute');
    const report=check(c,s);expect(codes(report)).toContain('missingOutput');expect(codes(report)).toContain('missingInput');
  });
  it('rejects selected unused routes without silently removing them',()=>{
    const c=independent(),s=selection(c,'prep');s.products=s.products.filter(p=>p.materialId!=='other');
    expect(codes(check(c,s))).toContain('unrelatedRoute');
  });
  it('accepts explicit upstream and side branch lead times, including zero',()=>{
    const c=previewConfig('assembly'),s=selection(c,'prep');s.leadTimes=[{routeIds:['source-prep'],timeMs:0},{routeIds:['source-work','work-assembly'],timeMs:300_000}];
    expect(check(c,s).structurallyValid).toBe(true);
    const shared=commonComponent(),x=selection(shared,'prep');x.leadTimes=[{routeIds:['raw-common','common-prep'],timeMs:0},{routeIds:['raw-common','common-work','work-assembly'],timeMs:1}];
    expect(check(shared,x).structurallyValid).toBe(true);
  });
  it.each([[],['missing'],['r2'],['r1','r3'],['r1','r2','r3'],['r1','r1']].map(routeIds=>({routeIds})))('rejects invalid branch paths $routeIds',({routeIds})=>{
    const c=line();expect(codes(check(c,{...selection(c,'s2'),leadTimes:[{routeIds,timeMs:1}]}))).toContain('leadTimePath');
  });
  it('reports non-text path IDs and non-array overrides as data errors',()=>{
    const c=line();
    expect(codes(check(c,{...selection(c),leadTimes:[{routeIds:[1],timeMs:1}]}))).toContain('value');
    expect(codes(check(c,{...selection(c),leadTimes:{}}))).toContain('shape');
  });
  it('does not lend a drum dependency to another recipe making the same product',()=>{
    const c=line();c.recipes.push({id:'bypass',name:'Bypass',kind:'production',inputs:[{materialId:'raw',quantity:'1'}],output:{materialId:'product',quantity:'1'}});
    c.stations[1]!.plan.push({...structuredClone(c.stations[1]!.plan[0]!),id:'bypass-row',recipeId:'bypass'});
    c.routes.push({id:'bypass-route',fromId:'source',toId:'s2',materialId:'raw'});
    expect(codes(check(c,selection(c,'s1')))).toContain('independentProduct');
  });
  it('rejects paths through drum and duplicated or malformed branch overrides',()=>{
    const c=previewConfig('assembly'),s=selection(c,'prep');s.leadTimes=[{routeIds:['source-prep','prep-assembly'],timeMs:1}];
    expect(codes(check(c,s))).toContain('leadTimePath');
    s.leadTimes=[{routeIds:['source-prep'],timeMs:0},{routeIds:['source-prep'],timeMs:0}];expect(codes(check(c,s))).toContain('duplicate');
    expect(codes(check(c,{...s,leadTimes:[{routeIds:['source-prep'],timeMs:-1},null]}))).toEqual(expect.arrayContaining(['value','shape']));
  });
  it('is stable across entity order, route selection order, names and priorities, without mutations',()=>{
    const c=previewConfig('split'),s=selection(c,'work');const before=JSON.stringify(s),run=compileConfig(c),hash=run.calculationHash;
    const result=validateDbrSelection(run,s);c.stations.reverse();c.recipes.reverse();c.routes.reverse();c.materials.reverse();c.sources.reverse();
    for(const station of c.stations){station.name='<script>not instructions</script>';station.priority=999;}
    s.routeIds.reverse();expect(check(c,s)).toEqual(result);s.routeIds.reverse();expect(JSON.stringify(s)).toBe(before);
    expect(run.calculationHash).toBe(hash);expect(run.source.policy).toBe('push');
    result.issues[0]!.entityIds.push('mutate');expect(validateDbrSelection(run,s).issues).not.toEqual(result.issues);
    expect(()=>JSON.stringify(validateDbrSelection(run,s))).not.toThrow();
  });
  it('does not change push simulation, formats or accept a DBR production policy',()=>{
    const c=line(),run=compileConfig(c),sim=new Simulation(run);sim.advanceTo(150_000);const before=JSON.stringify(sim.getSnapshot());
    validateDbrSelection(run,selection(c));expect(JSON.stringify(sim.getSnapshot())).toBe(before);
    expect(run.engineVersion).toBe('0.34.0');expect(run.schemaVersion).toBe(1);
    expect(()=>compileConfig({...c,policy:'dbr'})).toThrow(ConfigError);
  });
  it('returns concrete bilingual reasons for every reported error',()=>{
    const c=independent(),s={...selection(c,'missing'),bufferMs:-1,routeIds:['bad']};
    for(const issue of check(c,s).issues){expect(issue.path.startsWith('dbr')).toBe(true);expect(issue.messages.en.length).toBeGreaterThan(10);expect(issue.messages.ru.length).toBeGreaterThan(10);}
  });
});
