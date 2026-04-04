import CafePage from './pages/CafePage';

export default function App() {
  // URL: /:slug  (예: /my-cafe)
  const slug = window.location.pathname.replace(/^\//, '') || null;

  if (!slug) return <div style={styles.center}>카페 QR코드를 스캔해주세요.</div>;
  return <CafePage slug={slug} />;
}

const styles = {
  center: { display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', fontFamily: 'sans-serif' },
};
