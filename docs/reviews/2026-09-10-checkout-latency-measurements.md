# 구매 흐름 성능 측정 — 2026-09-10

## 환경과 한계

기준 코드 `3712759`에 진단 파일을 추가했다. 로컬 PostgreSQL(동일 머신, 전용 worker DB), pool 5, 실제 Nest HTTP, 가상 카드 simulation off, 1판매자/1옵션/수량1이다. 동시성4는 독립 구매자4명이 동일 옵션을 구매한다. 운영 데이터는 변경하지 않았다.

**운영의 4~5초 지연은 재현되지 않았다. 운영 병목 원인은 미해결이다.** 로컬 인증은 테스트 header principal resolver로 JWT 검증·운영 세션/네트워크 경로를 제외한다. 서비스 내 계정/권한·소유권 확인은 실제 코드/DB를 통과한다. 최초 요청 표본은 앱 부팅과 fixture 준비 후 첫 구매이며, Render/Neon의 실제 cold start가 아니다. 이를 warm 표본에 섞지 않았다.

실행: `CHECKOUT_LATENCY_DIAGNOSTIC=1 pnpm --filter @shopping/api exec vitest run test/api/checkout-latency.diagnostic.spec.ts`. 기본 출력 `/tmp/checkout-latency.json`, `CHECKOUT_LATENCY_OUTPUT`으로 변경 가능하다. 테스트용 DB만 사용한다. 기본 전체 검사에서는 이 측정을 건너뛴다.

## 응답 시간

각 흐름 3회 워밍업 후 동시성1은30회, 동시성4는32회/요청. 시간 단위ms, p95는 nearest rank, 전체 실제 HTTP+공유 클라이언트 응답 검증 포함이다.

| 동시성 | 요청 | n | 중앙값 | p95 | 최대 | 오류 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | cart.add | 30 | 13.6 | 18.82 | 20.47 | 0 |
| 1 | cart.get | 30 | 4.73 | 5.78 | 7.63 | 0 |
| 1 | checkout.open | 30 | 14.03 | 15.41 | 17.06 | 0 |
| 1 | order.create | 30 | 16.81 | 24.54 | 28.13 | 0 |
| 1 | payment.authorize | 30 | 20.35 | 27.63 | 36.42 | 0 |
| 1 | payment.capture | 30 | 27.08 | 37.68 | 42.69 | 0 |
| 1 | payment.start | 30 | 11.11 | 13.17 | 13.23 | 0 |
| 4 | cart.add | 32 | 20.23 | 26.25 | 27.82 | 0 |
| 4 | cart.get | 32 | 4.83 | 5.61 | 5.68 | 0 |
| 4 | checkout.open | 32 | 22.65 | 31.3 | 32.65 | 0 |
| 4 | order.create | 32 | 21.65 | 23.74 | 25.06 | 0 |
| 4 | payment.authorize | 32 | 24.93 | 29.27 | 30.47 | 0 |
| 4 | payment.capture | 32 | 38.94 | 47.02 | 49.97 | 0 |
| 4 | payment.start | 32 | 13.67 | 16.37 | 16.93 | 0 |

## 구간 계측

각 요청에는 DB 연결 획득·query 실행(전송/반환 포함)·transaction·서비스의 account/조회·provider 호출을 계측했다. 계측 항목은 요청 종류와 시간/횟수뿐이며 SQL·파라미터·사용자 ID·주소·메모·카드·토큰은 산출하지 않는다.

아래는 동시성1의 평균이다. **중첩 구간을 더하지 않는다.** query 시간은 병렬 쿼리의 누적이고 transaction/provider/account 시간과도 겹친다. 잔여는 HTTP 총시간에서 최상위 서비스 시간을 뺀 것으로 guard·라우팅·응답 직렬화·네트워크·클라이언트 검증을 포함한다. 각각을 분리 측정한 값은 아니다.

| 요청 | DB 쿼리 수 | DB 누적ms | 연결 획득ms | transaction ms | provider ms | 최상위 서비스ms | 미분리 잔여ms |
| --- | --- | --- | --- | --- | --- | --- | --- |
| cart.add | 20 | 13.31 | 0.28 | 7.48 | 0.00 | 13.07 | 1.10 |
| cart.get | 10 | 5.39 | 0.23 | 0.00 | 0.00 | 3.99 | 0.92 |
| checkout.open | 25 | 16.71 | 0.68 | 5.70 | 0.00 | 13.08 | 1.13 |
| order.create | 26 | 18.33 | 0.59 | 8.34 | 0.00 | 16.61 | 1.18 |
| payment.authorize | 20 | 18.46 | 0.17 | 12.17 | 6.61 | 20.51 | 0.93 |
| payment.capture | 37 | 29.06 | 0.33 | 21.40 | 0.00 | 27.14 | 1.07 |
| payment.start | 13 | 9.14 | 0.11 | 6.93 | 0.00 | 10.26 | 1.10 |

