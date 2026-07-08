import { useState, useEffect, useRef } from 'react';
import { googleLogin, completeRegistration } from '../api';

const TERMS = [
  {
    key: 'service',
    title: '서비스 이용약관',
    required: true,
    content: `시행일: 2026년 7월 8일

제1조 (목적)
본 약관은 Caffeine Flow(이하 "서비스")가 제공하는 카페 음악 추천 플랫폼의 이용 조건과, 이용자와 서비스 사이의 권리·의무를 정합니다.

제2조 (서비스 이용)
① 서비스는 카페 운영자(이하 "회원")가 손님으로부터 음악 신청을 받고 관리할 수 있는 플랫폼을 제공합니다.
② 회원은 서비스를 이용하여 불법적인 행위를 하거나 타인의 권리를 침해해서는 안 됩니다.
③ 서비스는 운영상 필요한 경우 사전 고지 후 서비스를 변경하거나 중단할 수 있습니다.

제3조 (회원 탈퇴)
① 회원은 서비스 내 문의 기능 또는 이메일(sngmng6506@gmail.com)로 언제든 탈퇴를 요청할 수 있습니다.
② 탈퇴 시 회원의 개인정보는 관련 법령에 따라 보관이 필요한 정보를 제외하고 지체 없이 파기됩니다.

제4조 (면책)
① 서비스는 천재지변 등 불가항력으로 인한 서비스 중단에 대해 책임을 지지 않습니다.
② 서비스는 음악 재생 플랫폼 도구를 제공할 뿐, 매장 내 음악 재생에 필요한 저작권 이용 허락을 대신 취득하거나 제공하지 않습니다. 공연권 등 저작권 관련 의무의 이행 주체는 매장을 운영하는 회원입니다.

제5조 (약관 변경)
① 약관을 변경할 경우 적용일 7일 전까지 서비스 내 공지 또는 이메일로 안내합니다.
② 변경된 약관에 동의하지 않는 회원은 탈퇴할 수 있습니다.

제6조 (분쟁 해결)
본 약관과 관련한 분쟁에는 대한민국 법률이 적용되며, 관할 법원은 민사소송법에 따릅니다.`,
  },
  {
    key: 'privacy',
    title: '개인정보 수집·이용 동의',
    required: true,
    content: `시행일: 2026년 7월 8일

■ 수집 항목
  - 소셜 로그인 시: 이메일 주소, 이름, 소셜 계정 식별자
  - 서비스 이용 과정에서 자동 수집: 접속 IP 주소, 서비스 이용 기록
  - 손님(비회원) 이용 시: 기기 식별값, 닉네임, 댓글 내용, 접속 IP

■ 수집·이용 목적
  - 회원 가입 및 계정 관리
  - 서비스 제공 및 운영
  - 어뷰징 방지 및 서비스 보안

■ 보유·이용 기간
  - 회원 탈퇴 시까지 보유 후 지체 없이 파기
  - 단, 관련 법령이 정한 기간 동안은 해당 정보를 보관
    · 계약 또는 청약철회 기록: 5년 (전자상거래법)
    · 접속 로그 기록: 3개월 (통신비밀보호법)

■ 개인정보의 국외 이전
  - 이전받는 자: Railway Corp. (클라우드 서버 운영)
  - 이전 국가: 미국
  - 이전 항목: 위 수집 항목 전체
  - 이전 일시·방법: 서비스 이용 시점에 네트워크를 통해 전송·보관
  - 보유 기간: 회원 탈퇴 또는 위탁 계약 종료 시까지

■ 처리 위탁
  - 소셜 로그인 인증: Google, Naver

■ 개인정보보호 책임자
  - 이메일: sngmng6506@gmail.com

■ 동의를 거부할 권리
  동의를 거부할 수 있으나, 본 항목은 서비스 제공에 필수적인 최소한의
  정보로서 거부 시 회원 가입이 제한됩니다.

■ 국외 이전 등 전체 내용
  개인정보 국외 이전을 포함한 전체 사항은 개인정보 처리방침에서
  확인하실 수 있습니다: /owner/privacy.html`,
  },
  {
    key: 'copyright',
    title: '매장 음악 재생(공연권) 안내 확인',
    required: true,
    content: `카페 등 매장에서 음악을 트는 것은 저작권법상 "공연"에 해당하여, 매장 규모에 따라 공연권료 납부 의무가 있을 수 있습니다.

알아두면 좋은 내용:
  - 영업 면적 50㎡(약 15평) 미만 매장은 공연권료가 면제됩니다 (저작권법 시행령).
  - 50㎡ 이상 매장은 면적 구간에 따라 월 수천 원 수준의 공연권료를 한국음악저작권협회(KOMCA) 등에 납부하게 됩니다. 자세한 기준은 KOMCA 안내를 확인해 주세요.

본 서비스는 음악 신청·추천을 돕는 플랫폼이며, 음악 저작권 이용 허락을 제공하지 않습니다. 매장 내 음악 재생에 따른 공연권 등 저작권 의무의 확인과 이행은 매장 운영자인 회원의 몫임을 확인합니다.

※ 위 안내는 일반 정보이며 법률 자문이 아닙니다.`,
  },
];

