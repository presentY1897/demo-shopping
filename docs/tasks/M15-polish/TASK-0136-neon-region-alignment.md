# TASK-0136: Neon DB와 API 리전 일치

| 항목 | 내용 |
| --- | --- |
| 마일스톤 | M15 마무리 |
| 상태 | 완료 |
| 작성일 | 2026-09-11 |
| 선행 | TASK0135 운영 검증, 대상 프로젝트 접근 및 전환 일정 확정 |
| 구현 예정 브랜치 / worktree | `feature/neon-region-alignment` / `feature-neon-region-alignment` |

## 1. 문제와 근거

사용자가 운영 Neon 리전을 AWS US East2 Ohio(`aws-us-east-2`)로 확인했다. API는 render.yaml상Singapore이다. 운영 DB 왕복 약200ms와 일치하는 유력한 지연 원인이다. API의 실제 대시보드 리전과 Render가 참조하는 Neon 프로젝트의 일치를 전환 전 다시 확인한다. 같은 지역 전후 측정 전에는 개선 폭 전체를 확정하지 않는다.

## 2. 제안

Neon에 Singapore(`aws-ap-southeast-1`) 새 프로젝트를 만들고 기존 스키마·데이터를 보존하여 복사한 뒤 API의 DATABASE_URL을 전환한다. 기존 Ohio DB를 유지한다. 기존 프로젝트의 region 필드 변경이나 기존 프로젝트 내 branch 생성으로는 지역이 바뀌지 않는다.

대안은 API/검색 서비스를Ohio로 재생성하는 것이다. DB 복사를 피하지만 API/검색/도메인 전환과 한국 사용자 HTTP 지연을 함께 고려해야 한다. 현재 API/검색이Singapore인 구성을 유지하려면 DB 이전이 우선 후보이다. 사용자가 대상 프로젝트를 준비하고 이전을 승인했다. 실행 결과는 아래 진행 기록에 남긴다. TASK0131의 인프라 이전 제외 범위를 넘어서는 별도 작업이다.

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
| F1 | 실 API/DB 리전 및 연결 대상 확인, Singapore 프로젝트 준비 | [x] |
| F2 | 로컬 복원 리허설·운영 백업·전 테이블 검증/금전·재고 대사 불일치0 | [x] |
| F3 | 동일 환경 배포·실구매/환불/권한/세션·이미지/장바구니 검증 통과 | [x] |
| F4 | warm3회 query/pool/전체 시간과 오류율 기록, 이전 대비 감소 검증; cold 근거를 별도 분리 | [x] |
| F5 | 전환/되돌리기 조건 검토, 원본 보존, TASK/인덱스/운영 문서 갱신 | [x] |

코드 변경 시 공통 품질 게이트 적용. 데이터/설정만 변경하면 백업·복원·정합성·운영 전후 검증이 필수다.

## 공식 자료

