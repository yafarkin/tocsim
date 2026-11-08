import {readdirSync, readFileSync} from 'node:fs';
import {basename, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';

const root = fileURLToPath(new URL('./contract/', import.meta.url));
function files(directory = root): string[] {
  return readdirSync(directory, {withFileTypes: true}).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path) : entry.name.endsWith('.ts') && entry.name !== 'index.ts' ? [path] : [];
  });
}

describe('public DTO source contract', () => {
  it('keeps one named DTO per file with a matching filename and TSDoc', () => {
    const sources = files();
    expect(sources.length).toBeGreaterThan(70);
    for (const path of sources) {
      const text = readFileSync(path, 'utf8');
      const entities = [...text.matchAll(/export (?:interface|type) ([A-Za-z0-9_]+)/g)];
      expect(entities, path).toHaveLength(1);
      expect(entities[0]![1], path).toBe(basename(path, '.ts'));
      expect(text, path).toMatch(/\/\*\*[\s\S]+\*\//);
    }
  });

  it('documents every interface property next to its declaration', () => {
    for (const path of files()) {
      const lines = readFileSync(path, 'utf8').split('\n');
      for (let index = 1; index < lines.length; index++) {
        if (!/^\s{2}(?:readonly )?[A-Za-z_$][\w$]*\??\s*:/.test(lines[index]!)) continue;
        expect(`${lines[index - 1]}${lines[index]}`, `${path}:${index + 1}`).toContain('/**');
      }
    }
  });
});
