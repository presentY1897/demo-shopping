# TASK-0009: 백엔드 배포 (API · DB · 검색)

| 항목 | 내용 |
| --- | --- |
| 마일스톤 | M02 배포 파이프라인 |
| 상태 | 진행중 |
| 작성일 | 2026-09-02 |
| 브랜치 | `chore/backend-deploy` |
| 선행 작업 | M01 완료 |

> **진행 상황 요약 (2026-09-03).** 계정 없이 만들 수 있는 것 — `render.yaml`, 빌드·시작 명령,
> 환경변수 목록, 배포·롤백 문서 — 은 전부 끝났고 로컬에서 검증했다. **F1~F8 은 전부 미충족이다.**
> Render 워크스페이스에 서비스가 생기기 전에는 측정할 대상이 없다. 6.1 표의 "무엇을 기다리는가"
> 열에 각 항목이 막힌 이유를 적었다.

## 1. 목적

API, PostgreSQL, Meilisearch 를 배포 환경에 올리고 서로 연결한다. 로컬 docker-compose 와 동일한 구성을 클라우드에서 재현한다.

## 2. 범위

### 포함
- **Render** 무료 플랜에 API·Meilisearch 배포, **PostgreSQL 은 Neon**
- **`render.yaml` (Blueprint) 로 서비스 정의를 코드에 둔다** — 아래 참조
- 모노레포에서 `apps/api` 만 빌드하도록 설정
- 서비스 간 연결 (API → Neon, API → Meilisearch)
- 배포 환경 변수 등록
- 마이그레이션 실행 전략 (`migrate deploy`)
- `api.<도메인>` 연결
- 배포 환경 헬스체크 확인

### 제외
- 자동 배포 트리거의 **CI 연동** (TASK-0012). Render 자체의 push 배포는 이 TASK 가 켠다 — 4장 참조
- 로그·모니터링 (TASK-0013)
- 백업 정책
- **재색인 명령의 구현** (TASK-0038). 여기서는 호출 지점과 조건만 정한다

## 3. 요구사항

- [ ] `https://api.<도메인>/api/v1/health` 가 `database: ok`, `search: ok` 를 반환한다
- [ ] Meilisearch 가 마스터 키로 보호된다 (**"외부 비노출"은 무료 플랜에서 불가능하다 — R6**)
- [ ] 마이그레이션이 배포 시 자동 적용된다
- [ ] DB 커넥션 풀 크기가 Neon 제한에 맞게 설정된다
- [ ] 재기동으로 인덱스가 비면 자동으로 재색인된다

## 4. 설계

| 서비스 | 플랫폼 | 비용 | 노출 |
| --- | --- | --- | --- |
| api | **Render 무료 web** | 0 | `api.demo-shopping.com` |
| postgres | **Neon 무료** | 0 | 외부 비노출 (연결 문자열 + TLS 로만) |
| meilisearch | **Render 무료 web** | 0 | **공개 URL. 마스터 키로만 보호** (아래) |

### 배포 설정을 코드로 — `render.yaml`

대시보드에서 손으로 만들지 않는다. 저장소 루트의 `render.yaml` 이 서비스 정의의 단일 출처이며, Render 는 이 파일을 읽어 서비스를 만들고 갱신한다(Blueprint).

이유는 세 가지다. 설정 변경이 **커밋으로 남아** 왜 바꿨는지 추적된다. 서비스가 날아가도 **같은 구성으로 다시 만들 수 있다**. 그리고 대시보드와 파일이 **갈라지지 않는다** — Render 는 Blueprint 를 sync 할 때 대시보드에서 바꾼 값을 파일 값으로 덮는다.

**그래서 서비스 생성은 `render.yaml` 이 저장소에 들어간 뒤에 한다.** 미리 만들어 두지 않는다.

