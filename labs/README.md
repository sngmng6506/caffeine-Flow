# Labs 허브

흩어져 있던 정적 lab들을 **탭 하나로 묶어** 한 포트에서 확인한다. 각 탭은 해당 lab을 iframe으로 불러온다.

## 탭

- **Flow Mark** — `design-lab/` (대표 마크·상태 목업)
- **손님 디자인** — `customer-design-lab/` (손님 화면 색·레이아웃 시안 비교)
- **음악 필터** — `music-filter-lab/` (AI 음악 필터 판단 테스트)

## 실행

허브가 각 lab을 절대경로(`/design-lab/…` 등)로 불러오므로 **저장소 루트에서** 정적 서버를 연다(한 포트로 전부 사용).

```bash
python -m http.server 4000
```

이후 `http://localhost:4000/labs/` 에 접속한다.

- 탭을 처음 누를 때만 iframe을 로드하고, 이후에는 표시만 전환해 각 lab 상태(입력값 등)를 유지한다.
- 개별 lab만 따로 열고 싶으면 우측 상단 "↗ 새 탭에서 열기" 또는 `http://localhost:4000/music-filter-lab/` 처럼 직접 접속한다.
- 이 lab들은 운영 코드와 분리된 실험용이며, 최종안 확정 전에는 운영 `customer/owner` 코드에 반영하지 않는다.
