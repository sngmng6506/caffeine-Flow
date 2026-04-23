const router   = require('express').Router();
const jwt      = require('jsonwebtoken');
const axios    = require('axios');
const { OAuth2Client } = require('google-auth-library');
const { JWT_SECRET, GOOGLE_CLIENT_ID, NAVER_CLIENT_ID, NAVER_CLIENT_SECRET, APP_URL, SERVER_URL } = require('../config');
const cafeService = require('../services/cafe.service');

const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

// JWT 발급 헬퍼
function issueToken(cafe) {
  return jwt.sign({ cafeId: cafe.id, slug: cafe.slug }, JWT_SECRET, { expiresIn: '30d' });
}

// 신규 가입 대기 토큰 (10분 유효)
function issuePendingToken(payload) {
  return jwt.sign({ ...payload, pending: true }, JWT_SECRET, { expiresIn: '10m' });
}

function safeCafe(cafe) {
  const { google_id, naver_id, ...rest } = cafe;
  return { ...rest, provider: google_id ? 'google' : 'naver' };
}

// ────────────────────────────────────────────
// POST /api/v1/auth/google
// body: { idToken }                         → 기존 회원: { token, cafe }
// body: { idToken, cafeName, agreed: true } → 신규 가입: { token, cafe }
// ────────────────────────────────────────────
router.post('/google', async (req, res) => {
  const { idToken, cafeName, agreed } = req.body;
  if (!idToken) return res.status(400).json({ error: 'idToken 필수' });

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

  // 신규 가입 완료
  if (cafeName && agreed) {
    const cafe = await cafeService.create({
      name: cafeName,
      ownerEmail: email,
      googleId,
      disclaimerAcceptedAt: new Date(),
    });
    return res.status(201).json({ token: issueToken(cafe), cafe: safeCafe(cafe) });
  }

  // 신규 회원 → 가입 정보 입력 필요
  return res.json({ needsSetup: true, pendingToken: issuePendingToken({ googleId, email, name }) });
});

// ────────────────────────────────────────────
// GET /api/v1/auth/naver  → 네이버 로그인 페이지로 리다이렉트
// ────────────────────────────────────────────
router.get('/naver', (req, res) => {
  const state       = Math.random().toString(36).slice(2);
  const redirectUri = `${SERVER_URL}/api/v1/auth/naver/callback`;
  const params = new URLSearchParams({
    response_type: 'code',
    client_id:     NAVER_CLIENT_ID,
    redirect_uri:  redirectUri,
    state,
  });
  const fullUrl = `https://nid.naver.com/oauth2.0/authorize?${params}`;
  console.log('[naver] full URL:', fullUrl);
  res.redirect(fullUrl);
});

// ────────────────────────────────────────────
// GET /api/v1/auth/naver/callback
// ────────────────────────────────────────────
router.get('/naver/callback', async (req, res) => {
  const { code, state } = req.query;
  // 사장님 앱은 /owner/ 경로에서 서빙됨 — 콜백 리다이렉트도 해당 경로로
  const ownerUrl = `${APP_URL.replace(/\/$/, '')}/owner/`;
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
      return res.redirect(`${ownerUrl}?token=${token}&cafe=${cafe}`);
    }

    // 신규 회원 → pending 토큰으로 클라이언트에 전달
    const pendingToken = issuePendingToken({ naverId, email, name });
    return res.redirect(`${ownerUrl}?pending=${pendingToken}`);

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
  if (!pendingToken || !cafeName || !agreed)
    return res.status(400).json({ error: '필수 항목 누락' });

  // 필수 약관 동의 검증
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

  const cafe = await cafeService.create({
    name:                 cafeName,
    ownerEmail:           pending.email || null,
    googleId:             pending.googleId || null,
    naverId:              pending.naverId  || null,
    disclaimerAcceptedAt: new Date(),
    lastLoginAt:          new Date(),
    agreements,
    location,
  });

  res.status(201).json({ token: issueToken(cafe), cafe: safeCafe(cafe) });
});

module.exports = router;
