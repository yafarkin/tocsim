import {parseQuantity} from './arithmetic';
import type {RunConfig} from './config';
import {planDrumSchedule} from './dbr-schedule';
import type {DbrSelection} from './dbr-validation';

// Bound the explicit accounting graph, not physical production quantities.
export const MAX_DBR_DEMAND_RECORDS = 300_000;
export const MAX_DBR_DEMAND_LINKS = 1_000_000;
export class DbrDemandLimitError extends Error {
  readonly code = 'limit';
  readonly messages = {
    ru: 'Расчёт потребностей DBR превышает размер реестра. Уменьшите горизонт или число партий.',
    en: 'DBR demand accounting exceeds its record limit. Reduce the horizon or batch count.',
  };
  constructor(readonly resource: 'records' | 'slotLinks') {super('DBR demand accounting limit exceeded.'); this.name = 'DbrDemandLimitError';}
}
/** All quantities are exact integer micro-unit strings, including intermediate totals. */
export interface DbrPlanWork {
  workId: string;
  stationId: string;
  recipeId: string;
  planRowId: string;
  firstBatchOrdinal: string;
  batchCount: string;
  repetitions: string;
  productCycleIndex: number;
  drumSlotId: string | null;
  output: {materialId: string; quantityUnits: string};
  inputs: {materialId: string; quantityUnits: string}[];
  slotIds: string[];
}
export interface DbrRawNeed {
  needId: string;
  productCycleIndex: number;
  sourceId: string;
  toId: string;
  routeId: string;
  materialId: string;
  quantityUnits: string;
  slotIds: string[];
}
export interface DbrAllocation {
  producerId: string;
  /** Null denotes the requested final product, not a station operation. */
  consumerId: string | null;
  productCycleIndex: number;
  routeId: string;
  materialId: string;
  quantityUnits: string;
}
export interface DbrDemandPlan {
  groups: {productCycleIndex: number; allSlotsPresent: boolean; slotIds: string[];
    products: {materialId: string; quantityUnits: string}[]}[];
  works: DbrPlanWork[];
  rawNeeds: DbrRawNeed[];
  allocations: DbrAllocation[];
  remainders: {producerId: string; ownerId: string; materialId: string; quantityUnits: string}[];
}
export interface DbrDemandIssue {
  code: 'drumShortage';
  productCycleIndex: number;
  materialId: string;
  missingUnits: string;
  messages: {ru: string; en: string};
}
type Request = {routeId: string; materialId: string; quantity: bigint; consumerId: string | null};
type Lot = {producerId: string; remaining: bigint};
const ceil = (a: bigint,b: bigint) => (a+b-1n)/b;
const compare = (a:string,b:string) => a<b ? -1 : a>b ? 1 : 0;

/** Pure quantity accounting. It ignores physical initial stock, calendars outside
 * drum, capacity, source timing and RNG. It never authorizes DBR execution.
 * Non-drum work follows a prefix of each station's fixed cyclic plan; no recipe
 * is selected by priority or skipped when another output is wanted.
 */
