# 오류 전달 계약

API 가 실패를 알리는 형식과, 각 오류 코드가 화면에서 어떤 문장·복구 수단이 되는지.
`docs/design/` 의 다른 문서와 같은 원칙으로 **현재 상태만** 담는다.

> 단일 출처: 봉투 스키마는 `packages/shared/src/api-error.ts`, 코드 목록은
> `packages/shared/src/api/error-codes.ts` 다. 이 문서는 그 둘의 **의미**를 적는다.

## 1. 봉투

모든 실패 응답은 하나의 모양이다.

```json
{
  "error": {
    "code": "CATEGORY_SLUG_TAKEN",
    "message": "이미 쓰고 있는 주소예요. 다른 주소를 입력해 주세요.",
    "details": [
      { "field": "slug", "message": "이미 쓰고 있는 주소예요. …", "code": "CATEGORY_SLUG_TAKEN" }
    ],
    "requestId": "4f3c1a90-8e2b-4c7d-9a11-4d0b7f2ea7b2"
  }
}
```

| 필드 | 뜻 | 읽는 쪽이 하는 일 |
| --- | --- | --- |
| `code` | **무엇이 일어났는가.** 도메인이 이름 붙였으면 그 코드, 아니면 HTTP 상태에서 파생 | 분기한다. 화면 동작은 전부 여기서 갈린다 |
| `message` | 서버가 쓴 한국어 문장 | **대비책으로만 쓴다.** 카탈로그에 `code` 가 없을 때만 |
| `details` | 어느 입력이 문제인가 | 필드에 메시지를 붙인다 |
| `requestId` | 이 요청의 식별자. 응답 헤더 `x-request-id` 와 같은 값 | 사용자가 고칠 수 없는 실패에만 보여 준다 |

### `details` 는 두 형태를 함께 담는다

```ts
// 구조화된 항목 — 어느 입력의 문제인지 말한다
{ field: 'slug', message: '…', code?: 'CATEGORY_SLUG_TAKEN', params?: { max: 3 } }

// 문자열 — 아직 코드를 붙이지 않은 엔드포인트
'선택한 카테고리가 없어졌어요. 목록을 새로고침해 주세요.'
```

유니온으로 좁히지 않는 이유는 **한 번에 전부 고치지 않아도 되게** 하기 위해서다.
판별은 `isApiFieldError(entry)` 하나로 모은다.

`params` 는 프론트 카탈로그 문장이 끼워 넣을 값이다 — 최대 깊이, 충돌한 카테고리 이름.
서버만 아는 사실이라 함께 보내지 않으면 그 문장만 서버 문구를 쓰게 된다.

## 2. 오류 코드

### 2.1 전송 계층 — HTTP 상태에서 파생

도메인이 이름 붙이지 않은 실패에 붙는다. `packages/shared` 의 `httpErrorCodeSchema`.

| 상태 | `code` |
| --- | --- |
| 400 | `BAD_REQUEST` |
| 401 | `UNAUTHORIZED` |
| 403 | `FORBIDDEN` |
| 404 | `NOT_FOUND` |
| 405 | `METHOD_NOT_ALLOWED` |
| 409 | `CONFLICT` |
| 413 | `PAYLOAD_TOO_LARGE` |
| 415 | `UNSUPPORTED_MEDIA_TYPE` |
| 422 | `VALIDATION_FAILED` |
| 429 | `TOO_MANY_REQUESTS` |
| 5xx | `INTERNAL_ERROR` |
| 503 | `SERVICE_UNAVAILABLE` |

### 2.2 도메인 코드

