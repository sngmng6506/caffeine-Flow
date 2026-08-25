# Customer Design Lab

운영 손님 앱과 분리된 정적 UI 비교 시안이다. API·로그인·실시간 데이터와 연결되지 않고 customer 빌드에도 포함되지 않는다.

## 확인 방법

`customer-design-lab/index.html`을 브라우저로 직접 열거나, 로컬 정적 서버가 필요하면 저장소 루트에서 실행한다.

```bash
python -m http.server 4174 --directory customer-design-lab
```

이후 `http://localhost:4174`에 접속한다. 상단에서 시안과 390px·480px 너비를 전환할 수 있다.

## 시안 목록

시안의 라벨·이름·요약은 `customer-design-lab/app.js`의 배열이 단일 기준이다. 이 문서에 목록을 복사하지 않는다. 대략의 계열은 다음과 같다.

```text
A~S      기본 방향 탐색 (미니멀, 피드, 다크, 잡지, 브루탈 등)
T~W      눈이 편한 범위에서 색 개성을 강화한 후보
X, Y     레이아웃 고정 · 색만 교체한 대조군
E1~E4    네온·레이어드 에너지를 강화한 실험
M1~M3    사이버펑크 × 파스텔 다크 융합 실험
B1~B2    현재 앱 정체성을 유지한 채 얹은 변형
V1       의료 디자인 언어 실험
```

## 제품 반영 원칙

- 이 폴더의 스타일을 `customer/src`에서 직접 import하지 않는다.
- 운영 손님 앱이 채택한 방향은 Cyber Queue이며, 실제 구현 계약은 [customer/DESIGN_GUIDE.md](../customer/DESIGN_GUIDE.md)다.
- 새 시안을 제품에 옮길 때는 토큰과 컴포넌트를 디자인 가이드 기준으로 다시 정리한다.
