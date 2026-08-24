# Music Filter Lab

음악 링크와 매장 분위기 프롬프트를 넣으면 실제 서비스와 동일한 로직으로 AI 음악 필터가 accept/reject·사유를 판단한다. 판단은 서버 엔드포인트를 통해 Railway에 등록된 OpenRouter 키로 실행하므로 브라우저에 키를 노출하지 않는다.

## 동작 방식

- 서버가 같은 오리진의 `/filter-lab`에서 정적 파일을 제공한다.
- 운영자 콘솔과 같은 탭의 `sessionStorage` 관리자 토큰만 사용한다.
- `POST /api/v1/admin/music-filter/test`가 URL→트랙 메타데이터 추출과 `evaluateTrack`까지 실제 신청 흐름과 동일하게 처리한다.
- 관리자 토큰이 없거나 만료되면 `/admin`으로 이동하며 별도 로그인·수동 토큰 입력은 제공하지 않는다.
- 오류는 실제 서비스처럼 fail-closed로 거절 표시한다.

## 접속

1. 운영자 콘솔(`/admin`)에 로그인한다.
2. 헤더의 **필터 실험실**을 눌러 같은 탭에서 `/filter-lab`으로 이동한다.

## 기능

- 음악 링크 + 프롬프트 → accept/reject + 사유를 실제 서비스 로직으로 판단한다.
- `GET /api/v1/admin/music-filter/models`가 OpenRouter의 `/models/user` 목록을 프록시한다. 입력해서 검색하며 비우면 서버 기본 모델(`MUSIC_FILTER_MODEL`)을 쓴다.
- 프롬프트와 모델을 바꿔 판단 차이를 비교한다.

운영 DB에 저장하지 않는 테스트 전용이다. 실제 필터 동작의 최종 기준은 서버 코드다.
