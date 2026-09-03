# TASK-0011: 오브젝트 스토리지 (R2)

| 항목 | 내용 |
| --- | --- |
| 마일스톤 | M02 배포 파이프라인 |
| 상태 | 진행중 |
| 작성일 | 2026-09-02 |
| 브랜치 | `feature/object-storage` |
| 선행 작업 | TASK-0009 |

## 1. 목적

브라우저에서 오브젝트 스토리지로 **직접** 업로드하는 경로를 뚫는다. 이미지 본문이 API 프로세스를 거치지 않아야 한다 — Render 무료 인스턴스는 메모리 512MB 에 스케일 투 제로이고, 5MB 이미지 몇 장이 동시에 올라오는 것만으로 프로세스가 죽는다.

**계정이 없는 상태에서 어디까지 만들 수 있는가**가 이 TASK 의 실제 문제다. Cloudflare R2 는 S3 호환이므로 presigned URL 발급은 **네트워크 호출이 전혀 없는 순수 계산**이다 — HMAC 연쇄 하나다. 그래서 발급·검증·권한·계약·에러 처리는 전부 계정 없이 만들고 검증할 수 있고, 계정이 있어야만 확인되는 것은 **버킷 생성·공개 읽기 도메인·실 계정 왕복** 세 가지로 좁혀진다 (6.4).

## 2. 범위

### 포함 (계정 없이)

- **`POST /api/v1/uploads/presign`** — 판매자가 상품 이미지를 직접 올릴 presigned PUT URL 발급
- **AWS SigV4 쿼리 서명**을 순수 로직으로 구현 (4.1)
- 업로드 제약 — 확장자 화이트리스트 · MIME 일치 · 용량 상한 · 키 규칙 · 만료 (4.3)
- 권한 — 새 퍼미션 `media.upload`, 스코프 `own` 으로 자기 스토어만 (4.4)
- 계약 — 요청·응답 zod 스키마를 `packages/shared` 에, `ApiClient.presignUpload()` 추가
- R2 환경변수를 `.env.example` · `render.yaml` 에 반영, **미설정 시 503** 으로 동작 (4.5)
- **로컬 S3 호환 서버(MinIO) 왕복 검증 스크립트** — 계정 없이 F2·F3·F6 을 실증한다 (4.6)
- 버킷 CORS 설정 **문서화** (9장 부록 A)

### 포함 (계정 필요 — 이번에 하지 못함)

- R2 버킷 2개 생성 (dev / prod), API 토큰 발급
- 버킷 CORS 규칙 **적용**
- 공개 읽기 도메인(`cdn.demo-shopping.com` 또는 r2.dev) 연결
- 실 R2 계정 왕복

### 제외

- 상품 이미지 관리 UI (M05)
- 이미지 리사이즈·최적화 (별도 TASK)
- 고아 파일 정리 배치 (M05 에서 함께 검토 — 7장 R2)
- 리뷰 사진(M13)·클레임 증빙(M10) 업로드 — 같은 엔드포인트를 쓰지만 `purpose` 와 퍼미션 스코프가 다르다

## 3. 요구사항

- [x] presigned URL 로 브라우저에서 직접 업로드된다 — S3 호환 서버로 실증 (F2)
- [ ] 업로드된 파일이 **공개 URL** 로 조회된다 — 공개 읽기 도메인은 계정 필요 (F3)
- [x] 허용되지 않은 확장자·용량은 발급 단계에서 거부된다 (F4·F5)
- [x] presigned URL 이 짧은 시간 후 만료된다 (F6)
- [x] 발급된 URL 로 **선언한 것과 다른 것**을 올릴 수 없다 (F9 — 계획에 없던 요구사항, 4.3)

## 4. 설계

```
브라우저 → API : POST /api/v1/uploads/presign
                 { purpose, sellerId, filename, contentType, size }
API            : 확장자·MIME·용량·키 규칙 검증 → 스토어 소유권 확인 → SigV4 서명
API → 브라우저 : { key, uploadUrl, publicUrl, method, headers, contentLength, expiresAt }
브라우저 → R2  : PUT uploadUrl  (Content-Type 헤더 + 파일 본문)
브라우저 → API : (M05) 상품 저장 시 key 를 함께 보낸다
```

