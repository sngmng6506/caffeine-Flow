import { useEffect, useState } from 'react';
import { getRecommendations, setStatus } from '../api';
import { getSocket, disconnectSocket } from '../socket';
import RecommendCard from './RecommendCard';
import StatsPanel from './StatsPanel';

export default function DashboardPage({ cafe, onLogout }) {
  const [recs, setRecs] = useState([]);
  const [isAccepting, setIsAccepting] = useState(true);
  const [tab, setTab] = useState('queue'); // 'queue' | 'stats'
  const [loading, setLoading] = useState(true);

  const queue   = recs.filter(r => r.status === 'pending' || r.status === 'accepted' || r.status === 'playing');
  const history = recs.filter(r => r.status === 'played' || r.status === 'skipped' || r.status === 'rejected');

  useEffect(() => {
    getRecommendations(cafe.slug)
      .then(({ recommendations, is_accepting }) => {
        setRecs(recommendations);
        setIsAccepting(is_accepting);
      })
      .catch(console.error)
      .finally(() => setLoading(false));

    const socket = getSocket(cafe.slug);
    socket.on('recommendations_update', ({ action, rec, id }) => {
      if (action === 'add')    setRecs(prev => [rec, ...prev]);
      if (action === 'update') setRecs(prev => prev.map(r => r.id === rec.id ? rec : r));
      if (action === 'delete') setRecs(prev => prev.filter(r => r.id !== id));
      if (action === 'vote')   setRecs(prev => prev.map(r => r.id === rec.id ? rec : r));
    });
    socket.on('system_toggled', ({ is_accepting }) => setIsAccepting(is_accepting));

    return () => disconnectSocket();
  }, [cafe.slug]);

  async function toggleAccepting() {
    const next = !isAccepting;
    setIsAccepting(next);
    try { await setStatus(next); }
    catch { setIsAccepting(!next); }
  }

  function handleUpdate(updated) { setRecs(prev => prev.map(r => r.id === updated.id ? updated : r)); }
  function handleDelete(id)      { setRecs(prev => prev.filter(r => r.id !== id)); }

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div>
          <div style={styles.cafeName}>{cafe.name}</div>
          <div style={styles.slug}>/{cafe.slug}</div>
        </div>
        <div style={styles.headerRight}>
          <button onClick={toggleAccepting} style={{ ...styles.toggleBtn, background: isAccepting ? '#4caf50' : '#888' }}>
            {isAccepting ? '신청 받는 중' : '신청 닫힘'}
          </button>
          <button onClick={onLogout} style={styles.logoutBtn}>로그아웃</button>
        </div>
      </div>

      <div style={styles.tabs}>
        <button onClick={() => setTab('queue')} style={{ ...styles.tab, ...(tab === 'queue' ? styles.tabActive : {}) }}>
          추천 목록 {queue.length > 0 && <span style={styles.badge}>{queue.length}</span>}
        </button>
        <button onClick={() => setTab('stats')} style={{ ...styles.tab, ...(tab === 'stats' ? styles.tabActive : {}) }}>통계</button>
      </div>

      {tab === 'queue' && (
        <div>
          {loading && <div style={styles.empty}>불러오는 중...</div>}
          {!loading && queue.length === 0 && <div style={styles.empty}>대기 중인 추천곡이 없습니다.</div>}
          {queue.map(r => (
            <RecommendCard key={r.id} slug={cafe.slug} rec={r} onUpdate={handleUpdate} onDelete={handleDelete} />
          ))}
          {history.length > 0 && (
            <>
              <h3 style={styles.sectionTitle}>오늘 이력</h3>
              {history.map(r => (
                <RecommendCard key={r.id} slug={cafe.slug} rec={r} onUpdate={handleUpdate} onDelete={handleDelete} />
              ))}
            </>
          )}
        </div>
      )}

      {tab === 'stats' && <StatsPanel />}
    </div>
  );
}

const styles = {
  page:        { maxWidth: 600, margin: '0 auto', padding: '16px', fontFamily: 'sans-serif' },
  header:      { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, paddingBottom: 16, borderBottom: '1px solid #eee' },
  cafeName:    { fontWeight: 700, fontSize: 18 },
  slug:        { fontSize: 12, color: '#888', marginTop: 2 },
  headerRight: { display: 'flex', gap: 8, alignItems: 'center' },
  toggleBtn:   { padding: '6px 12px', borderRadius: 20, border: 'none', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600 },
  logoutBtn:   { padding: '6px 12px', borderRadius: 20, border: '1px solid #ddd', background: '#fff', cursor: 'pointer', fontSize: 13 },
  tabs:        { display: 'flex', marginBottom: 16, borderBottom: '2px solid #eee' },
  tab:         { padding: '8px 16px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: '#888', display: 'flex', alignItems: 'center', gap: 6 },
  tabActive:   { color: '#1a1a2e', fontWeight: 700, borderBottom: '2px solid #1a1a2e', marginBottom: -2 },
  badge:       { background: '#e63946', color: '#fff', borderRadius: 10, padding: '1px 6px', fontSize: 11 },
  sectionTitle:{ fontSize: 14, color: '#888', margin: '20px 0 8px', fontWeight: 600 },
  empty:       { textAlign: 'center', color: '#aaa', padding: '40px 0' },
};
