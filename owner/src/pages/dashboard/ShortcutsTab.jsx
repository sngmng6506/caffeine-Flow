const SHORTCUT_GROUPS = [
  {
    platform: 'YouTube',
    color: '#ff0000',
    bg: '#fff5f5',
    note: '계정 불필요',
    links: [
      { label: 'YouTube Music', url: 'https://music.youtube.com' },
      { label: 'YouTube', url: 'https://www.youtube.com' },
      { label: '인기 음악 차트', url: 'https://www.youtube.com/feed/trending?bp=4gINGgt5dG1hX2NoYXJ0cw%3D%3D' },
    ],
  },
  {
    platform: 'Spotify',
    color: '#1db954',
    bg: '#f0fff5',
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
    bg: '#fff8f5',
    note: '계정 불필요',
    links: [
      { label: 'SoundCloud', url: 'https://soundcloud.com', action: 'bgm' },
    ],
  },
];

async function runShortcutAction(link) {
  const { action, url } = link;
  if (action === 'login') {
    window.electronAPI?.openLoginWindow(url);
    return;
  }
  if (action === 'clear-spotify-login') {
    const n = await window.electronAPI?.clearSpotifySession();
    alert(`Spotify 쿠키 ${n}개 삭제됨. 로그인 창을 엽니다.`);
    window.electronAPI?.openLoginWindow(url);
    return;
  }
  // default: navigate bgmView
  window.electronAPI?.setBgmUrl(url);
}

export default function ShortcutsTab() {
  return (
    <div style={{ paddingTop: 8 }}>
      {SHORTCUT_GROUPS.map(({ platform, color, bg, note, links }) => (
        <div key={platform} style={{ marginBottom: 14, borderRadius: 10, background: bg, padding: '12px 14px', border: `1px solid ${color}33` }}>
          <div style={{ fontSize: 12, fontWeight: 700, color, marginBottom: 10, letterSpacing: 0.3 }}>
            {platform}
            {note && <span style={{ marginLeft: 8, fontWeight: 400, color: '#888', fontSize: 11 }}>· {note}</span>}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {links.map((link) => {
              const isReset = link.action === 'clear-spotify-login';
              return (
                <button
                  key={link.label}
                  onClick={() => runShortcutAction(link)}
                  title={isReset ? 'DataDome 봇 차단 마커가 쿠키에 박혔을 때 사용' : undefined}
                  style={{
                    padding: '6px 14px', borderRadius: 20,
                    border: `1px ${isReset ? 'dashed' : 'solid'} ${color}`,
                    background: '#fff', color,
                    cursor: 'pointer', fontSize: 13, fontWeight: 600,
                    transition: 'opacity 0.15s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.opacity = '0.75'}
                  onMouseLeave={e => e.currentTarget.style.opacity = '1'}
                >
                  {link.label}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <div style={{ fontSize: 11, color: '#bbb', marginTop: 4 }}>
        링크 버튼: 오른쪽 화면에서 페이지 열기 · 로그인 버튼: 별도 창 · 점선 테두리: 쿠키 초기화 후 로그인
      </div>
    </div>
  );
}
