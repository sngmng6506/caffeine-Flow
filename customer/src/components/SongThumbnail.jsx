import { useEffect, useId, useRef, useState } from 'react';
import { Music2 } from 'lucide-react';

const YOUTUBE_THUMBNAIL_HOSTS = new Set(['img.youtube.com', 'i.ytimg.com']);

// 네트워크가 잠깐 끊기거나 CDN이 한 번 흔들리면 이미지 하나가 실패한다. 그 곡은
// 화면에 남아 있는 동안 계속 대체 표시가 되고, 손님이 화면을 새로 열어야 제대로
// 보였다. 짧게 두 번 다시 받아 본다.
const RETRY_DELAYS_MS = [400, 1500];

// 재시도까지 끝내 실패한 주소. 탭을 오갈 때마다 컴포넌트가 다시 마운트되는데,
// 기억해 두지 않으면 죽은 주소를 왕복할 때마다 다시 받는다(실측 3회 왕복 87회).
// 새로고침하면 비워진다 — 일시적인 실패를 영구히 낙인찍지 않기 위해서다.
const deadSources = new Set();

function isUnavailableYouTubeThumbnail(image) {
  try {
    const hostname = new URL(image.currentSrc || image.src).hostname;
    return YOUTUBE_THUMBNAIL_HOSTS.has(hostname)
      && image.naturalWidth <= 120
      && image.naturalHeight <= 90;
  } catch {
    return false;
  }
}

export default function SongThumbnail({ src, className, fallbackClassName, iconSize = 20 }) {
  const [failed, setFailed] = useState(() => deadSources.has(src));
  const [attempt, setAttempt] = useState(0);
  const patternId = useId();
  const retryTimer = useRef(null);

  useEffect(() => {
    setFailed(deadSources.has(src));
    setAttempt(0);
  }, [src]);

  useEffect(() => () => clearTimeout(retryTimer.current), []);

  // 연결이 돌아오면 다시 받아 본다. 손님이 화면을 새로 열지 않아도 복구된다.
  useEffect(() => {
    function retryOnline() {
      // 연결이 돌아왔으니 죽은 주소 판정도 다시 해 본다.
      deadSources.clear();
      setFailed(false);
      setAttempt(0);
    }
    window.addEventListener('online', retryOnline);
    return () => window.removeEventListener('online', retryOnline);
  }, []);

  function handleError() {
    // 재시도 중에도 대체 표시를 유지한다. 깨진 이미지의 빈 회색 상자를 노출하지
    // 않는다(DESIGN_GUIDE.md#이미지).
    setFailed(true);
    if (attempt >= RETRY_DELAYS_MS.length) {
      deadSources.add(src);
      return;
    }
    retryTimer.current = setTimeout(() => {
      setAttempt(value => value + 1);
      setFailed(false);
    }, RETRY_DELAYS_MS[attempt]);
  }

  if (!src || failed) {
    return (
      <span className={`${className} ${fallbackClassName}`} aria-hidden='true'>
        <svg className='song-thumbnail__fallback-pattern' viewBox='0 0 96 54' preserveAspectRatio='none'>
          <defs>
            <pattern id={patternId} width='12' height='12' patternUnits='userSpaceOnUse'>
              <path d='M-3 12 12-3M6 15 15 6' fill='none' stroke='currentColor' strokeWidth='1' />
            </pattern>
          </defs>
          <rect width='96' height='54' fill={`url(#${patternId})`} />
        </svg>
        <Music2 className='song-thumbnail__fallback-icon' size={iconSize} />
      </span>
    );
  }

  // 브라우저가 실패를 캐시하면 같은 주소로는 다시 받지 못한다. 재시도에만 표식을 붙인다.
  const requestSrc = attempt === 0
    ? src
    : `${src}${src.includes('?') ? '&' : '?'}cf-retry=${attempt}`;

  return (
    <img
      src={requestSrc}
      alt=''
      className={className}
      onLoad={event => {
        // YouTube가 주는 "영상 없음" 자리 이미지도 다시 받을 이유가 없다.
        if (isUnavailableYouTubeThumbnail(event.currentTarget)) {
          deadSources.add(src);
          setFailed(true);
        }
      }}
      onError={handleError}
    />
  );
}
