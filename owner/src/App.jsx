import { useState, useEffect } from 'react';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import { parseInitialState } from './utils/initialSession.mjs';
import { resetPlaybackSession } from './pages/dashboard/playbackSession.mjs';

const initialState = parseInitialState();

export default function App() {
  const [cafe, setCafe]             = useState(initialState.cafe);
  const [pending]                   = useState(initialState.pending);
  const [oauthError]                = useState(initialState.oauthError);
  const [youtubeVisible, setYoutubeVisible] = useState(false);
  const [updateVersion, setUpdateVersion]   = useState(null);

  useEffect(() => {
    const removeYoutubeState = window.electronAPI?.onYoutubeState(visible => setYoutubeVisible(visible));
    const removeUpdateDownloaded = window.electronAPI?.onUpdateDownloaded(version => setUpdateVersion(version));
    // 앱 시작 시 이미 로그인 상태면 YouTube 패널 바로 열기
    if (initialState.cafe) window.electronAPI?.showYoutube();

    return () => {
      if (typeof removeYoutubeState === 'function') removeYoutubeState();
      if (typeof removeUpdateDownloaded === 'function') removeUpdateDownloaded();
    };
  }, []);

  function handleLogin(cafeData) {
    setCafe(cafeData);
    window.electronAPI?.showYoutube();
  }

  function handleLogout() {
    // 로그아웃은 BrowserView를 파괴하므로 같은 Electron lease를 재사용하지
    // 않는다. HTTP 종료 정리가 실패해도 다음 로그인 리더가 고아 playing을 복구한다.
    resetPlaybackSession(cafe?.slug);
    localStorage.clear();
    setCafe(null);
    window.electronAPI?.hideYoutube();
  }

  const containerStyle = youtubeVisible
    ? { height: '100vh', overflow: 'hidden' }
    : {};

  const updateBanner = updateVersion && (
    <div className="owner-update-banner">
      v{updateVersion} 업데이트를 설치할 수 있어요.
      <button
        type="button"
        onClick={() => window.electronAPI?.restartApp()}
        className="owner-btn owner-btn--primary"
      >
        앱 다시 시작
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
      <DashboardPage cafe={cafe} onLogout={handleLogout} updateBanner={updateBanner} />
    </div>
  );
}
