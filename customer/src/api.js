const BASE = '/api/v1';

async function apiFetch(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(data.error || '요청 실패');
  return data;
}

export const getRecommendations = (slug) =>
  apiFetch('GET', `/cafes/${slug}/recommendations`);

export const postRecommendation = (slug, body) =>
  apiFetch('POST', `/cafes/${slug}/recommendations`, body);

export const vote = (slug, id) =>
  apiFetch('POST', `/cafes/${slug}/recommendations/${id}/vote`);

export const postComment = (slug, id, body) =>
  apiFetch('POST', `/cafes/${slug}/recommendations/${id}/comments`, body);

export const getOembed = (url) =>
  apiFetch('GET', `/youtube/oembed?url=${encodeURIComponent(url)}`);

export const getCafeTop10 = (slug) =>
  apiFetch('GET', `/cafes/${slug}/recommendations/top10`);

export const getGlobalTop10 = () =>
  apiFetch('GET', `/top10`);

export const getSongComments = (videoId) =>
  apiFetch('GET', `/songs/${videoId}/comments`);

export const postSongComment = (videoId, slug = null, body) =>
  slug
    ? apiFetch('POST', `/cafes/${slug}/songs/${videoId}/comments`, body)
    : apiFetch('POST', `/songs/${videoId}/comments`, body);

export const postSongReply = (videoId, commentId, slug = null, body) =>
  slug
    ? apiFetch('POST', `/cafes/${slug}/songs/${videoId}/comments/${commentId}/replies`, body)
    : apiFetch('POST', `/songs/${videoId}/comments/${commentId}/replies`, body);
