export function parseInitialState({
  location = window.location,
  history = window.history,
  storage = localStorage,
} = {}) {
  // OAuth callback values prefer the fragment so tokens do not enter server
  // access logs or Referer headers. Query parameters remain a legacy fallback.
  const fromHash = new URLSearchParams(location.hash.replace(/^#/, ''));
  const fromQuery = new URLSearchParams(location.search);
  const params = { get: key => fromHash.get(key) ?? fromQuery.get(key) };

  function clearCallbackUrl() {
    history.replaceState({}, '', location.pathname);
  }

  function clearStoredSession() {
    storage.removeItem('token');
    storage.removeItem('cafe');
  }

  const callbackToken = params.get('token');
  const callbackCafe = params.get('cafe');
  if (callbackToken || callbackCafe) {
    try {
      if (!callbackToken || !callbackCafe) throw new Error('incomplete callback');
      // URLSearchParams already decodes percent encoding. Decoding twice would
      // break otherwise valid cafe names containing a literal percent sign.
      const cafeData = JSON.parse(callbackCafe);
      if (!cafeData || typeof cafeData !== 'object' || !cafeData.id || !cafeData.slug) throw new Error('invalid cafe');
      storage.setItem('token', callbackToken);
      storage.setItem('cafe', JSON.stringify(cafeData));
      clearCallbackUrl();
      return { cafe: cafeData, pending: null, oauthError: '' };
    } catch {
      clearStoredSession();
      clearCallbackUrl();
      return { cafe: null, pending: null, oauthError: '로그인 정보를 확인하지 못했어요. 다시 로그인해 주세요.' };
    }
  }

  const pending = params.get('pending');
  if (pending) {
    clearCallbackUrl();
    return { cafe: null, pending, oauthError: '' };
  }

  if (params.get('error')) {
    clearCallbackUrl();
    return { cafe: null, pending: null, oauthError: '소셜 로그인에 실패했어요. 다시 시도해 주세요.' };
  }

  const token = storage.getItem('token');
  const cafeRaw = storage.getItem('cafe');
  if (!token || !cafeRaw) {
    if (token || cafeRaw) clearStoredSession();
    return { cafe: null, pending: null, oauthError: '' };
  }

  try {
    const cafe = JSON.parse(cafeRaw);
    if (!cafe || typeof cafe !== 'object' || !cafe.id || !cafe.slug) throw new Error('invalid cafe');
    return { cafe, pending: null, oauthError: '' };
  } catch {
    clearStoredSession();
    return { cafe: null, pending: null, oauthError: '저장된 로그인 정보가 손상되어 로그아웃했어요. 다시 로그인해 주세요.' };
  }
}
