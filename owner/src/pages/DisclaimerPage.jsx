import { useState } from 'react';
import { acceptDisclaimer } from '../api';

export default function DisclaimerPage({ onAccept }) {
  const [loading, setLoading] = useState(false);

  async function handleAccept() {
    setLoading(true);
    try {
      await acceptDisclaimer();
      onAccept();
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.wrap}>
      <h2 style={styles.title}>저작권 안내</h2>
      <div style={styles.box}>
        <p>본 서비스는 손님이 음악을 <strong>추천</strong>하는 기능을 제공합니다.</p>
        <p>실제 음악 재생은 사장님이 직접 결정하며, 재생에 따른 저작권 책임은 운영자에게 있습니다.</p>
        <p>카페 등 공개 장소에서 음악을 재생하려면 <strong>한국음악저작권협회(KOMCA)</strong> 등 관련 단체에 이용 허락을 받아야 합니다.</p>
        <p style={styles.small}>위 내용을 이해하고 관련 법령을 준수할 것에 동의합니다.</p>
      </div>
      <button onClick={handleAccept} disabled={loading} style={styles.btn}>
        {loading ? '처리 중...' : '동의하고 시작하기'}
      </button>
    </div>
  );
}

const styles = {
  wrap:  { maxWidth: 480, margin: '80px auto', padding: '32px', fontFamily: 'sans-serif', boxShadow: '0 2px 16px rgba(0,0,0,0.1)', borderRadius: 16 },
  title: { marginBottom: 20, fontSize: 20 },
  box:   { background: '#f8f8f8', borderRadius: 10, padding: '20px', lineHeight: 1.8, fontSize: 14, marginBottom: 24 },
  small: { color: '#888', fontSize: 13 },
  btn:   { width: '100%', padding: '12px', borderRadius: 8, background: '#1a1a2e', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 15 },
};
