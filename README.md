# ☕ Caffeine Flow

> 카페 음악 추천 플랫폼 — 손님이 QR코드로 음악을 신청하고, 사장님이 직접 재생합니다.

## 사용 흐름

1. **손님** → 카페에 비치된 QR 스캔 → 듣고 싶은 노래 신청
2. **사장님** → 데스크탑 앱에서 신청곡 확인 → 수락 / 거절 → YouTube 재생
3. **실시간 공유** → 지금 재생 중인 곡, TOP 차트, 다른 손님 댓글

---

## 다운로드

**사장님 앱 (Windows)** → [최신 버전 다운로드](https://github.com/sngmng6506/caffeine-Flow/releases/latest)

> 설치 시 "Windows의 PC 보호" 경고가 뜨면 **추가 정보 → 실행** 을 눌러주세요.

**손님 앱** → 별도 설치 불필요. 카페 QR 스캔하면 바로 웹에서 열립니다.

---

## 주요 기능

### 손님
- YouTube / SoundCloud / Spotify 링크로 신청
- 실시간 재생 중 곡 확인
- 다른 손님 신청곡에 👍 투표
- TOP 차트 + 댓글

### 사장님
- Google / Naver 소셜 로그인
- 신청곡 큐 관리 (드래그앤드롭으로 순서 변경)
- 카페 공지, 허용 플랫폼, 신청 ON/OFF 설정
- 시간대 / 요일별 신청 패턴 통계
- YouTube 내장 재생 — 종료 시 다음 곡 자동 진행

---

## 저작권 안내

⚠️ 공개 장소에서 음악을 재생할 경우 **한국음악저작권협회(KOMCA)** 등에서 공연권 이용 허락을 받아야 합니다.  
본 서비스는 음악 신청·추천 플랫폼이며, 실제 재생 및 저작권 이용 허락 취득의 책임은 카페 운영자에게 있습니다.

---

## 개발자용

### 기술 스택
Node.js · Express · Socket.IO · PostgreSQL · React · Vite · Electron

### 로컬 실행

```bash
# 1. 환경변수 설정 (.env.example 참고)
cp .env.example .env

# 2. DB 마이그레이션
cd server && npm install && npm run migrate

# 3. 실행 (각 터미널)
cd server && npm run dev          # 서버 :3000
cd owner  && npm run electron:dev # 사장님 Electron 앱
cd customer && npm run dev        # 손님 앱 :5173
```

### 배포

- **서버 + 손님 앱**: Railway (`railway.json` 참고)
- **사장님 앱**: `cd owner && npm run electron:build` → GitHub Releases

---

## 라이선스

MIT