| `code` | 상태 | `field` | `params` | 화면 문장 (`apps/admin`) | 복구 수단 |
| --- | --- | --- | --- | --- | --- |
| `AUTH_REQUIRED` | 401 | — | — | 로그인이 필요해요. | 로그인 |
| `INVALID` | 400 | 해당 입력 | — | 입력하신 값을 다시 확인해 주세요. | 필드 오류 |
| `CATEGORY_SLUG_TAKEN` | 409 | `slug` | — | 이미 쓰고 있는 주소예요. 다른 주소를 입력해 주세요. | 필드 오류 |
| `CATEGORY_VERSION_CONFLICT` | 409 | `version` | — | 다른 관리자가 먼저 저장했어요. 최신 내용을 불러올까요? | 충돌 다이얼로그 |
| `CATEGORY_HAS_CHILDREN` | 409 | — | — | 하위 카테고리를 먼저 옮기거나 삭제해 주세요. | 비활성화 안내 |
| `CATEGORY_MAX_DEPTH` | 400 | `parentId` | `max` | 카테고리는 {max}단계까지만 만들 수 있어요. | 필드 오류 |
| `CATEGORY_MOVE_INTO_SELF` | 400 | `parentId` | — | 카테고리를 자기 자신이나 그 아래로 옮길 수 없어요. | 원위치 + 토스트 |
| `CATEGORY_REORDER_MISMATCH` | 400 | `orderedIds` | — | 순서가 화면과 어긋났어요. 새로고침한 뒤 다시 시도해 주세요. | 원위치 + 토스트 |
| `CATEGORY_PARENT_MISSING` | 400 | `parentId` | — | 선택한 상위 카테고리가 없어졌어요. 목록을 새로고침해 주세요. | 필드 오류 |
| `ATTRIBUTE_KEY_TAKEN` | 409 | `key` | `name` | '{name}' 에 같은 이름의 속성이 이미 있어요. | 필드 오류 |
| `ATTRIBUTE_VERSION_CONFLICT` | 409 | `version` | — | 다른 관리자가 먼저 저장했어요. 최신 내용을 불러올까요? | 충돌 다이얼로그 |
| `ATTRIBUTE_IN_USE` | 409 | `id` | `count` | 이 속성을 쓰는 상품이 {count}개 있어요. 상품에서 먼저 값을 지워 주세요. | 비활성화 안내 |
| `PRODUCT_ATTRIBUTES_REQUIRED` | 400 | `attributes.<key>` | — | 판매를 시작하려면 필수 정보를 모두 채워야 해요. | 필드 오류 |
| `PRODUCT_TOO_MANY_VARIANTS` | 400 | `options` | `max` | 옵션 조합은 최대 {max}개까지 만들 수 있어요. 옵션 값을 줄여 주세요. | 필드 오류 |
| `PRODUCT_NOT_SELLABLE` | 400 | `status` | — | 판매하려면 주문할 수 있는 옵션이 하나는 있어야 해요. | 필드 오류 |
| `PRODUCT_SELLER_INACTIVE` | 403 | — | — | 스토어가 승인된 뒤에 상품을 등록할 수 있어요. | 안내 배너 |
| `PRODUCT_SKU_TAKEN` | 409 | — | — | 이미 쓰고 있는 SKU 예요. 다른 SKU 를 입력해 주세요. | 필드 오류 |
| `PRODUCT_VERSION_CONFLICT` | 409 | `version` | — | 다른 곳에서 먼저 저장했어요. 최신 내용을 불러올까요? | 충돌 다이얼로그 |

**`PRODUCT_SELLER_INACTIVE` 가 403 인데 `FORBIDDEN` 이 아닌 이유.** 같은 403 이라도 복구 수단이
정반대다. `FORBIDDEN`(소유권)은 "내 스토어가 맞는지 확인" 이고, 이것은 **내 스토어가 맞는데 아직
승인되지 않았다**는 뜻이다. 코드로 갈라 놓지 않으면 판매자에게 "권한이 없다"고 말하게 된다
(TASK-0113 4장).

**두 개의 409 를 가르는 이유.** `PRODUCT_VERSION_CONFLICT` 는 최신 내용을 불러오면 풀리고,
`PRODUCT_SKU_TAKEN` 은 불러와도 풀리지 않는다 — SKU 를 바꿔야 한다. 하나의 `CONFLICT` 로는
화면이 "다시 불러오기" 버튼을 언제 보여야 할지 결정할 수 없다.

