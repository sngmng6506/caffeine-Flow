import { describe, expect, it } from 'vitest';
import {
  clearSavedBgm,
  readSavedBgm,
  saveSavedBgm,
} from '../../owner/src/pages/dashboard/bgmStorage.js';

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    storage: {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: key => values.delete(key),
    },
  };
}

describe('owner 기본 BGM 저장', () => {
  it('카페 ID별로 기본 BGM을 분리해 저장한다', () => {
    const { values, storage } = createStorage();
    const first = { videoId: 'first-video' };
    const second = { videoId: 'second-video' };

    saveSavedBgm('cafe-a', first, storage);
    saveSavedBgm('cafe-b', second, storage);

    expect(readSavedBgm('cafe-a', storage)).toEqual(first);
    expect(readSavedBgm('cafe-b', storage)).toEqual(second);
    clearSavedBgm('cafe-a', storage);
    expect(readSavedBgm('cafe-a', storage)).toBeNull();
    expect(values.has('cf_default_video:cafe-b')).toBe(true);
  });

  it('기존 전역 기본 BGM을 현재 카페 저장소로 한 번 이전한다', () => {
    const legacy = JSON.stringify({ videoId: 'legacy-video' });
    const { values, storage } = createStorage({ cf_default_video: legacy });

    expect(readSavedBgm('cafe-id', storage)).toEqual({ videoId: 'legacy-video' });
    expect(values.get('cf_default_video:cafe-id')).toBe(legacy);
    expect(values.has('cf_default_video')).toBe(false);
  });
});
