#!/usr/bin/env node
import {readFile} from 'node:fs/promises';
import {runSimulationJson} from './run.js';
import type {EngineRunResponse} from './run.js';

function failure(code: 'usage' | 'io', ru: string, en: string): EngineRunResponse {
  return {ok: false, error: {code, path: null, objectId: null, messages: {ru, en}}};
}

async function readStdin(): Promise<string> {
  process.stdin.setEncoding('utf8');
  let source = '';
  for await (const chunk of process.stdin) source += chunk;
  return source;
}

const args = process.argv.slice(2);
let response: EngineRunResponse;
if (args.length > 1) {
  response = failure('usage', 'Использование: toc-engine [input.json|-].', 'Usage: toc-engine [input.json|-].');
} else {
  try {
    const source = args[0] === undefined || args[0] === '-'
      ? await readStdin()
      : await readFile(args[0], 'utf8');
    response = runSimulationJson(source);
  } catch {
    response = failure('io', 'Не удалось прочитать входной JSON.', 'Unable to read the input JSON.');
  }
}
process.stdout.write(`${JSON.stringify(response, null, 2)}\n`);
if (!response.ok) process.exitCode = 1;