| 항목 | 값 |
| --- | --- |
| 키 규칙 | `products/{sellerId}/{uuid}.{ext}` — **서버가 만든다** |
| 허용 형식 | jpg · jpeg · png · webp (MIME 은 image/jpeg · image/png · image/webp) |
| 용량 상한 | 5MB (5,242,880 바이트) |
| URL 만료 | 5분 (300초) |
| 서명 헤더 | `host` · `content-length` · `content-type` |

### 4.1 AWS SDK 를 쓰지 않고 SigV4 를 직접 구현한다

**계획 변경.** 5장 구현 계획 2번은 "S3 호환 클라이언트 설정 (AWS SDK)" 이었다. 실제로 필요한 것을 확인한 뒤 바꿨다.

presigned URL 생성은 **네트워크 호출이 아니다.** 요청을 정규화하고 HMAC-SHA256 을 네 번 연쇄한 뒤 16진수로 붙이는 것이 전부다 — 90줄이면 끝나고, 그 대가로 `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` 의 전이 의존 수십 개가 사라진다.

의존 개수보다 중요한 이유가 셋 있다.

| 이유 | 내용 |
| --- | --- |
| **검증 가능성** | 서명은 순수 함수다. AWS 가 공개한 **알려진 입력 → 알려진 서명** 벡터로 고정할 수 있다 (F7). SDK 를 쓰면 "SDK 가 맞겠지" 이상을 말할 수 없다 |
| **결정론** | 시각을 `Clock` 포트로 주입받으므로 발급된 URL 이 **바이트 단위로 결정론적**이다. SDK 의 `signingDate` 로도 되지만, 우리 코드가 시각을 어디서 얻는지가 눈에 보이는 편이 QUALITY-GATES 6장(시간 주입)에 맞는다 |
| **커버리지** | Q5 의 "순수 로직 분기 100%" 를 이 모듈에 걸 수 있다. 벤더 코드에는 걸 수 없다 |

폐기한 대안: `@aws-sdk/s3-request-presigner` 를 **devDependency 로만** 넣고 교차 검증 테스트를 쓰는 안. 검증 강도는 올라가지만 lockfile 에 40개 남짓이 들어오고, 그 값은 아래 두 오라클(F7 공개 벡터 · F9 MinIO 왕복)이 이미 제공한다.

### 4.2 서명 대상

R2 는 **path-style** 엔드포인트를 쓴다.

```
PUT https://<account>.r2.cloudflarestorage.com/<bucket>/<key>?X-Amz-...
```

정규 요청(canonical request)의 페이로드 해시는 presigned URL 규약대로 `UNSIGNED-PAYLOAD` 다 — 서버는 본문을 미리 볼 수 없으므로 본문 해시를 서명에 넣을 수 없다.

### 4.3 용량 상한은 발급 단계 검증만으로는 강제되지 않는다

**여기가 이 설계에서 제일 놓치기 쉬운 지점이다.**

presigned PUT 은 본문이 API 를 거치지 않는다. 그래서 요청 본문의 `size` 를 검증해 400 을 돌려주는 것은 **정직한 클라이언트만** 막는다. URL 을 받은 뒤 6MB 를 올리면 그대로 올라간다.

`content-length` 와 `content-type` 을 **서명 대상 헤더에 넣으면** 스토리지가 강제한다. 실제 업로드의 헤더 값이 서명된 값과 다르면 S3 호환 서버가 403 `SignatureDoesNotMatch` 로 거부한다. 브라우저는 `Content-Length` 를 본문에서 자동으로 채우고 사용자 코드가 덮어쓸 수 없으므로(forbidden header name), 이것은 우회할 수 없는 바이트 수 상한이 된다.

MinIO 로 실증했다 (F9): 10바이트로 서명한 URL 에 70바이트를 보내면 403.

