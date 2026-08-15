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

async function apiFetchBlob(path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
    },
  });
  if (!res.ok) {
    let message = '요청 실패';
    try {
      const data = await res.json();
      if (data.error) message = data.error;
    } catch {}
    throw new Error(message);
  }
  return res.blob();
}

export const googleLogin = idToken => apiFetch('POST', '/auth/google', { idToken });
export const completeRegistration = (pendingToken, cafeName, agreements, location) =>
  apiFetch('POST', '/auth/complete', { pendingToken, cafeName, agreed: true, agreements, location });

export const getMe = () => apiFetch('GET', '/cafes/me');
export const getQrImageBlob = () => apiFetchBlob('/cafes/me/qr-code');
export const updateMe = name => apiFetch('PUT', '/cafes/me', { name });
export const changeSlug = slug => apiFetch('PUT', '/cafes/me/slug', slug ? { slug } : {});
export const updateNotice = notice => apiFetch('PUT', '/cafes/me/notice', { notice });
export const setStatus = is_accepting => apiFetch('PUT', '/cafes/me/status', { is_accepting });
export const updatePlatforms = allowed_platforms =>
  apiFetch('PUT', '/cafes/me/platforms', { allowed_platforms });
export const updateMusicFilter = ({ enabled, prompt }) =>
  apiFetch('PUT', '/cafes/me/music-filter', { enabled, prompt });
export const testMusicFilter = ({ url, prompt }) =>
  apiFetch('POST', '/cafes/me/music-filter/test', { url, prompt });

export const getRecommendations = slug => apiFetch('GET', `/cafes/${slug}/recommendations/owner`);
export const createRec = (slug, data) =>
  apiFetch('POST', `/cafes/${slug}/recommendations/owner`, data);
export const updateRec = (slug, id, status) =>
  apiFetch('PUT', `/cafes/${slug}/recommendations/${id}`, { status });
export const deleteRec = (slug, id) =>
  apiFetch('DELETE', `/cafes/${slug}/recommendations/${id}`);

export const getHistory = (offset = 0, date = null) =>
  apiFetch('GET', `/cafes/me/history?offset=${offset}${date ? `&date=${date}` : ''}`);
export const finalizeManualPlayback = data =>
  apiFetch('POST', '/cafes/me/playback-history', data);
export const getSongComments = (videoId, offset = 0, limit = 20) =>
  apiFetch('GET', `/songs/${encodeURIComponent(videoId)}/comments?offset=${offset}&limit=${limit}`);
