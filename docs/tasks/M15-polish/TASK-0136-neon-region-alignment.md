# TASK-0136: Neon DB와 API 리전 일치

| 항목 | 내용 |
| --- | --- |
| 마일스톤 | M15 마무리 |
| 상태 | 초안 |
| 작성일 | 2026-09-11 |
| 선행 | TASK0135 운영 검증, 대상 프로젝트 접근 및 전환 일정 확정 |
| 구현 예정 브랜치 / worktree | `feature/neon-region-alignment` / `feature-neon-region-alignment` |

## 1. 문제와 근거

사용자가 운영 Neon 리전을 AWS US East2 Ohio(`aws-us-east-2`)로 확인했다. API는 render.yaml상Singapore이다. 운영 DB 왕복 약200ms와 일치하는 유력한 지연 원인이다. API의 실제 대시보드 리전과 Render가 참조하는 Neon 프로젝트의 일치를 전환 전 다시 확인한다. 같은 지역 전후 측정 전에는 개선 폭 전체를 확정하지 않는다.

## 2. 제안

Neon에 Singapore(`aws-ap-southeast-1`) 새 프로젝트를 만들고 기존 스키마·데이터를 보존하여 복사한 뒤 API의 DATABASE_URL을 전환한다. 기존 Ohio DB를 유지한다. 기존 프로젝트의 region 필드 변경이나 기존 프로젝트 내 branch 생성으로는 지역이 바뀌지 않는다.

대안은 API/검색 서비스를Ohio로 재생성하는 것이다. DB 복사를 피하지만 API/검색/도메인 전환과 한국 사용자 HTTP 지연을 함께 고려해야 한다. 현재 API/검색이Singapore인 구성을 유지하려면 DB 이전이 우선 후보이다. 이 문서는 계획이며 실제 리소스 생성·데이터 복사·운영 전환은 아직 하지 않았다. TASK0131의 인프라 이전 제외 범위를 넘어서는 별도 작업이다.

## 3. 실행 전 필요한 것

- 운영 API의 실제 리전, 연결된 Neon 프로젝트/branch/database와 PostgreSQL major version을 소유자가 확인한다.
- 대상Singapore 프로젝트와 동일 버전의 빈 DB를 준비하고 요금/프로젝트 한도·소유자를 확인한다.
- 소스/대상의 **unpooled** 접속은 로컬 보안 입력 또는 승인된 계정 연결로 제공한다. 채팅/커밋/PR에 비밀번호·연결 문자열을 쓰지 않는다. 현재 세션에는 Neon/Render 계정 조작 도구나 인증된 CLI가 없어 운영 자원을 준비할 수 없다.
- 운영 쓰기를 멈출 시간과 다시 열 조건을 정한다. API뿐 아니라 예약 만료/결제 대사/배송/정산 배치 등 모든 writer가 대상이다.

## 4. 실행 및 검증 순서

1. 같은 버전 로컬 DB에서 dump/restore 절차를 먼저 검증한다. 기존 데이터는 삭제하지 않는다.
2. 운영 쓰기와 배치를 정지하고 진행 중 결제/transaction을 종료시킨다. 웹 UI만 막는 것으로 쓰기가 정지됐다고 보지 않는다.
3. 직접 연결로 schema+data+sequence+Prisma migration 이력을 custom-format dump한다. 보호된 파일(소유자만 읽기)에 백업하고, PostgreSQL에 호환되는 pg_dump/pg_restore를 사용한다.
4. 대상 **빈 DB**에 소유자/ACL 재지정 없이 복원한다. `pg_restore --exit-on-error --single-transaction`으로 실패를 감추지 않는다. 운영 데이터를 초기화하거나 seed를 다시 실행하지 않는다.
5. 테이블별 행 수와 PK/sequence, `_prisma_migrations`, Order/SellerOrder/Payment/Refund/Cart/Reservation/Coupon 상태를 비교한다. StockLedger와 가상 카드 원장 합계·캐시를 대사하고 FK/unique/index/trigger/extension을 확인한다. 세션·상품 이미지 URL/id도 보존한다. 비교 결과에는 개인 데이터 대신 건수/불일치 수만 남긴다.
6. API의 DATABASE_URL만 대상의 애플리케이션용 연결로 바꾸고 재배포한다. JWT·쿠키 설정과 앱 도메인은 유지한다. `/health`·검색·권한·실제 구매/환불·새로고침·장바구니 비움을 검증한다. API 기동 자체가 background writer를 시작한다는 점에 주의한다.
7. 같은 상품/브라우저/진단 헤더 조건에서 warm 구매를 소량3회 측정하고 이전 자료와 비교한다. SQL 횟수뿐 아니라 DB query/pool 시간과 전체 클릭→완료 시간을 기록한다. 실제 scale-to-zero가 확인된 표본은 warm과 분리하고 TASK0131에 연결한다.
8. 검증 후 트래픽을 연다. Ohio 원본은 보관 기간을 정해 유지하고 별도 결정 없이 삭제하지 않는다.

## 5. 되돌리기

대상에 아직 쓰기가 없으면 API 연결을 원본으로 복구하고 재배포한다. 대상 API를 한 번이라도 기동했다면 예약 만료 등 배치 쓰기도 생길 수 있다. 사용자/배치 쓰기가 발생한 뒤에는 단순히 원본으로 돌아가면 변경이 유실되므로, 양쪽 writer를 중지하고 변경을 복원/대사한 뒤 전환한다. 원본으로 자동 복귀하는 스크립트는 만들지 않는다.

## 6. 완료 기준

| # | 검증 | 충족 |
| --- | --- | --- |
| F1 | 실 API/DB 리전 및 연결 대상 확인, Singapore 프로젝트 준비 | [ ] |
| F2 | 로컬 복원 리허설·운영 백업·전 테이블 검증/금전·재고 대사 불일치0 | [ ] |
| F3 | 동일 환경 배포·실구매/환불/권한/세션·이미지/장바구니 검증 통과 | [ ] |
| F4 | warm3회 query/pool/전체 시간과 오류율 기록, 이전 대비 감소 검증; cold 근거를 별도 분리 | [ ] |
| F5 | 전환/되돌리기 조건 검토, 원본 보존, TASK/인덱스/운영 문서 갱신 | [ ] |

코드 변경 시 공통 품질 게이트 적용. 데이터/설정만 변경하면 백업·복원·정합성·운영 전후 검증이 필수다.

## 공식 자료

- [Neon 리전 및 변경 제약](https://neon.com/docs/introduction/regions)
- [Neon 프로젝트 간 복사](https://neon.com/docs/import/migrate-from-neon)
- [Render 리전 변경 제약](https://render.com/docs/regions)
