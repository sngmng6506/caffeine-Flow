# Music Filter Lab

음악 링크와 매장 분위기 프롬프트를 넣으면, **실제 서비스와 동일한 로직**으로 AI 음악 필터가 accept/reject·사유를 판단한다. 판단은 서버 엔드포인트를 통해 **Railway에 등록된 OpenRouter 키**로 실행되므로, 브라우저에 별도 키를 넣지 않는다.

## 동작 방식

- 이 정적 파일은 서버가 **같은 오리진**(`/filter-lab`)에서 서빙한다. 그래서 사장님 앱과 같은 오리진의 `localStorage.token`(로그인 세션)을 그대로 재사용하고, `/api/v1/cafes/me/music-filter/test`를 CORS 없이 호출한다.
- 서버 `POST /me/music-filter/test`가 URL→트랙 메타데이터 추출과 `evaluateTrack`(Railway 키)까지 실제 신청 흐름과 동일하게 처리한다.
- 오류는 실제 서비스처럼 fail-closed로 거절 표시한다.

## 접속

1. 사장님 앱(`/owner/`)에 **로그인**한다(같은 오리진의 세션 토큰을 쓰기 위해).
2. 같은 브라우저에서 **`/filter-lab/`** 로 이동한다. (예: `https://<배포 도메인>/filter-lab/`)
3. 로그인 세션이 없으면 "토큰 수동 입력"에 사장님 토큰을 넣는다(사장님 앱 localStorage의 `token`).

## 기능

- **음악 링크 + 프롬프트 → accept/reject + 사유** (실제 서비스 그대로).
- **모델 선택**: `GET /me/music-filter/models`가 OpenRouter 모델 목록을 프록시해 datalist로 제공한다(입력해서 검색). 비우면 서버 기본 모델(`MUSIC_FILTER_MODEL`)을 쓴다.
- **프롬프트 변경**으로 판단 변화를 관찰한다.

운영 DB에 저장하지 않는 테스트 전용이다. 실제 필터 동작의 최종 기준은 서버 코드다.
