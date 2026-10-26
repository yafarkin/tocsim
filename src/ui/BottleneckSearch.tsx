import {useEffect, useRef, useState} from 'react';
import type {RunConfig} from '../engine/config';
import {searchBottleneck} from '../runner/bottleneck-search';
import type {BottleneckResult} from '../runner/bottleneck-search';
import {nameFor} from './i18n';
import type {Labels, Language} from './i18n';
import {quantityText} from './diagram';

export const bottleneckLabels={
  ru:{button:'Поиск узкого места',cancel:'Отменить поиск',running:'Проверочные прогоны',title:'Результат поиска узкого места',
    help:'Поиск отдельно выполняет полный горизонт с начала и уменьшает время обработки каждого поста на 10%. Текущий прогон не меняется. Буферы и остальные условия сохраняются.',
    candidate:'Кандидат по выпуску на этом горизонте',tied:'Найдены равные кандидаты',ambiguous:'Однозначное узкое место не найдено: результаты различаются между seeds или зависят от продукта.',
    noGain:'Ускорение отдельных постов не увеличило выпуск. Возможно совместное ограничение, недостаточная подача или слишком короткий горизонт.',
    limit:'Это проверка влияния на выпуск за заданный горизонт, а не доказательство постоянного ограничения. Меняются только времена обработки, с округлением до 1 мс; наладки и обслуживание прежние.',
    baseline:'Исходник',station:'Ускоренный пост',values:'В ячейках показаны выпуск и изменение относительно парного исходника. При нескольких seeds показан диапазон. Разные продукты сравниваются отдельно. Выпуск учитывает весь горизонт, включая разогрев.',
    paired:'Для случайных времён или брака проверены три парных seeds',single:'Расчёт без случайности, seed',
    error:'Поиск не завершён. Результат не назначен.',detail:'Результаты проверочных прогонов',
  },
  en:{button:'Find bottleneck',cancel:'Cancel search',running:'Trial runs',title:'Bottleneck search result',
    help:'Search runs the full horizon from the beginning separately, reducing processing times at each station by 10%. Your current run is unchanged. Buffers and all other conditions stay fixed.',
    candidate:'Output candidate for this horizon',tied:'Equal candidates found',ambiguous:'No single bottleneck found: results differ across seeds or depend on the product.',
    noGain:'Speeding up individual stations did not increase output. There may be joint constraints, insufficient supply or too short a horizon.',
    limit:'This tests output sensitivity over the configured horizon, not a permanent constraint. Only processing times change, rounded to 1 ms; setups and maintenance stay unchanged.',
    baseline:'Baseline',station:'Faster station',values:'Cells show output and its change from the paired baseline. Multiple seeds show a range. Products are compared separately. Output covers the full horizon, including warmup.',
    paired:'Three paired seeds tested for random processing times or defects',single:'No randomness, seed',
    error:'Search did not complete. No result assigned.',detail:'Trial run results',
  },
} as const;
const signed=(q:bigint)=>`${q>0n ? '+' : q<0n ? '−' : ''}${quantityText(String(q<0n ? -q : q))}`;
function range(values:bigint[],delta=false) {
  const min=values.reduce((a,b)=>a<b?a:b),max=values.reduce((a,b)=>a>b?a:b);
  const format=(q:bigint)=>delta ? signed(q) : quantityText(String(q));
  return min===max ? format(min) : `${format(min)}…${format(max)}`;
}
export function BottleneckResultView({run,result,language,text}:{run:RunConfig;result:BottleneckResult;language:Language;text:Labels}) {
  const t=bottleneckLabels[language];
  const stationName=(id:string)=>nameFor(id,run.source.stations.find(s=>s.id===id)!.name,text);
  return <div className="bottleneck-result"><h3>{t.title}</h3>
    <p role="status">{result.stationIds.length ? `${result.outcome==='tied' ? `${t.tied} (${result.stationIds.length})` : t.candidate}: ${result.stationIds.map(stationName).join(', ')}.` : t[result.outcome==='noGain'?'noGain':'ambiguous']}</p>
    <p className="summary-help">{t.limit}</p>
    <details><summary>{t.detail}</summary><p>{result.samples.length>1?t.paired:t.single}: {result.samples.map(s=>s.seed).join(', ')}.</p>
      <p>{t.values}</p><div className="table-scroll" tabIndex={0} role="region" aria-label={t.detail}><table>
        <thead><tr><th scope="col">{t.station}</th>{result.productIds.map(id=><th scope="col" key={id}>{nameFor(id,run.source.materials.find(m=>m.id===id)!.name,text)}</th>)}</tr></thead>
        <tbody><tr><th scope="row">{t.baseline}</th>{result.productIds.map((id,i)=><td key={id}>{range(result.samples.map(s=>BigInt(s.baseline[i]!)))}</td>)}</tr>
          {result.samples[0]!.outputs.map(row=><tr key={row.stationId} data-search-station={row.stationId} data-candidate={result.stationIds.includes(row.stationId)}>
            <th scope="row">{stationName(row.stationId)}</th>{result.productIds.map((id,i)=><td key={id}>{range(result.samples.map(s=>BigInt(s.outputs.find(r=>r.stationId===row.stationId)!.quantities[i]!)))} ({range(result.samples.map(s=>BigInt(s.outputs.find(r=>r.stationId===row.stationId)!.quantities[i]!)-BigInt(s.baseline[i]!)),true)})</td>)}
          </tr>)}
        </tbody></table></div></details>
  </div>;
}
export function BottleneckSearch({run,language,text,allowed,onResult}:{run:RunConfig;language:Language;text:Labels;allowed:boolean;onResult:(result:BottleneckResult|null)=>void}) {
  const [result,setResult]=useState<BottleneckResult|null>(null),[progress,setProgress]=useState<{done:number;total:number}|null>(null);
  const [error,setError]=useState<{ru:string;en:string}|null>(null);
  const job=useRef<{cancelled:boolean}|null>(null),t=bottleneckLabels[language];
  const cancel=()=>{if(job.current) job.current.cancelled=true;setProgress(null);};
  useEffect(()=>()=>{if(job.current) job.current.cancelled=true;},[]);
  useEffect(()=>{if(!allowed) {if(job.current) job.current.cancelled=true;setProgress(null);}},[allowed]);
  const start=async()=>{
    if (!allowed||progress) return;
    const current={cancelled:false};job.current=current;setError(null);setResult(null);onResult(null);
    try {
      const found=await searchBottleneck(run,{cancelled:()=>current.cancelled,onProgress:(done,total)=>{if(!current.cancelled)setProgress({done,total});}});
      if (!current.cancelled&&found) {setResult(found);onResult(found);}
    } catch(failure) {
      if(!current.cancelled) setError(failure&&typeof failure==='object'&&'messages' in failure ? (failure as {messages:{ru:string;en:string}}).messages : {ru:bottleneckLabels.ru.error,en:bottleneckLabels.en.error});
    } finally {if(!current.cancelled)setProgress(null);}
  };
  return <section className="bottleneck-search" aria-label={t.button}>
    <div className="bottleneck-actions"><button type="button" disabled={!allowed||!!progress} onClick={()=>void start()}>{t.button}</button>
      {progress&&<><button type="button" onClick={cancel}>{t.cancel}</button><span role="status">{t.running}: {progress.done}/{progress.total}</span></>}
    </div><p className="summary-help">{t.help}</p>
    {error&&<p role="alert">{error[language]}</p>}
    {result&&<BottleneckResultView run={run} result={result} language={language} text={text}/>}
  </section>;
}
