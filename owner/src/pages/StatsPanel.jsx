import { useEffect, useState } from 'react';
import { getStats } from '../api';

export default function StatsPanel() {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    getStats().then(setStats).catch(console.error);
  }, []);

  if (!stats) return <div style={styles.loading}>통계 불러오는 중...</div>;

  return (
    <div style={styles.wrap}>
      <h3 style={styles.title}>전체 통계</h3>
      <div style={styles.grid}>
        <div style={styles.stat}><span style={styles.num}>{stats.total}</span><span style={styles.label}>총 신청</span></div>
        <div style={styles.stat}><span style={styles.num}>{stats.played}</span><span style={styles.label}>재생됨</span></div>
        <div style={styles.stat}><span style={styles.num}>{stats.skipped}</span><span style={styles.label}>스킵됨</span></div>
      </div>
      {stats.topSongs?.length > 0 && (
        <>
          <h3 style={styles.title}>인기곡 TOP 10</h3>
          {stats.topSongs.map((s, i) => (
            <div key={s.video_id} style={styles.song}>
              <span style={styles.rank}>{i + 1}</span>
              <img src={s.thumbnail} alt="" style={styles.thumb} />
              <div style={styles.info}>
                <div style={styles.songTitle}>{s.title}</div>
                <div style={styles.songMeta}>{s.channel_title} · {s.count}회</div>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

const styles = {
  wrap:     { padding: '16px 0' },
  title:    { fontSize: 15, fontWeight: 700, margin: '16px 0 8px' },
  grid:     { display: 'flex', gap: 12 },
  stat:     { flex: 1, background: '#f8f8f8', borderRadius: 10, padding: '16px', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 4 },
  num:      { fontSize: 28, fontWeight: 700, color: '#1a1a2e' },
  label:    { fontSize: 12, color: '#888' },
  song:     { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid #eee' },
  rank:     { width: 20, textAlign: 'center', fontWeight: 700, color: '#888', fontSize: 13 },
  thumb:    { width: 48, height: 36, borderRadius: 4, objectFit: 'cover' },
  info:     { flex: 1, minWidth: 0 },
  songTitle:{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  songMeta: { fontSize: 11, color: '#aaa' },
  loading:  { color: '#888', fontSize: 13 },
};