export function planDbrDemand(run: RunConfig, selection: unknown) {
  const base = planDrumSchedule(run,selection);
  const fail = (demandIssues: DbrDemandIssue[]) => ({...base,demandValid:false,demandIssues,demandPlan:null});
  if (!base.schedule) return fail([]);
  const settings = selection as DbrSelection, schedule = base.schedule;
  const config = run.resolved;
  const stations = new Map(config.stations.map(s=>[s.id,s]));
  const recipes = new Map(config.recipes.map(r=>[r.id,r]));
  const selected = new Set(settings.routeIds);
  const routes = config.routes.filter(r=>selected.has(r.id)).sort((a,b)=>compare(a.id,b.id));
  const inputRoutes = new Map(routes.map(r=>[JSON.stringify([r.toId,r.materialId]),r]));
  const incoming = (owner:string,material:string) => inputRoutes.get(JSON.stringify([owner,material]))!;
  // Reverse topological station order combines all downstream branches before rounding.
  const outgoing = new Map<string, string[]>();
  for (const r of routes) if (stations.has(r.fromId) && stations.has(r.toId)) {
    const next = outgoing.get(r.fromId) ?? []; next.push(r.toId); outgoing.set(r.fromId,next);
  }
  const order:string[] = [], visited = new Set<string>();
  const visit = (id:string) => {
    if (visited.has(id)) return; visited.add(id);
    for (const next of [...new Set(outgoing.get(id) ?? [])].sort(compare)) visit(next);
    order.push(id);
  };
  for (const id of [...stations.keys()].sort(compare)) visit(id);
  const plan:DbrDemandPlan = {groups:[],works:[],rawNeeds:[],allocations:[],remainders:[]};
  const nodes = new Map<string,{slotIds:Set<string>; drumSlotId:string|null}>();
  const stock = new Map<string,{lots:Lot[]; head:number}>(), available = new Map<string,bigint>();
  const key = (owner:string,material:string) => JSON.stringify([owner,material]);
  const cursors = new Map<string,{row:number; batch:number; ordinal:bigint}>();
  let records=0, links=0;
  const record = () => {if (++records>MAX_DBR_DEMAND_RECORDS) throw new DbrDemandLimitError('records');};
  const link = (id:string,slot:string) => {
    const node=nodes.get(id)!;
    // A drum batch is already fixed to its own slot. Downstream group roots
    // must not relabel its individual input kit as belonging to every slot.
    if (node.drumSlotId!==null && node.drumSlotId!==slot) return;
    const set=node.slotIds;
    if (!set.has(slot)) {if (++links>MAX_DBR_DEMAND_LINKS) throw new DbrDemandLimitError('slotLinks'); set.add(slot);}
  };
  const addLot = (owner:string,material:string,producerId:string,quantity:bigint) => {
    const k=key(owner,material), queue=stock.get(k) ?? {lots:[],head:0};
    queue.lots.push({producerId,remaining:quantity}); stock.set(k,queue);
    available.set(k,(available.get(k) ?? 0n)+quantity);
  };
  const byGroup = new Map<number,typeof schedule.slots>();
  for (const slot of schedule.slots) {
    const group=byGroup.get(slot.productCycleIndex) ?? []; group.push(slot); byGroup.set(slot.productCycleIndex,group);
  }
  const drum=stations.get(settings.drumStationId)!;
  const expectedSlots=drum.plan.reduce((sum,row)=>sum+BigInt(row.batches),0n)*BigInt(settings.drumCycles);
  const demandIssues:DbrDemandIssue[]=[];
  for (const [productCycleIndex,slots] of byGroup) {
    record();
    const allSlotsPresent=BigInt(slots.length)===expectedSlots;
    const slotIds=slots.map(s=>s.slotId);
    const products=allSlotsPresent ? [...settings.products].sort((a,b)=>compare(a.materialId,b.materialId)).map(p=>({materialId:p.materialId,quantityUnits:String(parseQuantity(p.quantity))})) : [];
    plan.groups.push({productCycleIndex,allSlotsPresent,slotIds,products});
    const requests=new Map<string,Request[]>();
    const request = (owner:string,materialId:string,quantity:bigint,consumerId:string|null) => {
      const route=incoming(owner,materialId), list=requests.get(route.fromId) ?? [];
      list.push({routeId:route.id,materialId,quantity,consumerId}); requests.set(route.fromId,list);
    };
    const work = (stationId:string,planRowId:string,firstBatchOrdinal:bigint,batchCount:bigint,drumSlotId:string|null) => {
      record();
      const station=stations.get(stationId)!,row=station.plan.find(r=>r.id===planRowId)!,recipe=recipes.get(row.recipeId)!;
      const repetitions=batchCount*BigInt(row.repetitions);
      const workId=JSON.stringify(['work',stationId,firstBatchOrdinal.toString()]);
      const output={materialId:recipe.output.materialId,quantityUnits:String(BigInt(recipe.output.quantity)*repetitions)};
      const inputs=[...recipe.inputs].sort((a,b)=>compare(a.materialId,b.materialId)).map(i=>({materialId:i.materialId,quantityUnits:String(BigInt(i.quantity)*repetitions)}));
      plan.works.push({workId,stationId,recipeId:recipe.id,planRowId,firstBatchOrdinal:String(firstBatchOrdinal),batchCount:String(batchCount),repetitions:String(repetitions),productCycleIndex,drumSlotId,output,inputs,slotIds:[]});
      nodes.set(workId,{slotIds:new Set(),drumSlotId});
      if (drumSlotId!==null) link(workId,drumSlotId);
      addLot(stationId,output.materialId,workId,BigInt(output.quantityUnits));
      for (const input of inputs) request(stationId,input.materialId,BigInt(input.quantityUnits),workId);
      return workId;
    };
    for (const slot of slots) work(drum.id,slot.planRowId,BigInt(slot.ordinal),1n,slot.slotId);
    for (const product of products) request('market',product.materialId,BigInt(product.quantityUnits),null);
    const allocate = (owner:string,list:Request[]) => {
      for (const demand of list) {
        const k=key(owner,demand.materialId),queue=stock.get(k) ?? {lots:[],head:0};
        let needed=demand.quantity;
        // The cursor avoids rescanning or shifting exhausted lots across groups.
        while (needed>0n && queue.head<queue.lots.length) {
          const lot=queue.lots[queue.head]!,taken=needed<lot.remaining ? needed : lot.remaining;
          record(); plan.allocations.push({producerId:lot.producerId,consumerId:demand.consumerId,productCycleIndex,routeId:demand.routeId,materialId:demand.materialId,quantityUnits:String(taken)});
          if (demand.consumerId===null) for (const slotId of slotIds) link(lot.producerId,slotId);
          lot.remaining-=taken; needed-=taken; available.set(k,available.get(k)!-taken);
          if (lot.remaining===0n) queue.head++;
        }
        if (needed>0n) demandIssues.push({code:'drumShortage',productCycleIndex,materialId:demand.materialId,missingUnits:String(needed),messages:{
          ru:`Группа ${productCycleIndex}: выпуска существующих слотов drum недостаточно для материала ${demand.materialId}.`,
          en:`Group ${productCycleIndex}: existing drum slots do not supply enough material ${demand.materialId}.`,
        }});
      }
    };
    for (const id of order) {
      const list=requests.get(id) ?? [];
      if (list.length===0) continue;
      const station=stations.get(id)!;
      const totals=new Map<string,bigint>();
      for (const r of list) totals.set(r.materialId,(totals.get(r.materialId) ?? 0n)+r.quantity);
      if (id!==drum.id) {
        const cursor=cursors.get(id) ?? {row:0,batch:0,ordinal:0n}; cursors.set(id,cursor);
        const missing = () => [...totals].some(([material,q])=>q>(available.get(key(id,material)) ?? 0n));
        while (missing()) {
          const row=station.plan[cursor.row]!,recipe=recipes.get(row.recipeId)!;
          const deficit=(totals.get(recipe.output.materialId) ?? 0n)-(available.get(key(id,recipe.output.materialId)) ?? 0n);
          const batchOutput=BigInt(recipe.output.quantity)*BigInt(row.repetitions);
          // A single-row cycle can be represented by one contiguous batch range.
          const remaining=BigInt(row.batches-cursor.batch);
          const batches=station.plan.length===1 ? ceil(deficit,batchOutput) : deficit>0n ? (ceil(deficit,batchOutput)<remaining ? ceil(deficit,batchOutput) : remaining) : remaining;
          const workId=work(id,row.id,cursor.ordinal,batches,null);
          // Rows producing only a plan byproduct still belong to the triggering group.
          if (deficit<=0n) for (const slotId of slotIds) link(workId,slotId);
          cursor.ordinal+=batches;
          if (station.plan.length===1) cursor.batch=Number((BigInt(cursor.batch)+batches)%BigInt(row.batches));
          else {cursor.batch+=Number(batches);if (cursor.batch===row.batches) {cursor.batch=0;cursor.row=(cursor.row+1)%station.plan.length;}}
        }
      }
      allocate(id,list);
      if (demandIssues.length) return fail(demandIssues);
    }
    for (const source of [...config.sources].sort((a,b)=>compare(a.id,b.id))) {
      const list=requests.get(source.id) ?? [];
      // Keep distinct receiving inputs separate even when they share a source.
      for (const routeId of [...new Set(list.map(r=>r.routeId))].sort(compare)) {
        const demands=list.filter(r=>r.routeId===routeId),route=routes.find(r=>r.id===routeId)!;
        const quantity=demands.reduce((sum,r)=>sum+r.quantity,0n);
        const needId=JSON.stringify(['source',productCycleIndex,routeId]); record();
        plan.rawNeeds.push({needId,productCycleIndex,sourceId:source.id,toId:route.toId,routeId,materialId:source.materialId,quantityUnits:String(quantity),slotIds:[]});
        nodes.set(needId,{slotIds:new Set(),drumSlotId:null}); addLot(source.id,source.materialId,needId,quantity); allocate(source.id,demands);
      }
    }
  }
  // Follow material allocations downstream -> upstream once in DAG order. This
  // also attaches later slots to an earlier batch reused through its remainder.
  const supplies=new Map<string,string[]>();
  for (const allocation of plan.allocations) if (allocation.consumerId!==null) {
    const list=supplies.get(allocation.consumerId) ?? [];list.push(allocation.producerId);supplies.set(allocation.consumerId,list);
  }
  const worksByStation=new Map<string,DbrPlanWork[]>();
  for (const work of plan.works) {const list=worksByStation.get(work.stationId) ?? [];list.push(work);worksByStation.set(work.stationId,list);}
  for (const id of order) for (const work of worksByStation.get(id) ?? []) {
    for (const producer of supplies.get(work.workId) ?? []) for (const slot of nodes.get(work.workId)!.slotIds) link(producer,slot);
  }
  const slotOrder=new Map(schedule.slots.map(s=>[s.slotId,s.ordinal]));
  const slotList = (id:string) => [...nodes.get(id)!.slotIds].sort((a,b)=>slotOrder.get(a)!-slotOrder.get(b)!);
  for (const work of plan.works) work.slotIds=slotList(work.workId);
  for (const need of plan.rawNeeds) need.slotIds=slotList(need.needId);
  for (const [k,queue] of stock) {
    const [ownerId,materialId]=JSON.parse(k) as [string,string];
    for (const lot of queue.lots.slice(queue.head)) if (lot.remaining>0n) plan.remainders.push({producerId:lot.producerId,ownerId,materialId,quantityUnits:String(lot.remaining)});
  }
  return {...base,demandValid:true,demandIssues:[],demandPlan:plan};
}
