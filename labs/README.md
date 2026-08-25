# Labs 허브

흩어져 있는 정적 lab을 탭 하나로 묶어 한 포트에서 확인한다. 각 탭은 해당 lab을 iframe으로 불러온다.

| 탭 | 대상 |
| --- | --- |
| Flow Mark | [`design-lab/`](../design-lab/README.md) — 대표 마크·상태 목업 |
| 손님 디자인 | [`customer-design-lab/`](../customer-design-lab/README.md) — 손님 화면 색·레이아웃 시안 비교 |
| 음악 필터 (배포) | [`music-filter-lab/`](../music-filter-lab/README.md) — 서버가 `/filter-lab`에서 서빙 |

음악 필터 탭은 관리자 로그인 세션과 배포 환경의 OpenRouter 키를 재사용하므로 로컬 정적 서버가 아니라 배포 도메인에서 사용한다. 허브 탭은 배포 URL을 iframe으로 연다.

## 실행

허브가 각 lab을 절대경로(`/design-lab/…`)로 불러오므로 **저장소 루트에서** 정적 서버를 연다.

```bash
python -m http.server 4000
```

이후 `http://localhost:4000/labs/`에 접속한다.

- 탭을 처음 누를 때만 iframe을 로드하고 이후에는 표시만 전환해 각 lab의 입력 상태를 유지한다.
- 개별 lab만 열려면 우측 상단 "↗ 새 탭에서 열기" 또는 `http://localhost:4000/customer-design-lab/`처럼 직접 접속한다.
- 이 lab들은 운영 코드와 분리된 실험용이며 최종안 확정 전에는 `customer`·`owner` 코드에 반영하지 않는다.
