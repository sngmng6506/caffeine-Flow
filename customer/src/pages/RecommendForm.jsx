import { useState } from 'react';
import { getOembed, postRecommendation } from '../api';
import { getDeviceName } from '../deviceName';

export default function RecommendForm({ slug, onAdded }) {
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
        requesterName: getDeviceName(),
      });
      onAdded(rec);
      setUrl('');
      setPreview(null);
      setStep('input');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  if (step === 'preview' && preview) {
    return (
      <div style={styles.wrap}>
        <div style={styles.previewCard}>
          <img src={preview.thumbnail} alt="" style={styles.thumb} />
          <div style={styles.info}>
            <div style={styles.title}>{preview.title}</div>
            <div style={styles.channel}>{preview.channelTitle}</div>
          </div>
        </div>
        {error && <div style={styles.error}>{error}</div>}
        <div style={styles.btnRow}>
          <button onClick={() => setStep('input')} style={styles.cancelBtn}>취소</button>
          <button onClick={handleSubmit} disabled={loading} style={styles.submitBtn}>
            {loading ? '신청 중...' : '신청하기'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handlePreview} style={styles.wrap}>
      <input
        placeholder="YouTube 링크를 붙여넣으세요"
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
  wrap:        { display: 'flex', flexDirection: 'column', gap: 10, padding: '16px', background: '#f8f8f8', borderRadius: 12, marginBottom: 20 },
  previewCard: { display: 'flex', gap: 12, alignItems: 'center' },
  thumb:       { width: 80, height: 60, borderRadius: 6, objectFit: 'cover' },
  info:        { flex: 1, minWidth: 0 },
  title:       { fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  channel:     { fontSize: 12, color: '#888', marginTop: 2 },
  input:       { fontSize: 14, padding: '10px 12px', borderRadius: 8, border: '1px solid #ddd', outline: 'none' },
  btnRow:      { display: 'flex', gap: 8 },
  submitBtn:   { flex: 1, padding: '10px', borderRadius: 8, background: '#1a1a2e', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600 },
  cancelBtn:   { padding: '10px 16px', borderRadius: 8, background: '#fff', border: '1px solid #ddd', cursor: 'pointer' },
  error:       { fontSize: 13, color: '#e63946' },
};
