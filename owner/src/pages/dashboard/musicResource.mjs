export function detectMusicPlatform(value) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    if (host === 'youtu.be' || host === 'youtube.com' || host.endsWith('.youtube.com')) return 'youtube';
    if (host === 'soundcloud.com' || host.endsWith('.soundcloud.com')) return 'soundcloud';
    if (host === 'spotify.com' || host.endsWith('.spotify.com') || host === 'spotify.link') return 'spotify';
  } catch {}
  return 'youtube';
}

export function defaultToRecommendationPayload(defaultVideo) {
  const url = defaultVideo.url || defaultVideo.videoId;
  return {
    videoId: defaultVideo.videoId || url,
    title: defaultVideo.title,
    channelTitle: defaultVideo.channelTitle || null,
    thumbnail: defaultVideo.thumbnail || null,
    duration: defaultVideo.duration || null,
    platform: defaultVideo.platform || detectMusicPlatform(url),
  };
}

export function recommendationToDefault(rec) {
  const isUrlId = /^https:\/\//i.test(rec.video_id);
  return {
    ...(isUrlId ? { url: rec.video_id } : {}),
    videoId: rec.video_id,
    title: rec.title,
    channelTitle: rec.channel_title || null,
    thumbnail: rec.thumbnail || null,
    duration: rec.duration || null,
    platform: rec.platform || detectMusicPlatform(rec.video_id),
  };
}

export function metadataToDefault(data, fallbackUrl) {
  return {
    url: fallbackUrl,
    videoId: data.videoId || fallbackUrl,
    title: data.title || fallbackUrl,
    channelTitle: data.channelTitle || null,
    thumbnail: data.thumbnail || null,
    duration: data.duration || null,
    platform: data.platform || detectMusicPlatform(fallbackUrl),
  };
}
