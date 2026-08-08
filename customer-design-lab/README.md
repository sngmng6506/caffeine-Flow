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
- C · Toss Compact: 선명한 블루, 굵은 정보 위계, 빠른 행동 탐색
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

상단에서 전체/A~S 시안을 선택하고 390px·480px 너비를 전환할 수 있다. 최종안이 정해지기 전에는 이 폴더의 스타일을 운영 customer/src에 반영하지 않는다.
