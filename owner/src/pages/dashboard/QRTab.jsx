export default function QRTab({ url, cafeName }) {
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
};
