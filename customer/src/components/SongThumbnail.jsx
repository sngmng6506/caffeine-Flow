import { useEffect, useId, useRef, useState } from 'react';
import { Music2 } from 'lucide-react';

const YOUTUBE_THUMBNAIL_HOSTS = new Set(['img.youtube.com', 'i.ytimg.com']);

// 네트워크가 잠깐 끊기거나 CDN이 한 번 흔들리면 이미지 하나가 실패한다. 그 곡은
// 화면에 남아 있는 동안 계속 대체 표시가 되고, 손님이 화면을 새로 열어야 제대로
// 보였다. 짧게 두 번 다시 받아 본다.
const RETRY_DELAYS_MS = [400, 1500];

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
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const patternId = useId();
  const retryTimer = useRef(null);

  useEffect(() => {
    setFailed(false);
    setAttempt(0);
  }, [src]);

  useEffect(() => () => clearTimeout(retryTimer.current), []);

  // 연결이 돌아오면 다시 받아 본다. 손님이 화면을 새로 열지 않아도 복구된다.
  useEffect(() => {
    function retryOnline() {
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
    if (attempt >= RETRY_DELAYS_MS.length) return;
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
        if (isUnavailableYouTubeThumbnail(event.currentTarget)) setFailed(true);
      }}
      onError={handleError}
    />
  );
}
