import { useState } from 'react';
import { vote, unvote, cancelRecommendation } from '../api';
import { hasVoted, markVoted, removeVote } from '../votedSongs';

const statusLabel = { pending: '대기', accepted: '수락', playing: '재생 중', played: '완료', rejected: '거절', skipped: '스킵' };
const statusColor = { pending: '#888', accepted: '#4caf50', playing: '#2196f3', played: '#9e9e9e', rejected: '#f44336', skipped: '#ff9800' };

export default function SongCard({ slug, rec, onUpdate, onDelete, showDate, position, isMyRequest }) {
  const [error, setError] = useState('');
  const voted = hasVoted(slug, rec.id);
  const cancellable = isMyRequest && (rec.status === 'pending' || rec.status === 'accepted');

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
      <img src={rec.thumbnail} alt="" style={styles.thumb} />
      <div style={styles.body}>
        <div style={styles.title}>{rec.title}</div>
        <div style={styles.meta}>
          {rec.channel_title} {rec.duration && `· ${rec.duration}`}
          <span style={{ ...styles.status, color: statusColor[rec.status] }}> · {statusLabel[rec.status]}</span>
        </div>
        {showDate && rec.requested_at && (
          <div style={styles.date}>
            {new Date(rec.requested_at).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' })}
          </div>
        )}
        {isMyRequest
          ? <div style={styles.myRequest}>내가 신청한 곡</div>
          : rec.requester_name && <div style={styles.requester}>신청: {rec.requester_name}</div>
        }

        <div style={styles.actions}>
          <button onClick={handleVote} style={{ ...styles.voteBtn, ...(voted ? styles.votedBtn : {}) }}>
            👍 {rec.vote_count}
          </button>
          {cancellable && (
            <button onClick={handleCancel} style={styles.cancelBtn}>신청 취소</button>
          )}
        </div>

        {error && <div style={styles.error}>{error}</div>}
      </div>
    </div>
  );
}

const styles = {
  card:        { display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: '1px solid #eee' },
  position:    { width: 24, textAlign: 'center', fontWeight: 800, fontSize: 15, color: '#1a1a2e', flexShrink: 0 },
  thumb:       { width: 80, height: 60, borderRadius: 6, objectFit: 'cover', flexShrink: 0 },
  body:        { flex: 1, minWidth: 0 },
  title:       { fontWeight: 600, fontSize: 14, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  meta:        { fontSize: 12, color: '#888' },
  status:      { fontWeight: 600 },
  date:        { fontSize: 11, color: '#aaa', marginTop: 2 },
  myRequest:   { fontSize: 11, color: '#2196f3', fontWeight: 600, marginTop: 2 },
  requester:   { fontSize: 11, color: '#aaa', marginTop: 2 },
  actions:     { display: 'flex', gap: 8, marginTop: 8 },
  voteBtn:     { fontSize: 13, padding: '4px 10px', borderRadius: 6, border: '1px solid #ddd', background: '#fff', cursor: 'pointer' },
  votedBtn:    { background: '#e3f2fd', color: '#1565c0', border: '1px solid #90caf9', fontWeight: 700 },
  cancelBtn:   { fontSize: 13, padding: '4px 10px', borderRadius: 6, border: '1px solid #fcc', background: '#fff', color: '#e63946', cursor: 'pointer' },
  error:       { fontSize: 12, color: '#e63946', marginTop: 4 },
};
