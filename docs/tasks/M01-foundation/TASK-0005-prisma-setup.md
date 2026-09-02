# TASK-0005: Prisma · DB 연결

| 항목 | 내용 |
| --- | --- |
| 마일스톤 | M01 기반 구축 |
| 상태 | 승인 대기 |
| 작성일 | 2026-09-02 |
| 브랜치 | `feature/prisma-setup` |
| 선행 작업 | TASK-0004 |

## 1. 목적

Prisma 를 연결하고 마이그레이션 파이프라인을 세운다. 이후 모든 스키마 변경이 이 경로를 탄다.

## 2. 범위

### 포함
- Prisma 설치 및 `schema.prisma` 초기화
- `PrismaService` (Nest 라이프사이클에 연결, graceful shutdown)
- 마이그레이션 스크립트: `db:migrate` / `db:reset` / `db:studio`
- 검증용 최소 모델 1개 (예: `AppMeta`) 로 마이그레이션 1회 성공
- `/health` 에 `db` 상태 추가
- 시드 스크립트 골격 (`prisma/seed.ts`) — 내용은 M05

### 제외
- 실제 도메인 스키마 (M04 이후 각 도메인 TASK)
- 시드 데이터 내용 (M05)

## 3. 요구사항

### 기능 요구사항
- [ ] `pnpm db:migrate` 로 마이그레이션이 생성·적용된다
- [ ] `/health` 가 DB 연결 상태를 반환한다
- [ ] DB 가 죽어 있으면 `db: "down"` 을 반환하되 API 는 200 을 유지한다
- [ ] 애플리케이션 종료 시 커넥션이 정상적으로 닫힌다
- [ ] `pnpm db:reset` 으로 스키마를 초기화하고 재적용할 수 있다

### 비기능 요구사항
- 마이그레이션 파일은 커밋한다. 배포 환경에서는 `migrate deploy` 만 실행한다
- 커넥션 풀 크기를 환경변수로 조절할 수 있게 한다 (서버리스 환경 대비)

## 4. 설계

```
apps/api/
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seed.ts
└── src/prisma/prisma.service.ts
```

전체 데이터 모델 설계는 `docs/design/erd.md` 참조. 이번 TASK 는 **파이프라인만** 세운다.

## 5. 구현 계획

1. Prisma 설치, `schema.prisma` 초기화, datasource 연결
2. 검증용 모델 1개 정의
3. 첫 마이그레이션 생성·적용
4. `PrismaService` 작성 및 모듈 등록
5. `/health` 에 DB 체크 추가
6. 스크립트 정리, 시드 골격 추가

## 6. 완료 기준 (Definition of Done)

### 6.1 기능

| # | 기준 | 측정 방법 | 목표 | 충족 |
| --- | --- | --- | --- | --- |
| F1 | 마이그레이션 적용 | `pnpm db:migrate` | 성공, `_prisma_migrations` 에 기록 | [ ] |
| F2 | 헬스체크에 DB 반영 | `curl .../health` | `db: "ok"` | [ ] |
| F3 | DB 장애 격리 | Postgres 중지 후 헬스체크 | 200 유지, `db: "down"` | [ ] |
| F4 | 초기화 | `pnpm db:reset` 후 `db:migrate` | 성공 | [ ] |
| F5 | 종료 처리 | SIGTERM 전송 | 커넥션 종료 로그 후 정상 종료 | [ ] |
| F6 | 재현성 | 새 DB 에 `migrate deploy` | 동일 스키마 생성 | [ ] |

### 6.2 품질 게이트

| # | 기준 | 측정 방법 | 목표 | 충족 |
| --- | --- | --- | --- | --- |
| Q1 | 타입 검사 | `pnpm typecheck` | error 0 (Prisma Client 타입 포함) | [ ] |
| Q2 | 린트 | `pnpm lint` | error 0, warning 0 | [ ] |
| Q3 | 빌드 | `pnpm build` | 성공 | [ ] |
| Q4 | 테스트 | `pnpm test` | 전부 통과 | [ ] |
| Q5 | 커버리지 | – | **면제** | – |

### 6.3 성능

| # | 기준 | 측정 방법 | 목표 | 충족 |
| --- | --- | --- | --- | --- |
| P1 | 헬스체크 응답 | DB 체크 포함 p95 | 150ms 이하 | [ ] |

### 6.4 문서

| # | 기준 | 충족 |
| --- | --- | --- |
| D1 | 상태 갱신 + 인덱스 2곳 | [ ] |
| D3 | 새 환경변수 `.env.example` 반영 | [ ] |
| D5 | 확정 버전 기록 | [ ] |

## 7. 리스크 / 열린 질문

| # | 내용 | 대응 |
| --- | --- | --- |
| R1 | 배포 환경(Railway)에서 커넥션 수 제한 | 풀 크기를 환경변수로 노출. M02 에서 실제 값 조정 |

## 8. 확정된 버전

| 패키지 | 버전 |
| --- | --- |
| prisma | |
| @prisma/client | |

## 9. 변경 이력

| 날짜 | 내용 |
| --- | --- |
| 2026-09-02 | 최초 작성 |
