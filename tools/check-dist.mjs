import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const directory = resolve(process.argv[2] ?? 'dist');
const files = await readdir(directory);
if (files.length !== 1 || files[0] !== 'index.html') {
  throw new Error('Standalone build must contain only index.html');
}
const html = await readFile(resolve(directory, 'index.html'), 'utf8');
if (html.includes('mode-check-result') || html.includes('Injected regression failure')) {
  throw new Error('Development regression page must not be included in standalone HTML');
}
if (!/<!doctype html>/i.test(html)) throw new Error('Missing HTML document');
let scripts = 0, styles = 0;
const markup = html.replace(/<script\b([^>]*)>[\s\S]*?<\/script\s*>/gi, (_match, attributes) => {
  scripts++;
  if (/\bsrc\s*=/i.test(attributes)) throw new Error('External script in standalone HTML');
  return '';
}).replace(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi, (_match, css) => {
  styles++;
  if (/@import\b/i.test(css)) throw new Error('CSS import in standalone HTML');
  return '';
});
if (!scripts || !styles) throw new Error('Expected inline JavaScript and CSS');
if (/<link\b[^>]*\brel\s*=\s*["']?(?:stylesheet|modulepreload)\b/i.test(markup)) {
  throw new Error('External CSS or module preload in standalone HTML');
}
const bytes = Buffer.byteLength(html), sha256 = createHash('sha256').update(html).digest('hex');
console.log(`Standalone HTML verified: ${bytes} bytes, SHA-256 ${sha256}`);
