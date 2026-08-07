import { useState } from 'react';
import { ChevronDown, ChevronUp, Heart, MessageCircle, Music2, X } from 'lucide-react';
import { vote, unvote, cancelRecommendation } from '../api';
import { hasVoted, markVoted, removeVote } from '../votedSongs';
import { CANCELLABLE_STATUSES, REC_STATUS_LABELS } from '../constants/recommendationStatus';
import { COMPACT_PLATFORM_BADGE, PLATFORM } from '../constants/platforms';

export default function SongCard({ slug, rec, onUpdate, onDelete, onToggle, showDate, position, isMyRequest, hideStatus, expanded }) {
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
    <article className='song-card'>
      <div className='song-card__row'>
        {position && <span className='song-card__position' aria-label={`${position}번째`}>{position}</span>}
        {rec.thumbnail
          ? <img src={rec.thumbnail} alt='' className='song-card__thumb' />
          : <div className='song-card__thumb song-card__thumb--fallback'><Music2 size={20} aria-hidden='true' /></div>
        }
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
          <div className='song-card__details'>
            {!hideStatus && <span className={`status-badge status-badge--${rec.status}`}>{REC_STATUS_LABELS[rec.status]}</span>}
            {showDate && rec.requested_at && (
              <span>{new Date(rec.requested_at).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' })}</span>
            )}
            {!isMyRequest && rec.requester_name && <span>신청 · {rec.requester_name}</span>}
            {isMyRequest && <span className='song-card__mine'>내 신청곡</span>}
          </div>
        </div>
        <button
          type='button'
          onClick={onToggle}
          className='icon-button song-card__comments'
          aria-expanded={expanded}
          aria-label={expanded ? '댓글 닫기' : '댓글 보기'}
        >
          {expanded ? <ChevronUp size={19} aria-hidden='true' /> : <ChevronDown size={19} aria-hidden='true' />}
        </button>
      </div>

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
          <span>{expanded ? '댓글 닫기' : '댓글 보기'}</span>
        </button>
        {cancellable && (
          <button type='button' onClick={handleCancel} className='pill-action pill-action--danger'>
            <X size={16} aria-hidden='true' />
            <span>신청 취소하기</span>
          </button>
        )}
      </div>

      {error && <div className='feedback feedback--error song-card__error' role='alert'>{error}</div>}
    </article>
  );
}
