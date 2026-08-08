# Caffeine Flow Design Lab

실제 customer/owner 앱 코드와 분리된 정적 디자인 목업 디렉토리다.

## 목적

- 대표 `Flow Mark`를 SVG 도형으로 실험
- `idle / playing / new request / spread` 상태 비교
- 손님 화면의 now-playing, request notification, profile mark 목업 확인
- 16px favicon부터 128px 이상까지 축소 적합성 확인
- 실제 제품 코드로 옮기기 전 색상·밀도·애니메이션을 빠르게 조정

## 실행

빌드나 의존성 설치가 필요 없다.

```bash
cd design-lab
python -m http.server 8080
```

브라우저에서 `http://localhost:8080`을 연다.

`index.html`을 직접 열어도 대부분 동작하지만, 로컬 HTTP 서버를 권장한다.

## 파일

```text
design-lab/
  index.html    목업 화면
  styles.css    레이아웃·상태 애니메이션·토큰
  app.js        SVG Flow Mark 생성기
  README.md     이 문서
```

## 제품 반영 원칙

이 디렉토리는 실험실이다. customer/owner 코드에서 직접 import하지 않는다.
최종안이 정해지면 마크 생성 로직과 토큰을 실제 컴포넌트로 별도 이식한다.
