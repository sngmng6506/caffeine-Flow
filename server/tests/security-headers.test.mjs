import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'vitest';
import request from 'supertest';

import appModule from '../app.js';

const { app, corsOriginCheck } = appModule;

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
  assert.match(csp, /https:\/\/t1\.daumcdn\.net/);
  assert.match(csp, /https:\/\/t1\.kakaocdn\.net/);
  assert.match(csp, /https:\/\/unpkg\.com/);
  assert.match(csp, /script-src-attr 'none'/);
  assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/);
  assert.match(csp, /object-src 'none'/);
});

test('운영자 콘솔은 inline script 없이 외부 정적 자산을 사용한다', () => {
  const html = readFileSync(new URL('../admin-ui/index.html', import.meta.url), 'utf8');
  const adminJs = readFileSync(new URL('../admin-ui/admin.js', import.meta.url), 'utf8');

  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i);
  assert.match(html, /src="\/admin-assets\/admin\.js"/);
  assert.match(html, /href="\/admin-assets\/admin\.css"/);
  assert.doesNotThrow(() => new Function(adminJs));
});

test('Socket.IO origin 검사는 명시적으로 허용된 웹 origin만 통과시킨다', async () => {
  const localhost = await checkOrigin('http://localhost:5174');
  assert.equal(localhost.error, null);
  assert.equal(localhost.allowed, true);

  const missing = await checkOrigin(undefined);
  assert.ok(missing.error);
  assert.equal(missing.allowed, undefined);

  const nullOrigin = await checkOrigin('null');
  assert.ok(nullOrigin.error);
  assert.equal(nullOrigin.allowed, undefined);

  const foreign = await checkOrigin('https://evil.example');
  assert.ok(foreign.error);
  assert.equal(foreign.allowed, undefined);
});
