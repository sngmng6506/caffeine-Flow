import { AudioLines, LoaderCircle, Pause } from 'lucide-react';
import SongThumbnail from '../components/SongThumbnail';
import { PLAYBACK_STATE } from '../constants/playbackState';

export default function NowPlaying({ rec, playbackState = PLAYBACK_STATE.UNKNOWN }) {
  if (!rec) return null;

  const isPaused = playbackState === PLAYBACK_STATE.PAUSED;
  const isBuffering = playbackState === PLAYBACK_STATE.BUFFERING;
  const label = isPaused ? '일시정지 중' : isBuffering ? '불러오는 중' : '재생 중';
  const StatusIcon = isPaused ? Pause : isBuffering ? LoaderCircle : AudioLines;

  return (
    <section className='now-playing' aria-label={`현재 ${label}인 곡`}>
      <div className={`now-playing__status now-playing__status--${playbackState}`}>
        <StatusIcon size={16} aria-hidden='true' />
        <span>{label}</span>
        {!isPaused && !isBuffering && <span className='now-playing__pulse' aria-hidden='true' />}
      </div>
      <div className='now-playing__content'>
        <SongThumbnail
          src={rec.thumbnail}
          className='now-playing__thumb'
          fallbackClassName='now-playing__thumb--fallback'
          iconSize={24}
        />
        <div className='now-playing__info'>
          <h2 className='now-playing__title'>{rec.title}</h2>
          <p className='now-playing__channel'>{rec.channel_title}</p>
        </div>
      </div>
    </section>
  );
}
