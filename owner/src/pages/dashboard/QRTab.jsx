import { useState } from 'react';
import { changeSlug } from '../../api';

export default function QRTab({ url, cafeName, currentSlug, initialSlug, onSlugChanged }) {
  const [showChange, setShowChange] = useState(false);
  const [customSlug, setCustomSlug] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(url)}&size=280x280&margin=10`;

  async function handleDownload() {
    const src = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(url)}&size=600x600&margin=20&format=jpg`;
    try {
      const res = await fetch(src);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = `caffeine-flow-${cafeName}-qr.jpg`;
      a.click();
      URL.revokeObjectURL(objectUrl);
    } catch {
      // CORS/네트워크 실패 시 새 탭 fallback
      window.open(src, '_blank');
    }
  }

  function handlePrint() { window.print(); }

  function handleRestore() {
    if (!initialSlug || initialSlug === currentSlug) return;
    const confirmed = window.confirm(
      `최초 QR 코드(${initialSlug})로 돌아갈까요?\n현재 QR 코드는 더 이상 동작하지 않습니다.`
    );
    if (confirmed) handleReissue(initialSlug);
  }

  // 무작위 재발급(slug 없이) 또는 사전 제작 QR 코드로 재등록(slug 지정).
  // 성공 시 부모가 cafe.slug·토큰·소켓 연결을 함께 갱신해야 하므로
  // onSlugChanged로 위임한다.
  async function handleReissue(slugValue) {
    setLoading(true);
    setError('');
    try {
      const updated = await changeSlug(slugValue || null);
      onSlugChanged(updated);
      setShowChange(false);
      setCustomSlug('');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={qrStyles.outer}>
      <style>{`
        @media print {
          @page { size: auto; margin: 0; }
          html, body { margin: 0; padding: 0; height: 100vh; overflow: hidden; }
          body * { visibility: hidden; }
          .print-poster, .print-poster * { visibility: visible; }
          .print-poster { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); }
        }
      `}</style>

      {/* QR 카드 */}
      <div style={qrStyles.poster} className="print-poster">
        <div style={qrStyles.qrWrap}>
          <img src={qrUrl} alt="QR 코드" style={qrStyles.qrImg} />
        </div>
      </div>

      {/* 버튼 (프린트 시 숨김) */}
      <div style={qrStyles.btnRow} className="no-print">
        <button onClick={handlePrint} style={qrStyles.btn}>프린트</button>
        <button onClick={handleDownload} style={{ ...qrStyles.btn, background: '#fff', color: '#1a1a2e', border: '1px solid #ddd' }}>이미지 저장</button>
      </div>

      {/* 미리 제작한 아크릴 QR 등으로 교체하고 싶을 때 */}
      <div className="no-print" style={qrStyles.changeSection}>
        {error && <div style={qrStyles.error}>{error}</div>}
        {!showChange ? (
          <div style={qrStyles.changeLinks}>
            <button onClick={() => setShowChange(true)} disabled={loading} style={qrStyles.changeLink}>
              다른 QR 코드로 변경
            </button>
            {initialSlug && initialSlug !== currentSlug && (
              <button onClick={handleRestore} disabled={loading} style={qrStyles.restoreLink}>
                {loading ? '처리 중...' : '최초 QR 코드로 돌아가기'}
              </button>
            )}
          </div>
        ) : (
          <div style={qrStyles.changeBox}>
            <p style={qrStyles.changeHint}>
              이미 인쇄·제작된 QR(아크릴 등)이 있다면 그 코드를 입력해 연결하세요.
              비워두면 무작위로 새 QR을 발급합니다. 기존 QR은 더 이상 동작하지 않습니다.
            </p>
            <input
              placeholder="영문 소문자·숫자 (비우면 자동 발급)"
              value={customSlug}
              onChange={e => setCustomSlug(e.target.value.trim().toLowerCase())}
              style={qrStyles.input}
            />
            <div style={qrStyles.changeBtnRow}>
              <button onClick={() => handleReissue(customSlug)} disabled={loading} style={qrStyles.btn}>
                {loading ? '처리 중...' : customSlug ? '이 코드로 연결' : '무작위로 재발급'}
              </button>
              <button onClick={() => { setShowChange(false); setError(''); }} style={qrStyles.cancelBtn}>취소</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const qrStyles = {
  outer:          { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20, paddingTop: 16 },
  poster:         { borderRadius: 16, overflow: 'hidden', boxShadow: '0 4px 24px rgba(0,0,0,0.10)', border: '1px solid #eee', display: 'inline-flex' },
  brand:          { fontSize: 22, fontWeight: 800, color: '#fff', letterSpacing: '-0.5px' },
  tagline:        { fontSize: 11, color: '#aaa', marginTop: 4, letterSpacing: 1 },
  posterBody:     { background: '#fff', padding: '24px 24px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 },
  cta:            { fontSize: 15, fontWeight: 600, color: '#1a1a2e', textAlign: 'center', lineHeight: 1.6 },
  qrWrap:         { background: '#fff', padding: 20 },
  qrImg:          { display: 'block', width: 240, height: 240 },
  posterCafeName: { fontSize: 14, fontWeight: 700, color: '#333' },
  urlText:        { fontSize: 10, color: '#bbb', wordBreak: 'break-all', textAlign: 'center' },
  posterFooter:   { background: '#f8f8f8', padding: '10px 24px', textAlign: 'center', borderTop: '1px solid #eee' },
  devInfo:        { fontSize: 10, color: '#bbb', fontFamily: 'monospace' },
  btnRow:         { display: 'flex', gap: 10 },
  btn:            { padding: '10px 24px', borderRadius: 8, background: '#1a1a2e', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 14 },
  changeSection:  { marginTop: 4, width: '100%', maxWidth: 320, display: 'flex', flexDirection: 'column', alignItems: 'center' },
  changeLinks:    { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 },
  changeLink:     { fontSize: 12, color: '#999', textDecoration: 'underline', background: 'none', border: 'none', cursor: 'pointer' },
  restoreLink:    { fontSize: 12, color: '#1a1a2e', background: '#fff', border: '1px solid #ccc', borderRadius: 7, padding: '7px 12px', cursor: 'pointer', fontWeight: 600 },
  changeBox:      { width: '100%', display: 'flex', flexDirection: 'column', gap: 10, background: '#fafafa', border: '1px solid #eee', borderRadius: 10, padding: 16 },
  changeHint:     { fontSize: 12, color: '#888', lineHeight: 1.6, margin: 0 },
  input:          { padding: '10px 12px', borderRadius: 8, border: '1px solid #ddd', fontSize: 14, boxSizing: 'border-box', width: '100%' },
  error:          { fontSize: 12, color: '#e63946' },
  changeBtnRow:   { display: 'flex', gap: 8 },
  cancelBtn:      { padding: '10px 16px', borderRadius: 8, background: '#fff', color: '#888', border: '1px solid #ddd', cursor: 'pointer', fontSize: 14 },
};
