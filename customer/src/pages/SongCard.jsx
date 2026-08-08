import { useState } from 'react';
import { Heart, MessageCircle, X } from 'lucide-react';
import { vote, unvote, cancelRecommendation } from '../api';
import { hasVoted, markVoted, removeVote } from '../votedSongs';
import { CANCELLABLE_STATUSES, REC_STATUS_LABELS } from '../constants/recommendationStatus';
import { COMPACT_PLATFORM_BADGE, PLATFORM } from '../constants/platforms';
import SongThumbnail from '../components/SongThumbnail';
import LongPressCopy from '../components/LongPressCopy';

export default function SongCard({ slug, rec, onUpdate, onDelete, onToggle, onLinkCopyResult, showDate, position, isMyRequest, hideStatus, expanded }) {
  const [error, setError] = useState('');
  const voted = hasVoted(slug, rec.id);
  const cancellable = isMyRequest && CANCELLABLE_STATUSES.includes(rec.status);
  const platformBadge = rec.platform && rec.platform !== PLATFORM.YOUTUBE ? COMPACT_PLATFORM_BADGE[rec.platform] : null;

  async function handleCancel() {
    if (!window.confirm('이 신청곡을 취소할까요?\n대기열에서 사라지며 다시 들으려면 새로 신청해야 해요.')) return;
    setError('');
    try {
      await cancelRecommendation(slug, rec.id);
      onDelete?.(rec.id);
    } catch (caught) {
      setError(caught.message);
    }
  }

  async function handleVote() {
    setError('');
    try {
      if (voted) {
        const updated = await unvote(slug, rec.id);
        removeVote(slug, rec.id);
        onUpdate(updated);
      } else {
        const updated = await vote(slug, rec.id);
        markVoted(slug, rec.id);
        onUpdate(updated);
      }
    } catch (caught) {
      setError(caught.message);
    }
  }

  return (
    <LongPressCopy videoId={rec.video_id} onResult={onLinkCopyResult}>
      <article className='song-card'>
      <div className='song-card__context'>
        <div className='song-card__details'>
          {position && <span className='song-card__position'>{position}번째</span>}
          {!hideStatus && <span className={`status-badge status-badge--${rec.status}`}>{REC_STATUS_LABELS[rec.status]}</span>}
          {isMyRequest && <span className='song-card__mine'>내 신청곡</span>}
          {!isMyRequest && rec.requester_name && <span>{rec.requester_name}</span>}
          {showDate && rec.requested_at && (
            <span>{new Date(rec.requested_at).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' })}</span>
          )}
        </div>
      </div>

      <div className='song-card__body'>
        <h3 className='song-card__title'>{rec.title}</h3>
        <div className='song-card__meta'>
          {platformBadge && (
            <span className='platform-badge platform-badge--compact' style={{ background: platformBadge.bg }}>
              {platformBadge.label}
            </span>
          )}
          <span>{rec.channel_title}</span>
          {rec.duration && <span>· {rec.duration}</span>}
        </div>
      </div>

      <SongThumbnail
        src={rec.thumbnail}
        className='song-card__thumb'
        fallbackClassName='song-card__thumb--fallback'
      />

      <div className='song-card__actions'>
        <button
          type='button'
          onClick={handleVote}
          className={`pill-action${voted ? ' pill-action--active' : ''}`}
          aria-pressed={voted}
          aria-label={`좋아요 ${rec.vote_count || 0}개${voted ? ', 선택됨' : ''}`}
        >
          <Heart size={16} fill={voted ? 'currentColor' : 'none'} aria-hidden='true' />
          <span>좋아요</span>
          <strong>{rec.vote_count || 0}</strong>
        </button>
        <button type='button' onClick={onToggle} className='pill-action' aria-expanded={expanded}>
          <MessageCircle size={16} aria-hidden='true' />
          <span>댓글</span>
        </button>
        {cancellable && (
          <button type='button' onClick={handleCancel} className='pill-action pill-action--danger'>
            <X size={16} aria-hidden='true' />
            <span>취소</span>
          </button>
        )}
      </div>

      {error && <div className='feedback feedback--error song-card__error' role='alert'>{error}</div>}
      </article>
    </LongPressCopy>
  );
}
