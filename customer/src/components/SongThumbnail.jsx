import { useEffect, useState } from 'react';
import { Music2 } from 'lucide-react';

export default function SongThumbnail({ src, className, fallbackClassName, iconSize = 20 }) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (!src || failed) {
    return (
      <span className={`${className} ${fallbackClassName}`} aria-hidden='true'>
        <Music2 size={iconSize} />
      </span>
    );
  }

  return <img src={src} alt='' className={className} onError={() => setFailed(true)} />;
}
