# Music Filter Lab

음악 링크와 매장 분위기 프롬프트를 넣으면 실제 서비스와 같은 로직으로 accept/reject와 사유를 판단하는 운영자 전용 화면이다. 운영 DB에 저장하지 않으며 실제 필터 동작의 최종 기준은 서버 코드다.

## 동작

- 서버가 같은 오리진의 `/filter-lab`에서 정적 파일을 제공한다.
- 운영자 콘솔과 같은 탭의 `sessionStorage` 관리자 토큰만 사용한다. 토큰이 없거나 만료되면 `/admin`으로 이동하며 별도 로그인은 제공하지 않는다.
- `POST /api/v1/admin/music-filter/test`가 URL → 트랙 메타데이터 추출과 `evaluateTrack`까지 실제 신청 흐름과 동일하게 처리하므로 브라우저에 OpenRouter 키를 노출하지 않는다.
- `GET /api/v1/admin/music-filter/models`가 OpenRouter `/models/user` 목록을 프록시한다. 입력해서 검색하며 비우면 서버 기본 모델(`MUSIC_FILTER_MODEL`)을 쓴다.
- 오류는 실제 서비스처럼 fail-closed로 거절 표시한다.

## 접속

운영자 콘솔(`/admin`)에 로그인한 뒤 헤더의 **필터 실험실**을 눌러 같은 탭에서 `/filter-lab`으로 이동한다.
