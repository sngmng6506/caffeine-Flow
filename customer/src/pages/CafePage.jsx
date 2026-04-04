import { useEffect, useState } from 'react';
import { getRecommendations } from '../api';
import { getSocket, disconnectSocket } from '../socket';
import NowPlaying from './NowPlaying';
import RecommendForm from './RecommendForm';
import SongCard from './SongCard';

export default function CafePage({ slug }) {
  const [recs, setRecs] = useState([]);
  const [isAccepting, setIsAccepting] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const nowPlaying = recs.find(r => r.status === 'playing') || null;
  const queue = recs.filter(r => r.status === 'pending' || r.status === 'accepted');
  const history = recs.filter(r => r.status === 'played' || r.status === 'skipped' || r.status === 'rejected');

  useEffect(() => {
    // 초기 데이터 로드
    getRecommendations(slug)
      .then(({ recommendations, is_accepting }) => {
        setRecs(recommendations);
        setIsAccepting(is_accepting);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));

    // 실시간 업데이트
    const socket = getSocket(slug);

    socket.on('recommendations_update', ({ action, rec, id }) => {
      if (action === 'add')    setRecs(prev => [rec, ...prev]);
      if (action === 'update') setRecs(prev => prev.map(r => r.id === rec.id ? rec : r));
      if (action === 'delete') setRecs(prev => prev.filter(r => r.id !== id));
      if (action === 'vote')   setRecs(prev => prev.map(r => r.id === rec.id ? rec : r));
    });

    socket.on('system_toggled', ({ is_accepting }) => setIsAccepting(is_accepting));

    return () => disconnectSocket();
  }, [slug]);

  function handleUpdate(updated) {
    setRecs(prev => prev.map(r => r.id === updated.id ? updated : r));
  }

  function handleAdded(rec) {
    setRecs(prev => [rec, ...prev]);
  }

  if (loading) return <div style={styles.center}>불러오는 중...</div>;
  if (error)   return <div style={styles.center}>{error}</div>;

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h2 style={styles.title}>🎵 음악 추천</h2>
        {!isAccepting && <div style={styles.closed}>현재 신청을 받지 않습니다</div>}
      </div>

      <NowPlaying rec={nowPlaying} />

      {isAccepting && <RecommendForm slug={slug} onAdded={handleAdded} />}

      {queue.length > 0 && (
        <section>
          <h3 style={styles.sectionTitle}>대기 중 ({queue.length})</h3>
          {queue.map(r => (
            <SongCard key={r.id} slug={slug} rec={r} onUpdate={handleUpdate} />
          ))}
        </section>
      )}

      {history.length > 0 && (
        <section style={{ marginTop: 24 }}>
          <h3 style={styles.sectionTitle}>오늘 재생 이력</h3>
          {history.map(r => (
            <SongCard key={r.id} slug={slug} rec={r} onUpdate={handleUpdate} />
          ))}
        </section>
      )}

      {queue.length === 0 && history.length === 0 && (
        <div style={styles.empty}>아직 추천된 곡이 없습니다.<br />첫 번째 곡을 추천해보세요!</div>
      )}
    </div>
  );
}

const styles = {
  page:        { maxWidth: 480, margin: '0 auto', padding: '16px', fontFamily: 'sans-serif' },
  header:      { marginBottom: 16 },
  title:       { margin: 0, fontSize: 22 },
  closed:      { marginTop: 8, padding: '8px 12px', background: '#fff3cd', borderRadius: 8, fontSize: 13, color: '#856404' },
  sectionTitle:{ fontSize: 15, fontWeight: 700, margin: '0 0 8px 0', color: '#333' },
  empty:       { textAlign: 'center', color: '#aaa', padding: '40px 0', lineHeight: 1.8 },
  center:      { display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', fontFamily: 'sans-serif' },
};
