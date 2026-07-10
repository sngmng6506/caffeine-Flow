const BASE = import.meta.env.VITE_SERVER_URL
  ? `${import.meta.env.VITE_SERVER_URL}/api/v1`
  : '/api/v1';

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

export const googleLogin = idToken => apiFetch('POST', '/auth/google', { idToken });
export const completeRegistration = (pendingToken, cafeName, agreements, location) =>
  apiFetch('POST', '/auth/complete', { pendingToken, cafeName, agreed: true, agreements, location });

export const getMe = () => apiFetch('GET', '/cafes/me');
export const updateMe = name => apiFetch('PUT', '/cafes/me', { name });
export const updateNotice = notice => apiFetch('PUT', '/cafes/me/notice', { notice });
export const setStatus = is_accepting => apiFetch('PUT', '/cafes/me/status', { is_accepting });
export const updatePlatforms = allowed_platforms =>
  apiFetch('PUT', '/cafes/me/platforms', { allowed_platforms });
export const updateMusicFilter = ({ enabled, prompt, strictness }) =>
  apiFetch('PUT', '/cafes/me/music-filter', { enabled, prompt, strictness });
export const testMusicFilter = ({ url, prompt, strictness }) =>
  apiFetch('POST', '/cafes/me/music-filter/test', { url, prompt, strictness });

export const getRecommendations = slug => apiFetch('GET', `/cafes/${slug}/recommendations`);
export const createRec = (slug, data) =>
  apiFetch('POST', `/cafes/${slug}/recommendations/owner`, data);
export const updateRec = (slug, id, status) =>
  apiFetch('PUT', `/cafes/${slug}/recommendations/${id}`, { status });
export const deleteRec = (slug, id) =>
  apiFetch('DELETE', `/cafes/${slug}/recommendations/${id}`);

export const getHistory = (offset = 0, date = null) =>
  apiFetch('GET', `/cafes/me/history?offset=${offset}${date ? `&date=${date}` : ''}`);
export const getStats = () => apiFetch('GET', '/cafes/me/stats');
export const getMusicFilterStats = () => apiFetch('GET', '/cafes/me/stats/music-filter');
export const getDailyStats = date => apiFetch('GET', `/cafes/me/stats/daily?date=${date}`);
export const getHourlyStats = () => apiFetch('GET', '/cafes/me/stats/hourly');
export const getWeekdayStats = () => apiFetch('GET', '/cafes/me/stats/weekday');
export const getHourlySongs = (hour, offset = 0) =>
  apiFetch('GET', `/cafes/me/stats/hourly-songs?hour=${hour}&offset=${offset}`);
export const getWeekdaySongs = (day, offset = 0) =>
  apiFetch('GET', `/cafes/me/stats/weekday-songs?day=${day}&offset=${offset}`);

export const getSongComments = videoId => apiFetch('GET', `/songs/${videoId}/comments`);
