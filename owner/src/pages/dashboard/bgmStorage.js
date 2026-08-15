const LEGACY_STORAGE_KEY = 'cf_default_video';
const STORAGE_KEY_PREFIX = 'cf_default_video:';

function storageKey(cafeId) {
  return cafeId ? STORAGE_KEY_PREFIX + cafeId : LEGACY_STORAGE_KEY;
}

export function savedToBgmUrl(info) {
  if (!info) return null;
  if (info.url) return info.url;
  if (info.videoId?.startsWith('http')) return info.videoId;
  return `https://www.youtube.com/watch?v=${info.videoId}`;
}

export function readSavedBgm(cafeId, storage = localStorage) {
  try {
    const key = storageKey(cafeId);
    const saved = storage.getItem(key);
    if (saved) return JSON.parse(saved);

    const legacy = cafeId ? storage.getItem(LEGACY_STORAGE_KEY) : null;
    if (!legacy) return null;
    const parsed = JSON.parse(legacy);
    storage.setItem(key, legacy);
    storage.removeItem(LEGACY_STORAGE_KEY);
    return parsed;
  } catch {
    return null;
  }
}

export function saveSavedBgm(cafeId, info, storage = localStorage) {
  storage.setItem(storageKey(cafeId), JSON.stringify(info));
}

export function clearSavedBgm(cafeId, storage = localStorage) {
  storage.removeItem(storageKey(cafeId));
}
