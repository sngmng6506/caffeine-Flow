export function savedToBgmUrl(info) {
  if (!info) return null;
  if (info.url) return info.url;
  if (info.videoId?.startsWith('http')) return info.videoId;
  return `https://www.youtube.com/watch?v=${info.videoId}`;
}

export function readSavedBgm() {
  try {
    return JSON.parse(localStorage.getItem('cf_default_video'));
  } catch {
    return null;
  }
}