| | 발급 검증만 | + 서명 헤더 |
| --- | --- | --- |
| 정직한 클라이언트가 6MB 를 고름 | 400 (좋은 UX) | 400 |
| URL 을 탈취해 6MB 를 올림 | **통과** | **403** |
| URL 을 탈취해 `.exe` 를 올림 | 통과(확장자는 키에 이미 박혔지만 내용은 무엇이든) | Content-Type 불일치로 **403** |

두 층을 다 둔다. 발급 검증은 사용자에게 이유를 말해주기 위한 것이고, 서명 헤더가 실제 강제다.

> **리스크**: `Content-Length` 대신 chunked transfer-encoding 을 쓰는 클라이언트는 서명이 깨진다. `fetch(url, { body: file })` 로 `File`·`Blob` 을 보내면 브라우저가 `Content-Length` 를 채우므로 정상 경로에서는 문제가 없다. R2 가 서명된 `content-length` 를 S3·MinIO 와 같은 방식으로 강제하는지는 **계정 확보 후 확인해야 한다** (6.4 B4).

### 4.4 권한 — `media.upload` 를 신설한다

`product.write` 를 재사용하지 않는다.

- **다른 능력이다.** 상품 행을 고치는 것과 버킷에 바이트를 놓는 것은 실패 양상이 다르다 — 후자는 저장 용량·고아 파일·콘텐츠 책임이 걸린다.
- **소비자가 다르다.** 리뷰 사진(M13)·클레임 증빙(M10)은 구매자가 올리는데, 구매자는 `product.write` 를 갖지 않는다. 지금 `product.write` 로 묶으면 그때 되돌려야 한다.

| 역할 | 스코프 | 근거 |
| --- | --- | --- |
| `SELLER_OWNER` | `own` | 자기 스토어 경로에만 |
| `ADMIN_OPERATOR` | `any` | 운영자가 판매자 대신 이미지를 교체하는 일이 있다 |
| `ADMIN_SUPER` | `any` | 전 퍼미션 자동 부여 |
| `DEMO_ADMIN` | `demo` | `ADMIN_OPERATOR` 에서 파생 — 쓰기라서 `demo` 로 좁혀진다 |
| `BUYER` | — | 리뷰 사진 TASK(M13)가 필요할 때 준다. 지금 주면 쓰이지 않는 권한이 열린 채로 남는다 |

`own` 판정은 요청의 `sellerId` 로 `Seller` 행을 읽어 `sellerOwnership()` 으로 매핑한 뒤 `assertResourceAccess` 가 한다. 서비스는 소유자도 데모 여부도 직접 보지 않는다 (TASK-0105 F8).

**키는 서버가 만든다.** 클라이언트가 키를 고르게 하면 검증을 아무리 해도 남의 스토어 경로를 얻을 방법을 찾는 게임이 된다. `sellerId` 만 받고 `products/{sellerId}/{uuid}.{ext}` 를 서버가 조립하면 그 게임 자체가 없어진다.

### 4.5 R2 가 설정되지 않은 환경에서의 동작

계정이 없으므로 **환경변수 6개가 전부 비어 있는 상태가 정상 경로**여야 한다.

| 상태 | 동작 |
| --- | --- |
| R2 변수 **전부 미설정** | API 는 정상 부팅. presign 은 **503** + 통일 에러 포맷 |
| R2 변수 **전부 설정** | 정상 발급 |
| **일부만** 설정 | **부팅 거부** (`EnvValidationError`) |

부분 설정을 부팅 실패로 두는 이유는 `derived-env.ts` 가 `CORS_ORIGINS` 를 두고 한 판단과 같다 — 조용히 잘못된 값으로 도는 것이 아무것도 안 하는 것보다 나쁘다. 버킷 이름만 빠진 배포는 "이미지가 안 올라간다" 가 아니라 **다른 버킷에 쓴다**로 나타난다.

### 4.6 계정 없이 왕복을 검증하는 방법 — 로컬 S3 호환 서버

R2 는 S3 호환이므로 **같은 서명을 받는 다른 구현**에 대고 왕복을 돌려 볼 수 있다. MinIO 를 컨테이너로 띄우고 `apps/api/scripts/verify-presign-roundtrip.mjs` 가 실제 PUT·GET 을 한다.

