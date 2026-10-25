import {expect,it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {compileConfig,ConfigError} from '../engine/config';
import {previewConfig} from './preview';
import {warmupFromMinutes,WarmupPanel} from './WarmupPanel';
import {labels} from './i18n';
import {flowRatioText} from './metric-format';
it('converts zero, comma, leading dot, exact milliseconds and the horizon without rounding',()=>{
  expect(warmupFromMinutes('0',60000)).toBe(0);expect(warmupFromMinutes(' 0,5 ',60000)).toBe(30000);
  expect(warmupFromMinutes('.5',60000)).toBe(30000);expect(warmupFromMinutes('0.00005',60000)).toBe(3);expect(warmupFromMinutes('1',60000)).toBe(60000);
});
it.each(['','-1','-0','1.000001','0.000001','Infinity','9007199254740991','0.0000001','one','1e-3','0;alert(1)'])('rejects invalid or inexact warmup %j',value=>{
  expect(()=>warmupFromMinutes(value,60000)).toThrow(ConfigError);
});
it.each(['ru','en'] as const)('renders a locked warmup setting and applied value in %s',language=>{
  const c=previewConfig();c.warmupMs=60000;const run=compileConfig(c),text=labels(language);
  const html=renderToStaticMarkup(<WarmupPanel run={run} locked text={text} language={language} onApply={()=>{}}/>);
  expect(html).toContain(text.warmupHelp);expect(html).toContain(text.warmupMinutes);expect(html).toContain(text.warmupApply);
  expect(html).toContain('fieldset class="batch-settings" disabled=""');expect(html).toContain('data-applied-warmup="60000"');expect(html).toContain('0:01:00');
});
it('formats signed and tiny exact flow ratios without dropping a nonzero difference',()=>{
  expect(flowRatioText({numerator:'1',denominator:'3'},'none')).toBe('≈ 0.333333');
  expect(flowRatioText({numerator:'-1',denominator:'3'},'none')).toBe('≈ −0.333333');
  expect(flowRatioText({numerator:'1',denominator:'1000000000000'},'none')).toBe('< 0.000001');
  expect(flowRatioText({numerator:'-1',denominator:'1000000000000'},'none')).toBe('> −0.000001; < 0');
  expect(flowRatioText({numerator:'0',denominator:'1'},'none')).toBe('0');expect(flowRatioText(null,'none')).toBe('none');
  expect(flowRatioText({numerator:'2000000',denominator:'150000'},'none',60000n,1000000n)).toBe('0.8');
});