**`field` 가 없는 코드가 있는 이유.** `CATEGORY_HAS_CHILDREN` 은 어떤 입력의 문제도 아니다.
사용자가 건드리지 않은 컨트롤 아래에 오류를 다는 것보다 아무 데도 달지 않는 편이 낫다.

## 3. 문장 규칙

프론트 카탈로그(`apps/admin/src/messages/ko.ts` 의 `errors`)가 지키는 네 가지.

1. **사용자가 한 행동의 언어로 쓴다.** `orderedIds` 가 아니라 "순서", `slug` 가 아니라 "주소".
2. **다음에 무엇을 할지 말한다.** "…할 수 없습니다" 로 끝내지 않는다.
3. **원인을 짚을 수 있으면 이름으로 짚는다.** `params` 가 그 값을 나른다.
4. **내부 식별자를 쓰지 않는다.**

서버도 한국어 문장을 계속 보내지만 그것은 **카탈로그에 없는 코드를 위한 대비책**이다.
문장을 없애면 새 코드가 왔을 때 사용자가 빈 화면을 본다.

## 4. 사용자가 볼 이유가 없는 오류

| 상황 | 응답 | 이유 |
| --- | --- | --- |
| 엔드포인트에 퍼미션 미선언 | **500**, `details` 비움 | 개발자 실수다. 403 은 "네 권한이 부족하다"는 뜻인데 부족한 것은 권한이 아니다 |
| `@PublicEndpoint` 와 `@RequirePermission` 동시 선언 | **500**, `details` 비움 | 〃 |
| 그 밖의 500 | `details` 비움 | 던진 예외의 문장이 본문으로 새어 나가는 길을 막는다 |

원래 문장은 **서버 로그에 그대로 남는다.** 503 은 예외다 — "이미지 저장소가 설정되지
않았습니다" 는 결함이 아니라 상태이고, 지우면 호출자에게 남는 것이 없다.

## 5. 요청 번호

`request-context.middleware.ts` 가 요청마다 UUID 를 만들어

1. 요청 헤더에 실어 두고 (같은 요청 안에서 어디서든 읽는다)
2. 응답 헤더 `x-request-id` 로 내보내고 (CORS `exposedHeaders` 에 올라가 있다)
3. 오류 봉투의 `requestId` 에 넣는다 (헤더를 못 읽는 상황 대비)

호출자가 `x-request-id` 를 보내면 **그 값을 그대로 쓴다.** 프론트와 백엔드의 추적이 이어진다.

### 화면 규약

| 실패 성격 | 보여 주는 것 |
| --- | --- |
| 사용자가 고칠 수 있음 (검증·충돌) | 문장 + 복구 수단. **번호를 보여 주지 않는다** — 잡음이다 |
| 사용자가 고칠 수 없음 (5xx) | 문장 + **문의 번호 + 복사** (`ErrorNotice`) |
| 응답 자체가 없음 (네트워크·타임아웃) | 문장 + 다시 시도. **번호가 없다** — 만들어 내면 로그에 없는 숫자가 된다 |

### 로그에서 찾는 법

```
[error] GET /api/v1/boom 500 e30b3f8b-…-70ffb7c7e02d InternalServerErrorException
[error] GET /api/v1/boom 500 5.7ms e30b3f8b-…-70ffb7c7e02d
```

한 요청당 두 줄 — 예외 필터가 남긴 실패 기록과 미들웨어가 남긴 종료 기록이다.
화면의 번호로 `grep` 하면 그 요청만 나온다.

## 6. 새 도메인에 코드를 붙일 때

1. `packages/shared/src/api/error-codes.ts` 의 `domainErrorCodes` 에 코드를 더한다.
2. 각 앱 카탈로그의 `errors` 에 문장을 더한다. **빠뜨리면 `pnpm typecheck` 가 잡는다.**
3. 서비스에서 `domainFailure(code, message, { field, params })` 로 예외를 던진다.
4. 스펙은 **문장이 아니라 `code` 와 `field` 를 단언한다.**
