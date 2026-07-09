import { useState } from 'react';
import { vote, unvote, cancelRecommendation } from '../api';
import { hasVoted, markVoted, removeVote } from '../votedSongs';
import {
  CANCELLABLE_STATUSES,
  REC_STATUS,
  REC_STATUS_COLORS,
  REC_STATUS_LABELS,
} from '../constants/recommendationStatus';
import { COMPACT_PLATFORM_BADGE } from '../constants/platforms';

export default function SongCard({ slug, rec, onUpdate, onDelete, showDate, position, isMyRequest, hideStatus, expanded }) {
  const [error, setError] = useState('');
  const voted = hasVoted(slug, rec.id);
  const cancellable = isMyRequest && CANCELLABLE_STATUSES.includes(rec.status);
  const platformBadge = rec.platform && rec.platform !== REC_STATUS.YOUTUBE ? COMPACT_PLATFORM_BADGE[rec.platform] : null;

  async function handleCancel() {
    if (!window.confirm('신청을 취소하시겠습니까?')) return;
    setError('');
    try {
      await cancelRecommendation(slug, rec.id);
      onDelete?.(rec.id);
    } catch (e) {
      setError(e.message);
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
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div style={styles.card}>
      {position && <span style={styles.position}>{position}</span>}
      {rec.thumbnail
        ? <img src={rec.thumbnail} alt="" style={styles.thumb} />
        : <div style={styles.thumbFallback} />
      }
      <div style={styles.body}>
        <div style={styles.title}>{rec.title}</div>
        <div style={styles.meta}>
          {platformBadge && <span style={{ ...styles.platformBadge, background: platformBadge.bg }}>{platformBadge.label}</span>}
          {rec.channel_title} {rec.duration && `· ${rec.duration}`}
          {!hideStatus && <span style={{ ...styles.status, color: REC_STATUS_COLORS[rec.status] }}> · {REC_STATUS_LABELS[rec.status]}</span>}
        </div>
        {showDate && rec.requested_at && (
          <div style={styles.date}>
            {new Date(rec.requested_at).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' })}
          </div>
        )}

        {!isMyRequest && rec.requester_name && <div style={styles.requesterTag}>신청: {rec.requester_name}</div>}

        <div style={styles.actions} onClick={e => e.stopPropagation()}>
          <button onClick={handleVote} style={{ ...styles.voteBtn, ...(voted ? styles.votedBtn : {}) }}>
            👍 {rec.vote_count}
          </button>
          {cancellable && (
            <button onClick={handleCancel} style={styles.cancelBtn}>신청 취소</button>
          )}
        </div>

        {error && <div style={styles.error}>{error}</div>}
      </div>
      <span style={styles.commentHint}>{expanded ? '▲' : '▼'}</span>
    </div>
  );
}

const styles = {
  card:        { display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: '1px solid #eee' },
  position:    { width: 24, textAlign: 'center', fontWeight: 800, fontSize: 15, color: '#1a1a2e', flexShrink: 0 },
  thumb:       { width: 80, height: 60, borderRadius: 6, objectFit: 'cover', flexShrink: 0 },
  thumbFallback:{ width: 80, height: 60, borderRadius: 6, background: '#ddd', flexShrink: 0 },
  body:        { flex: 1, minWidth: 0 },
  title:       { fontWeight: 600, fontSize: 14, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  meta:        { fontSize: 12, color: '#888' },
  status:      { fontWeight: 600 },
  date:        { fontSize: 11, color: '#aaa', marginTop: 2 },
  requesterTag:{ fontSize: 11, color: '#888', marginTop: 2 },
  actions:     { display: 'flex', gap: 8, marginTop: 8 },
  voteBtn:     { fontSize: 13, padding: '4px 10px', borderRadius: 6, border: '1px solid #ddd', background: '#fff', cursor: 'pointer' },
  votedBtn:    { background: '#e3f2fd', color: '#1565c0', border: '1px solid #90caf9', fontWeight: 700 },
  cancelBtn:    { fontSize: 13, padding: '4px 10px', borderRadius: 6, border: '1px solid #fcc', background: '#fff', color: '#e63946', cursor: 'pointer' },
  acceptedBadge:{ fontSize: 11, color: '#2e7d32', fontWeight: 600, marginTop: 2 },
  platformBadge:{ fontSize: 10, fontWeight: 700, color: '#fff', padding: '1px 5px', borderRadius: 3, marginRight: 4, verticalAlign: 'middle' },
  commentHint:  { fontSize: 11, color: '#aaa', flexShrink: 0, alignSelf: 'center' },
  error:        { fontSize: 12, color: '#e63946', marginTop: 4 },
};
