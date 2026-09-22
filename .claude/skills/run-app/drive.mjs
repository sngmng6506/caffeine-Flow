// 손님·사장님 화면을 열어 스크린샷을 남긴다. --accept를 주면 사장님 화면에서
// 첫 "수락"을 눌러 손님 화면이 새로고침 없이 바뀌는지까지 확인한다.
//
// 실행: node .claude/skills/run-app/drive.mjs <출력폴더> [--accept] [--slug demo]
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const args = process.argv.slice(2);
const outDir = args[0];
const accept = args.includes('--accept');
const slug = args.includes('--slug') ? args[args.indexOf('--slug') + 1] : 'demo';
const base = 'http://localhost:3000';

if (!outDir) {
  console.error('출력 폴더를 인자로 준다');
  process.exit(1);
}

// 외부 호스트(썸네일 i.ytimg.com 등)는 이 컨테이너의 egress 정책이 막는다.
// 그대로 두면 networkidle이 오지 않아 화면이 아니라 네트워크를 기다리게 된다.
// ws://도 허용해야 소켓이 붙는다.
const localOnly = (route) => (/^(https?|ws):\/\/localhost:3000/.test(route.request().url())
  ? route.continue()
  : route.abort());

const browser = await chromium.launch();
const problems = [];
let blocked = 0;
// 위에서 일부러 끊은 외부 요청은 항상 ERR_FAILED로 콘솔에 남는다. 그것까지 문제로
// 보고하면 진짜 오류가 묻힌다.
const watch = (page, who) => {
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (m.text().includes('net::ERR_FAILED')) { blocked += 1; return; }
    problems.push(`${who}: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`${who}: ${e}`));
};

const guest = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await guest.route('**/*', localOnly);
watch(guest, '손님');
await guest.goto(`${base}/${slug}`, { waitUntil: 'domcontentloaded' });
await guest.waitForTimeout(2000);
await guest.screenshot({ path: path.join(outDir, 'customer.png'), fullPage: true });
const guestBefore = await guest.locator('body').innerText();

const session = JSON.parse(fs.readFileSync(path.join(outDir, 'owner-session.json'), 'utf8'));
const owner = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await owner.route('**/*', localOnly);
watch(owner, '사장님');
await owner.goto(`${base}/owner/`, { waitUntil: 'domcontentloaded' });
await owner.evaluate((s) => {
  localStorage.setItem('token', s.token);
  localStorage.setItem('cafe', JSON.stringify(s.cafe));
}, session);
await owner.reload({ waitUntil: 'domcontentloaded' });
await owner.waitForTimeout(2000);
await owner.screenshot({ path: path.join(outDir, 'owner.png') });

if (accept) {
  const buttons = owner.getByRole('button', { name: '수락' });
  const before = await buttons.count();
  if (!before) {
    problems.push('수락할 신청곡이 없다 — seed:demo를 다시 실행한다');
  } else {
    await buttons.first().click();
    await owner.waitForTimeout(2500);
    await owner.screenshot({ path: path.join(outDir, 'owner-after-accept.png') });
    await guest.waitForTimeout(1500);
    await guest.screenshot({ path: path.join(outDir, 'customer-after-accept.png'), fullPage: true });
    const guestAfter = await guest.locator('body').innerText();
    console.log(`수락 버튼 ${before} -> ${await buttons.count()}`);
    console.log(`손님 화면이 새로고침 없이 바뀜: ${guestBefore !== guestAfter}`);
  }
}

// 사장님 화면은 브라우저에서 왼쪽 패널만 그린다. 오른쪽 빈 공간은 Electron에서
// 외부 음악 페이지가 들어가는 자리다 — 잘린 것이 아니다.
console.log(`스크린샷: ${outDir}`);
console.log(`외부 리소스 차단 ${blocked}건 (정상 — egress 정책)`);
console.log(problems.length ? `문제:\n  ${problems.join('\n  ')}` : '그 밖의 콘솔 오류 없음');
await browser.close();
