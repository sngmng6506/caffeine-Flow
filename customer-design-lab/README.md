# Customer Design Lab

운영 고객 앱과 분리된 정적 UI 비교 시안이다. API, 로그인, 실시간 데이터와 연결되지 않으며 customer 빌드에도 포함되지 않는다.

## 확인 방법

customer-design-lab/index.html 파일을 브라우저로 직접 열면 된다.

로컬 정적 서버가 필요하면 저장소 루트에서 다음 명령을 실행한다.

    python -m http.server 4174 --directory customer-design-lab

이후 http://localhost:4174 에 접속한다.

## 비교 기준

- A · Threads Minimal: 무채색, 얇은 구분선, 콘텐츠 중심
- B · Disquiet Feed: 따뜻한 배경, 분명한 섹션, 커뮤니티 피드 밀도
- C · Clear Compact: 선명한 블루, 굵은 정보 위계, 빠른 행동 탐색
- D · Midnight Radio: 전체 다크, 온에어형 현재 재생, 몰입감
- E · Paper Zine: 종이와 세리프 타이포, 매거진형 정보 구조
- F · Messenger Queue: 대화 흐름처럼 이어지는 신청곡 목록
- G · Bento Player: 재생·신청·목록을 나눈 모듈형 구성
- H · Retro Jukebox: 크림·레드와 굵은 테두리의 음악적 개성
- I · Mono Signal: 흑백·형광 라임의 고대비 디지털 포스터
- J · Nightwave: 딥 네이비·전기 블루의 야간 방송
- K · Acid Club: 블랙·애시드 옐로의 독립 음악 포스터
- L · Redline FM: 차콜·시그널 레드의 산업형 라디오 콘솔
- M · Polar Signal: 차가운 화이트·시안의 정밀한 디지털 UI
- N · Layered Lime: 라임 신청 패널과 블랙 재생 카드의 이중 레이어
- O · Blue Float: 네이비 위에 부유하는 블루·화이트 핵심 패널
- P · Red Offset: 크림 바탕에 어긋나게 쌓은 블랙·레드 패널
- Q · Chrome Stack: 차가운 회색 위에 겹친 시안 프레임
- R · Cyber Queue: 블랙·애시드 옐로 핵심 패널과 K식 평면 신청곡 목록
- S · Daily Signal: 따뜻한 화이트 바탕에 형광 핵심 레이어만 남긴 일상 모드

### 개성 재검토 후보 T~W

눈은 편하게(순수 검정·흰색과 형광 배제) 유지하되, 밋밋함을 피하고 각 안이 뚜렷한 색 성격을 갖도록 방향을 잡은 후보다.

- T · Moody Lounge: 에스프레소 다크에 앰버 골드 하나로 프리미엄 야간 무드를 낸 편안한 다크
- U · Retro Warm: 크림 바탕에 빈티지 오렌지 + 틸 투톤의 정겹고 음악적인 개성
- V · Editorial Pop: 따뜻한 오프화이트에 확신에 찬 코발트 히어로와 강한 타이포 위계
- W · Botanical Dusk: 뮤트 플럼 다크에 세이지 + 소프트 로즈의 낯설지만 부드러운 색 이야기

### 색조합만 교체 A/B (X · Y)

"레이아웃은 그대로 두고 색만 바꾸면 어떤지"를 보기 위한 대조군이다. 두 안은 각진 모서리·하드 오프셋 그림자 등 구조가 동일하고 색 토큰만 다르다.

- X · 현재 손님 앱: 실제 `customer/src/styles/tokens.css` 값 그대로 (네온 라임 × 순검정 × 핫핑크 하드 그림자)
- Y · 리컬러 제안: X와 구조 동일, 색만 교체 (앰버 골드 × 웜 차콜 × 웜 클레이 그림자)

### 실험 배치 E1~E3

X(현재 네온)와 N(Layered Lime) 선호를 기반으로, 볼드·네온·레이어드 에너지를 더 밀어붙인 실험 방향이다.

- E1 · Neon Brutalist: 순검정에 라임 + 일렉트릭 마젠타 듀얼, 두꺼운 테두리와 스택 오프셋의 브루탈 포스터
- E2 · Liquid Acid: 라임→시안 그라디언트와 네온 글로우, 부드러운 라운드의 액체질감
- E3 · Vaporwave Sunset: 마젠타→퍼플→시안 선셋 그라디언트, 딥 인디고 위 레트로 퓨처
- E4 · Liquid Signal: E2(Liquid Acid) × X(현재 앱) 블렌드 — 라임/시안 그라디언트·글로우를 현재 앱의 네온 라임·순검정·핫핑크 정체성에 입힘

상단에서 전체/A~Y·E1~E4 시안을 선택하고 390px·480px 너비를 전환할 수 있다. 최종안이 정해지기 전에는 이 폴더의 스타일을 운영 customer/src에 반영하지 않는다.