이것이 증명하는 것과 증명하지 못하는 것을 구분해 둔다.

| 증명되는 것 | 증명되지 않는 것 |
| --- | --- |
| 서명이 **실제 S3 구현에 받아들여진다** | R2 의 구현 차이 (버킷 이름 규칙, 오류 코드 세부) |
| 서명된 `content-length`·`content-type` 이 **강제된다** | R2 의 공개 읽기 도메인 동작 |
| 만료된 URL 이 거부된다 | R2 의 CORS 프리플라이트 응답 |
| 서명 1비트를 바꾸면 거부된다 | R2 요금·쿼터 |

**이 스크립트는 `pnpm test` 에 들어가지 않는다.** QUALITY-GATES 6장이 R2 를 모킹 대상으로 못박았고, 컨테이너를 요구하는 검증이 단위 테스트 경로에 섞이면 그 규약이 무너진다. 스위트 안에서는 서명이 **공개 벡터**로 고정되고(F7), 왕복은 사람이 돌리는 스크립트로 남는다.

### 4.7 응답 형태

```json
{
  "key": "products/0192f0c1-…-a001/0192f0c2-…-b002.png",
  "uploadUrl": "https://<account>.r2.cloudflarestorage.com/shopping-dev/products/…?X-Amz-Algorithm=…&X-Amz-Signature=…",
  "publicUrl": "https://cdn.demo-shopping.com/products/…/….png",
  "method": "PUT",
  "headers": { "Content-Type": "image/png" },
  "contentLength": 70,
  "expiresAt": "2026-09-03T00:05:00.000Z"
}
```

`headers` 와 `contentLength` 를 돌려주는 이유: 서명에 들어간 값이므로 **클라이언트가 그대로 보내지 않으면 403** 이다. 응답이 그 사실을 말하지 않으면 호출자가 알 방법이 없다. `Content-Length` 는 브라우저가 채우므로 `headers` 에 넣지 않고 `contentLength` 로 따로 알린다 — 값이 다르면 다시 발급받아야 한다는 신호다.

## 5. 구현 계획

1. TASK 문서를 계정 없는 범위로 갱신 (이 문서) — 계획 변경이 먼저다
2. `packages/shared` 계약 — 업로드 스키마 + `ApiClient.presignUpload()`
3. 퍼미션 `media.upload` 추가 + 권한 매트릭스 재생성
4. SigV4 쿼리 서명 (순수 로직) + 공개 벡터 스펙
5. 업로드 제약 규칙 (순수 로직) + 스펙
6. R2 설정 파싱 · 오브젝트 스토리지 포트 · 미설정 시 503
7. presign 엔드포인트 (컨트롤러 · 서비스 · 스토어 소유권 매퍼)
8. 통합 스펙 (A1~A6 · C3) · 성능 스펙 (A1 · A5)
9. `.env.example` · `render.yaml`
10. MinIO 왕복 검증 스크립트
11. 검증 결과를 이 문서에 기록

## 6. 완료 기준

### 6.1 기능 — 계정 없이 검증한 것

| # | 기준 | 측정 방법 | 목표 | 결과 | 충족 |
| --- | --- | --- | --- | --- | --- |
| F1 | presign 발급 | 정상 요청 | `uploadUrl`·`publicUrl`·`key` 반환 | | [ ] |
| F2 | 직접 업로드 | 발급된 URL 로 PUT (MinIO) | 200, 파일 저장됨 | | [ ] |
| F4 | 확장자 거부 | `.exe`·`.svg` 로 presign 요청 | 400 + 통일 포맷 | | [ ] |
| F5 | 용량 거부 | 6MB · 0바이트로 presign 요청 | 400 + 통일 포맷 | | [ ] |
| F6 | URL 만료 | 만료 시각을 지난 URL 로 PUT | 403 | | [ ] |
| F7 | **서명이 올바르다** | AWS 공개 문서의 알려진 벡터 | 서명·정규요청 해시 일치 | | [ ] |
| F8 | **발급이 결정론적이다** | 고정 Clock 으로 2회 발급 | URL 바이트 단위 동일, `expiresAt` = now + 300s | | [ ] |
| F9 | **서명 헤더가 강제된다** | 선언과 다른 크기·형식으로 PUT (MinIO) | 403 | | [ ] |
| F10 | 서버 미경유 | 코드 경로 확인 | 파일 본문이 API 를 거치지 않음 | | [ ] |
| F11 | 미설정 시 503 | R2 변수 없이 presign 호출 | 503 + 통일 포맷 | | [ ] |
| F12 | 부분 설정은 부팅 실패 | 변수 일부만 설정 | `EnvValidationError` | | [ ] |

