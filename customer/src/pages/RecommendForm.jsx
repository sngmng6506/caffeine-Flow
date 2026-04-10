import { useState } from 'react';
import { getOembed, postRecommendation } from '../api';
import { getDeviceName } from '../deviceName';

const PLATFORM_BADGE = {
  youtube:    { label: 'YouTube',     bg: '#ff0000', color: '#fff' },
  soundcloud: { label: 'SoundCloud',  bg: '#ff5500', color: '#fff' },
};

export default function RecommendForm({ slug, onAdded, activeVideoIds = [] }) {
  const [url, setUrl] = useState('');
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [step, setStep] = useState('input'); // 'input' | 'preview'

  async function handlePreview(e) {
    e.preventDefault();
    if (!url.trim()) return;
    setLoading(true);
    setError('');
    try {
      const data = await getOembed(url.trim());
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

  return (
    <form onSubmit={handlePreview} style={styles.wrap}>
      <input
        placeholder="YouTube 또는 SoundCloud 링크를 붙여넣으세요"
        value={url}
        onChange={e => setUrl(e.target.value)}
        style={styles.input}
      />
      {error && <div style={styles.error}>{error}</div>}
      <button type="submit" disabled={loading} style={styles.submitBtn}>
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
  input:        { fontSize: 14, padding: '10px 12px', borderRadius: 8, border: '1px solid #ddd', outline: 'none' },
  btnRow:       { display: 'flex', gap: 8 },
  submitBtn:    { flex: 1, padding: '10px', borderRadius: 8, background: '#1a1a2e', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600 },
  cancelBtn:    { padding: '10px 16px', borderRadius: 8, background: '#fff', border: '1px solid #ddd', cursor: 'pointer' },
  error:        { fontSize: 13, color: '#e63946' },
};
