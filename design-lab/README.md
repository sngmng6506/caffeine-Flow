# Flow Mark Design Lab

실제 customer/owner 코드와 분리된 정적 디자인 목업이다. 대표 마크 `Flow Mark`를 SVG로 실험한다.

## 목적

- `idle / playing / new request / spread` 상태 비교
- 손님 화면의 now-playing, request notification, profile mark 목업 확인
- 16px favicon부터 128px 이상까지 축소 적합성 확인
- 제품 코드로 옮기기 전 색상·밀도·애니메이션 조정

## 실행

빌드나 의존성 설치가 필요 없다.

```bash
python -m http.server 8080 --directory design-lab
```

브라우저에서 `http://localhost:8080`을 연다.

```text
index.html  목업 화면
styles.css  레이아웃·상태 애니메이션·토큰
app.js      SVG Flow Mark 생성기
```

## 제품 반영 원칙

customer/owner 코드에서 직접 import하지 않는다. 최종안이 정해지면 마크 생성 로직과 토큰을 실제 컴포넌트로 별도 이식한다.