### 6.2 품질 게이트

[공통 품질 게이트](../QUALITY-GATES.md) 적용. 예외:

- **Q5(커버리지 수치) 면제** — M05 부터 적용. 다만 순수 로직(서명·업로드 규칙)은 **분기 100%** 를 이 TASK 에서 지킨다
- **3장 API 게이트**: A1·A2·A3·A4·A5·A6 적용. **A7(동시 요청) 해당 없음** — presign 은 잔액·재고·순서·멱등 어느 것도 건드리지 않는다. 같은 요청을 두 번 보내면 서로 다른 UUID 키가 두 개 나오고, 그것이 올바른 동작이다
  - 원래 문서는 "A3·A4 는 M04 이후" 였으나 TASK-0105·0106 으로 권한 계층과 하네스가 완성되어 **지금 적용한다**
- **2장 화면 게이트 해당 없음**
- **4장 데이터 게이트 해당 없음** — `schema.prisma` 를 바꾸지 않는다
- **5장 계약 게이트**: C1·C3 적용. C2 는 프론트 TASK(M05)

### 6.3 문서

| # | 기준 | 결과 | 충족 |
| --- | --- | --- | --- |
| D1 | 상태 갱신 + 인덱스 2곳 | | [ ] |
| D4 | R2 환경변수 `.env.example` · `render.yaml` 반영 | | [ ] |
| D5 | 도입한 라이브러리 버전 8장 기록 | | [ ] |

### 6.4 계정이 있어야 확인되는 것 — **막혀 있는 항목**

| # | 항목 | 무엇을 기다리는가 | 무엇이 있으면 검증 가능한가 |
| --- | --- | --- | --- |
| B1 | R2 버킷 2개 생성 (dev / prod) | Cloudflare 계정 + R2 구독(무료 티어도 결제수단 등록 필요) | 대시보드에서 버킷 2개. 부록 A-1 |
| B2 | API 토큰 발급 | B1 | Access Key ID · Secret Access Key. 부록 A-2 |
| B3 | 버킷 CORS 적용 | B1 | 부록 A-3 의 JSON 을 버킷 설정에 붙여넣기 |
| B4 | **실 R2 왕복** — 서명·`content-length` 강제 확인 | B2 | `R2_*` 를 `.env` 에 채우고 `pnpm --filter @shopping/api storage:roundtrip` |
| B5 | 공개 읽기 도메인 (F3) | B1 + DNS(TASK-0008) | `cdn.demo-shopping.com` 을 버킷에 연결하거나 r2.dev 공개 활성화 |
| B6 | Render 에 R2 환경변수 주입 | B2 + Blueprint | `render.yaml` 의 `sync: false` 6개를 대시보드에서 채운다 |

**B1~B6 이 남아 있는 동안 상태는 `진행중` 이다.** F3(공개 조회)은 B5 없이는 어떤 방법으로도 검증할 수 없다 — MinIO 로 대체하면 "우리 서버가 우리 파일을 준다"만 증명되고, 정작 확인해야 할 것(R2 공개 도메인이 익명 GET 을 허용하는가)은 그대로 남는다.

## 7. 리스크 / 열린 질문

