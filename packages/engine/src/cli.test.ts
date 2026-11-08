import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {runSimulation} from './run.js';
import {line} from './test-fixtures.js';
import type {EngineRunResponse} from './run.js';

const cliPath = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'toc-engine-'));
});

afterEach(async () => {
  await rm(directory, {recursive: true, force: true});
});

function run(args: string[], input?: string) {
  const completed = spawnSync(process.execPath, [cliPath, ...args], {encoding: 'utf8', input, maxBuffer: 64 * 1024 * 1024});
  expect(completed.error).toBeUndefined();
  return {...completed, response: JSON.parse(completed.stdout) as EngineRunResponse};
}

describe('toc-engine CLI', () => {
  it('runs a JSON file through the same built engine as the public API', async () => {
    const input = join(directory, 'input.json');
    await writeFile(input, JSON.stringify(line()));
    const completed = run([input]);

    expect(completed.status).toBe(0);
    expect(completed.stderr).toBe('');
    expect(completed.response).toEqual({ok: true, result: runSimulation(line())});
    if (!completed.response.ok) throw new Error('Expected a completed run.');
    expect(completed.response.result.snapshot.line!.termination).toBe('horizon');
  });

  it('reads stdin and produces byte-equivalent JSON to file input', async () => {
    const json = JSON.stringify(line());
    const input = join(directory, 'input.json');
    await writeFile(input, json);
    const fromFile = run([input]);
    const fromStdin = run(['-'], json);
    const fromImplicitStdin = run([], json);

    expect(fromStdin.status).toBe(0);
    expect(fromStdin.stdout).toBe(fromFile.stdout);
    expect(fromImplicitStdin.stdout).toBe(fromFile.stdout);
  });

  it('reports malformed JSON without a stack trace', () => {
    const completed = run([], '{broken');
    expect(completed.status).toBe(1);
    expect(completed.response).toEqual({ok: false, error: {
      code: 'json', path: null, objectId: null,
      messages: {ru: 'Входные данные не являются корректным JSON.', en: 'Input is not valid JSON.'},
    }});
    expect(completed.stdout).not.toContain('stack');
  });

  it('uses the public configuration error and a failing exit code', async () => {
    const input = line();
    input.stations = [];
    const path = join(directory, 'invalid.json');
    await writeFile(path, JSON.stringify(input));
    const completed = run([path]);

    expect(completed.status).toBe(1);
    if (completed.response.ok) throw new Error('Expected a rejected run.');
    expect(completed.response.error.code).toBe('reference');
    expect(completed.response.error.messages.en).toBeTruthy();
  });

  it('reports file and usage failures as JSON', () => {
    const missing = run([join(directory, 'missing.json')]);
    const usage = run(['a.json', 'b.json']);

    expect(missing.status).toBe(1);
    expect(missing.response).toMatchObject({ok: false, error: {code: 'io'}});
    expect(usage.status).toBe(1);
    expect(usage.response).toMatchObject({ok: false, error: {code: 'usage'}});
  });
});
