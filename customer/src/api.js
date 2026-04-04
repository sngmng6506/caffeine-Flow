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