| # | 내용 | 대응 |
| --- | --- | --- |
| R1 | 인증 도입 전 presign 이 무제한 노출 | **해소됨.** TASK-0105 의 기본 거부 + `media.upload` 로 가려진다. 인증(TASK-0021/0022)이 붙으면 익명은 401 |
| R2 | 참조되지 않는 고아 파일 누적 | 상품 저장 시 키를 기록하는 것은 M05 다. 참조 없는 키를 정리하는 배치를 M05 에서 함께 검토 |
| R3 | `content-length` 서명을 R2 가 강제하지 않을 가능성 | B4 로 확인한다. 강제하지 않으면 용량 상한이 발급 검증만 남으므로, R2 의 이벤트 알림이나 주기 스캔으로 초과 객체를 지우는 보완이 필요하다 |
| R4 | chunked 전송을 쓰는 클라이언트는 서명이 깨진다 | `File`·`Blob` 본문은 브라우저가 `Content-Length` 를 채운다. 서버 간 업로드가 필요해지면 그때 별도 발급 경로를 둔다 |
| R5 | presigned URL 이 로그·리퍼러로 새면 만료 전까지 유효 | 만료 5분 + 키가 UUID + 업로드 전용(읽기 권한 없음). 유출된 URL 로 할 수 있는 최대는 **이미 정해진 키에 정해진 크기·형식의 바이트를 한 번 덮어쓰는 것**이다 |
| R6 | 무료 R2 도 결제수단 등록을 요구한다 | 사용자 판단 사항. 등록 전까지 presign 은 503 이고 나머지 API 는 정상 동작한다 |

## 8. 확정된 버전

| 패키지 | 버전 | 용도 |
| --- | --- | --- |
| (없음) | — | 새 런타임 의존을 도입하지 않았다. SigV4 서명은 `node:crypto` 만 쓴다 (4.1) |

검증에 쓴 도구:

| 도구 | 버전 | 용도 |
| --- | --- | --- |
| minio/minio | (컨테이너, 수동 검증 전용) | S3 호환 왕복 검증. `pnpm test` 에 포함되지 않는다 |

## 9. 변경 이력

| 날짜 | 내용 |
| --- | --- |
| 2026-09-02 | 최초 작성 |
| 2026-09-03 | **계정 없이 진행 가능한 범위로 계획 갱신.** AWS SDK 대신 SigV4 직접 구현(4.1), `content-length`·`content-type` 서명으로 용량 상한 실강제(4.3), 퍼미션 `media.upload` 신설(4.4), 미설정 시 503(4.5), MinIO 왕복 검증(4.6). 6.4 에 계정이 필요한 항목 B1~B6 을 분리 |

---

## 부록 A. Cloudflare 대시보드에서 해야 할 것

계정이 준비되면 아래를 순서대로 한다. **모두 대시보드 클릭이고 코드 변경은 없다.**

### A-1. 버킷 2개 만들기

1. <https://dash.cloudflare.com> 로그인 → 왼쪽 메뉴 **R2 Object Storage**
2. 처음이면 **Purchase R2 / 결제수단 등록** 을 요구한다. 무료 티어(10GB 저장·월 100만 Class A 요청)만 써도 카드 등록은 필요하다
3. **Create bucket** → 이름 `shopping-dev` → Location: **Automatic** → **Create bucket**
4. 같은 방식으로 `shopping-prod` 를 하나 더 만든다
5. 버킷 화면 오른쪽 위의 **Account ID** 를 적어 둔다 → `R2_ACCOUNT_ID`

> 개발용과 운영용을 나누는 이유: 로컬에서 잘못 올린 파일이 운영 공개 도메인에 그대로 뜨는 일을 없앤다.

### A-2. API 토큰 발급

1. R2 개요 화면 오른쪽 **Manage R2 API Tokens** → **Create API token**
2. Token name: `shopping-api`
3. Permissions: **Object Read & Write**
4. Specify bucket(s): `shopping-dev` · `shopping-prod` 만 선택 (계정 전체 권한을 주지 않는다)
5. TTL: 필요 없으면 비워 둔다
6. **Create API Token** → 다음 화면에 한 번만 보이는 값 2개를 복사한다
   - **Access Key ID** → `R2_ACCESS_KEY_ID`
   - **Secret Access Key** → `R2_SECRET_ACCESS_KEY`
