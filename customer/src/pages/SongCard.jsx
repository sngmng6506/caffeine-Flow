import { useState } from 'react';
import { vote, postComment } from '../api';

export default function SongCard({ slug, rec, onUpdate }) {
  const [commentOpen, setCommentOpen] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const statusLabel = { pending: '대기', accepted: '수락', playing: '재생 중', played: '완료', rejected: '거절', skipped: '스킵' };
  const statusColor = { pending: '#888', accepted: '#4caf50', playing: '#2196f3', played: '#9e9e9e', rejected: '#f44336', skipped: '#ff9800' };

  async function handleVote() {
    setError('');
    try {
      const updated = await vote(slug, rec.id);
      onUpdate(updated);
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleComment(e) {
    e.preventDefault();
    if (!commentText.trim()) return;
    setLoading(true);
    setError('');
    try {
      await postComment(slug, rec.id, { commenterName: name || undefined, body: commentText.trim() });
      setCommentText('');
      setCommentOpen(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.card}>
      <img src={rec.thumbnail} alt="" style={styles.thumb} />
      <div style={styles.body}>
        <div style={styles.title}>{rec.title}</div>
        <div style={styles.meta}>
          {rec.channel_title} {rec.duration && `· ${rec.duration}`}
          <span style={{ ...styles.status, color: statusColor[rec.status] }}> · {statusLabel[rec.status]}</span>
        </div>
        {rec.requester_name && <div style={styles.requester}>신청: {rec.requester_name}</div>}

        <div style={styles.actions}>
          <button onClick={handleVote} style={styles.voteBtn}>
            👍 {rec.vote_count}
          </button>
          <button onClick={() => setCommentOpen(v => !v)} style={styles.commentBtn}>
            💬 코멘트
          </button>
        </div>

        {error && <div style={styles.error}>{error}</div>}

        {commentOpen && (
          <form onSubmit={handleComment} style={styles.commentForm}>
            <input
              placeholder="닉네임 (선택)"
              value={name}
              onChange={e => setName(e.target.value)}
              style={styles.input}
              maxLength={20}
            />
            <input
              placeholder="한줄 코멘트"
              value={commentText}
              onChange={e => setCommentText(e.target.value)}
              style={styles.input}
              maxLength={200}
              required
            />
            <button type="submit" disabled={loading} style={styles.submitBtn}>등록</button>
          </form>
        )}
      </div>
    </div>
  );
}

const styles = {
  card:        { display: 'flex', gap: 12, padding: '12px 0', borderBottom: '1px solid #eee' },
  thumb:       { width: 80, height: 60, borderRadius: 6, objectFit: 'cover', flexShrink: 0 },
  body:        { flex: 1, minWidth: 0 },
  title:       { fontWeight: 600, fontSize: 14, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  meta:        { fontSize: 12, color: '#888' },
  status:      { fontWeight: 600 },
  requester:   { fontSize: 11, color: '#aaa', marginTop: 2 },
  actions:     { display: 'flex', gap: 8, marginTop: 8 },
  voteBtn:     { fontSize: 13, padding: '4px 10px', borderRadius: 6, border: '1px solid #ddd', background: '#fff', cursor: 'pointer' },
  commentBtn:  { fontSize: 13, padding: '4px 10px', borderRadius: 6, border: '1px solid #ddd', background: '#fff', cursor: 'pointer' },
  commentForm: { marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 },
  input:       { fontSize: 13, padding: '6px 8px', borderRadius: 6, border: '1px solid #ddd', outline: 'none' },
  submitBtn:   { alignSelf: 'flex-end', fontSize: 13, padding: '6px 14px', borderRadius: 6, background: '#1a1a2e', color: '#fff', border: 'none', cursor: 'pointer' },
  error:       { fontSize: 12, color: '#e63946', marginTop: 4 },
};
