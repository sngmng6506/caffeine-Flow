import { useState } from 'react';
import { vote } from '../api';
import { hasVoted, markVoted } from '../votedSongs';

export default function SongCard({ slug, rec, onUpdate, showDate, position, isMyRequest }) {
  const [error, setError] = useState('');
  const voted = hasVoted(slug, rec.id);

  const statusLabel = { pending: '대기', accepted: '수락', playing: '재생 중', played: '완료', rejected: '거절', skipped: '스킵' };
  const statusColor = { pending: '#888', accepted: '#4caf50', playing: '#2196f3', played: '#9e9e9e', rejected: '#f44336', skipped: '#ff9800' };

  async function handleVote() {
    if (voted) return;
    setError('');
    try {
      const updated = await vote(slug, rec.id);
      markVoted(slug, rec.id);
      onUpdate(updated);
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
          <button onClick={handleVote} disabled={voted} style={{ ...styles.voteBtn, ...(voted ? styles.votedBtn : {}) }}>
            👍 {rec.vote_count}
          </button>
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
  votedBtn:    { background: '#f0f0f0', color: '#aaa', cursor: 'default', border: '1px solid #eee' },
  error:       { fontSize: 12, color: '#e63946', marginTop: 4 },
};
