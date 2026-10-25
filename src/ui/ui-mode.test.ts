import {describe, expect, it} from 'vitest';
import {readUiMode, saveUiMode, UI_MODE_STORAGE_KEY} from './ui-mode';

describe('optional UI mode preference', () => {
  it('round trips only a versioned viewing preference', () => {
    for (const mode of ['simple', 'expert'] as const) {
      let stored = '';
      saveUiMode(mode, () => ({setItem: (key, value) => {
        expect(key).toBe(UI_MODE_STORAGE_KEY); stored = value;
      }}));
      expect(JSON.parse(stored)).toEqual({schemaVersion: 1, mode});
      expect(readUiMode(() => ({getItem: key => {
        expect(key).toBe(UI_MODE_STORAGE_KEY); return stored;
      }}))).toBe(mode);
    }
  });
  it.each([null, '{', 'null', '[]', '"expert"', 'true', '7',
    '{"mode":"expert"}', '{"schemaVersion":0,"mode":"expert"}',
    '{"schemaVersion":2,"mode":"expert"}', '{"schemaVersion":"1","mode":"expert"}',
    '{"schemaVersion":1,"mode":"invalid"}', '{"schemaVersion":1,"mode":null}',
    '{"schemaVersion":1,"mode":{"toString":"expert"}}',
  ])('uses simple mode for absent, damaged or unsupported data: %s', record => {
    expect(readUiMode(() => ({getItem: () => record}))).toBe('simple');
  });
  it('keeps working when acquiring, reading or writing storage fails', () => {
    const denied = () => {throw new Error('Storage unavailable');};
    expect(readUiMode(denied)).toBe('simple');
    expect(readUiMode(() => ({getItem: denied}))).toBe('simple');
    expect(() => saveUiMode('expert', denied)).not.toThrow();
    expect(() => saveUiMode('simple', () => ({setItem: denied}))).not.toThrow();
  });
  it('never persists unrelated data from a previously read record', () => {
    const record = '{"schemaVersion":1,"mode":"expert","seed":5,"history":[1,2]}';
    let saved = '';
    saveUiMode(readUiMode(() => ({getItem: () => record})), () => ({setItem: (_key, value) => {saved = value;}}));
    expect(JSON.parse(saved)).toEqual({schemaVersion: 1, mode: 'expert'});
  });
});
