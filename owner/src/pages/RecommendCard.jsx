import { useState } from 'react';
import { updateRec, deleteRec } from '../api';

export default function RecommendCard({ slug, rec, onUpdate, onDelete, context, position, expanded }) {
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

  return (
    <div
      style={{ ...styles.card, cursor: context ? 'grab' : 'default' }}
      draggable={!!context}
      onDragStart={e => {
        e.dataTransfer.setData('text/plain', JSON.stringify({ id: rec.id, status: rec.status }));
        e.dataTransfer.effectAllowed = 'move';
      }}
    >
      {position && <span style={styles.position}>{position}</span>}
      <img src={rec.thumbnail} alt="" style={styles.thumb} />
      <div style={styles.body}>
        <div style={styles.title}>{rec.title}</div>
        <div style={styles.meta}>
          {rec.platform === 'soundcloud' && <span style={{ ...styles.platformBadge, background: '#ff5500' }}>SC</span>}
          {rec.platform === 'spotify'    && <span style={{ ...styles.platformBadge, background: '#1db954' }}>SP</span>}
          {rec.channel_title}{rec.duration && ` · ${rec.duration}`}
          {rec.requester_name && ` · 추천: ${rec.requester_name}`}
        </div>
        <div style={styles.meta}>👍 {rec.vote_count}표</div>

        {/* 추천 재생 중 섹션 */}
        {context === 'playing' && (
          <div style={styles.playingRow}>
            <span style={styles.nowPlaying}>🎵 재생 중</span>
            <button onClick={() => handle('skipped')} disabled={loading} style={styles.skipBtn}>스킵</button>
          </div>
        )}

        {/* 대기 곡 섹션 */}
        {context === 'accepted' && (
          <div style={styles.actions}>
            <span style={styles.queuedLabel}>⏳ 대기 중</span>
            <button onClick={() => handle('skipped')} disabled={loading} style={styles.skipBtn}>스킵</button>
          </div>
        )}

        {/* 추천 곡 섹션 */}
        {context === 'pending' && (
          <div style={styles.actions}>
            <button
              onClick={() => handle('accepted')}
              disabled={loading}
              style={{ ...styles.btn, background: '#4caf50' }}
            >
              수락
            </button>
            <button onClick={() => handle('skipped')} disabled={loading} style={{ ...styles.btn, background: '#ff9800' }}>스킵</button>
          </div>
        )}

        {/* 이력 탭 등 context 없는 경우 */}
        {!context && (
          <div style={styles.meta} />
        )}
      </div>
      {expanded !== undefined && (
        <span style={styles.commentHint}>{expanded ? '▲' : '▼'}</span>
      )}
    </div>
  );
}

const styles = {
  card:       { display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: '1px solid #eee' },
  position:   { width: 24, textAlign: 'center', fontWeight: 800, fontSize: 15, color: '#1a1a2e', flexShrink: 0 },
  thumb:      { width: 80, height: 60, borderRadius: 6, objectFit: 'cover', flexShrink: 0 },
  body:       { flex: 1, minWidth: 0 },
  title:      { fontWeight: 600, fontSize: 14, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  meta:       { fontSize: 12, color: '#888', marginBottom: 2 },
  actions:    { display: 'flex', gap: 6, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' },
  btn:        { fontSize: 12, padding: '4px 10px', borderRadius: 6, border: 'none', color: '#fff', cursor: 'pointer', fontWeight: 600 },
  playingRow: { display: 'flex', alignItems: 'center', gap: 10, marginTop: 6 },
  nowPlaying: { fontSize: 12, color: '#2196f3', fontWeight: 700 },
  queuedLabel:{ fontSize: 12, color: '#4caf50', fontWeight: 600 },
  skipBtn:    { fontSize: 11, padding: '3px 10px', borderRadius: 6, border: 'none', background: '#ff9800', color: '#fff', cursor: 'pointer', fontWeight: 600 },
  platformBadge: { fontSize: 10, fontWeight: 700, color: '#fff', padding: '1px 5px', borderRadius: 3, marginRight: 4 },
  commentHint:   { fontSize: 11, color: '#aaa', flexShrink: 0, alignSelf: 'center' },
};
