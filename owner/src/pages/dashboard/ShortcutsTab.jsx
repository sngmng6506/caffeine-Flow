import { useState } from 'react';
import SettingsStatus from './SettingsStatus';

const MUSIC_SERVICES = [
  {
    name: 'YouTube',
    note: '로그인 없이 재생 가능',
    color: '#ff0000',
    url: 'https://www.youtube.com',
    loginUrl: 'https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fwww.youtube.com%2F',
  },
  {
    name: 'YouTube Music',
    note: '무료 재생 가능 · 로그인 권장',
    color: '#ff0000',
    url: 'https://music.youtube.com',
    loginUrl: 'https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fmusic.youtube.com%2F',
  },
  {
    name: 'Spotify',
    note: '로그인 필요 · Premium 계정 필요',
    color: '#1db954',
    url: 'https://open.spotify.com',
    loginUrl: 'https://accounts.spotify.com/ko/login',
  },
  {
    name: 'SoundCloud',
    note: '로그인 없이 재생 가능',
    color: '#ff5500',
    url: 'https://soundcloud.com',
    loginUrl: 'https://soundcloud.com/signin',
  },
];

export default function ShortcutsTab() {
  const [message, setMessage] = useState(null);

  function openService(url) {
    setMessage(null);
    window.electronAPI?.setBgmUrl(url);
  }

  function openLogin(url) {
    setMessage(null);
    window.electronAPI?.openLoginWindow(url);
  }

  async function resetSpotifyLogin() {
    setMessage(null);
    try {
      const count = await window.electronAPI?.clearSpotifySession();
      setMessage({ tone: 'success', text: `Spotify 로그인 정보 ${count || 0}개를 정리했어요.` });
      window.electronAPI?.openLoginWindow('https://accounts.spotify.com/ko/login');
    } catch (error) {
      setMessage({ tone: 'error', text: error.message || 'Spotify 로그인 정보를 정리하지 못했어요. 다시 시도해 주세요.' });
    }
  }

  return (
    <div style={styles.wrap}>
      <SettingsStatus tone={message?.tone}>{message?.text}</SettingsStatus>

      <div style={styles.serviceList}>
        {MUSIC_SERVICES.map((service, index) => (
          <div
            key={service.name}
            style={{ ...styles.serviceRow, ...(index === MUSIC_SERVICES.length - 1 ? styles.lastServiceRow : {}) }}
          >
            <div style={styles.serviceInfo}>
              <div style={styles.serviceTitleRow}>
                <span aria-hidden="true" style={{ ...styles.platformDot, background: service.color }} />
                <span style={styles.serviceName}>{service.name}</span>
              </div>
              <span style={styles.note}>{service.note}</span>
            </div>
            <div style={styles.actions}>
              <button type="button" onClick={() => openService(service.url)} style={styles.openBtn}>
                오른쪽 화면에서 열기
              </button>
              <button type="button" onClick={() => openLogin(service.loginUrl)} style={styles.loginBtn}>
                로그인
              </button>
            </div>
          </div>
        ))}
      </div>

      <details style={styles.troubleshooting}>
        <summary style={styles.troubleshootingSummary}>로그인 문제 해결</summary>
        <div style={styles.troubleshootingBody}>
          <span style={styles.troubleshootingText}>Spotify 로그인이 반복해서 막힐 때만 사용해 주세요.</span>
          <button type="button" onClick={resetSpotifyLogin} style={styles.resetBtn}>Spotify 로그인 정보 초기화</button>
        </div>
      </details>
    </div>
  );
}

const styles = {
  wrap: { paddingTop: 4 },
  serviceList: { overflow: 'hidden', border: '1px solid var(--owner-stroke)', borderRadius: 10, background: '#fff' },
  serviceRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 14, padding: '14px', borderBottom: '1px solid var(--owner-stroke)' },
  lastServiceRow: { borderBottom: 'none' },
  serviceInfo: { display: 'flex', minWidth: 180, flex: '1 1 220px', flexDirection: 'column', gap: 4 },
  serviceTitleRow: { display: 'flex', alignItems: 'center', gap: 7 },
  platformDot: { width: 8, height: 8, flexShrink: 0, borderRadius: 999 },
  serviceName: { color: 'var(--owner-text)', fontSize: 13, fontWeight: 700 },
  note: { color: 'var(--owner-text-muted)', fontSize: 12 },
  actions: { display: 'flex', flex: '0 1 auto', flexWrap: 'wrap', gap: 8 },
  openBtn: { minHeight: 40, padding: '8px 13px', borderRadius: 8, border: 'none', background: 'var(--owner-primary)', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 700 },
  loginBtn: { minHeight: 40, padding: '8px 13px', borderRadius: 8, border: '1px solid var(--owner-stroke)', background: '#fff', color: 'var(--owner-text)', cursor: 'pointer', fontSize: 12, fontWeight: 700 },
  troubleshooting: { marginTop: 10, border: '1px solid var(--owner-stroke)', borderRadius: 8, background: '#fff', overflow: 'hidden' },
  troubleshootingSummary: { padding: '12px 14px', color: 'var(--owner-text-muted)', cursor: 'pointer', fontSize: 12, fontWeight: 700 },
  troubleshootingBody: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, padding: '12px 14px', borderTop: '1px solid var(--owner-stroke)' },
  troubleshootingText: { color: 'var(--owner-text-muted)', fontSize: 12 },
  resetBtn: { minHeight: 40, padding: '8px 12px', borderRadius: 8, border: '1px solid var(--owner-stroke)', background: '#fff', color: 'var(--owner-text)', cursor: 'pointer', fontSize: 12, fontWeight: 700 },
};
