import { useState } from 'react';
import SettingsStatus from './SettingsStatus';

const SHORTCUT_GROUPS = [
  {
    platform: 'YouTube',
    color: '#ff0000',
    note: 'YouTube는 계정 불필요 · Music은 로그인 권장',
    links: [
      { label: 'YouTube Music', url: 'https://music.youtube.com', action: 'bgm' },
      { label: 'YouTube', url: 'https://www.youtube.com' },
      { label: '인기 음악 차트', url: 'https://www.youtube.com/feed/trending?bp=4gINGgt5dG1hX2NoYXJ0cw%3D%3D' },
      {
        label: 'YouTube Music 로그인',
        url: 'https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fmusic.youtube.com%2F',
        action: 'login',
      },
    ],
  },
  {
    platform: 'Spotify',
    color: '#1db954',
    note: '계정 필요 (Premium 권장)',
    links: [
      { label: 'Spotify',         url: 'https://open.spotify.com',                       action: 'bgm' },
      { label: '카페 플레이리스트', url: 'https://open.spotify.com/search/cafe%20playlist', action: 'bgm' },
      { label: '로그인',           url: 'https://accounts.spotify.com/ko/login',          action: 'login' },
      { label: '쿠키 초기화 후 로그인', url: 'https://accounts.spotify.com/ko/login',     action: 'clear-spotify-login' },
    ],
  },
  {
    platform: 'SoundCloud',
    color: '#ff5500',
    note: '계정 불필요',
    links: [
      { label: 'SoundCloud', url: 'https://soundcloud.com', action: 'bgm' },
    ],
  },
];

export default function ShortcutsTab() {
  const [message, setMessage] = useState(null);

  async function runShortcutAction(link) {
    const { action, url } = link;
    setMessage(null);
    try {
      if (action === 'login') {
        window.electronAPI?.openLoginWindow(url);
        return;
      }
      if (action === 'clear-spotify-login') {
        const count = await window.electronAPI?.clearSpotifySession();
        setMessage({ tone: 'success', text: `Spotify 로그인 정보 ${count || 0}개를 정리하고 로그인 창을 열었습니다.` });
        window.electronAPI?.openLoginWindow(url);
        return;
      }
      window.electronAPI?.setBgmUrl(url);
    } catch (error) {
      setMessage({ tone: 'error', text: error.message || '음악 서비스 작업을 완료하지 못했습니다.' });
    }
  }

  return (
    <div style={styles.wrap}>
      <SettingsStatus tone={message?.tone}>{message?.text}</SettingsStatus>
      {SHORTCUT_GROUPS.map(({ platform, color, note, links }) => (
        <div key={platform} style={styles.group}>
          <div style={styles.groupHeader}>
            <span aria-hidden="true" style={{ ...styles.platformDot, background: color }} />
            <span style={styles.platformName}>{platform}</span>
            {note && <span style={styles.note}>· {note}</span>}
          </div>
          <div style={styles.links}>
            {links.map((link) => {
              const isReset = link.action === 'clear-spotify-login';
              return (
                <button
                  key={link.label}
                  onClick={() => runShortcutAction(link)}
                  title={isReset ? 'DataDome 봇 차단 마커가 쿠키에 박혔을 때 사용' : undefined}
                  style={{ ...styles.linkBtn, ...(isReset ? styles.resetBtn : {}) }}
                >
                  {link.label}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <div style={styles.help}>
        링크 버튼: 오른쪽 화면에서 페이지 열기 · 로그인 버튼: 별도 창 · 점선 테두리: 쿠키 초기화 후 로그인
      </div>
    </div>
  );
}

const styles = {
  wrap: { paddingTop: 4 },
  group: { marginBottom: 10, padding: '12px 14px', border: '1px solid #e4e7ec', borderRadius: 8, background: '#fff' },
  groupHeader: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
  platformDot: { width: 8, height: 8, flexShrink: 0, borderRadius: 999 },
  platformName: { color: '#344054', fontSize: 12, fontWeight: 700 },
  note: { color: '#667085', fontSize: 11 },
  links: { display: 'flex', flexWrap: 'wrap', gap: 8 },
  linkBtn: { minHeight: 36, padding: '7px 12px', borderRadius: 8, border: '1px solid #d0d5dd', background: '#fff', color: '#475467', cursor: 'pointer', fontSize: 12, fontWeight: 600 },
  resetBtn: { borderStyle: 'dashed' },
  help: { marginTop: 4, color: '#98a2b3', fontSize: 11, lineHeight: 1.5 },
};
