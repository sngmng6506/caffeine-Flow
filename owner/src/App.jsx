import { useState, useEffect } from 'react';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';

function parseInitialState() {
  // OAuth 콜백 파라미터는 fragment(#) 우선 — 토큰이 서버 로그/Referer에
  // 남지 않도록 서버가 fragment로 보냄. query는 구버전 서버 호환 폴백.
  const fromHash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const fromQuery = new URLSearchParams(window.location.search);
  const params = { get: (k) => fromHash.get(k) ?? fromQuery.get(k) };

  if (params.get('token') && params.get('cafe')) {
    const token    = params.get('token');
    const cafeData = JSON.parse(decodeURIComponent(params.get('cafe')));
    localStorage.setItem('token', token);
    localStorage.setItem('cafe', JSON.stringify(cafeData));
    window.history.replaceState({}, '', window.location.pathname);
    return { cafe: cafeData, pending: null, oauthError: '' };
  }

  if (params.get('pending')) {
    const pending = params.get('pending');
    window.history.replaceState({}, '', window.location.pathname);
    return { cafe: null, pending, oauthError: '' };
  }

  if (params.get('error')) {
    window.history.replaceState({}, '', window.location.pathname);
    return { cafe: null, pending: null, oauthError: '소셜 로그인에 실패했습니다. 다시 시도해주세요.' };
  }

  const token   = localStorage.getItem('token');
  const cafeRaw = localStorage.getItem('cafe');
  return {
    cafe:       token && cafeRaw ? JSON.parse(cafeRaw) : null,
    pending:    null,
    oauthError: '',
  };
}

const initialState = parseInitialState();

export default function App() {
  const [cafe, setCafe]             = useState(initialState.cafe);
  const [pending]                   = useState(initialState.pending);
  const [oauthError]                = useState(initialState.oauthError);
  const [youtubeVisible, setYoutubeVisible] = useState(false);
  const [updateVersion, setUpdateVersion]   = useState(null);

  useEffect(() => {
    window.electronAPI?.onYoutubeState(visible => setYoutubeVisible(visible));
    window.electronAPI?.onUpdateDownloaded(version => setUpdateVersion(version));
    // 앱 시작 시 이미 로그인 상태면 YouTube 패널 바로 열기
    if (initialState.cafe) window.electronAPI?.showYoutube();
  }, []);

  function handleLogin(cafeData) {
    setCafe(cafeData);
    window.electronAPI?.showYoutube();
  }

  function handleLogout() {
    localStorage.clear();
    setCafe(null);
    window.electronAPI?.hideYoutube();
  }

  const containerStyle = youtubeVisible
    ? { height: '100vh', overflow: 'hidden' }
    : {};

  const updateBanner = updateVersion && (
    <div style={bannerStyle}>
      v{updateVersion} 업데이트 준비 완료
      <button onClick={() => window.electronAPI?.restartApp()} style={bannerBtnStyle}>
        지금 재시작
      </button>
    </div>
  );

  if (!cafe) return (
    <div style={containerStyle}>
      {updateBanner}
      <LoginPage onLogin={handleLogin} initialPendingToken={pending} oauthError={oauthError} />
    </div>
  );
  return (
    <div style={containerStyle}>
      {updateBanner}
      <DashboardPage cafe={cafe} onLogout={handleLogout} />
    </div>
  );
}

const bannerStyle = {
  position: 'sticky', top: 0, zIndex: 9999,
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
  background: '#1a1a2e', color: '#fff', fontSize: 13, fontWeight: 600,
  padding: '10px 16px',
};
const bannerBtnStyle = {
  padding: '5px 14px', borderRadius: 6, border: 'none',
  background: '#4caf50', color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: 13,
};
