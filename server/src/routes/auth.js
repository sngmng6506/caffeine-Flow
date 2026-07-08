const router   = require('express').Router();
const jwt      = require('jsonwebtoken');
const crypto   = require('crypto');
const axios    = require('axios');
const { OAuth2Client } = require('google-auth-library');
const { JWT_SECRET, GOOGLE_CLIENT_ID, NAVER_CLIENT_ID, NAVER_CLIENT_SECRET, APP_URL, SERVER_URL } = require('../config');
const cafeService = require('../services/cafe.service');
const { safeCafe } = require('../utils/cafe-sanitize');
const { validateString, validateBool } = require('../utils/validate');

const NAVER_STATE_COOKIE = 'cf_naver_state';
const STATE_COOKIE_OPTS = { httpOnly: true, secure: true, sameSite: 'lax', maxAge: 10 * 60 * 1000, path: '/api/v1/auth' };

const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

// JWT 발급 헬퍼
function issueToken(cafe) {
  return jwt.sign({ cafeId: cafe.id, slug: cafe.slug }, JWT_SECRET, { expiresIn: '30d' });
}

// 신규 가입 대기 토큰 (10분 유효)
function issuePendingToken(payload) {
  return jwt.sign({ ...payload, pending: true }, JWT_SECRET, { expiresIn: '10m' });
}


// 같은 이메일의 다른 provider 계정 존재 여부 확인 — 정책상 provider별
// 별도 계정을 허용하므로 차단하지 않고, 서버 로그 + 응답 힌트만 남긴다.
// (사용자가 실수로 다른 소셜 로그인으로 새 카페를 만드는 케이스 추적/안내용)
async function checkEmailOverlap(email) {
  if (!email) return null;
  const existing = await cafeService.findByEmail(email);
  if (!existing) return null;
  console.warn(`[auth] 이메일 중복 가입: ${email} — 기존 카페 "${existing.name}" (${existing.google_id ? 'google' : 'naver'})와 별도 계정 생성`);
  return '같은 이메일로 가입된 다른 소셜 로그인 계정이 있습니다. 기존 카페를 찾으시면 이전에 쓰던 로그인 방식을 사용해주세요.';
}

// ────────────────────────────────────────────
// POST /api/v1/auth/google
// body: { idToken }                         → 기존 회원: { token, cafe }
// 기존 회원 → { token, cafe } / 신규 회원 → { needsSetup, pendingToken } (가입은 /complete에서)
// ────────────────────────────────────────────
router.post('/google', async (req, res) => {
  const { idToken } = req.body;
  const idTokenCheck = validateString(idToken, { max: 4096, name: 'idToken' });
  if (idTokenCheck.error) return res.status(400).json({ error: idTokenCheck.error });

  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({ idToken, audience: GOOGLE_CLIENT_ID });
    payload = ticket.getPayload();
  } catch {
    return res.status(401).json({ error: '유효하지 않은 Google 토큰' });
  }

  const { sub: googleId, email, name } = payload;

  // 기존 회원
  const existing = await cafeService.findByGoogleId(googleId);
  if (existing) {
    await cafeService.update(existing.id, { last_login_at: new Date() });
    return res.json({ token: issueToken(existing), cafe: safeCafe(existing) });
  }

  // 신규 회원 → 가입 정보 입력 필요.
  // 모든 신규 가입은 /complete 한 곳으로 통일한다 — 과거의 인라인 가입
  // 분기(cafeName+agreed)는 약관별 동의 시각 기록 없이 계정을 만들 수
  // 있는 컴플라이언스 구멍이라 제거했다.
  return res.json({ needsSetup: true, pendingToken: issuePendingToken({ googleId, email, name }) });
});

// ────────────────────────────────────────────
// GET /api/v1/auth/naver  → 네이버 로그인 페이지로 리다이렉트
// state는 암호학적으로 안전한 nonce. HttpOnly 쿠키에 저장하고 콜백에서 대조 → CSRF 차단.
// ────────────────────────────────────────────
router.get('/naver', (req, res) => {
  const state       = crypto.randomBytes(24).toString('hex');
  const redirectUri = `${SERVER_URL}/api/v1/auth/naver/callback`;
  const params = new URLSearchParams({
    response_type: 'code',
    client_id:     NAVER_CLIENT_ID,
    redirect_uri:  redirectUri,
    state,
  });
  res.cookie(NAVER_STATE_COOKIE, state, STATE_COOKIE_OPTS);
  res.redirect(`https://nid.naver.com/oauth2.0/authorize?${params}`);
});

