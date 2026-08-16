import { useEffect, useState } from 'react';
import { ChevronDown, LoaderCircle, Pause } from 'lucide-react';
import SongThumbnail from '../components/SongThumbnail';
import { PLAYBACK_STATE } from '../constants/playbackState';
import CafeComments from './CafeComments';

const WAVE_BAR_HEIGHTS = [8, 18, 12, 24, 15, 21, 10];

function PlaybackWaveMark() {
  return (
    <svg className='now-playing__wave-mark' viewBox='0 0 52 28' aria-hidden='true'>
      <defs>
        <linearGradient id='now-playing-wave-gradient' x1='0' y1='0' x2='0' y2='1'>
          <stop offset='0' stopColor='var(--cf-brand)' />
          <stop offset='1' stopColor='var(--cf-accent-lilac)' />
        </linearGradient>
      </defs>
      {WAVE_BAR_HEIGHTS.map((height, index) => (
        <rect
          key={index}
          x={2 + index * 7}
          y={(28 - height) / 2}
          width='4'
          height={height}
          rx='2'
          fill='url(#now-playing-wave-gradient)'
          style={{ '--wave-index': index }}
        />
      ))}
    </svg>
  );
}

export default function NowPlaying({ rec, playbackState = PLAYBACK_STATE.UNKNOWN, commentKey, slug }) {
  const [commentsOpen, setCommentsOpen] = useState(false);

  useEffect(() => {
    setCommentsOpen(false);
  }, [commentKey]);

  if (!rec) return null;

  const isPaused = playbackState === PLAYBACK_STATE.PAUSED;
  const isBuffering = playbackState === PLAYBACK_STATE.BUFFERING;
  const label = isPaused ? '일시정지 중' : isBuffering ? '불러오는 중' : '재생 중';
  const showsWave = !isPaused && !isBuffering;
  const StatusIcon = isPaused ? Pause : LoaderCircle;

  const toggleComments = () => setCommentsOpen(value => !value);
  // 카드 전체를 눌러 댓글을 펼친다. 명시적 '댓글' 버튼 대신 은근한 화살표만 힌트로 둔다.
  const toggleProps = commentKey
    ? {
        role: 'button',
        tabIndex: 0,
        'aria-expanded': commentsOpen,
        'aria-label': commentsOpen ? '댓글 접기' : '댓글 펼치기',
        onClick: toggleComments,
        onKeyDown: (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            toggleComments();
          }
        },
      }
    : {};

  return (
    <section className='now-playing' aria-label={`현재 ${label}인 곡`}>
      <div className={`now-playing__status now-playing__status--${playbackState}`}>
        {showsWave ? <PlaybackWaveMark /> : <StatusIcon size={16} aria-hidden='true' />}
        <span>{label}</span>
      </div>
      <div className='now-playing__content' {...toggleProps}>
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
        {commentKey && (
          <ChevronDown
            size={18}
            className={`now-playing__comment-caret${commentsOpen ? ' is-open' : ''}`}
            aria-hidden='true'
          />
        )}
      </div>
      {commentsOpen && commentKey && (
        <div className='now-playing__comments'>
          <CafeComments key={commentKey} videoId={commentKey} slug={slug} />
        </div>
      )}
    </section>
  );
}
