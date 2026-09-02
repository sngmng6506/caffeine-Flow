import { useEffect, useId, useState } from 'react';
import { Music2 } from 'lucide-react';

export default function SongThumbnail({ src, className, fallbackClassName, iconSize = 20 }) {
  const [failed, setFailed] = useState(false);
  const patternId = useId();

  useEffect(() => {
    setFailed(false);
  }, [src]);

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

  return <img src={src} alt='' className={className} onError={() => setFailed(true)} />;
}
