import {elapsedTime} from './calendar';
import type {WorkCalendar} from './calendar';
import type {ProcessingOrigin, StockOrigin, StockState} from './state';

/** Current physical quantity, not a time average or completed output. */
export interface AgeSummary {
  knownQuantity: string;
  notStartedQuantity: string;
  unknownQuantity: string;
  calendarQuantityMs: string;
  workQuantityMs: string;
  meanCalendarMs: number | null;
  meanWorkMs: number | null;
}
export interface MaterialAge {
  materialId: string;
  quantity: string;
  admission: AgeSummary;
  firstProcessing: AgeSummary;
}
export interface PlaceAge extends MaterialAge {
  ownerId: string;
  location: Exclude<StockState['location'], 'warehouse'>;
}
export interface StockAge {materials: MaterialAge[]; places: PlaceAge[]}
interface Total {knownQuantity: bigint; notStartedQuantity: bigint; unknownQuantity: bigint; calendarQuantityMs: bigint; workQuantityMs: bigint}
interface Row {quantity: bigint; admission: Total; firstProcessing: Total}
const total = (): Total => ({knownQuantity: 0n, notStartedQuantity: 0n, unknownQuantity: 0n, calendarQuantityMs: 0n, workQuantityMs: 0n});
const row = (): Row => ({quantity: 0n, admission: total(), firstProcessing: total()});
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
function summarize(t: Total): AgeSummary {
  return {knownQuantity: String(t.knownQuantity), notStartedQuantity: String(t.notStartedQuantity), unknownQuantity: String(t.unknownQuantity),
    calendarQuantityMs: String(t.calendarQuantityMs), workQuantityMs: String(t.workQuantityMs),
    meanCalendarMs: t.knownQuantity ? Number(t.calendarQuantityMs) / Number(t.knownQuantity) : null,
    meanWorkMs: t.knownQuantity ? Number(t.workQuantityMs) / Number(t.knownQuantity) : null};
}
function summarizeRow(r: Row) {return {quantity: String(r.quantity), admission: summarize(r.admission), firstProcessing: summarize(r.firstProcessing)};}
function age(start: StockOrigin | ProcessingOrigin, quantity: bigint, calendar: WorkCalendar, timeMs: number): Total {
  const t = total();
  if (start.kind === 'known') {
    const duration = elapsedTime(calendar, start.startedAtMs, timeMs);
    t.knownQuantity = quantity;
    t.calendarQuantityMs = quantity * BigInt(duration.calendarMs); t.workQuantityMs = quantity * BigInt(duration.workMs);
  } else if (start.kind === 'notStarted') t.notStartedQuantity = quantity;
  else t.unknownQuantity = quantity;
  return t;
}
function add(target: Total, value: Total) {
  target.knownQuantity += value.knownQuantity; target.notStartedQuantity += value.notStartedQuantity; target.unknownQuantity += value.unknownQuantity;
  target.calendarQuantityMs += value.calendarQuantityMs; target.workQuantityMs += value.workQuantityMs;
}
/** Read only physical lots and beginnings. Quality, costs and future recipe outputs are deliberately absent. */
export function stockAge(stocks: readonly {ownerId: string; materialId: string; location: StockState['location']; quantity: number;
  provenance: {origin: StockOrigin; firstProcessing: ProcessingOrigin}}[], materialIds: readonly string[], calendar: WorkCalendar, timeMs: number): StockAge {
  const materials = new Map(materialIds.map(id => [id, row()]));
  const places = new Map<string, {ownerId: string; materialId: string; location: PlaceAge['location']; value: Row}>();
  for (const stock of stocks) {
    if (stock.location === 'warehouse' || stock.quantity === 0) continue;
    const key = JSON.stringify([stock.ownerId, stock.materialId, stock.location]);
    let place = places.get(key);
    if (!place) {place = {ownerId: stock.ownerId, materialId: stock.materialId, location: stock.location, value: row()}; places.set(key, place);}
    const quantity = BigInt(stock.quantity);
    const admission = age(stock.provenance.origin, quantity, calendar, timeMs);
    const firstProcessing = age(stock.provenance.firstProcessing, quantity, calendar, timeMs);
    for (const r of [materials.get(stock.materialId)!, place.value]) {
      r.quantity += quantity; add(r.admission, admission); add(r.firstProcessing, firstProcessing);
    }
  }
  return {
    materials: [...materials].sort(([a], [b]) => compare(a,b)).map(([materialId, value]) => ({materialId, ...summarizeRow(value)})),
    places: [...places.values()].sort((a,b) => compare(a.ownerId,b.ownerId) || compare(a.materialId,b.materialId) || compare(a.location,b.location))
      .map(({value, ...place}) => ({...place, ...summarizeRow(value)})),
  };
}
