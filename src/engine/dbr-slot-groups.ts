import type {RunConfig} from './config';
import {planDbrDemand} from './dbr-demand';
import type {DbrSelection} from './dbr-validation';

export interface DbrSlotGroupIssue {
  code: 'slotGroupLimit';
  slotIds: string[];
  requiredOpenSlots: number;
  maxOpenSlots: number;
  messages: {ru: string; en: string};
}

/** Checks the existing demand plan's conservative links, not physical execution. */
export function planDbrSlotGroups(run: RunConfig, selection: unknown) {
  const base=planDbrDemand(run,selection);
  if (!base.demandPlan || !base.schedule) return {
    ...base,slotGroupsValid:false,slotGroups:null,slotGroupIssues:[] as DbrSlotGroupIssue[],
  };
  const slots=base.schedule.slots, index=new Map(slots.map((s,i)=>[s.slotId,i]));
  const parents=slots.map((_,i)=>i), sizes=slots.map(()=>1);
  const root=(i:number):number => {
    while (parents[i]!==i) {parents[i]=parents[parents[i]!]!;i=parents[i]!;}
    return i;
  };
  const connect=(ids:readonly string[]) => {
    if (!ids.length) return;
    let a=root(index.get(ids[0]!)!);
    for (const id of ids.slice(1)) {
      let b=root(index.get(id)!);
      if (a===b) continue;
      if (sizes[a]!<sizes[b]!) [a,b]=[b,a];
      parents[b]=a;sizes[a]=sizes[a]!+sizes[b]!;
    }
  };
  for (const work of base.demandPlan.works) connect(work.slotIds);
  for (const need of base.demandPlan.rawNeeds) connect(need.slotIds);
  const components=new Map<number,string[]>();
  slots.forEach((slot,i)=>{const r=root(i),ids=components.get(r) ?? [];ids.push(slot.slotId);components.set(r,ids);});
  const groups=[...components.values()].map(slotIds=>({slotIds}));
  const minimumOpenSlots=groups.reduce((max,g)=>Math.max(max,g.slotIds.length),0);
  const maxOpenSlots=(selection as DbrSelection).maxOpenSlots;
  const slotGroupIssues:DbrSlotGroupIssue[]=groups.filter(g=>g.slotIds.length>maxOpenSlots).map(g=>({
    code:'slotGroupLimit',slotIds:[...g.slotIds],requiredOpenSlots:g.slotIds.length,maxOpenSlots,
    messages:{ru:`Для связанной группы заданий нужен лимит минимум ${g.slotIds.length}; задан ${maxOpenSlots}.`,
      en:`This linked slot group needs a limit of at least ${g.slotIds.length}; the configured limit is ${maxOpenSlots}.`},
  }));
  return {...base,slotGroupsValid:slotGroupIssues.length===0,slotGroups:{groups,minimumOpenSlots},slotGroupIssues,
    pendingChecks:slotGroupIssues.length===0 ? base.pendingChecks.filter(check=>check!=='slotGroups') : base.pendingChecks};
}
