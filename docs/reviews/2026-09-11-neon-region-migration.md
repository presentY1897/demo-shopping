# Neon Singapore 이전 검증

TASK0136에서 운영 DB를 Ohio에서 Singapore의 새 프로젝트로 이전했다. 사용자 승인으로 최종 복사 전 Render API를 Suspend하고, 복사 검증 후 사용자가 DATABASE_URL을 바꾸어 서비스를 재개·배포했다. 연결 정보와 백업 파일은 저장소 밖 소유자 전용 경로에 보관한다.

사용자가 Render 실제 대시보드 리전도 Singapore임을 확인했다. API와 DB가 같은 리전이다.

## 데이터 보존

- 소스/대상 PostgreSQL18.6, PostgreSQL18 도구 사용. pooled 호스트를 직접 연결 호스트로 변환하여 dump/restore했다.
- 로컬 PostgreSQL18 리허설 성공 후 운영 중지를 확인했다(health503, 열린 transaction0). 기존 idle 연결은 남아 있었지만 백업 전후와 대상 복원 후 원본 전체 데이터가 동일했다.
- 최종 백업921,314 bytes. 빈 대상에 `pg_restore --no-owner --no-privileges --exit-on-error --single-transaction` 복원 성공.
- 63개 테이블/22,561행의 테이블별 건수 및 전체 행 내용 digest 일치. 상품 이미지 URL, 세션, 주문/결제/환불, Prisma migration 이력도 포함한다.
- 컬럼·제약·인덱스·사용자 trigger/function·enum 값과 상대 순위·sequence 비교 일치. 원본의 SettlementStatus 내부 순번1/1.5/2/3은 복원 시1/2/3/4로 정규화되므로 실제 값과 정렬 순위로 비교했다. 데이터나 enum을 수정해서 비교를 맞추지 않았다.
- 복원 직후 및 운영 구매/환불 후 재고 원장 합계/연쇄/끝 잔액/순번 대사와 가상 카드 사용액/원장 합계 불일치0. 무효 인덱스0, 미검증 제약0.
- 실제 브라우저 신규 주문2건을 직접 조회했을 때 대상2건/원본0건으로, 배포 API가 Singapore DB에 쓰는 것을 확인했다.

## 운영 검증과 속도

같은 상품2개, 모바일390px, 실제 데모 BUYER/가상 카드, 주문서 reload와 진단 헤더 조건으로 순차3회 측정했다. API 응답을 mock하거나 주문/결제를 미리 생성하지 않았다. 카탈로그와 장바구니 준비는 실 API, 주문서 진입과 주문/결제는 실제 브라우저 클릭이다. DB는 warm이며 hosting cold 표본이 아니다.

| 표본 | 주문 클릭→완료 | 주문 생성 서버 | 결제 생성 서버 | 승인 서버 | 확정 서버 |
| --- | --- | --- | --- | --- | --- |
| 1 | 1,041.55ms | 78.27ms | 31.87ms | 42.40ms | 111.12ms |
| 2 | 972.15ms | 46.58ms | 23.12ms | 30.04ms | 36.98ms |
| 3 | 964.94ms | 34.42ms | 18.58ms | 31.82ms | 41.62ms |

이전 Ohio 운영 표본은17,319.97ms였다. 이전1회와 이후3회 비교이며 p95나 부하 보장은 아니다. 이후 중앙값972.15ms는 이전 단일 표본 대비 약94.4% 감소했다. 결제 응답 단일 조회는 기존 약200ms에서1.69~5.04ms로 줄었다. 각 요청의 DB 획득 합은0.10~2.46ms이다. 내부 span은 중첩되므로 합산해 벽시계로 해석하지 않는다.

3회 모두 판매자 주문2건PAID, 결제 요청 실패0, 구매 후 장바구니0, 장바구니/주문서 이미지 로드 성공, 주문서 reload 후401 없음. 세 번째 구매는 타 계정 주문 조회403과 양쪽 판매자 주문 취소/REFUNDED까지 확인했다. 취소는 실 API로 검증했으며 취소 UI 전체 시나리오를 의미하지 않는다. 운영 health의 database/search 모두ok이다.

원시 표본: [1](artifacts/checkout-review/neon-singapore-purchase-1.json), [2](artifacts/checkout-review/neon-singapore-purchase-2.json), [3](artifacts/checkout-review/neon-singapore-purchase-3.json). 이전 표본은 [TASK0135 검증](2026-09-11-payment-read-latency.md)에 있다.

## 보존과 되돌리기

Ohio 원본과 로컬 최종 백업은 별도 삭제 결정 전까지 유지한다. 현재 Singapore에 실제 구매와 배치 쓰기가 발생했으므로 Ohio로 DATABASE_URL만 되돌리면 데이터가 유실된다. 문제가 생기면 writer를 중지하고 변경분 복원/대사를 먼저 한다. 기존 원본을 자동 삭제하거나 자동 롤백하는 작업은 없다.

TASK0131의 hosting scale-to-zero 측정은 별도 미완료 항목이다. 앱 코드/스키마/timeout/JWT/쿠키/이미지 저장소는 이번 이전에서 바꾸지 않았다. 문서 PR에서는 기존 앱 코드의 로컬 전체 게이트를 반복하지 않고 문서/민감 정보 검사와 PR CI를 확인한다.
