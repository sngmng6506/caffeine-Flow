import { useState } from 'react';

export default function DefaultSection({ defaultVideo, isPlaying, onSet, onClear, widevineStatus }) {
  const [inputUrl, setInputUrl] = useState('');
  const [setting, setSetting]   = useState(false);
  const [error, setError]       = useState('');

  async function handleSet() {
    const url = inputUrl.trim();
    if (!/^https?:\/\//i.test(url)) { setError('http(s)로 시작하는 URL을 입력하세요'); return; }
    setSetting(true); setError('');
    try {
      // YouTube/SoundCloud/Spotify는 서버 oembed로 메타데이터 시도, 그 외 또는 플레이리스트는 URL만 저장
      let info = { url, title: url, thumbnail: null };
      try {
        const base = import.meta.env.VITE_SERVER_URL ? `${import.meta.env.VITE_SERVER_URL}/api/v1` : '/api/v1';
        const res  = await fetch(`${base}/tracks/oembed?url=${encodeURIComponent(url)}`);
        if (res.ok) {
          const data = await res.json();
          info = { url, title: data.title || url, thumbnail: data.thumbnail || null };
        }
      } catch { /* oembed 실패는 무시하고 URL만 저장 */ }
      onSet(info);
      setInputUrl('');
    } catch {
      setError('등록에 실패했습니다');
    } finally {
      setSetting(false);
    }
  }

  if (defaultVideo) {
    const url = defaultVideo.url || (defaultVideo.videoId?.startsWith('http')
      ? defaultVideo.videoId
      : `https://www.youtube.com/watch?v=${defaultVideo.videoId}`);
    return (
      <div
        style={dfStyles.card}
        draggable={true}
        onDragStart={e => {
          e.dataTransfer.setData('text/plain', JSON.stringify({
            type: 'default',
            videoId:   defaultVideo.videoId || url,
            title:     defaultVideo.title,
            thumbnail: defaultVideo.thumbnail,
          }));
          e.dataTransfer.effectAllowed = 'move';
        }}
      >
        <div
          style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0, cursor: 'pointer' }}
          onClick={() => window.electronAPI?.setBgmUrl(url)}
          title="클릭하면 해당 링크로 이동"
          draggable={false}
          onDragStart={e => e.stopPropagation()}
        >
        {defaultVideo.thumbnail
          ? <img src={defaultVideo.thumbnail} alt="" style={dfStyles.thumb} />
          : <div style={{ ...dfStyles.thumb, background: '#eee' }} />
        }
        <div style={dfStyles.info}>
          {isPlaying && <span style={dfStyles.playing}>▶ 재생 중</span>}
          <div style={dfStyles.title}>{defaultVideo.title}</div>
          <div style={dfStyles.hint}>클릭하면 해당 플레이어로 이동 · 신청곡 없을 때 자동 재생</div>
          {/spotify\.com/i.test(url) && (
            <div style={{ ...dfStyles.hint, color: '#1db954' }}>※ Spotify 계정 로그인 필요 (Premium 권장)</div>
          )}
          {/spotify\.com/i.test(url) && widevineStatus === 'not_found' && (
            <div style={dfStyles.warn}>⚠️ Chrome 미설치 — Spotify 재생 불가</div>
          )}
          {/spotify\.com/i.test(url) && widevineStatus?.startsWith('loaded') && (
            <div style={{ ...dfStyles.hint, color: '#1db954' }}>✓ Widevine 로드됨</div>
          )}
        </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0 }}>
          {/spotify\.com/i.test(url) && (
            <button
              onClick={() => window.electronAPI?.openLoginWindow('https://accounts.spotify.com/ko/login')}
              draggable={false} onDragStart={e => e.stopPropagation()}
              style={{ ...dfStyles.clearBtn, background: '#1db954', color: '#fff', border: 'none' }}
            >Spotify 로그인</button>
          )}
          <button
            onClick={onClear}
            draggable={false}
            onDragStart={e => e.stopPropagation()}
            style={dfStyles.clearBtn}
          >해제</button>
        </div>
      </div>
    );
  }

  return (
    <div style={dfStyles.inputRow}>
      <input
        value={inputUrl}
        onChange={e => { setInputUrl(e.target.value); setError(''); }}
        onKeyDown={e => e.key === 'Enter' && handleSet()}
        placeholder="YouTube/Spotify/SoundCloud 링크 — 플레이리스트도 OK"
        style={dfStyles.input}
      />
      <button onClick={handleSet} disabled={setting || !inputUrl.trim()} style={dfStyles.setBtn}>
        {setting ? '...' : '설정'}
      </button>
      {error && <div style={dfStyles.error}>{error}</div>}
    </div>
  );
}

const dfStyles = {
  card:     { display: 'flex', gap: 10, alignItems: 'center', padding: '10px 0', borderTop: '1px solid #eee' },
  thumb:    { width: 80, height: 56, borderRadius: 6, objectFit: 'cover', flexShrink: 0 },
  info:     { flex: 1, minWidth: 0 },
  playing:  { fontSize: 11, fontWeight: 700, color: '#2196f3', display: 'block', marginBottom: 2 },
  title:    { fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  hint:     { fontSize: 11, color: '#aaa', marginTop: 2 },
  warn:     { fontSize: 11, color: '#e63946', marginTop: 2 },
  clearBtn: { fontSize: 12, padding: '4px 10px', borderRadius: 6, border: '1px solid #ddd', background: '#fff', cursor: 'pointer', flexShrink: 0 },
  inputRow: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', paddingTop: 8, borderTop: '1px solid #eee' },
  input:    { flex: 1, fontSize: 13, padding: '6px 10px', borderRadius: 8, border: '1px solid #ddd', outline: 'none', minWidth: 0 },
  setBtn:   { fontSize: 12, padding: '6px 14px', borderRadius: 8, background: '#1a1a2e', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600, flexShrink: 0 },
  error:    { fontSize: 12, color: '#e63946', width: '100%' },
};