- [Neon 리전 및 변경 제약](https://neon.com/docs/introduction/regions)
- [Neon 프로젝트 간 복사](https://neon.com/docs/import/migrate-from-neon)
- [Render 리전 변경 제약](https://render.com/docs/regions)

## 2026-09-11 착수

사용자가 migration 실행을 승인했다. 전용 브랜치/worktree를 생성했다. 소스/대상 접속 정보는 저장소 밖 소유자 전용 파일에서 읽고 출력하지 않는다. 먼저 버전·리전·대상 빈 DB 여부를 읽기 전용으로 확인하고, 로컬 복원 리허설을 진행한다. Render 접근 확보와 모든 writer 정지 확인 전에는 최종 운영 복사 및 연결 전환을 하지 않는다. 원본 DB는 삭제하지 않는다.

### 사전 점검

- 소스/대상 직접 연결 읽기 전용 조회 성공. 호스트 리전은 각각 Ohio/Singapore이며 PostgreSQL은 둘 다 18.6이다. 소스 사용자 테이블 63개, 대상 0개이다.
- 입력된 pooled 주소의 Neon 호스트에서 `-pooler` 부분을 제거한 직접 주소를 메모리에서만 사용한다. 원본 보안 파일은 수정하지 않는다. PostgreSQL 18 도구를 준비하여 호환되는 로컬 18 복원 리허설을 수행한다.
- 사용자는 Render API 키 대신 대시보드에서 직접 서비스를 중지하고 환경변수를 변경한다. 정지 완료를 받기 전에는 최종 복사하지 않는다.

### 로컬 복원 리허설 결과

PostgreSQL 18 도구로 운영 소스를 읽기 전용 백업하고 네트워크·공개 포트 없는 별도 로컬 PostgreSQL 18 컨테이너에 복원했다. 백업 921,307 bytes, 사용자 테이블 63개/총 22,561행을 확인했다. 재고 원장 합계·연쇄·마지막 잔액·순번 대사 불일치0, 가상 카드 사용액/원장 합계 불일치0, 무효 인덱스0, 미검증 제약0이다. 전체 행 내용 digest를 로컬 보안 파일에 저장했다. 운영이 계속 쓰는 동안 얻은 리허설 스냅샷이므로 최종 이전 백업으로 사용하지 않는다. 대상 DB 쓰기·Render 환경변수 변경은 아직 없다.

다음 단계는 사용자의 Render 서비스 중지 및 실제 리전/소스 연결 일치 확인이다. 모든 writer가 중지된 뒤 별도 최종 백업과 원본/대상 전체 데이터 비교를 수행한다. F1~F5는 최종 검증까지 열어 둔다.

### 운영 최종 복사 착수

사용자가 Render Suspend 완료를 알렸고 공개 API health HTTP503을 확인했다. 소스의 다른 열린 transaction은0이며 기존 연결5개는 idle이다. 원본 데이터/스키마 digest를 백업 전후와 복원 후 비교하여 남은 writer에 의한 변경이 있으면 전환을 중단한다. 대상 사용자 테이블0을 재확인한 뒤 PostgreSQL18 custom dump와 단일 transaction 복원을 진행한다.

### 최종 복원 및 검증

중지 후 생성한 최종 백업은 921,314 bytes이다. 백업 전후 및 대상 복원 후 원본 데이터를 비교하여 변경 없음을 확인했다. Singapore 빈 DB에 `--no-owner --no-privileges --exit-on-error --single-transaction`으로 복원했다. 원본은 유지했다.

초기 스키마 digest 비교에서 SettlementStatus의 내부 `enumsortorder`가 원본1/1.5/2/3에서 복원본1/2/3/4로 재부여된 차이를 발견했다. 상태 label 및 상대 순서는 동일하며 pg_dump 복원 특성이다. 검증을 label과 상대 순위 비교로 수정했으며 DB 데이터를 변경하여 맞추지 않았다. 컬럼·제약·인덱스·사용자 trigger/function·enum 순서·sequence와 모든 테이블 행 내용을 다시 비교한다.

최종 재검증: 원본 변경 없음, 원본/대상 전체 비교 일치. 63테이블/22,561행, 재고·카드 대사 불일치0, 무효 인덱스0, 미검증 제약0. 이미지 URL·세션·Prisma migration 이력은 전체 행 digest 비교에 포함되어 보존됐다. 사용자가 Render DATABASE_URL을 대상의 애플리케이션 연결로 변경하고 서비스를 재개·배포하면 운영 검증을 이어간다. F1의 실제 Render 리전 및 연결 일치, F3/F4/F5의 배포 후 검증은 아직 미완료다.

### 운영 배포 후 검증

사용자의 환경변수 변경/재개 후 health database/search ok. 실제 구매3회 1,041.55/972.15/964.94ms, 결제 실패0/장바구니0/이미지 정상/reload401없음. 신규 주문이 대상에만 저장됨을 SQL로 확인했다. 타 계정 주문 접근403, 두 판매자 주문 취소/환불REFUNDED, 이후 재고·카드 대사 불일치0. [운영 이전 검증](../../reviews/2026-09-11-neon-region-migration.md). Ohio 원본과 보안 백업은 별도 삭제 결정 전까지 유지한다. 사용자가 Render 실제 Region도 Singapore임을 확인했다. F1~F5를 모두 충족하여 완료로 전환한다.

### PR146 검증 보완 계획

동일 head의 CI 두 번 모두 기존 payment-finalization 측정이 capture27회/상한26회로 실패했다. 로컬 해당9개는 통과했다. 이 저장소에는 Prisma query event가 응답 이후 도착하여 이웃 측정에 섞이는 문제를 처리하는 `recordStatements`가 이미 있다. API 동작/SQL 예산을 바꾸지 않고 결제 단계별 측정에 이 helper를 사용하여 앞뒤 이벤트를 배출한다. 계측 아래 실 PostgreSQL 해당 파일과 전체 게이트를 확인한다. 검증 보완 완료 전 TASK 상태는 진행중으로 되돌린다.

원인 확인: 계측 아래 이벤트를 완전히 배출하면 capture27회의 마지막 문장은 결제 이벤트 리스너의 비동기 Notification 일괄 INSERT이다. 기존26회는 응답 뒤 도착한 이 문장을 빠뜨린 기준이었다. 동기/나머지 문장 상한26회는 유지하고 Notification 일괄 INSERT가 정확히1회임을 별도 단언한다. 측정 전후에는 기존 recordStatements로 배출한다. SQL 진단 출력은 제거하고 운영 코드는 변경하지 않는다.

보완 후 계측 아래 실 PostgreSQL 해당9개 테스트가 통과했다. 운영 이전 F1~F5는 충족 상태이며 TASK를 완료로 유지한다. 테스트 helper 적용 변경에 대한 로컬 전체 게이트와 새 head CI는 PR 병합 전에 확인하고 PR 본문에 최종 결과를 기록한다.
