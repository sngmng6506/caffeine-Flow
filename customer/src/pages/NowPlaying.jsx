const platformColor = { youtube: '#ff0000', soundcloud: '#ff5500' };

export default function NowPlaying({ rec }) {
  if (!rec) return null;
  const platformBg = platformColor[rec.platform] || platformColor.youtube;
  return (
    <div style={styles.wrap}>
      <span style={styles.badge}>▶ 지금 재생 중</span>
      {rec.thumbnail
        ? <img src={rec.thumbnail} alt="" style={styles.thumb} />
        : <div style={styles.thumbFallback} />
      }
      <div style={styles.info}>
        <div style={styles.title}>{rec.title}</div>
        <div style={styles.channel}>
          <span style={{ ...styles.platformBadge, background: platformBg }}>
            {rec.platform === 'soundcloud' ? 'SC' : 'YT'}
          </span>
          {rec.channel_title}
        </div>
      </div>
    </div>
  );
}

const styles = {
  wrap:          { display: 'flex', alignItems: 'center', gap: 12, background: '#1a1a2e', color: '#fff', borderRadius: 12, padding: '12px 16px', marginBottom: 16 },
  badge:         { fontSize: 11, background: '#e63946', borderRadius: 4, padding: '2px 6px', whiteSpace: 'nowrap', flexShrink: 0 },
  thumb:         { width: 56, height: 42, borderRadius: 6, objectFit: 'cover', flexShrink: 0 },
  thumbFallback: { width: 56, height: 42, borderRadius: 6, background: '#333', flexShrink: 0 },
  info:          { overflow: 'hidden', minWidth: 0 },
  title:         { fontWeight: 600, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  channel:       { fontSize: 12, color: '#aaa', marginTop: 2, display: 'flex', alignItems: 'center', gap: 5 },
  platformBadge: { fontSize: 10, fontWeight: 700, color: '#fff', padding: '1px 5px', borderRadius: 3, flexShrink: 0 },
};
