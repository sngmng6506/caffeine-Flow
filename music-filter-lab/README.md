# Music Filter Lab

AI 음악 필터가 신청곡을 어떻게 판단하는지 **실제 서버와 동일한 프롬프트·요청**으로 미리 테스트한다. 매장 분위기 프롬프트와 곡 메타데이터를 바꿔가며 accept/reject·사유·confidence를 확인한다.

## 특징

- `server/src/features/music-filter`의 `prompt.builder` · `llm.client`(tool calling) · `decision.policy` 로직을 그대로 옮겨, 실제 서버와 같은 판단·상태 매핑(accept→pending/accepted, reject→rejected, 오류→error_rejected fail-closed)을 재현한다.
- **모델**은 OpenRouter 모델 목록(`/api/v1/models`, 공개)에서 골라 바꿔가며 비교할 수 있다. 구조화 출력을 tool calling으로 받으므로 tool 지원 모델이면 대부분 동작한다.
- **매장 분위기 프롬프트**를 자유롭게 바꿔 판단 변화를 관찰한다.

## 실행

`labs/` 허브(`/labs/`)의 "음악 필터" 탭에서 쓰거나, 단독으로 열려면 저장소 루트에서:

```bash
python -m http.server 4000
```

`http://localhost:4000/music-filter-lab/` 접속.

## API Key

- 판단에는 **OpenRouter API Key**가 필요하다(브라우저 → OpenRouter 직접 호출).
- 키는 **이 브라우저의 localStorage에만 저장**되고 OpenRouter 외 어디로도 전송되지 않는다. 저장소·서버에 저장하지 않는다.
- 운영 서버의 키를 여기에 넣지 말고, 테스트용 키를 사용하는 것을 권장한다.

이 lab은 운영 API·DB와 연결되지 않는다. 실제 필터 동작의 최종 기준은 서버 코드다.
