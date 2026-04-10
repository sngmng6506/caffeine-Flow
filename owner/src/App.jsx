import { useState, useEffect } from 'react';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';

function parseInitialState() {
  const params = new URLSearchParams(window.location.search);

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

  useEffect(() => {
    window.electronAPI?.onYoutubeState(visible => setYoutubeVisible(visible));
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
    ? { width: '42vw', height: '100vh', overflowY: 'auto' }
    : {};

  if (!cafe) return (
    <div style={containerStyle}>
      <LoginPage onLogin={handleLogin} initialPendingToken={pending} oauthError={oauthError} />
    </div>
  );
  return (
    <div style={containerStyle}>
      <DashboardPage cafe={cafe} onLogout={handleLogout} />
    </div>
  );
}
