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

## 통합 검증 결과

로컬 전체 typecheck·lint·build 통과. API 4,341개 통과(진단 1개 기본 생략), 공유/UI/대역 패키지 통과. 웹 패키지는 머신 메모리 부족으로 전체 동시 실행에서 시간 초과가 발생해 workspace 동시성2·Vitest worker4로 제한하여 전부 다시 실행했다: 구매자1,248개(1개 생략), 관리자1,164개, 판매자867개 통과. 단일 최종 `pnpm test` 실행이 성공했다고 해석하지 않는다. GitHub CI의 typecheck·lint·build·test 네 게이트와 Lighthouse는 코드 기준 `f3dbb0a`에서 모두 통과했다. E2E 선택자를 수정한 `d945f04`에서도 네 게이트와 E2E·Lighthouse가 모두 COMPLETED/SUCCESS다. 이후 변경은 검증 기록 및 TASK 상태 문서뿐이며 최종 문서 head의 네 게이트도 머지 전에 확인한다.

초기 검색54개 실패는 전용 로컬 환경의 Meilisearch 개발 키 누락으로 해결했다. 배송 정책 계약에 맞춰 응답 검사를 갱신했다. 쿠폰 중복 클릭 검사는 첫 요청이 명시적으로 보류된 동안 두 번째 클릭을 검사하도록 고쳤다. 검색 준비 중 빈 응답은 정상 빈 목록으로 캐시하지 않도록 회귀 검사를 추가했다.

추가 Chromium 검사는 다음과 같다. API 대역을 사용한 브라우저 검사를 실 DB 검사와 구분한다.

- [주문 생성·승인·확정 응답 단절](artifacts/checkout-review/payment-response-loss.json): 각 단계 처리 후 응답을 끊어도 같은 주문으로 완료, 새로고침 후 주문 생성 합계1회.
- [주소 신규 등록·기존 주소 수정 왕복](artifacts/checkout-review/address-roundtrips.json): 메모 유지, 이동 시 예약 해제0회, 결제 성공.
- [403·손상 이미지](artifacts/checkout-review/thumbnail-failures.json): 대체 표시, 정상 이미지는 디코딩 성공. 404/null은 viewport 검사, 빈 URL은 컴포넌트 검사로 확인했다. 제보된 특정 상품 URL은 미확보이므로 그 원인 확인은 TASK-0129 F6에 남긴다.
- [직접 구매](artifacts/checkout-review/direct-purchase.json): 상세 옵션·수량2를 선택하면 해당 옵션2개만 주문서로 전달, 기존 장바구니 유지.

GitHub E2E의 구매·판매·환불 흐름은 실제 API/DB로 실행한다. 결제 완료 문구에 금액이 추가되어 주문번호 추출을 정규식으로 한정했다. 추가한 결제 후 장바구니 검사는 실제 빈 상태가 `heading`이 아닌 `status` 안 문단임을 확인하고 선택자를 수정했다. 실패 당시 브라우저 스냅샷에서도 장바구니가 비고 헤더 건수가 제거된 것을 확인했다.

## 배포 후 운영 소량 확인

PR #136의 `b954d63`을 2026-09-10 운영에 배포했다. Render API 및 Vercel 세 앱 배포 성공, health DB/search 정상, 신규 배송비 응답/주문서 초안 경로 확인. 운영 데모 가상카드 구매1건을 완료했고 승인·확정 응답이 브라우저에서 중단된 상황에서도 결과 조회로 자동 완료했다. 완료 화면 새로고침 복구, 결제된 장바구니 비움, 주문서 정상 이미지 디코딩을 확인했다. 장바구니 이미지 표본은 목록 로드 전에 채집되어 이미지 확인 근거에서 제외한다.

완료된 브라우저 요청에서 checkout.open 4,642ms, order.create 4,408ms, payment.start 3,011ms였다. 최초 확인의 장바구니 담기 실패와 별도 시도의 주문 생성 응답 유실도 관찰했다. 마지막 구매에서는 장바구니 담기·승인·확정 요청의 `net::ERR_ABORTED`가 발생했으며 실제 서버 작업은 반영됐다. 중단된 요청의 Playwright timing 값은 유효하지 않아 소요 시간 수치로 사용하지 않는다.

이로써 운영의 수초 지연은 브라우저에서 관찰했으나 **서버 내부 원인은 여전히 미확인**이다. 위 로컬 미재현 결과와 구분한다. 단일 성공 흐름의 값은 p95나 성능 개선 검증이 아니며 서버 trace 확보를 대신하지 않는다. [개인정보를 제외한 결과](artifacts/checkout-review/production-smoke.json).