7. 같은 화면의 **Use jurisdiction-specific endpoints** 아래 S3 엔드포인트가 `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` 인지 확인한다

### A-3. 버킷 CORS 설정

버킷 → **Settings** → **CORS Policy** → **Add CORS policy** 에 아래를 넣는다. **개발용 버킷(`shopping-dev`)** 기준이다.

```json
[
  {
    "AllowedOrigins": [
      "http://localhost:3001",
      "http://127.0.0.1:3001"
    ],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["content-type"],
    "ExposeHeaders": ["etag"],
    "MaxAgeSeconds": 3600
  }
]
```

**운영용 버킷(`shopping-prod`)** 은 오리진만 바꾼다.

```json
[
  {
    "AllowedOrigins": ["https://seller.demo-shopping.com"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["content-type"],
    "ExposeHeaders": ["etag"],
    "MaxAgeSeconds": 3600
  }
]
```

설계 근거:

| 항목 | 값 | 이유 |
| --- | --- | --- |
| `AllowedOrigins` | 판매자 앱만 | 상품 이미지를 올리는 화면은 `apps/seller` 하나다. 구매자·관리자 오리진을 넣을 이유가 지금은 없다. 로컬은 워크트리마다 포트가 다르므로(`PORT_OFFSET`) 자기 포트를 추가한다 |
| `AllowedMethods` | `PUT` 만 | 발급하는 URL 이 PUT 전용이다. `GET` 은 공개 읽기 도메인이 담당하고 그쪽은 CORS 가 필요 없다 |
| `AllowedHeaders` | `content-type` | 프리플라이트가 묻는 것은 이 헤더 하나다. `Content-Length` 는 브라우저가 붙이는 forbidden header 라 목록에 넣지 않는다 |
| `ExposeHeaders` | `etag` | 업로드 성공 후 무결성 확인에 쓴다 |
| `*` 를 쓰지 않는 이유 | — | presigned URL 은 그 자체로 쓰기 권한이다. 오리진을 열어 두면 유출된 URL 을 아무 페이지에서나 쓸 수 있다 |

### A-4. 공개 읽기 도메인

두 가지 중 하나를 고른다.

| 방법 | 절차 | `R2_PUBLIC_BASE_URL` |
| --- | --- | --- |
| **커스텀 도메인 (권장)** | 버킷 → Settings → **Public access** → *Custom Domains* → **Connect Domain** → `cdn.demo-shopping.com`. 도메인이 이미 Cloudflare 에 있으므로 DNS 레코드는 자동 생성된다 | `https://cdn.demo-shopping.com` |
| r2.dev 서브도메인 | 같은 화면의 *R2.dev subdomain* → **Allow Access** | `https://pub-<해시>.r2.dev` |

r2.dev 는 요금 보호 장치가 없고 속도 제한이 있어 운영에는 커스텀 도메인을 쓴다.

### A-5. Render 에 값 넣기

Render 대시보드 → `shopping-api` → **Environment** 에서 `render.yaml` 이 `sync: false` 로 선언한 6개를 채운다.

| 키 | 값 |
| --- | --- |
| `R2_ACCOUNT_ID` | A-1 의 Account ID |
| `R2_BUCKET` | `shopping-prod` |
| `R2_ACCESS_KEY_ID` | A-2 의 Access Key ID |
| `R2_SECRET_ACCESS_KEY` | A-2 의 Secret Access Key |
| `R2_PUBLIC_BASE_URL` | A-4 에서 정한 주소 |
| `R2_REGION` | `auto` |

**여섯 개를 다 채우거나, 하나도 채우지 않는다.** 일부만 채우면 API 가 부팅을 거부한다 (4.5).

### A-6. 확인

로컬 `.env` 에 개발용 값 6개를 채우고 왕복을 돌린다.

```bash
pnpm --filter @shopping/api storage:roundtrip
```

PUT 200 · GET 200 · 크기 불일치 403 · 만료 403 이 나오면 B4 가 끝난다.