export default function LoginPage({ onLogin, initialPendingToken, oauthError }) {
  const [step, setStep] = useState(initialPendingToken ? 'setup' : 'login');
  const [pendingToken, setPendingToken] = useState(initialPendingToken || '');
  const [cafeName, setCafeName] = useState('');
  const [location, setLocation] = useState(null);
  const [detailAddress, setDetailAddress] = useState('');
  const [agreements, setAgreements] = useState({ service: false, privacy: false, copyright: false, age: false });
  const [expanded, setExpanded] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(oauthError || '');
  const googleBtnRef = useRef(null);
  const detailRef = useRef(null);

  const allRequired = agreements.age && agreements.service && agreements.privacy && agreements.copyright;
  const allChecked  = allRequired;

  // Google Identity Services 스크립트 로드
  useEffect(() => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = initGoogle;
    document.body.appendChild(script);
    return () => document.body.removeChild(script);
  }, []);

  function initGoogle() {
    if (!window.google || !import.meta.env.VITE_GOOGLE_CLIENT_ID) return;
    window.google.accounts.id.initialize({
      client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID,
      callback:  handleGoogleCallback,
    });
    if (googleBtnRef.current) {
      window.google.accounts.id.renderButton(googleBtnRef.current, {
        type: 'standard', theme: 'outline', size: 'large', width: 320, text: 'signin_with', locale: 'ko',
      });
    }
  }

  async function handleGoogleCallback({ credential }) {
    setLoading(true);
    setError('');
    try {
      const res = await googleLogin(credential);
      if (res.needsSetup) {
        setPendingToken(res.pendingToken);
        setStep('setup');
      } else {
        localStorage.setItem('token', res.token);
        localStorage.setItem('cafe', JSON.stringify(res.cafe));
        onLogin(res.cafe);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function handleNaverLogin() {
    window.location.href = '/api/v1/auth/naver';
  }

  async function handleSetupSubmit(e) {
    e.preventDefault();
    if (!cafeName.trim() || !allRequired || !location) return;
    setLoading(true);
    setError('');
    try {
      const detail = detailAddress.trim();
      const payload = {
        ...location,
        roadAddress: location.roadAddress ? `${location.roadAddress}${detail ? ' ' + detail : ''}` : null,
        address:     location.address     ? `${location.address}${detail ? ' ' + detail : ''}`     : null,
      };
      const res = await completeRegistration(pendingToken, cafeName.trim(), agreements, payload);
      localStorage.setItem('token', res.token);
      localStorage.setItem('cafe', JSON.stringify(res.cafe));
      onLogin(res.cafe);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function handleCancel() {
    setPendingToken('');
    setCafeName('');
    setLocation(null);
    setDetailAddress('');
    setAgreements({ service: false, privacy: false, copyright: false, age: false });
    setExpanded({});
    setError('');
    setStep('login');
  }

  function openAddressSearch() {
    if (!window.daum?.Postcode) {
      const script = document.createElement('script');
      script.src = '//t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js';
      script.onload = () => runPostcode();
      document.body.appendChild(script);
    } else {
      runPostcode();
    }
  }

  function runPostcode() {
    new window.daum.Postcode({
      oncomplete(data) {
        setLocation({
          address: data.jibunAddress || null,
          roadAddress: data.roadAddress || null,
          region: data.sido || null,
          district: data.sigungu || null,
          latitude: null,
          longitude: null,
        });
        setDetailAddress('');
        // 우편번호 검색 후 상세주소 입력칸으로 포커스 이동
        setTimeout(() => detailRef.current?.focus(), 100);
      },
    }).open();
  }

  function toggleAgreement(key) {
    setAgreements(prev => ({ ...prev, [key]: !prev[key] }));
  }

  function toggleAll() {
    const next = !allChecked;
    setAgreements({ service: next, privacy: next, copyright: next, age: next });
  }

  if (step === 'setup') {
    return (
      <div style={styles.wrap}>
        <div style={styles.setupHeader}>
          <button type="button" onClick={handleCancel} style={styles.backBtn}>← 뒤로</button>
          <h2 style={styles.setupTitle}>카페 정보 입력</h2>
        </div>
        <form onSubmit={handleSetupSubmit} style={styles.form}>
          <input
            placeholder="카페 이름"
            value={cafeName}
            onChange={e => setCafeName(e.target.value)}
            style={styles.input}
            required
            autoFocus
          />

          <div style={styles.addressBox}>
            <div style={styles.addressLabel}>카페 주소 <span style={styles.required}>(필수)</span></div>
            {location ? (
              <>
                <div style={styles.addressResult}>
                  <div style={styles.addressText}>{location.roadAddress || location.address}</div>
                  <button type="button" onClick={openAddressSearch} style={styles.addressChangeBtn}>변경</button>
                </div>
                <input
                  ref={detailRef}
                  placeholder="상세주소 (예: 2층, 201호)"
                  value={detailAddress}
                  onChange={e => setDetailAddress(e.target.value)}
                  style={styles.input}
                />
              </>
            ) : (
              <button type="button" onClick={openAddressSearch} style={styles.addressSearchBtn}>
                🔍 주소 검색
              </button>
            )}
          </div>

          <div style={styles.agreementBox}>
            <label style={styles.allAgree}>
              <input type="checkbox" checked={allChecked} onChange={toggleAll} />
              <strong>전체 동의</strong>
              <span style={styles.allAgreeSub}>(아래 필수 항목 일괄 동의)</span>
            </label>
            <div style={styles.divider} />
            <label style={styles.checkLabel}>
              <input type="checkbox" checked={agreements.age} onChange={() => toggleAgreement('age')} />
              <span>만 14세 이상입니다</span>
              <span style={styles.required}>(필수)</span>
            </label>
            {TERMS.map(term => (
              <div key={term.key} style={styles.termItem}>
                <div style={styles.termHeader}>
                  <label style={styles.checkLabel}>
                    <input type="checkbox" checked={agreements[term.key]} onChange={() => toggleAgreement(term.key)} />
                    <span>{term.title}</span>
                    {term.required
                      ? <span style={styles.required}>(필수)</span>
                      : <span style={styles.optional}>(선택)</span>
                    }
                  </label>
                  <button type="button" onClick={() => setExpanded(p => ({ ...p, [term.key]: !p[term.key] }))} style={styles.expandBtn}>
                    {expanded[term.key] ? '접기' : '보기'}
                  </button>
                </div>
                {expanded[term.key] && <div style={styles.termContent}>{term.content}</div>}
              </div>
            ))}
          </div>

          {error && <div style={styles.error}>{error}</div>}
          <button type="submit" disabled={loading || !allRequired || !cafeName.trim() || !location} style={styles.btn}>
            {loading ? '처리 중...' : '가입 완료'}
          </button>
        </form>
        <div style={styles.policyFooter}>
          <a href="/owner/privacy.html" target="_blank" rel="noreferrer" style={styles.policyLink}>개인정보 처리방침</a>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.wrap}>
      <h1 style={styles.title}>☕ Caffeine Flow</h1>
      <p style={styles.subtitle}>사장님 로그인</p>

      <div style={styles.oauthBtns}>
        {/* Google 로그인 버튼 (GIS SDK가 렌더링) */}
        <div ref={googleBtnRef} />
        {!import.meta.env.VITE_GOOGLE_CLIENT_ID && (
          <div style={styles.configWarn}>
            Google 로그인을 사용할 수 없습니다.<br />
            (관리자: VITE_GOOGLE_CLIENT_ID 빌드 설정을 확인해 주세요)
          </div>
        )}

        {/* 네이버 로그인 버튼 — VITE_NAVER_ENABLED=true 설정 시 활성화 */}
        {import.meta.env.VITE_NAVER_ENABLED === 'true' && (
          <button onClick={handleNaverLogin} style={styles.naverBtn}>
            <span style={styles.naverN}>N</span>
            <span style={styles.naverBtnText}>네이버로 로그인</span>
          </button>
        )}
      </div>

      {error && <div style={styles.error}>{error}</div>}
      {loading && <div style={styles.loading}>처리 중...</div>}

      <div style={styles.policyFooter}>
        <a href="/owner/privacy.html" target="_blank" rel="noreferrer" style={styles.policyLink}>개인정보 처리방침</a>
      </div>
    </div>
  );
}

const styles = {
  wrap:         { maxWidth: 380, margin: '80px auto', padding: '36px 32px', fontFamily: 'sans-serif', boxShadow: '0 2px 20px rgba(0,0,0,0.1)', borderRadius: 16 },
  title:        { textAlign: 'center', marginBottom: 8, fontSize: 24 },
  setupHeader:  { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 },
  setupTitle:   { fontSize: 20, fontWeight: 700, margin: 0, flex: 1, textAlign: 'center', paddingRight: 48 },
  backBtn:      { fontSize: 13, color: '#888', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0', flexShrink: 0 },
  subtitle:     { textAlign: 'center', color: '#888', fontSize: 14, marginBottom: 32 },
  form:         { display: 'flex', flexDirection: 'column', gap: 12 },
  input:        { padding: '10px 12px', borderRadius: 8, border: '1px solid #ddd', fontSize: 14, outline: 'none' },
  oauthBtns:    { display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' },
  configWarn:   { fontSize: 12, color: "#e63946", textAlign: "center", lineHeight: 1.5, padding: "12px", background: "#fff5f5", borderRadius: 8, width: 320, boxSizing: "border-box" },
  naverBtn:     { position: 'relative', display: 'flex', alignItems: 'center', width: 320, padding: '10px 16px', borderRadius: 8, border: 'none', background: '#03C75A', color: '#fff', fontSize: 15, fontWeight: 600, cursor: 'pointer' },
  naverBtnText: { flex: 1, textAlign: 'center' },
  naverN:       { width: 24, height: 24, borderRadius: 4, background: '#fff', color: '#03C75A', fontWeight: 900, fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  agreementBox: { border: '1px solid #eee', borderRadius: 10, padding: '14px', display: 'flex', flexDirection: 'column', gap: 8 },
  allAgree:     { display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, cursor: 'pointer' },
  allAgreeSub:  { fontSize: 12, color: '#aaa' },
  divider:      { height: 1, background: '#eee' },
  termItem:     { display: 'flex', flexDirection: 'column', gap: 4 },
  termHeader:   { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  checkLabel:   { display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' },
  required:     { fontSize: 11, color: '#e63946', marginLeft: 2 },
  optional:     { fontSize: 11, color: '#aaa', marginLeft: 2 },
  expandBtn:    { fontSize: 11, color: '#888', background: 'none', border: '1px solid #ddd', borderRadius: 4, padding: '2px 8px', cursor: 'pointer' },
  termContent:  { fontSize: 12, color: '#666', background: '#f8f8f8', borderRadius: 6, padding: '10px 12px', whiteSpace: 'pre-line', lineHeight: 1.7, maxHeight: 150, overflowY: 'auto' },
  addressBox:       { display: 'flex', flexDirection: 'column', gap: 6 },
  addressLabel:     { fontSize: 13, color: '#888' },
  addressResult:    { display: 'flex', alignItems: 'center', gap: 8 },
  addressText:      { flex: 1, fontSize: 13, color: '#333', background: '#f8f8f8', padding: '8px 10px', borderRadius: 6 },
  addressChangeBtn: { fontSize: 12, padding: '6px 10px', borderRadius: 6, border: '1px solid #ddd', background: '#fff', cursor: 'pointer', flexShrink: 0 },
  addressSearchBtn: { padding: '11px 12px', borderRadius: 8, border: '1px solid #ddd', background: '#fff', color: '#333', cursor: 'pointer', fontSize: 14, fontWeight: 500 },
  btn:          { padding: '12px', borderRadius: 8, background: '#1a1a2e', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 15 },
  error:        { fontSize: 13, color: '#e63946', textAlign: 'center' },
  loading:      { fontSize: 13, color: '#888', textAlign: 'center' },
  policyFooter: { marginTop: 20, textAlign: 'center' },
  policyLink:   { fontSize: 12, color: '#aaa', textDecoration: 'underline' },
};