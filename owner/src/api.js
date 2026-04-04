const BASE = '/api/v1';

function getToken() {
  return localStorage.getItem('token');
}

async function apiFetch(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(data.error || '요청 실패');
  return data;
}

export const login    = (email, password) => apiFetch('POST', '/auth/login', { email, password });
export const register = (name, slug, email, password) => apiFetch('POST', '/auth/register', { name, slug, email, password });
export const acceptDisclaimer = () => apiFetch('POST', '/auth/disclaimer');

export const getMe     = () => apiFetch('GET',  '/cafes/me');
export const setStatus = (is_accepting) => apiFetch('PUT', '/cafes/me/status', { is_accepting });

export const getRecommendations = (slug) => apiFetch('GET',    `/cafes/${slug}/recommendations`);
export const updateRec          = (slug, id, status) => apiFetch('PUT', `/cafes/${slug}/recommendations/${id}`, { status });
export const deleteRec          = (slug, id) => apiFetch('DELETE', `/cafes/${slug}/recommendations/${id}`);

export const getStats      = () => apiFetch('GET', '/cafes/me/stats');
export const getDailyStats = (date) => apiFetch('GET', `/cafes/me/stats/daily?date=${date}`);