// ────────────────────────────────────────────
// GET /api/v1/auth/naver/callback
// ────────────────────────────────────────────
router.get('/naver/callback', async (req, res) => {
  const { code, state } = req.query;
  // 사장님 앱은 /owner/ 경로에서 서빙됨 — 콜백 리다이렉트도 해당 경로로
  const ownerUrl = `${APP_URL.replace(/\/$/, '')}/owner/`;

  // CSRF: 쿠키에 저장한 state와 URL의 state 가 일치해야만 통과. timingSafeEqual 로 비교.
  const expectedState = req.cookies?.[NAVER_STATE_COOKIE];
  res.clearCookie(NAVER_STATE_COOKIE, { ...STATE_COOKIE_OPTS, maxAge: 0 });
  if (!expectedState || typeof state !== 'string' || expectedState.length !== state.length ||
      !crypto.timingSafeEqual(Buffer.from(expectedState), Buffer.from(state))) {
    return res.redirect(`${ownerUrl}?error=invalid_state`);
  }
  if (!code) return res.redirect(`${ownerUrl}?error=naver_cancelled`);

  try {
    // 토큰 교환
    const { data: tokenData } = await axios.get('https://nid.naver.com/oauth2.0/token', {
      params: {
        grant_type:    'authorization_code',
        client_id:     NAVER_CLIENT_ID,
        client_secret: NAVER_CLIENT_SECRET,
        code,
        state,
      },
    });

    // 사용자 정보 조회
    const { data: profileData } = await axios.get('https://openapi.naver.com/v1/nid/me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    const { id: naverId, email, name } = profileData.response;

    // 기존 회원
    const existing = await cafeService.findByNaverId(naverId);
    if (existing) {
      await cafeService.update(existing.id, { last_login_at: new Date() });
      const token = issueToken(existing);
      const cafe  = encodeURIComponent(JSON.stringify(safeCafe(existing)));
      // 토큰을 query가 아닌 fragment로 전달 — fragment는 서버 액세스 로그·
      // Referer 헤더에 남지 않음 (query의 30일 JWT는 로그로 유출될 수 있음)
      return res.redirect(`${ownerUrl}#token=${token}&cafe=${cafe}`);
    }

    // 신규 회원 → pending 토큰으로 클라이언트에 전달
    const pendingToken = issuePendingToken({ naverId, email, name });
    return res.redirect(`${ownerUrl}#pending=${pendingToken}`);

  } catch (err) {
    console.error('[naver callback]', err.message);
    res.redirect(`${ownerUrl}?error=naver_failed`);
  }
});

// ────────────────────────────────────────────
// POST /api/v1/auth/complete  → 신규 가입 완료 (네이버/구글 공통)
// body: { pendingToken, cafeName, agreed: true }
// ────────────────────────────────────────────
router.post('/complete', async (req, res) => {
  const { pendingToken, cafeName, agreed, agreements, location } = req.body;
  const tokenCheck = validateString(pendingToken, { max: 4096, name: 'pendingToken' });
  if (tokenCheck.error) return res.status(400).json({ error: tokenCheck.error });
  const nameCheck = validateString(cafeName, { max: 100, name: '카페명' });
  if (nameCheck.error) return res.status(400).json({ error: nameCheck.error });
  if (!agreed) return res.status(400).json({ error: '약관 동의 필수' });

  // 필수 약관 동의 검증
  if (!agreements?.age)
    return res.status(400).json({ error: '만 14세 이상 확인이 필요합니다' });
  if (!agreements?.service || !agreements?.privacy || !agreements?.copyright)
    return res.status(400).json({ error: '필수 약관에 모두 동의해야 합니다' });

  // 카페 위치 필수
  if (!location?.address && !location?.roadAddress)
    return res.status(400).json({ error: '카페 위치를 입력해주세요' });

  let pending;
  try {
    pending = jwt.verify(pendingToken, JWT_SECRET);
    if (!pending.pending) throw new Error();
  } catch {
    return res.status(401).json({ error: '만료되었거나 유효하지 않은 요청입니다. 다시 시도해주세요.' });
  }

  const emailWarning = await checkEmailOverlap(pending.email);
  const cafe = await cafeService.create({
    name:                 nameCheck.value,
    ownerEmail:           pending.email || null,
    googleId:             pending.googleId || null,
    naverId:              pending.naverId  || null,
    disclaimerAcceptedAt: new Date(),
    lastLoginAt:          new Date(),
    agreements,
    location,
  });

  res.status(201).json({ token: issueToken(cafe), cafe: safeCafe(cafe), emailWarning });
});

module.exports = router;
