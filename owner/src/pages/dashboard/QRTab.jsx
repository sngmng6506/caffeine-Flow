import { useState } from 'react';
import { changeSlug } from '../../api';
import SettingsStatus from './SettingsStatus';

export default function QRTab({ url, cafeName, currentSlug, initialSlug, onSlugChanged }) {
  const [showChange, setShowChange] = useState(false);
  const [customSlug, setCustomSlug] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(url)}&size=280x280&margin=10`;

  async function handleDownload() {
    const src = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(url)}&size=600x600&margin=20&format=jpg`;
    setMessage(null);
    try {
      if (window.electronAPI?.supportsQrDownload) {
        const started = await window.electronAPI.downloadQrImage(src);
        if (!started) throw new Error('download rejected');
        return;
      }
      const res = await fetch(src);
      if (!res.ok) throw new Error('download failed');
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = `caffeine-flow-${cafeName}-qr.jpg`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
    } catch {
      setMessage({ tone: 'error', text: 'QR 이미지를 저장하지 못했어요. 다시 시도해 주세요.' });
    }
  }

  function handlePrint() { window.print(); }

  function handleRestore() {
    if (!initialSlug || initialSlug === currentSlug) return;
    const confirmed = window.confirm(
      `최초 QR 코드(${initialSlug})로 돌아갈까요?\n현재 QR 코드는 더 이상 동작하지 않아요.`
    );
    if (confirmed) handleReissue(initialSlug);
  }

  // 무작위 재발급(slug 없이) 또는 사전 제작 QR 코드로 재등록(slug 지정).
  // 성공 시 부모가 cafe.slug·토큰·소켓 연결을 함께 갱신해야 하므로
  // onSlugChanged로 위임한다.
  async function handleReissue(slugValue) {
    setLoading(true);
    setMessage(null);
    try {
      const updated = await changeSlug(slugValue || null);
      onSlugChanged(updated);
      setShowChange(false);
      setCustomSlug('');
      setMessage({ tone: 'success', text: '손님용 QR 연결을 변경했어요.' });
    } catch (e) {
      setMessage({ tone: 'error', text: e.message || 'QR 연결을 변경하지 못했어요. 다시 시도해 주세요.' });
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

      <div style={qrStyles.urlBox} className="no-print">
        <div style={qrStyles.urlLabel}>손님용 주소</div>
        <div style={qrStyles.urlValue}>{url}</div>
      </div>

      {/* 버튼 (프린트 시 숨김) */}
      <div style={qrStyles.btnRow} className="no-print">
        <button type="button" onClick={handlePrint} style={qrStyles.btn}>인쇄</button>
        <button type="button" onClick={handleDownload} style={qrStyles.secondaryBtn}>이미지 저장</button>
      </div>

      {/* 미리 제작한 아크릴 QR 등으로 교체하고 싶을 때 */}
      <div className="no-print" style={qrStyles.changeSection}>
        <SettingsStatus tone={message?.tone}>{message?.text}</SettingsStatus>
        {!showChange ? (
          <div style={qrStyles.changeLinks}>
            <button type="button" onClick={() => { setShowChange(true); setMessage(null); }} disabled={loading} style={qrStyles.changeLink}>
              다른 QR 코드로 변경
            </button>
            {initialSlug && initialSlug !== currentSlug && (
              <button type="button" onClick={handleRestore} disabled={loading} style={qrStyles.restoreLink}>
                {loading ? '처리 중…' : '최초 QR 코드로 돌아가기'}
              </button>
            )}
          </div>
        ) : (
          <div style={qrStyles.changeBox}>
            <p style={qrStyles.changeHint}>
              이미 인쇄하거나 제작한 QR이 있다면 코드를 입력해 연결해 주세요.
              비워두면 무작위로 새 QR을 발급해요. 기존 QR은 더 이상 동작하지 않아요.
            </p>
            <input
              placeholder="영문 소문자·숫자 (비우면 자동 발급)"
              value={customSlug}
              onChange={e => setCustomSlug(e.target.value.trim().toLowerCase())}
              style={qrStyles.input}
            />
            <div style={qrStyles.changeBtnRow}>
              <button type="button" onClick={() => handleReissue(customSlug)} disabled={loading} style={qrStyles.btn}>
                {loading ? '처리 중…' : customSlug ? '이 코드로 연결' : '무작위로 재발급'}
              </button>
              <button type="button" onClick={() => { setShowChange(false); setMessage(null); }} style={qrStyles.cancelBtn}>취소</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const qrStyles = {
  outer:          { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, paddingTop: 12 },
  poster:         { maxWidth: '100%', borderRadius: 12, overflow: 'hidden', border: '1px solid var(--owner-stroke)', display: 'inline-flex' },
  qrWrap:         { maxWidth: '100%', boxSizing: 'border-box', background: '#fff', padding: 20 },
  qrImg:          { display: 'block', width: 220, maxWidth: '100%', height: 'auto', aspectRatio: '1' },
  btnRow:         { display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 8 },
  urlBox:         { width: '100%', maxWidth: 360, padding: '10px 12px', borderRadius: 8, background: 'var(--owner-surface-subtle)', border: '1px solid var(--owner-stroke)', boxSizing: 'border-box' },
  urlLabel:       { fontSize: 12, color: 'var(--owner-text-muted)', marginBottom: 4 },
  urlValue:       { fontSize: 12, color: 'var(--owner-text)', lineHeight: 1.4, wordBreak: 'break-all' },
  btn:            { minHeight: 40, padding: '9px 20px', borderRadius: 8, background: 'var(--owner-primary)', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 650, fontSize: 13 },
  secondaryBtn:   { minHeight: 40, padding: '9px 20px', borderRadius: 8, background: '#fff', color: 'var(--owner-text)', border: '1px solid var(--owner-stroke)', cursor: 'pointer', fontWeight: 650, fontSize: 13 },
  changeSection:  { marginTop: 4, width: '100%', maxWidth: 320, display: 'flex', flexDirection: 'column', alignItems: 'center' },
  changeLinks:    { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 },
  changeLink:     { minHeight: 40, padding: '8px 10px', fontSize: 12, color: 'var(--owner-text-muted)', textDecoration: 'underline', background: 'none', border: 'none', cursor: 'pointer' },
  restoreLink:    { minHeight: 40, fontSize: 12, color: 'var(--owner-text)', background: '#fff', border: '1px solid var(--owner-stroke)', borderRadius: 8, padding: '8px 12px', cursor: 'pointer', fontWeight: 600 },
  changeBox:      { width: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 10, background: 'var(--owner-surface-subtle)', border: '1px solid var(--owner-stroke)', borderRadius: 10, padding: 14 },
  changeHint:     { fontSize: 12, color: 'var(--owner-text-muted)', lineHeight: 1.6, margin: 0 },
  input:          { minHeight: 40, padding: '9px 12px', borderRadius: 8, border: '1px solid var(--owner-stroke)', fontSize: 13, boxSizing: 'border-box', width: '100%' },
  changeBtnRow:   { display: 'flex', flexWrap: 'wrap', gap: 8 },
  cancelBtn:      { minHeight: 40, padding: '9px 16px', borderRadius: 8, background: '#fff', color: 'var(--owner-text-muted)', border: '1px solid var(--owner-stroke)', cursor: 'pointer', fontSize: 13 },
};
