import CafePage from './pages/CafePage';
import { Music2 } from 'lucide-react';

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

  if (!slug) return (
    <main className='app-state'>
      <div className='app-state__icon' aria-hidden='true'><Music2 size={26} /></div>
      <h1>카페 QR 코드를 스캔해 주세요</h1>
      <p>매장의 신청곡 화면으로 연결해 드릴게요.</p>
    </main>
  );
  return <CafePage slug={slug} />;
}
