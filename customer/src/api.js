import { getVisitorId } from './deviceName';

const BASE = '/api/v1';

async function apiFetch(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Visitor-Id': getVisitorId(),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(data.error || '요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.');
  return data;
}

export const getRecommendations = (slug) =>
  apiFetch('GET', `/cafes/${slug}/recommendations`);

export const postRecommendation = (slug, body) =>
  apiFetch('POST', `/cafes/${slug}/recommendations`, body);

export const vote   = (slug, id) =>
  apiFetch('POST',   `/cafes/${slug}/recommendations/${id}/vote`);

export const unvote = (slug, id) =>
  apiFetch('DELETE', `/cafes/${slug}/recommendations/${id}/vote`);

export const cancelRecommendation = (slug, id) =>
  apiFetch('DELETE', `/cafes/${slug}/recommendations/${id}/cancel`);

export const getOembed = (url) =>
  apiFetch('GET', `/tracks/oembed?url=${encodeURIComponent(url)}`);

export const getCafeTop10   = (slug, offset = 0) =>
  apiFetch('GET', `/cafes/${slug}/recommendations/top10?offset=${offset}`);

export const getGlobalTop10 = (offset = 0) =>
  apiFetch('GET', `/top10?offset=${offset}`);

export const getSongComments = (videoId, offset = 0, limit = 20) =>
  apiFetch('GET', `/songs/${videoId}/comments?offset=${offset}&limit=${limit}`);

export const postSongComment = (videoId, slug = null, body) =>
  slug
    ? apiFetch('POST', `/cafes/${slug}/songs/${videoId}/comments`, body)
    : apiFetch('POST', `/songs/${videoId}/comments`, body);

export const postSongReply = (videoId, commentId, slug = null, body) =>
  slug
    ? apiFetch('POST', `/cafes/${slug}/songs/${videoId}/comments/${commentId}/replies`, body)
    : apiFetch('POST', `/songs/${videoId}/comments/${commentId}/replies`, body);