| 시점 | 소유자가 하는 일 |
| --- | --- |
| M01 중 | Render 가입 → GitHub 연동 → `demo-shopping` 접근 허용. **여기까지만.** |
| 이 TASK 의 PR 머지 후 | Render 대시보드에서 `New → Blueprint` → 저장소 선택 → 비밀값 입력 → 2단계로 `MEILI_HOST` 채우기 |

절차는 [`docs/OWNER-CHECKLIST.md`](../../OWNER-CHECKLIST.md) 와 [README "배포"](../../../README.md#배포) 에 클릭 단위로 적혀 있다.

비밀값은 파일에 담을 수 없으므로 `sync: false` 로 선언해 Render 가 생성 시 묻게 한다.

| 변수 | 출처 | 왜 파일에 못 두는가 |
| --- | --- | --- |
| `DATABASE_URL` | Neon 콘솔의 연결 문자열 | 비밀번호를 포함한다 |
| `MEILI_MASTER_KEY` | `openssl rand -base64 32` 로 새로 생성 (로컬 값 재사용 금지) | 비밀값 |
| `MEILI_HOST` | 검색 서비스의 공개 URL | **생성 시점에는 아직 존재하지 않는다** (아래) |

나머지(`NODE_ENV` · `MEILI_ENV` · 풀 크기 · `CORS_ORIGINS`)는 `render.yaml` 에 평문으로 둔다.
목록의 단일 출처는 `apps/api/src/config/env.schema.ts` 다.

포트는 Render 가 주입하는 `PORT`(기본 10000)를 API 가 이미 폴백으로 읽는다(TASK-0004, `merge-env.ts`).
`PORT=10000` 으로 기동해 확인했다.

### `CORS_ORIGINS` 를 반드시 명시하는 이유

`apps/api/src/config/derived-env.ts` 는 워크스페이스 루트(`pnpm-workspace.yaml`)를 찾으면 `PORT_OFFSET`
에서 `API_PORT` · `MEILI_HOST` · `DATABASE_URL` · `CORS_ORIGINS` 를 파생시킨다. Render 의 Node 런타임은
**저장소 체크아웃 위에서** 빌드하고 실행하므로 이 파일들이 그대로 있고, 따라서 **파생이 배포 환경에서도
동작한다.**

파생값은 실제 환경변수 *아래에* 깔리므로 명시한 값이 이기지만, 반대로 **빠뜨린 값은 부팅 거부가 아니라
조용한 localhost 기본값**이 된다. 실제로 확인했다.

| 빼고 기동한 변수 | 결과 |
| --- | --- |
| `MEILI_MASTER_KEY` | **부팅 거부** (변수명 출력 후 exit 1) — 파생 대상이 아니다 |
| `DATABASE_URL` | 기동됨. `postgresql://shopping:shopping@localhost:5432/shopping` 로 붙으려 한다 |
| `CORS_ORIGINS` | 기동됨. 허용 오리진이 **localhost 6개**가 된다 |

그래서 `render.yaml` 은 네 값을 전부 명시한다. "빠지면 부팅이 막아 줄 것"이라는 가정에 기대지 않는다.

> 코드 쪽 개선안(배포 환경에서는 파생을 끄기)은 `apps/api` 소유권이 TASK-0028 에 있어 이 TASK 에서
> 건드리지 않았다. 제안 diff 는 PR 본문에 있다.

### 무료 플랜의 제약과 대응

확인된 Render 무료 플랜 제약이 다섯이다. 그대로 쓰면 스택이 돌아가지 않는다.
(전부 2026-09-03 에 [Render 문서](https://render.com/docs/free)로 확인. 근거 URL 은 7장 R6·R7)

| 제약 | 영향 | 대응 |
| --- | --- | --- |
| 무료 PostgreSQL 이 **생성 후 30일 만료** | 한 달마다 DB 소실 | **Neon 무료 티어로 이전.** 만료 없음, 0.5GB / 월 100 CU-hours |
| **Private Service 가 무료 플랜에 없다** | Meilisearch 를 내부 전용으로 둘 수 없다 | **공개 web 서비스 + 마스터 키.** F5 기준을 고쳤다 (R6) |
| **무료 web 서비스는 사설망 요청을 받지 못한다** | 검색 엔진을 web 으로 둬도 내부 주소로는 못 부른다 | API 가 **공개 HTTPS URL** 로 접속한다 |
| 무료 인스턴스는 **영구 디스크 미지원** | 재시작마다 Meilisearch 인덱스 소실 | **기동 시 자동 전체 재색인** (아래) |
| **`preDeployCommand` 가 유료 전용** | 마이그레이션을 배포 단계에 넣을 자리가 없다 | `startCommand` 앞에 붙인다. `migrate deploy` 는 멱등이라 매 기동마다 돌아도 안전하다 |
| 15분 무활동 시 spin down, 재기동 약 1분 | 첫 방문 지연 | TASK-0101 (프리워밍 + 안내 UX) |

**Neon 도 5분 무활동 시 scale-to-zero** 되지만 재개가 수백 ms 라 체감되지 않는다. 우리 데이터(상품 800·리뷰 3000·주문 500)는 0.5GB 한도에 여유 있게 들어간다.

### Meilisearch 를 공개 web 서비스로 두는 것의 의미

무료 플랜에는 Private Service 가 없고, 무료 web 서비스는 사설망 요청을 **받지** 못한다. 그래서
"내부 전용"이라는 원래 설계는 무료 플랜에서 성립하지 않는다. 대신 이렇게 한다.

- 검색 엔진은 `https://<이름>.onrender.com` 으로 **공개된다.** 커스텀 도메인은 붙이지 않는다 — 주소를 굳이 알리지 않는다
- `MEILI_MASTER_KEY` 없이는 **모든 데이터 경로가 401** 이다. 로컬에서 확인했다:
  `/indexes` 키 없음 → 401, 키 있음 → 200
- `MEILI_ENV=production` 으로 둬서 **검색 미리보기 UI 를 끈다.** 이 모드는 마스터 키를 16바이트
  이상으로 강제하므로(8바이트 키로는 기동 자체가 거부된다) `openssl rand -base64 32`(44자)를 쓴다
- `/health` 만 인증 없이 열려 있다. Render 의 헬스체크가 이 경로를 쓴다
- 색인에는 **개인정보가 들어가지 않는다** (상품 카탈로그는 공용 데이터다). 키가 새더라도 유출되는
  것은 이미 공개된 상품 정보이고, 대응은 키 재발급이다

**유료로 올리면 원래 설계로 돌아간다.** Private Service(월 $7~)로 바꾸면 `type: pserv` 한 줄과
`MEILI_HOST` 를 사설망 주소로 바꾸는 것이 전부다.

### 인덱스 소실 자동 복구

Meilisearch 는 디스크가 없어 재기동 시 인덱스가 비어 있다. 상품 800개 색인은 **수 초**로 끝나므로 디스크 없이 매번 다시 만들어도 된다.

```
API 가 검색 엔진 상태를 확인
  → 인덱스 문서 수 0 을 감지
  → 전체 재색인 트리거 (TASK-0038 의 재색인 명령 재사용)
  → 수 초 내 검색 가능
```

**자리만 잡고 구현은 TASK-0038 이다.** 이 TASK 에서 정한 것은 두 가지뿐이다.

- **트리거 주체는 API** 다. 검색 엔진 컨테이너는 우리 코드가 아니고 DB 에 접근할 수도 없다
- **조건은 "문서 수 0"** 이고, 동시 실행은 락으로 막는다 (R5). 헬스체크가 이 판정을 겸하지 않는다 —
  `/health` 는 플랫폼 프로브가 부르는 경로라 여기에 재색인을 매달면 프로브마다 부하가 걸린다

### 빌드와 시작

```
빌드: pnpm install --frozen-lockfile --prod=false && pnpm --filter @shopping/api build
시작: pnpm --filter @shopping/api db:deploy && node apps/api/dist/main.js
```

원래 문서에는 `--prod=false` 가 없었다. **없으면 배포가 깨진다.** `NODE_ENV=production` 은 런타임
변수이면서 빌드에도 적용되고, pnpm 은 `NODE_ENV=production` 이면 devDependencies 를 설치하지 않는다.
`nest`(빌드)와 `prisma`(마이그레이션) CLI 가 둘 다 devDependency 이므로 빌드도 시작도 실패한다.
로컬에서 재현·확인했다.

`prisma migrate deploy` 는 `pnpm --filter @shopping/api db:deploy` 로 부른다. `prisma.config.mts` 가
API 와 **같은 코드로** `DATABASE_URL` 을 해석하므로 마이그레이션과 실행 프로세스가 다른 DB 를 볼 수 없다.

**나중에 유료 전환할 수 있게** 검색 엔진은 Docker 이미지 기반으로 구성한다. 콜드 스타트를 없애려면 Railway(월 $5~)로 옮기면 되고, 이전 비용이 거의 없다.

## 5. 구현 계획

| # | 단계 | 계정 필요 | 상태 |
| --- | --- | --- | --- |
| 1 | R6·R7 확인 후 설계 확정 | 아니오 | 완료 |
| 2 | `render.yaml` 작성 (API + 검색) | 아니오 | 완료 |
| 3 | 빌드·시작 명령 로컬 검증 | 아니오 | 완료 |
| 4 | 배포 환경변수 목록 확정 · `.env.example` 반영 | 아니오 | 완료 |
| 5 | 배포 절차·롤백 문서화 | 아니오 | 완료 |
| 6 | Render `New → Blueprint` 로 서비스 생성 | **예** | 대기 |
| 7 | `MEILI_HOST` 2단계 입력 후 재배포 | **예** | 대기 |
| 8 | Neon 프로젝트에서 연결 문자열 확보 · 입력 | **예** | 대기 |
| 9 | `api.demo-shopping.com` DNS 연결 (TASK-0008) | **예** | 대기 |
| 10 | 헬스체크 검증 (F1~F8) | **예** | 대기 |

## 6. 완료 기준

### 6.1 기능

| # | 기준 | 측정 방법 | 목표 | 무엇을 기다리는가 | 충족 |
| --- | --- | --- | --- | --- | --- |
| F1 | API 기동 | `curl https://api.<도메인>/api/v1/health` | 200 | Blueprint 생성(6단계) + DNS(TASK-0008). onrender.com 주소로는 6단계만 있으면 된다 | [ ] |
| F2 | DB 연결 | 같은 응답 | `database: "ok"` | Neon 연결 문자열 입력(8단계) | [ ] |
| F3 | 검색엔진 연결 | 같은 응답 | `search: "ok"` | 검색 서비스 생성 + `MEILI_HOST` 입력(7단계). **유휴에서 깨는 약 1분 동안은 `down` 이 정상이다** | [ ] |
| F4 | 마이그레이션 자동 적용 | 새 마이그레이션 배포 | 재시작 후 스키마 반영 | 6단계. 시작 명령 자체는 로컬 검증 완료 | [ ] |
| F5 | **자격 없는 접근 차단** (개정) | ① Neon 연결 문자열 없이 DB 접속 ② 검색 엔진에 키 없이 `/indexes` 호출 | ① 연결 실패 ② **401** | 6·8단계. ②는 로컬에서 401 확인 완료 | [ ] |
| F6 | 재배포 후 DB 유지 | 재배포 실행 | Neon 데이터 유지 | 6단계 | [ ] |
| F7 | 인덱스 자동 복구 | Meilisearch 재시작 | 문서 수 0 감지 → 자동 재색인 → 10초 내 검색 가능 | **TASK-0038**(재색인 명령)과 6단계. 이 TASK 는 트리거 조건만 정한다 | [ ] |
| F8 | DB 만료 없음 | Neon 콘솔 확인 | 만료일 없음 | Neon 프로젝트 확인(8단계) | [ ] |

> **F5 는 R6 확인 결과로 바뀌었다.** 원래 기준은 "외부에서 DB·Meili 포트 접근 시 연결 실패"였다.
> Render 무료 플랜에 Private Service 가 없어 Meilisearch 를 비공개로 둘 방법이 없으므로,
> 기준을 "노출 여부"에서 "**자격 없는 접근이 거부되는가**"로 바꿨다. 4장 참조.

### 6.2 품질 게이트

[공통 품질 게이트](../QUALITY-GATES.md) 적용. 예외:
- **Q5(커버리지) 면제** — M05 부터 적용
- **3장 API 게이트**: A1(응답시간) 적용. 배포 환경 기준 p95 500ms 이하로 완화. **콜드 스타트 제외** —
  무료 플랜의 1분 spin-up 은 TASK-0101 의 대상이다
- **4장 데이터 게이트**: S1(마이그레이션) 적용
- **2장 화면 게이트 해당 없음**

### 6.3 문서

| # | 기준 | 충족 |
| --- | --- | --- |
| D1 | 상태 갱신 + 인덱스 2곳 | [ ] (완료 시) |
| D4 | 배포 환경 변수 목록을 `.env.example` 에 반영 | [x] |
| 추가 | 배포 절차와 롤백 방법을 README 에 기재 | [x] |
| 추가 | `OWNER-CHECKLIST.md` 를 조사 결과에 맞게 갱신 | [x] |

## 7. 리스크 / 열린 질문

| # | 내용 | 상태 |
| --- | --- | --- |
| R1 | 무료 플랜 메모리 제한(512MB)으로 Meilisearch 가 죽음 | 열림. 인덱스 크기를 800개 기준으로 산정. 죽어도 자동 재색인으로 복구된다 |
| R2 | 모노레포 빌드 시 불필요한 앱까지 빌드 | **해소.** `buildCommand` 가 `--filter @shopping/api` 로 한정하고, `buildFilter.paths` 가 관련 없는 경로의 배포 트리거를 막는다 |
| R3 | 커넥션 수 제한 초과 | **해소.** `DATABASE_POOL_SIZE=5` (기본 10에서 낮춤). 실 부하 확인은 배포 후 |
| R4 | Neon 월 100 CU-hours 초과 | 열림. scale-to-zero 로 유휴 시 소모가 없다. 초과 시 다음 달까지 정지되므로 사용량 모니터링 |
| R5 | 재색인이 잦아 DB 부하 | 열림 → TASK-0038. 인덱스가 비어있을 때만 트리거하고 동시 실행을 락으로 막는다 |
| R6 | Meilisearch 를 무료 플랜에서 외부 비노출로 둘 수 있는가 | **해소 — 불가능.** [Deploy for Free](https://render.com/docs/free): 무료 인스턴스를 쓸 수 있는 것은 web service · static site · Render Postgres · Key Value 뿐이고 *"Other service types don't support Free instances"* 다. 나아가 [Private Network](https://render.com/docs/private-network) 에 *"Free web services can send private network requests, but they can't receive them"* 이라 web 으로 두더라도 사설망으로는 못 부른다. → **공개 web + 마스터 키**로 설계 변경, F5 개정 |
| R7 | Blueprint 가 무료 플랜(`plan: free`)을 지원하는가 | **해소 — 지원한다.** [Blueprint YAML Reference](https://render.com/docs/blueprint-spec) 의 `plan` 필드가 `free` 를 유효값으로 명시한다(*"The service's compute plan, such as `free` or `1c-2g`"*). 대시보드 수동 구성으로 내려가지 않는다 |
| R8 | **무료 인스턴스 시간 750h/월이 서비스 2개에 공유된다** | 열림. 24시간 가동이면 2×730=1460h 로 초과한다. spin down 중에는 소모되지 않으므로 데모 트래픽에서는 여유가 있으나, **TASK-0101 의 프리워밍을 "항상 깨워 두기"로 만들면 한도를 넘긴다.** TASK-0101 은 방문 직전에만 깨우는 방식이어야 한다 |
| R9 | Render 에 설치된 pnpm 버전이 `packageManager: pnpm@9.15.9` 와 다를 수 있다 | 열림·미확인. [Native Runtimes](https://render.com/docs/native-runtimes) 는 pnpm 이 있다고만 하고 버전을 밝히지 않는다. 실패하면 빌드 명령 앞에 `corepack enable && corepack prepare --activate &&` 를 붙인다 (Node 24 에는 corepack 이 포함된다) |
| R10 | 검색 엔진이 유휴에서 깨는 동안 `/health` 가 `search: "down"` 을 보고한다 | 열림·설계상 허용. `MEILI_HEALTH_TIMEOUT_MS` 상한이 10초라 1분짜리 spin-up 을 기다릴 수 없다. API 는 200 을 유지하고 `status: "degraded"` 가 된다. TASK-0101 은 **검색 엔진도 함께** 깨워야 한다 |
| R11 | `singapore` 리전에서 무료 인스턴스가 제공되는지 미확인 | 열림·미확인. [Regions](https://render.com/docs/regions) 는 리전 5개를 나열하나 무료 제공 여부를 리전별로 밝히지 않는다. 생성 시 거부되면 `region: oregon` 으로 바꾼다 (한국에서 지연은 늘어난다) |
| R12 | `sslmode` 없는 Neon 연결 문자열 | 열림. Neon 은 TLS 를 요구한다. 콘솔이 주는 문자열에 `?sslmode=require` 가 포함되는지 확인하고, 없으면 붙인다. 실 연결 확인은 배포 후 |

## 8. 확정된 버전

| 항목 | 값 |
| --- | --- |
| 플랫폼 | Render (무료 web × 2) + Neon (무료) |
| Render 리전 | `singapore` (R11) |
| meilisearch 이미지 | `docker.io/getmeili/meilisearch:v1.24.0` — `docker-compose.yml` 과 동일 태그 |
| Node 버전 | `.nvmrc` 의 `24.13.1` (Render 가 읽는다) |
| Blueprint 파일 | 저장소 루트 `render.yaml` |
| 서비스 이름 | `shopping-api` · `shopping-search` |

## 9. 변경 이력

| 날짜 | 내용 |
| --- | --- |
| 2026-09-02 | 최초 작성 |
| 2026-09-03 | R6·R7 조사 완료. **R6 결과로 설계 변경** — Meilisearch 를 내부 전용에서 공개 web 서비스 + 마스터 키 보호로 바꾸고 F5 기준을 "노출 여부"에서 "자격 없는 접근 거부"로 개정 |
| 2026-09-03 | 빌드 명령에 `--prod=false` 추가 (`NODE_ENV=production` 이면 pnpm 이 devDependencies 를 빼서 빌드가 깨진다). 마이그레이션을 `startCommand` 에 둔 이유(`preDeployCommand` 유료 전용) 명시 |
| 2026-09-03 | `CORS_ORIGINS` 등 파생 대상 변수를 `render.yaml` 에 명시하기로. 빠뜨려도 부팅이 막히지 않고 localhost 기본값이 된다는 것을 확인 |
| 2026-09-03 | R8~R12 추가. Render 자체 push 배포(`autoDeployTrigger: commit`)는 이 TASK 에서 켜고 CI 연동(`checksPass`)은 TASK-0012 로 넘기는 것으로 범위 정리 |
| 2026-09-03 | 상태를 `승인됨` → `진행중` 으로. 계정 없이 되는 부분은 완료, F1~F8 은 Render 서비스 생성 대기 |
