import { useState } from 'react';
import { updateRec, deleteRec } from '../api';

const STATUS_LABEL = { pending: '대기', accepted: '수락', playing: '재생 중', played: '완료', rejected: '거절', skipped: '스킵' };
const STATUS_COLOR = { pending: '#888', accepted: '#4caf50', playing: '#2196f3', played: '#9e9e9e', rejected: '#f44336', skipped: '#ff9800' };

export default function RecommendCard({ slug, rec, onUpdate, onDelete }) {
  const [loading, setLoading] = useState(false);

  async function handle(action) {
    setLoading(true);
    try {
      if (action === 'delete') {
        await deleteRec(slug, rec.id);
        onDelete(rec.id);
      } else {
        const updated = await updateRec(slug, rec.id, action);
        onUpdate(updated);
      }
    } catch (e) {
      console.error(e.message);
    } finally {
      setLoading(false);
    }
  }

  const isActive = rec.status === 'pending' || rec.status === 'accepted';

  return (
    <div style={styles.card}>
      <img src={rec.thumbnail} alt="" style={styles.thumb} />
      <div style={styles.body}>
        <div style={styles.title}>{rec.title}</div>
        <div style={styles.meta}>
          {rec.channel_title}{rec.duration && ` · ${rec.duration}`}
          {rec.requester_name && ` · 신청: ${rec.requester_name}`}
          <span style={{ ...styles.status, color: STATUS_COLOR[rec.status] }}> · {STATUS_LABEL[rec.status]}</span>
        </div>
        <div style={styles.meta}>👍 {rec.vote_count}표</div>

        {isActive && (
          <div style={styles.actions}>
            {rec.status === 'pending' && (
              <button onClick={() => handle('accepted')} disabled={loading} style={{ ...styles.btn, background: '#4caf50' }}>수락</button>
            )}
            {rec.status === 'accepted' && (
              <button onClick={() => handle('playing')} disabled={loading} style={{ ...styles.btn, background: '#2196f3' }}>재생</button>
            )}
            <button onClick={() => handle('skipped')}  disabled={loading} style={{ ...styles.btn, background: '#ff9800' }}>스킵</button>
            <button onClick={() => handle('rejected')} disabled={loading} style={{ ...styles.btn, background: '#f44336' }}>거절</button>
            <button onClick={() => handle('delete')}   disabled={loading} style={{ ...styles.btn, background: '#eee', color: '#333' }}>삭제</button>
          </div>
        )}
      </div>
    </div>
  );
}

const styles = {
  card:    { display: 'flex', gap: 12, padding: '12px 0', borderBottom: '1px solid #eee' },
  thumb:   { width: 80, height: 60, borderRadius: 6, objectFit: 'cover', flexShrink: 0 },
  body:    { flex: 1, minWidth: 0 },
  title:   { fontWeight: 600, fontSize: 14, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  meta:    { fontSize: 12, color: '#888', marginBottom: 2 },
  status:  { fontWeight: 600 },
  actions: { display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' },
  btn:     { fontSize: 12, padding: '4px 10px', borderRadius: 6, border: 'none', color: '#fff', cursor: 'pointer', fontWeight: 600 },
};
