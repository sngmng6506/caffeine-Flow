# Caffeine Flow

음악 추천 및 커뮤니티 플랫폼.  

## 손님
- QR 스캔 후 YouTube / SoundCloud / Spotify 링크로 신청
- 실시간 재생 중 곡 확인
- 투표, 댓글
- 가게 TOP  / 전체 TOP 

## 사장님
- Google / Naver 로그인
- 신청곡 수락 / 거절 / 스킵
- 대기곡 순서 관리
- 공지, 허용 플랫폼, 신청 ON/OFF
- 시간대 / 요일별 통계
- 손님용 QR 코드 생성

## 디렉토리 구조

| 경로        | 역할                                              |
| ----------- | ------------------------------------------------- |
| `server/`   | Express + Postgres 백엔드 (v2, **활성**)          |
| `customer/` | 손님용 Vite/React SPA                             |
| `owner/`    | 사장님용 Vite/React SPA + Electron 데스크톱 앱     |
| `extension/`| Chrome 익스텐션 (v1 프로토콜, **현재 미사용**)    |
| `legacy/`   | v1 단일파일 서버 (**보관용, 운영 환경에서 미사용**) |

배포 entry는 `railway.json`이 `server/server.js`를 명시한다.
`npm run legacy`는 보관된 v1을 로컬에서 띄울 때만 사용.

## License

BSL
