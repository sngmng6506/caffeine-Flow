import CafePage from './pages/CafePage';

// URL: /:slug  (예: /my-cafe, /my-cafe/, /my-cafe?foo=bar 모두 허용)
// slug는 카페 가입 시 cafe.service.js의 generateSlug에서 [a-z0-9]만 사용해 생성됨.
// 그 외 문자(쿼리, 해시, 하위 경로 등)는 잘라내고 형식이 맞지 않으면 null로 처리.
function parseSlug() {
  const first = window.location.pathname.split('/').filter(Boolean)[0];
  if (!first) return null;
  return /^[a-z0-9]+$/i.test(first) ? first.toLowerCase() : null;
}

export default function App() {
  const slug = parseSlug();

  if (!slug) return <div style={styles.center}>카페 QR코드를 스캔해주세요.</div>;
  return <CafePage slug={slug} />;
}

const styles = {
  center: { display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', fontFamily: 'sans-serif' },
};
