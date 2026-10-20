import { describe, expect, it } from 'vitest';
import { observeTheme, readTheme, saveTheme, THEME_STORAGE_KEY } from './theme';

describe('optional versioned theme preference', () => {
  it('restores all choices from the exact saved record', () => {
    let stored: string | null = null;
    for (const preference of ['system', 'dark', 'light'] as const) {
      saveTheme(preference, () => ({setItem: (key, value) => {expect(key).toBe(THEME_STORAGE_KEY); stored = value;}}));
      expect(JSON.parse(stored!)).toEqual({schemaVersion: 1, preference});
      expect(readTheme(() => ({getItem: () => stored}))).toBe(preference);
    }
  });
  it.each([null, '{', 'null', '"dark"', '{"schemaVersion":2,"preference":"dark"}', '{"schemaVersion":1,"preference":"invalid"}'])('falls back safely for %s', record => {
    expect(readTheme(() => ({getItem: () => record}))).toBe('system');
  });
  it('works when getting storage or reading/writing throws', () => {
    const denied = () => {throw new Error('Storage unavailable');};
    expect(readTheme(denied)).toBe('system');
    expect(readTheme(() => ({getItem: denied}))).toBe('system');
    expect(() => saveTheme('dark', denied)).not.toThrow();
    expect(() => saveTheme('light', () => ({setItem: denied}))).not.toThrow();
  });
});

describe('system appearance', () => {
  it('follows system changes and removes its listener when the selection changes', () => {
    let listener: (() => void) | null = null;
    const media = {matches: false, addEventListener: (_type: string, callback: () => void) => {listener = callback;}, removeEventListener: (_type: string, callback: () => void) => {expect(callback).toBe(listener); listener = null;}};
    const applied: string[] = [];
    const dispose = observeTheme('system', media, theme => applied.push(theme));
    expect(applied).toEqual(['light']);
    media.matches = true; listener!(); expect(applied).toEqual(['light', 'dark']);
    dispose(); expect(listener).toBeNull();
    observeTheme('light', media, theme => applied.push(theme));
    expect(applied.at(-1)).toBe('light'); expect(listener).toBeNull();
    media.matches = false;
    observeTheme('dark', media, theme => applied.push(theme));
    expect(applied.at(-1)).toBe('dark'); expect(listener).toBeNull();
  });
});
