import { useState } from 'react';

const MUSIC_HOSTS = ['youtube.com', 'youtu.be', 'soundcloud.com', 'spotify.com', 'spotify.link'];

function isSupportedMusicUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && MUSIC_HOSTS.some(host =>
      parsed.hostname === host || parsed.hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
}

export default function DefaultSection({ defaultVideo, isPlaying, onSet, onClear, widevineStatus }) {
  const [inputUrl, setInputUrl] = useState('');
  const [setting, setSetting] = useState(false);
  const [error, setError] = useState('');
  const [imageError, setImageError] = useState(false);

  async function handleSet() {
    const url = inputUrl.trim();
    if (!isSupportedMusicUrl(url)) {
      setError('YouTube, Spotify, SoundCloud의 HTTPS 링크를 입력해 주세요.');
      return;
    }
    setSetting(true);
    setError('');
    try {
      let info = { url, title: url, thumbnail: null };
      try {
        const base = import.meta.env.VITE_SERVER_URL ? `${import.meta.env.VITE_SERVER_URL}/api/v1` : '/api/v1';
        const response = await fetch(`${base}/tracks/oembed?url=${encodeURIComponent(url)}`);
        if (response.ok) {
          const data = await response.json();
          info = { url, title: data.title || url, thumbnail: data.thumbnail || null };
        }
      } catch {
        // 메타데이터 조회에 실패해도 입력한 링크는 기본 BGM으로 사용할 수 있다.
      }
      onSet(info);
      setInputUrl('');
    } catch {
      setError('기본 BGM을 설정하지 못했어요. 링크를 확인하고 다시 시도해 주세요.');
    } finally {
      setSetting(false);
    }
  }

  if (defaultVideo) {
    const url = defaultVideo.url || (defaultVideo.videoId?.startsWith('http')
      ? defaultVideo.videoId
      : `https://www.youtube.com/watch?v=${defaultVideo.videoId}`);
    const isSpotify = /spotify\.(com|link)/i.test(url);

    return (
      <div
        className="owner-default-card"
        draggable
        onDragStart={event => {
          if (event.target.closest('button')) {
            event.preventDefault();
            return;
          }
          event.dataTransfer.setData('text/plain', JSON.stringify({
            type: 'default',
            videoId: defaultVideo.videoId || url,
            title: defaultVideo.title,
            thumbnail: defaultVideo.thumbnail,
          }));
          event.dataTransfer.effectAllowed = 'move';
        }}
      >
        <div className="owner-default-card__content">
          {defaultVideo.thumbnail && !imageError ? (
            <img
              src={defaultVideo.thumbnail}
              alt=""
              className="owner-default-card__thumb"
              onError={() => setImageError(true)}
            />
          ) : (
            <div className="owner-default-card__thumb owner-thumb-placeholder" aria-hidden="true">CF</div>
          )}
          <div className="owner-default-card__info">
            {isPlaying && <span className="owner-inline-status">재생 중</span>}
            <div className="owner-default-card__title">{defaultVideo.title}</div>
            <div className="owner-default-card__hint">끌어서 재생 중이나 대기 곡으로 옮길 수 있어요.</div>
            {isSpotify && (
              <div className="owner-default-card__hint">Spotify 로그인 필요 · Premium 계정 필요</div>
            )}
            {isSpotify && widevineStatus === 'not_found' && (
              <div className="owner-default-card__warning">
                Spotify 재생 환경을 준비하지 못했어요. Chrome 설치 상태를 확인해 주세요.
              </div>
            )}
          </div>
        </div>
        <div className="owner-default-card__actions">
          <button
            type="button"
            onClick={() => window.electronAPI?.setBgmUrl(url)}
            draggable={false}
            onDragStart={event => event.stopPropagation()}
            className="owner-btn owner-btn--secondary"
          >오른쪽 화면에서 열기</button>
          {isSpotify && (
            <button
              type="button"
              onClick={() => window.electronAPI?.openLoginWindow('https://accounts.spotify.com/ko/login')}
              draggable={false}
              onDragStart={event => event.stopPropagation()}
              className="owner-btn owner-btn--secondary"
            >Spotify 로그인</button>
          )}
          <button
            type="button"
            onClick={onClear}
            draggable={false}
            onDragStart={event => event.stopPropagation()}
            className="owner-btn owner-btn--danger"
          >기본 BGM 해제</button>
        </div>
      </div>
    );
  }

  return (
    <div className="owner-bgm-form">
      <label htmlFor="owner-bgm-url" className="owner-bgm-form__label">
        기본 BGM에는 재생목록 사용을 권장해요.
      </label>
      <input
        id="owner-bgm-url"
        value={inputUrl}
        onChange={event => { setInputUrl(event.target.value); setError(''); }}
        onKeyDown={event => event.key === 'Enter' && handleSet()}
        placeholder="음악 또는 재생목록 링크를 입력하세요"
        className="owner-input"
      />
      <button
        type="button"
        onClick={handleSet}
        disabled={setting || !inputUrl.trim()}
        className="owner-btn owner-btn--primary"
      >
        {setting ? '설정 중…' : '기본 BGM 설정'}
      </button>
      {error && <div role="alert" className="owner-form-error">{error}</div>}
    </div>
  );
}
