# 상품 이미지 제작·반영 자료

검수된 콘셉트 상품은 66개, 이미지 파일은 660개(1,228,911,310바이트)다. 남성복·여성복·유니섹스 명세와 컬러/재질별 전체 갤러리를 포함한다. 실제 판매 상품으로 오인하지 않도록 샘플 설명을 유지한다.

이미지 원본은 모두 Git 대신 R2에 보관한다. 이전 코트 이미지51개도 PR 커밋 이력에서 제거했다. 새로 clone한 환경의 코드 테스트·빌드는 이미지 다운로드 없이 실행할 수 있다.

## 로컬 이미지 복원

```sh
python3 apps/api/scripts/restore-reviewed-assets.py
python3 apps/api/scripts/restore-reviewed-assets.py --apply
```

첫 명령은 파일·체크섬 상태만 확인한다. `--apply`는 개발 버킷(shopping-dev)의 공개 R2 주소에서 없는 파일을 내려받고 SHA-256을 검증한다. 다른 내용의 기존 파일을 덮어쓰지 않는다. 고유 파일 기준 최대 약1.23GB를 받을 수 있다. `legacy-image-aliases.json`의 이전 코트 경로19개도 동일 체크섬의 파일로 복원하며, 로컬에 이미 확인한 파일은 네트워크 다운로드 없이 재사용한다. 공개 개발 URL이 비활성화되면 다운로드할 수 없다. 이 주소는 운영 자산 저장소가 아니다 — 운영 화면이 쓰는 사본은 shopping-prod(`https://cdn.demo-shopping.com`)에 따로 있고 복원 도구는 그쪽을 읽지 않는다.

`apps/shop/public/product-image-sets/*/manifest.json`에는 승인 상태, 의존 이미지, 실제 생성 프롬프트 및 검수 이력이 있다. `skills/product-image-set/scripts/pipeline.py check <manifest>`로 필수 컷 완성을 확인하고 `preview <manifest>`로 소개 HTML을 재생성한다. 전체 이미지가 승인된 manifest만 상품에 반영한다. `audience-samples-v1`, `shirt-ivory-v1`, `six-b-v1`은 이전 제작 이력이다. 복원 도구는 현재 승인 내보내기의660개 파일과 이전 코트의19개 별칭 경로를 복원하며, 이전 이력의 모든 파일을 복원하지는 않는다.

## 반영 도구

- `export-reviewed-products.cjs`: 별도 미리보기 DB에서 승인 상품과 옵션 갤러리만 내보낸다.
- `upload-reviewed-assets.cjs`: 명시한 환경 파일과 버킷을 검증하고 기존 키를 덮어쓰지 않으며, 공개 GET 체크섬을 확인한 뒤 재개용 맵에 기록한다. 기본은 dry-run이다.
- `import-reviewed-products.cjs`: 판매자·분류·SKU·이미지 소유권을 검사하고 도메인 서비스를 통해 상품·재고·검색 outbox를 추가한다. 기본은 읽기 전용이며 `--plan-only` 결과는 공개 파일 검증을 대체하지 못한다. 기본 대상은 `localhost:5582/shopping`뿐이다. 운영 DB는 `--production-plan <계획 파일>`을 줄 때만 열리고, 그때는 아래 가드를 통과해야 한다.
- `reviewed-production-guard.cjs`: 위 도구의 대상 판정. 계획 파일이 고정한 DB 호스트·경로, TLS, 버킷 shopping-prod, 공개 주소, 내보내기 SHA-256, 파일 수와 검증 상태를 대조하고, `--apply`에는 검증된 백업과 같은 입력의 dry-run 결과를 추가로 요구한다. 운영에서는 `--plan-only`를 거부한다. 검사는 `apps/api/test/scripts/reviewed-production-guard.spec.ts`(DB·네트워크 없음).
- `run-reviewed-import-local.cjs`: 로컬 미리보기 설정에서 원본 DB 주소를 유도한다. `localhost:5582/shopping` 이외는 거부한다. 운영 DB용 도구가 아니다(운영 반영은 위 `--production-plan` 경로로만 했다).
- `verify-reviewed-import.cjs`: 로컬 적용 결과에 대해 상세 조회와 공개 갤러리 연결을 확인한다.
- `seed-*-samples.cjs`: 각 배치를 별도 미리보기 DB에 등록한 실행 도구다. 해당 DB의 기존 판매자/분류 및 승인 이미지가 필요하며 새로운 빈 DB를 초기화하는 도구는 아니다.

명세는 `*-v1.json`/`*-v2.json`, 내보내기는 `reviewed-products-export.json`, 공개 파일 맵은 `uploaded-assets.json`이다. 로컬 연결 설정·백업·회원 행 해시·실행 로그·메모리 측정·화면 캡처는 커밋하지 않는다.

## 반영 상태

| | 이미지 | DB | 상태 |
| --- | --- | --- | --- |
| 개발 | R2 shopping-dev | 로컬 `localhost:5582/shopping` | 2026-09-10 상품66개·이미지660장 반영 — [catalog-production.md](catalog-production.md) |
| 운영 | R2 shopping-prod (`https://cdn.demo-shopping.com`) | 운영 DB | 2026-09-10 같은66개·660장 반영(상품800→866개) — [production-migration-plan.md](production-migration-plan.md) |

운영 쪽 수치는 실행한 세션의 기록이다. 2026-09-17에 운영 공개 검색 API에서 검수 상품이 조회되는 것은 관찰했지만 66개·660장 전수와 기존 행 보존을 다시 확인하지는 않았다. 운영 DB는 2026-09-11에 dump/restore로 리전을 옮겼다(TASK-0136). 무엇이 기록이고 무엇이 관찰인지는 위 운영 문서의 실행 기록에 줄마다 적었다. 병렬 생성 측정의 한계는 [catalog-production.md](catalog-production.md)를 참고한다.
