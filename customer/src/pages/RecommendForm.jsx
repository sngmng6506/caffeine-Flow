import { useState } from 'react';
import { getOembed, postRecommendation } from '../api';
import { getDeviceName } from '../deviceName';

const PLATFORM_BADGE = {
  youtube:    { label: 'YouTube',     bg: '#ff0000', color: '#fff' },
  soundcloud: { label: 'SoundCloud',  bg: '#ff5500', color: '#fff' },
  spotify:    { label: 'Spotify',     bg: '#1db954', color: '#fff' },
};

function YouTubeIcon() {
  return (
    <svg width="38" height="27" viewBox="0 0 38 27" fill="none">
      <rect width="38" height="27" rx="7" fill="#FF0000"/>
      <polygon points="15,7 15,20 26,13.5" fill="white"/>
    </svg>
  );
}

function SpotifyIcon() {
  return (
    <svg width="27" height="27" viewBox="0 0 27 27" fill="none">
      <circle cx="13.5" cy="13.5" r="13.5" fill="#1DB954"/>
      <path d="M7 10.5c4-2 9-2 13 0"   stroke="white" strokeWidth="2"   fill="none" strokeLinecap="round"/>
      <path d="M7.5 14c3.5-1.5 8-1.5 12 0" stroke="white" strokeWidth="1.8" fill="none" strokeLinecap="round"/>
      <path d="M8 17.5c3-1.2 6.5-1.2 11 0" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
    </svg>
  );
}

function SoundCloudIcon() {
  return (
    <svg width="38" height="27" viewBox="0 0 38 27" fill="none">
      <rect width="38" height="27" rx="7" fill="#FF5500"/>
      <path d="M8 18.5 Q8 15 11 15 Q11 11 14.5 11 Q15 8 18 8 Q22 8 22 12.5 L22 18.5 Z" fill="white" opacity="0.9"/>
      <rect x="24" y="12" width="2" height="7" rx="1" fill="white" opacity="0.7"/>
      <rect x="27.5" y="10" width="2" height="9" rx="1" fill="white" opacity="0.7"/>
      <rect x="31" y="13" width="2" height="6" rx="1" fill="white" opacity="0.7"/>
    </svg>
  );
}

export default function RecommendForm({ slug, onAdded, activeVideoIds = [], playingVideoId }) {
  const [url, setUrl] = useState('');
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [step, setStep] = useState('input');

  async function handlePreview(e) {
    e.preventDefault();
    if (!url.trim()) return;
    setLoading(true);
    setError('');
    try {
      const data = await getOembed(url.trim());
      if (data.videoId === playingVideoId) {
        setError('현재 재생 중인 곡입니다.');
        setUrl('');
        return;
      }
      if (activeVideoIds.includes(data.videoId)) {
        setError('이미 대기 중인 곡입니다. 다른 곡을 추천해주세요.');
        setUrl('');
        return;
      }
      setPreview(data);
      setStep('preview');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit() {
    setLoading(true);
    setError('');
    try {
      const rec = await postRecommendation(slug, {
        videoId:       preview.videoId,
        title:         preview.title,
        channelTitle:  preview.channelTitle,
        thumbnail:     preview.thumbnail,
        platform:      preview.platform,
        requesterName: getDeviceName(),
      });
      onAdded(rec);
      setUrl('');
      setPreview(null);
      setStep('input');
    } catch (e) {
      setError(e.message);
      setUrl('');
      setPreview(null);
      setStep('input');
    } finally {
      setLoading(false);
    }
  }

  if (step === 'preview' && preview) {
    const badge = PLATFORM_BADGE[preview.platform] || PLATFORM_BADGE.youtube;
    return (
      <div style={styles.wrap}>
        <div style={styles.previewCard}>
          {preview.thumbnail
            ? <img src={preview.thumbnail} alt="" style={styles.thumb} />
            : <div style={styles.thumbFallback} />
          }
          <div style={styles.info}>
            <span style={{ ...styles.badge, background: badge.bg, color: badge.color }}>
              {badge.label}
            </span>
            <div style={styles.title}>{preview.title}</div>
            <div style={styles.channel}>{preview.channelTitle}</div>
          </div>
        </div>
        {error && <div style={styles.error}>{error}</div>}
        <div style={styles.btnRow}>
          <button onClick={() => setStep('input')} style={styles.cancelBtn}>취소</button>
          <button onClick={handleSubmit} disabled={loading} style={styles.submitBtn}>
            {loading ? '추천 중...' : '추천하기'}
          </button>
        </div>
      </div>
    );
  }

  const PLATFORM_LINKS = [
    { icon: <YouTubeIcon />,    href: 'https://www.youtube.com' },
    { icon: <SpotifyIcon />,    href: 'https://open.spotify.com' },
    { icon: <SoundCloudIcon />, href: 'https://soundcloud.com' },
  ];

  return (
    <form onSubmit={handlePreview} style={styles.wrap}>
      <div style={styles.platformRow}>
        <div style={styles.platformIcons}>
          {PLATFORM_LINKS.map(({ icon, href }) => (
            <a
              key={href}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              style={styles.iconLink}
            >
              {icon}
            </a>
          ))}
        </div>
        <span style={styles.platformHint}>바로 가기</span>
      </div>
      <input
        placeholder="링크를 붙여넣으세요"
        value={url}
        onChange={e => setUrl(e.target.value)}
        style={styles.input}
      />
      {error && <div style={styles.error}>{error}</div>}
      <button type="submit" disabled={loading || !url.trim()} style={styles.submitBtn}>
        {loading ? '확인 중...' : '곡 확인'}
      </button>
    </form>
  );
}

const styles = {
  wrap:         { display: 'flex', flexDirection: 'column', gap: 10, padding: '16px', background: '#f8f8f8', borderRadius: 12, marginBottom: 20 },
  previewCard:  { display: 'flex', gap: 12, alignItems: 'center' },
  thumb:        { width: 80, height: 60, borderRadius: 6, objectFit: 'cover', flexShrink: 0 },
  thumbFallback:{ width: 80, height: 60, borderRadius: 6, background: '#ddd', flexShrink: 0 },
  info:         { flex: 1, minWidth: 0 },
  badge:        { fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4, marginBottom: 4, display: 'inline-block' },
  title:        { fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  channel:      { fontSize: 12, color: '#888', marginTop: 2 },
  input:         { fontSize: 14, padding: '10px 12px', borderRadius: 8, border: '1px solid #ddd', outline: 'none' },
  platformRow:   { display: 'flex', alignItems: 'center', gap: 10 },
  platformHint:  { fontSize: 11, color: '#aaa', whiteSpace: 'nowrap' },
  platformIcons: { display: 'flex', gap: 8, alignItems: 'center' },
  iconLink:      { display: 'flex', alignItems: 'center', lineHeight: 0 },
  btnRow:       { display: 'flex', gap: 8 },
  submitBtn:    { flex: 1, padding: '10px', borderRadius: 8, background: '#1a1a2e', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600 },
  cancelBtn:    { padding: '10px 16px', borderRadius: 8, background: '#fff', border: '1px solid #ddd', cursor: 'pointer' },
  error:        { fontSize: 13, color: '#e63946' },
};