## PR #137 운영 Server-Timing 실측

2026-09-10 API 배포 `a5661a9d267ac4f721b5d96c96cbf46414e671ee` 완료 후 실제 JWT 데모 구매자로 가상 카드 구매 1회를 수행했다. 모든 요청은 성공했고 결제 PAID와 장바구니 itemCount 0을 확인했다. 클라이언트는 Node fetch, 제한30초이며 기존 브라우저5초 중단과 구분한다. 운영 부하 검사는 수행하지 않았다. 단일 흐름이라 운영 median/p95나 cold start 수치를 산출하지 않는다.

| 요청 | 클라이언트 ms | 서버 ms | SQL 횟수 | SQL 누적 ms | 연결 획득 누적 ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| POST /cart/items | 4122 | 3710 | 21 | 4408 | 115 |
| GET /cart | 1483 | 1271 | 10 | 2102 | 1 |
| POST /checkouts | 3707 | 3327 | 25 | 5226 | 154 |
| POST /orders | 4736 | 4264 | 24 | 5044 | 1061 |
| POST /payments | 2855 | 2534 | 13 | 2732 | 1 |
| POST /payments/:id/authorize | 5340 | 4834 | 20 | 4285 | 740 |
| POST /payments/:id/capture | 8103 | 7384 | 35 | 7358 | 1418 |
| GET /cart | 1468 | 1265 | 10 | 2102 | 1 |

SQL 누적 시간에는 병렬 질의가 포함되므로 서버 벽시계와 합산하거나 비율로 환산하지 않는다. 서비스·transaction·provider 구간도 서로 중첩된다. 대부분의 단순 계정 조회가 약210ms이며 인증 resolver는0.16~0.42ms다. 장바구니 linesOf는 약1054ms, 결제 확정 markPaid는4006ms이며 provider capture는0.03ms다. 따라서 이 표본의 구매 지연에는 반복 DB 왕복과 transaction 내부 작업이 크게 기여하고, 외부 결제 capture 호출이나 JWT 처리만으로 설명되지 않는다. 연결 획득 지연도 주문 생성1061ms·capture1418ms로 관측됐다. 이것만으로 DB 리전 불일치·pool 고갈·DB CPU 병목 중 하나를 확정하지 않는다.

후속 수정 후보는 cart/checkout의 다중 relation 조회 왕복 축소, 이미 확인한 account/order의 요청 내부 중복 조회 축소다. 구매 상태 전이·원장·잠금·스냅샷을 유지한 실 PostgreSQL 회귀가 선행되어야 한다. Prisma relationJoins preview는 켜는 순간 기본 관계 로딩 전략 전체가 바뀌므로 특정 경로만 바뀐다고 가정하면 안 된다. 후속 구현은 별도 TASK에서 범위와 위험을 명시하고, 같은7개 요청 warm30회/동시32회 비교 및 운영 소량 전후 trace로 검증한다. 1차 목표는 대상 관계 조회의 SQL 왕복 수 절반 이하 및 동일 환경 p95 회귀0건이다. 전체 구매300ms 같은 검증되지 않은 운영 목표는 약속하지 않는다. 실제 cold start 표본은 여전히 미확보라 TASK-0131 F3는 열어 둔다.

[요청 ID와 구간 원자료](artifacts/checkout-review/production-server-timing.json). 토큰·주소·카드·SQL/매개변수는 저장하지 않았다.

### 복수 상품 운영 확인에서 발견한 추가 실패

썸네일 검증용 기존 시드 상품과 사진 상품2개를 함께 주문할 때, Chromium 주문서 조회가 오류 화면을 표시했고 최종 POST /payments/:id/capture가 HTTP500을 반환했다. 단일 상품 구매1회의 PAID/장바구니 비움 성공을 복수 상품 전체 성공으로 일반화하지 않는다. 이미지 표시 검증은 같은 운영 응답을 미리 받아 렌더링에 제공하는 방식으로 분리했다. 응답500에 성공 전용 Server-Timing은 없고 서버 오류 로그에 접근하지 못했으므로 transaction 만료를 확정 원인으로 기록하지 않는다. markPaid가 기본 Prisma transaction 안에서 상품별 예약/원장/상태 전이를 순차 실행하는 점과 운영 DB 왕복 약210ms를 근거로, 지연을 주입한 실 PostgreSQL 복수 상품 재현이 다음 조사 대상이다.