## 해석과 후속 검증 범위

- 로컬에서 가장 긴 단계는 결제 확정이다. 주문 완료 처리의 transaction과 여러 DB 왕복이 중심이며, 가상 provider capture는 사실상 즉시 반환한다. 원장/재고/주문/장바구니 정합성을 위한 쿼리를 검증 없이 삭제할 근거는 없다.
- 동시성4에서 연결 획득 대기는 늘지만 수초 지연에 이르지 않는다. 운영 pool 고갈 또는 지역 간 RTT가 원인이라는 결론은 이 결과로 내릴 수 없다.
- 다음 운영 관측은 **동일 요청 ID로 JWT/권한·DB pool 획득·각 쿼리 RTT·transaction·provider·응답 직렬화를 연결하는 trace**가 필요하다. 운영 1회 데모 구매의 trace를 확보하고 local 1회와 비교하는 범위로 제한한다. 운영 부하 테스트나 유료 인프라 변경은 범위가 아니다.
- 후속 최적화 목표는 trace의 가장 큰 비중을 차지하는 구간에 둔다. 쿼리 RTT가 지배하면 응답 재조회/연속 조회를 검토하고, pool 대기가 지배하면 연결 보유 시간·pool 상한을 검토한다. 각각 동일 환경30표본의 p95 감소와 결제 정합성 회귀 검사를 함께 요구한다. 현재 운영 300ms 달성을 약속할 근거는 없다.

상세 수치: [집계](artifacts/checkout-review/api-latency-summary.json), [원시 시간 표본](artifacts/checkout-review/api-latency-samples.json). 운영 trace 접근과 실제 cold start 표본은 미확보로 남긴다.

## 홈과 이미지

홈 원본/수정본을 각각 로컬 Next dev 서버에서 Chromium 360px DPR2, 새 브라우저 context, 같은 운영 공개 API/CDN으로 번갈아3회 측정했다. 로컬에서만 CORS 전달을 보완했고 서버 캐시를 매번 지우지 않았다. 네트워크 throttling 없음. 첫 실행은 dev 컴파일 영향을 포함하므로 운영 Lighthouse 점수로 해석하지 않는다.

LCP 원본 5916/3476/3932ms, 수정본 792/676/760ms. 캐시/네트워크 변동과 dev 환경의 영향을 포함한 참고값이다. 변경 전 health가 검색 앞에 있었고 변경 후 상품 요청은 health와 병행한다. 3개 상품 원본 합 6,013,377 bytes → 750px WebP 75,928 bytes, 98.74% 감소. 실제 360px 표준 밀도에서는 384px 응답을 선택한다. 원본을 보존하며 이미지 변환 실패는 카드의 대체 표시로 처리한다.

[이미지 응답](artifacts/checkout-review/image-measurements.json), [360/768/1440px 디코딩 및 넘침 검사](artifacts/checkout-review/image-viewports.json), [홈 비교 원시 측정](artifacts/checkout-review/home-comparison.json).

## 구매 화면 브라우저 회귀

로컬 production build와 계약 기반 API 대역을 사용해 Chromium 360/390/768/1440px에서 검사했다. 실제 운영 결제를 수행한 검사가 아니다. 배송 메모 입력→주소록 이동→뒤로가기에서 메모 유지, DELETE 예약 해제 0건, 동의 후 결제 완료, 완료 화면 새로고침 후 주문 생성 추가 0건을 확인했다. 정상 이미지 naturalWidth 750, 실패 URL은 대체 표시, 가로 넘침 없음. 모바일 하단 CTA는 viewport 안에 있고 포커스된 메모 입력의 하단이 CTA 위에 놓였다. [결과](artifacts/checkout-review/checkout-viewports.json).

최초 전체 검사에서 검색 엔진 인증 키가 빠져 검색 관련54개가 실패했다. 전용 로컬 `.env.local`에 compose와 동일한 개발용 키를 설정한 뒤 검색/상품/토스 관련123개가 통과했다. 배송 정책 계약에 맞춰 상품 응답 검사를 갱신했다. 구매자1247개를 포함한 웹 전체 검사는 통과했고, 통합 전체 검사를 재실행 중이다.

### 최종 통합 회귀 보완

API 전체4341개 통과. 웹 전체 실행 중 기존 쿠폰 등록의 중복 클릭 검사가 첫 응답 완료 전/후를 구분하지 않아 요청2건을 관찰했다. 구현을 바꾸지 않고 첫 요청을 명시적으로 보류한 상태에서 두 번째 클릭을 검사하도록 바꿨으며60개 관련 검사가 통과했다. 검색 준비 중 빈 응답은 정상 빈 카탈로그로 캐시하지 않도록 회귀 검사를 추가했다.
