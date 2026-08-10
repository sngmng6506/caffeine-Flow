import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'vitest';
import request from 'supertest';

import appModule from '../app.js';

const { app, buildAllowedOrigins, corsOriginCheck } = appModule;

function checkOrigin(origin) {
  return new Promise((resolve) => {
    corsOriginCheck(origin, (error, allowed) => resolve({ error, allowed }));
  });
}

test('CSP는 필요한 외부 리소스만 허용하고 inline script를 허용하지 않는다', async () => {
  const response = await request(app).get('/health').expect(200);
  const csp = response.headers['content-security-policy'];

  assert.ok(csp, 'Content-Security-Policy header가 있어야 한다');
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /script-src[^;]*'self'/);
  assert.match(csp, /https:\/\/accounts\.google\.com\/gsi\/client/);
  assert.match(csp, /https:\/\/t1\.kakaocdn\.net/);
  assert.match(csp, /https:\/\/postcode\.map\.kakao\.com/);
  assert.match(csp, /https:\/\/unpkg\.com/);
  assert.doesNotMatch(csp, /daumcdn\.net/);
  assert.doesNotMatch(csp, /postcode\.map\.daum\.net/);
  assert.match(csp, /script-src-attr 'none'/);
  assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/);
  assert.match(csp, /object-src 'none'/);
});

test('운영자 콘솔은 inline script 없이 Leaflet CDN 자산을 SRI로 고정한다', () => {
  const html = readFileSync(new URL('../../admin/index.html', import.meta.url), 'utf8');
  const adminJs = readFileSync(new URL('../../admin/admin.js', import.meta.url), 'utf8');

  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i);
  assert.match(html, /href="\/admin-assets\/admin\.css"/);
  assert.match(html, /src="\/admin-assets\/admin\.js"/);
  assert.match(html, /leaflet@1\.9\.4\/dist\/leaflet\.css[\s\S]*integrity="sha256-p4NxAoJBhIIN\+hmNHrzRCf9tD\/miZyoHS5obTRR9BMY="[\s\S]*crossorigin=""/);
  assert.match(html, /leaflet@1\.9\.4\/dist\/leaflet\.js[\s\S]*integrity="sha256-20nQCchB9co0qIjJZRGuk2\/Z9VM\+kNiyxNV1lvTlZBo="[\s\S]*crossorigin=""/);
  assert.doesNotThrow(() => new Function(adminJs));
});

test('owner 우편번호 연동은 Kakao CDN과 kakao.Postcode만 사용한다', () => {
  const loginPage = readFileSync(new URL('../../owner/src/pages/LoginPage.jsx', import.meta.url), 'utf8');

  assert.match(loginPage, /https:\/\/t1\.kakaocdn\.net\/mapjsapi\/bundle\/postcode\/prod\/postcode\.v2\.js/);
  assert.match(loginPage, /window\.kakao\?\.Postcode/);
  assert.match(loginPage, /new window\.kakao\.Postcode/);
  assert.doesNotMatch(loginPage, /t1\.daumcdn\.net/);
  assert.doesNotMatch(loginPage, /window\.daum/);
});

test('Socket.IO origin 검사는 same-origin 호환성과 cross-origin 제한을 함께 유지한다', async () => {
  // same-origin GET/HEAD long-polling은 브라우저가 Origin을 생략할 수 있다.
  const missing = await checkOrigin(undefined);
  assert.equal(missing.error, null);
  assert.equal(missing.allowed, true);

  const localhost = await checkOrigin('http://localhost:5174');
  assert.equal(localhost.error, null);
  assert.equal(localhost.allowed, true);

  const nullOrigin = await checkOrigin('null');
  assert.ok(nullOrigin.error);
  assert.equal(nullOrigin.allowed, undefined);

  const foreign = await checkOrigin('https://evil.example');
  assert.ok(foreign.error);
  assert.equal(foreign.allowed, undefined);
});

test('운영 origin allowlist에는 개발 localhost를 포함하지 않는다', () => {
  const origins = buildAllowedOrigins({
    appUrl: 'https://caffeine.example',
    nodeEnv: 'production',
  });

  assert.deepEqual([...origins], ['https://caffeine.example']);
});
