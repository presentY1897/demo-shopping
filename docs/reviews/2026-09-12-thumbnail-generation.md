# TASK0138 자동 썸네일 검증

## 구현

ProductImage의 원본 url은 유지하고 thumbnailUrl/cardImageUrl을 READY 파생 파일에 연결한다. 동일 판매자·원본 URL의 작업은 DB에서 합치며 전체 한 슬롯의 120초 lease/token으로 claim과 완료를 보호한다. 상품 이미지 INSERT 트리거가 영속 작업을 등록한다. 카탈로그·판매자·컬렉션·문의·장바구니·주문 생성·검색 및 상품 상세/최근 본 기록이 이를 소비한다. 과거 주문 JSON은 변경하지 않는다.

작업마다 자식 프로세스 하나를 실행하며 256/768px WebP를 순차 생성한다. 입력 10MiB/16MP/4채널, Sharp 내부 스레드 1·캐시 꺼짐, JS heap64MiB, 실제 RSS192MiB 감시, 작업 전체30초 제한을 둔다. 큐에는 이미지 바이트가 없다. 부모는 자식 close 이후 슬롯을 반환하고 임시 파일을 정리한다. 부모가 비정상 종료했을 때의 고아 임시 폴더도 소유 PID가 없는 경우 정리한다. RSS는25ms 관측 간격이므로 OS hard cap을 뜻하지 않는다.

cgroup v2/v1에서 현재 프로세스와 상위 그룹 제한을 함께 읽는다. 시작 시192+64MiB 여유가 없으면 claim하지 않는다. 실행 중 남은 여유64MiB 미만이면 중단한다. 제한 정보를 읽지 못해도 시작하지 않는다. 메모리 부족 대기는 실패 시도 수를 소모하지 않으며, 실패한 변환은 최대3회 시도 후 FAILED로 남긴다.

## 검증 결과와 한계

- 실제 PostgreSQL: 동시8개 claim에서1개 성공, lease 만료 복구·오래된 token 완료 차단,3회 실패 후 중단, 이미지 재정렬 후 READY URL 유지, 검색 갱신 등록 확인.
- 실제 Sharp/자식 프로세스/HTTP 저장소: JPEG/PNG/WebP, 회전·투명도·작은 이미지 확대 금지, 정상 크기별 생성, 바이트·픽셀·손상·403/404·업로드 거부, 중단/메모리·시간 감시/슬롯 회수·고아 및 임시 파일 정리 검증. 메모리·시간 감시의 강제 종료 검사는 테스트에서 제한을 낮춰 장치 동작을 확인했다.
- 최종 native 반복20건 p95와 최대 관측 RSS는 [원자료](artifacts/thumbnail-generation/native-process.txt)에 기록했다. 테스트 그림·로컬 HTTP 기준이며 모든 운영 이미지의 상한 실측 결과가 아니다.
- 실제 API `/api/v1/health` 150표본씩: baseline p95 5.428ms, 변환 중5.370ms, 후4.398ms. 변환20건 동시 진행, 변화 -1.08%. 실제 로컬 API/DB이나 결제·검색 전체 부하 또는 Render 성능을 보장하지 않는다. [원자료](artifacts/thumbnail-generation/api-impact.json).
- 별도 disposable DB에서 INSERT→claim→자식 변환→HTTP PUT→READY→실제 공개 상품 상세 응답→파생 파일 디코딩 전체 연결 통과. 원본 바이트 보존·검색 outbox 확인. R2는 로컬 HTTP 대역이므로 실제 운영 버킷 서명/권한 검증을 대신하지 않는다. [원자료](artifacts/thumbnail-generation/pipeline.txt).
- 통합 API 전체4,375개 통과·기존skip2. 이후 cgroup 보호를 포함한 관련20개 검사 통과. UI961/shop1,275/seller867/admin1,164/shared103/api-mocks472개 통과, 후속 갤러리/최근/찜32개 통과. 저장소 타입·린트·빌드·포맷 검사 통과. 수정 전 실패 기록은 전체 결과와 구분한다.
- 처음 API 전체 검사에서 로컬 Meilisearch 주소 누락을 바로잡았다. 기존 PostgreSQL 디스크 checkpoint 지연으로 최종 검사는 별도 postgres17.11 임시 tmpfs DB를 사용했다. fsync는 끄지 않았고 컨테이너 메모리1GiB/데이터 tmpfs768MiB로 제한했다. 운영 DB 작업은 없다.

## 배포/활성화 절차

1. 추가형 migration을 배포한다. `THUMBNAIL_GENERATION=off` 기본값에서는 원본 표시를 유지하고 신규 파일의 작업만 기록한다. UI 변경은 바로 사용할 수 있다.
2. 운영 원본과 주문 스냅샷은 백업/보존한다. R2 GET/PUT 가능 여부와 thumbnails 접두사의 보존 정책을 확인한다. 이 구현은 원본/파생 파일 DELETE를 수행하지 않는다.
3. 배포 환경에서 `node dist/thumbnails/backfill.js`로 최대100개씩 읽기 전용 목록 통계를 확인한다. `--after=<nextCursor>`로 계속한다. 이 단계는 URL을 출력하지 않고 eligible/skipped 수를 기록한다.
4. 메모리 여유·R2 권한을 확인한 후 `THUMBNAIL_GENERATION=on`으로 켠다. 새 상품 이미지1건으로 READY/실제 디코딩/원본 유지/검색 반영/메모리·API 응답을 확인한다. 이미 대기 중인 신규 등록 작업이 있다면 함께 하나씩 처리되므로 활성화 전 개수를 확인한다.
5. 기존 이미지 보완은 `node dist/thumbnails/backfill.js --apply` 및 cursor로 최대100개씩 등록한다. 소유 R2 키만 대상이며 누락 원본·외부 URL·시드SVG는 임의 이미지로 대체하지 않는다. 실패 재처리는 `--apply --retry-failed`로 명시한다.
6. 문제 발생 시 flag를 off로 바꿔 새 실행을 멈춘다. 기존 READY 읽기까지 되돌리려면 이전 API 코드를 배포한다. 추가한 nullable 컬럼·테이블은 남겨도 이전 코드와 호환된다. 새 스냅샷이 참조한 파일은 삭제하지 않는다.

운영 migration/실제 R2/메모리 관측·활성화·기존 데이터 보완은 아직 수행하지 않았다. TASK는 진행중이며 위 절차와 CI/배포 결과가 충족되어야 완료 처리한다.

추가 DB 검증: 상품 편집이 이미지를 삭제/재등록하는 동안 완료 처리는 Product 잠금에서 대기하고, 편집 커밋 후 새 이미지 행에 READY 주소를 반영한다. 데모 정리 분류와 SQL/Prisma 대표 이미지 투영도 회귀 검사로 유지한다.
