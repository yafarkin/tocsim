import {describe, expect, it} from 'vitest';
import {createLinearProcess} from './linear-process';
import {openProcessStorage, PROCESS_STORAGE_PREFIX as prefix} from './process-storage';

function fixture() {
  const data = new Map<string, string>();
  const storage = {
    get length() { return data.size; },
    key: (index: number) => [...data.keys()][index] ?? null,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
  };
  return {data, storage, open: () => openProcessStorage(() => storage)};
}

describe('process storage', () => {
  it('rereads one conflict without discarding other memory-only processes', () => {
    const f = fixture(), store = f.open(); store.save('a', createLinearProcess('a'), 0);
    const config = createLinearProcess('b'), write = f.storage.setItem;
    f.storage.setItem = () => {throw new Error('Quota');};
    store.save('b', config, 0); f.storage.setItem = write;
    f.open().save('a', {...createLinearProcess('a'), name: 'Remote'}, 1);
    const result = store.read('a');
    expect(result.entry?.record).toMatchObject({revision: 2, config: {name: 'Remote'}});
    result.entry!.record.config.name = 'Changed';
    expect(store.list().find(entry => entry.record.id === 'a')!.record.config.name).toBe('Remote');
    expect(store.list().find(entry => entry.record.id === 'b')).toMatchObject({persisted: false, record: {config}});
  });
  it('preserves the local draft after a failed reread and handles a deleted record', () => {
    const f = fixture(), store = f.open(); store.save('a', createLinearProcess('a'), 0);
    const before = store.list(), read = f.storage.getItem;
    f.storage.getItem = () => {throw new Error('Denied');};
    expect(store.read('a').issue!.code).toBe('unavailable'); expect(store.list()).toEqual(before);
    f.storage.getItem = read; f.data.set(prefix + 'a', '{broken');
    expect(store.read('a').issue!.code).toBe('invalid'); expect(store.list()).toEqual(before);
    f.data.delete(prefix + 'a'); expect(store.read('a')).toEqual({entry: null, issue: null});
    expect(store.list()).toEqual([]);
  });
  it('restores several named configurations and revisions, including duplicate names', () => {
    const f = fixture(), store = f.open();
    const a = createLinearProcess('config-a'), b = createLinearProcess('config-b');
    b.seed = 123; b.stations[0]!.plan[0]!.processing.cv = 0.5;
    expect(store.save('a', a, 0).persisted).toBe(true);
    expect(store.save('b', b, 0).persisted).toBe(true);
    a.name = 'Updated';
    expect(store.save('a', a, 1).persisted).toBe(true);
    const reopened = f.open().list();
    expect(reopened.map(entry => entry.record.config)).toEqual([a, b]);
    expect(reopened.map(entry => entry.record.revision)).toEqual([2, 1]);
    expect(reopened.every(entry => entry.persisted)).toBe(true);
    expect(reopened.every(entry => Number.isFinite(Date.parse(entry.record.updatedAt)))).toBe(true);
    expect([...f.data.keys()]).toEqual([prefix + 'a', prefix + 'b']);
  });

  it('keeps input and returned configurations independent of the library', () => {
    const f = fixture(), store = f.open(), config = createLinearProcess('config');
    store.save('a', config, 0);
    config.stations[0]!.name = 'Changed';
    store.list()[0]!.record.config.name = 'Changed';
    expect(store.list()[0]!.record.config).toEqual(createLinearProcess('config'));
    expect(f.open().list()).toEqual(store.list());
  });

  it('removes only the selected record and preserves unrelated keys', () => {
    const f = fixture(), store = f.open();
    f.data.set('toc.uiMode', 'expert'); f.data.set('other', 'keep');
    store.save('a', createLinearProcess('a'), 0);
    store.save('b', createLinearProcess('b'), 0);
    expect(store.remove('a', 1)).toEqual({persisted: true, issue: null});
    expect(f.open().list().map(entry => entry.record.id)).toEqual(['b']);
    expect(f.data.get('toc.uiMode')).toBe('expert'); expect(f.data.get('other')).toBe('keep');
  });

  it('continues in memory when access itself throws', () => {
    const store = openProcessStorage(() => { throw new Error('Denied'); });
    expect(store.issues()[0]!.code).toBe('unavailable');
    const result = store.save('a', createLinearProcess('a'), 0);
    expect(result.persisted).toBe(false);
    expect(result.issue!.ru).toContain('памяти'); expect(result.issue!.en).toContain('tab');
    expect(store.list()[0]!.record.revision).toBe(0);
    expect(store.list()[0]!.persisted).toBe(false);
    expect(store.remove('a', 0).persisted).toBe(false);
    expect(store.list()).toEqual([]);
  });

  it('retains a draft on quota failure and can retry without a false revision conflict', () => {
    const f = fixture(), store = f.open(), config = createLinearProcess('a');
    store.save('a', config, 0);
    const original = f.data.get(prefix + 'a'), write = f.storage.setItem;
    f.storage.setItem = () => { throw new Error('QuotaExceededError'); };
    config.name = 'Draft';
    expect(store.save('a', config, 1).issue!.code).toBe('unavailable');
    expect(f.data.get(prefix + 'a')).toBe(original);
    expect(store.list()[0]).toMatchObject({persisted: false, record: {revision: 1, config: {name: 'Draft'}}});
    f.storage.setItem = write;
    expect(store.save('a', store.list()[0]!.record.config, 1).persisted).toBe(true);
    expect(f.open().list()[0]!.record.revision).toBe(2);
  });

  it('does not write when rereading fails and retains a draft', () => {
    const f = fixture(), store = f.open();
    f.storage.getItem = () => { throw new Error('Read denied'); };
    expect(store.save('a', createLinearProcess('a'), 0).issue!.code).toBe('unavailable');
    expect(f.data.size).toBe(0); expect(store.list()).toHaveLength(1);
  });

  it('keeps remaining records readable after an individual read failure', () => {
    const f = fixture(), store = f.open();
    store.save('a', createLinearProcess('a'), 0); store.save('b', createLinearProcess('b'), 0);
    const read = f.storage.getItem;
    f.storage.getItem = key => { if (key === prefix + 'a') throw new Error('Read denied'); return read(key); };
    const reopened = f.open();
    expect(reopened.list().map(entry => entry.record.id)).toEqual(['b']);
    expect(reopened.issues()[0]).toMatchObject({key: prefix + 'a', code: 'unavailable'});
  });

  it.each(['{broken', 'null', JSON.stringify({schemaVersion: 99}),
    JSON.stringify({schemaVersion: 1, id: 'bad', revision: 0, updatedAt: 'bad', config: {}})])(
    'preserves an unreadable record while opening and saving other processes: %s', raw => {
      const f = fixture(); f.data.set(prefix + 'bad', raw);
      const store = f.open();
      expect(store.issues()).toHaveLength(1);
      expect(store.save('good', createLinearProcess('good'), 0).persisted).toBe(true);
      expect(store.save('bad', createLinearProcess('bad'), 0).persisted).toBe(false);
      expect(store.remove('bad', 0).persisted).toBe(false);
      expect(f.data.get(prefix + 'bad')).toBe(raw);
      expect(f.open().list().map(entry => entry.record.id)).toEqual(['good']);
    });

  it.each(['id', 'revision', 'updatedAt', 'config'] as const)('rejects invalid persisted %s', field => {
    const f = fixture(); f.open().save('a', createLinearProcess('a'), 0);
    const record = JSON.parse(f.data.get(prefix + 'a')!);
    record[field] = field === 'revision' ? 1.5 : field === 'config' ? createLinearProcess('x') : 'wrong';
    if (field === 'config') record.config.stations[0].setupMs = 1;
    f.data.set(prefix + 'a', JSON.stringify(record));
    expect(f.open().issues()[0]!.code).toBe('invalid');
    expect(f.open().list()).toEqual([]);
  });

  it('rejects stale updates and deletions while keeping the unsaved local configuration', () => {
    const f = fixture(), first = f.open(); first.save('a', createLinearProcess('a'), 0);
    const second = f.open(), local = second.list()[0]!.record.config;
    first.save('a', {...local, name: 'Remote'}, 1);
    local.name = 'Local';
    expect(second.save('a', local, 1).issue!.code).toBe('conflict');
    expect(second.list()[0]!.record.config.name).toBe('Local');
    expect(second.remove('a', 1).issue!.code).toBe('conflict');
    expect(f.open().list()[0]!.record.config.name).toBe('Remote');
    expect(second.save('copy', {...local, id: 'copy'}, 0).persisted).toBe(true);
    expect(f.open().list()).toHaveLength(2);
  });

  it('detects creation collisions and records removed by another instance', () => {
    const f = fixture(), store = f.open(), config = createLinearProcess('a');
    store.save('a', config, 0);
    expect(f.open().save('a', config, 0).issue!.code).toBe('conflict');
    f.data.delete(prefix + 'a');
    expect(store.save('a', config, 1).issue!.code).toBe('conflict');
    expect(store.remove('a', 1).issue!.code).toBe('conflict');
  });

  it('reports failed deletion and leaves persisted data intact', () => {
    const f = fixture(), store = f.open(); store.save('a', createLinearProcess('a'), 0);
    f.storage.removeItem = () => { throw new Error('Denied'); };
    expect(store.remove('a', 1).issue!.code).toBe('unavailable');
    expect(store.list()).toEqual([]); expect(f.open().list()).toHaveLength(1);
  });

  it('rejects unsupported configurations before changing memory or storage', () => {
    const f = fixture(), store = f.open(), config = createLinearProcess('a');
    config.stations[0]!.setupMs = 1;
    expect(() => store.save('a', config, 0)).toThrow();
    expect(store.list()).toEqual([]); expect(f.data.size).toBe(0);
    expect(() => store.save('', createLinearProcess('a'), 0)).toThrow();
    expect(() => store.remove('a', -1)).toThrow();
  });
});
