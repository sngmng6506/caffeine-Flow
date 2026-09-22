---
name: run-app
description: 손님·사장님 화면을 데모 데이터로 띄우고 Playwright로 조작·스크린샷한다. 화면을 눈으로 확인해야 하는 UI 작업, 실시간 반영 확인, 재현 확인에 쓴다.
---

# 손님·사장님 화면 띄우고 확인하기

브라우저 화면 두 개는 이 컨테이너에서 실제로 띄우고 조작할 수 있다. Electron 재생
화면은 불가능하다([안 되는 것](#안-되는-것)).

명령과 환경변수의 기준은 [docs/DEVELOPMENT.md](../../../docs/DEVELOPMENT.md)이고, 여기에는
**그 문서만 보고는 알 수 없는 세 가지**와 실행 순서만 적는다.

## 1. 데모 데이터

```bash
npm run migrate --prefix server
npm run seed:demo --prefix server      # 재생 중·대기·확인 중·거절·긴 제목·SC/SP 배지
```

세션 시작 훅이 PostgreSQL과 루트 `.env`를 준비해 두므로 환경변수를 따로 붙이지 않는다.

## 2. 서버 기동 — `APP_URL`을 포트에 맞춘다

```bash
cd server && APP_URL=http://localhost:3000 nohup node server.js > /tmp/server.log 2>&1 &
```

`APP_URL` 기본값은 `5174`라 **그냥 띄우면 소켓이 붙지 않는다.** SPA를 서버 자신의 포트에서
열면 origin이 `http://localhost:3000`인데 allowlist에 없어 WebSocket 업그레이드가 400으로
거절된다(`server/app.js`의 `buildAllowedOrigins`). 운영에서는 SPA와 API가 같은 도메인이라
생기지 않는 로컬 전용 문제다. 화면은 폴링으로 그려지므로 **이 값을 빠뜨리면 실시간 반영만
조용히 죽는다.**

빌드된 SPA를 서빙하므로 화면을 고쳤다면 먼저 빌드한다.

```bash
npm run build --prefix customer && npm run build --prefix owner
```

## 3. 화면 열기

```bash
node .claude/skills/run-app/owner-session.js demo /tmp/shots   # 사장님 세션 준비
node .claude/skills/run-app/drive.mjs /tmp/shots --accept      # 두 화면 + 수락 확인
```

`--accept`는 사장님 화면에서 첫 "수락"을 누르고, 손님 화면이 **새로고침 없이** 바뀌는지
출력한다. 스크린샷은 `customer.png`, `owner.png`, `*-after-accept.png`로 남는다.
**찍은 이미지를 실제로 열어 본다** — 빈 화면은 실패다.

사장님 화면은 OAuth를 타야 들어갈 수 있어서 `owner-session.js`가 서버와 같은 함수로
토큰을 발급하고, 드라이버가 `localStorage`의 `token`·`cafe`에 넣는다. 둘 다 있어야 로그인
화면을 지나간다.

## 사장님 화면 폭 — 브라우저 창 폭이 아니라 패널 폭

`owner/DESIGN_GUIDE.md`가 말하는 "420px, 560px, 720px"는 **`.owner-dashboard`(왼쪽
운영 패널)의 실제 폭**이다. 이 패널은 `usePanelDivider.js`가 정하는 `panelRatio`(기본
42%, 최대 85%)만큼만 창 너비를 차지한다 — 오른쪽은 Electron BrowserView가 들어가는
자리다. Playwright 뷰포트를 그냥 420/560/720px로 주면 **패널은 그 42%인 176~302px에서
렌더링되고, 가이드가 검증하라는 폭은 확인하지 못한다.**

패널 폭을 정확히 맞추려면 로드 전에 비율을 최대로 고정하고, 목표 패널 폭을 그 비율로
나눈 값을 뷰포트에 준다.

```js
await page.evaluate(() => localStorage.setItem('cf_panel_ratio', '1')); // clampRatio가 0.85로 고정
// 목표 패널폭 420/560/720px -> 뷰포트 494/659/847px (÷0.85)
```

## 안 되는 것

- **Electron 재생 화면** — 외부 음악 플랫폼 접근 자체가 막힌다. 재생·종료 감지·BrowserView
  동작은 여전히 코드와 테스트로만 확인한다([docs/PLAYBACK.md](../../../docs/PLAYBACK.md)).
- **외부 썸네일** — egress 정책이 `i.ytimg.com` 등을 막는다. 드라이버가 외부 요청을 아예
  끊으므로 스크린샷의 썸네일은 항상 fallback 모양이다. 실제 썸네일 모양은 확인할 수 없다.
- **사장님 화면의 오른쪽 여백** — Electron에서 외부 음악 페이지가 들어가는 자리다. 브라우저
  에서는 왼쪽 패널만 그려지는 것이 정상이다.
