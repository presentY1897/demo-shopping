# TASK-0008: 도메인 확보 · DNS 구성

| 항목 | 내용 |
| --- | --- |
| 마일스톤 | M02 배포 파이프라인 |
| 상태 | 승인됨 |
| 작성일 | 2026-09-02 |
| 브랜치 | `chore/domain-dns` |
| 선행 작업 | M01 완료 |

## 1. 목적

커스텀 도메인을 확보하고 세 앱이 쓸 서브도메인 구조를 만든다. `*.vercel.app` 대신 제대로 된 URL 을 포트폴리오에 적을 수 있게 한다.

## 2. 범위

### 포함
- ~~도메인 구매~~ — **`demo-shopping.com` 구매 완료 (Cloudflare 등록)**
- ~~네임서버 이전~~ — Cloudflare 에서 구매했으므로 **불필요**
- 서브도메인 계획 확정: `shop` / `seller` / `admin` / `api`
- 루트 도메인 처리 방침 (`shop` 으로 리다이렉트)
- SSL 인증서 발급 확인

### 제외
- 각 서비스에 실제 연결 (TASK-0010, 0009)
- 이메일 도메인 설정

## 3. 요구사항

- [ ] 네 서브도메인이 DNS 에서 해석된다
- [ ] 루트 도메인 접속 시 `shop` 으로 리다이렉트된다
- [ ] 모든 서브도메인이 HTTPS 로 접근된다

## 4. 설계

| 서브도메인 | 연결 대상 |
| --- | --- |
| `shop.demo-shopping.com` | Vercel — apps/shop |
| `seller.demo-shopping.com` | Vercel — apps/seller |
| `admin.demo-shopping.com` | Vercel — apps/admin |
| `api.demo-shopping.com` | **Render** — apps/api |

**쿠키는 각 서브도메인 한정**(`Domain` 속성 미지정)으로 발급한다. 세션이 앱 간에 공유되지 않아야 한다. (D-028)

### Cloudflare DNS + Vercel 조합

Cloudflare 에서 도메인을 사고 DNS 를 관리하되, **Vercel 로 향하는 레코드는 프록시를 끈다(DNS only, 회색 구름).**

프록시를 켜면 Cloudflare CDN 과 Vercel CDN 이 이중으로 걸려 캐시 무효화가 어긋나고, Vercel 의 도메인 검증·SSL 발급이 실패하거나 리다이렉트 루프가 생긴다. 흔한 함정이다.

| 서브도메인 | 프록시 |
| --- | --- |
| `shop` / `seller` / `admin` → Vercel | **DNS only** |
| `api` → Railway/Render | **DNS only** |
| `cdn` → R2 | 프록시 사용 가능 (Cloudflare 자체 서비스) |

R2 도 Cloudflare 이므로 도메인·스토리지·DNS 를 한 계정에서 관리하게 된다. 배포까지 Cloudflare(Pages/Workers)로 옮기는 선택지도 있으나, Next.js App Router 의 SSR 은 Vercel 이 네이티브라 제약이 없다. **DNS 는 Cloudflare, 배포는 Vercel** 조합을 유지한다.

## 5. 구현 계획

1. 서브도메인 레코드 생성 (연결 대상은 이후 TASK 에서 지정)
2. **모든 레코드를 DNS only(회색 구름)로 설정** — Vercel·Render 대상
3. 루트 리다이렉트 규칙
4. SSL 확인

## 6. 완료 기준

### 6.1 기능

| # | 기준 | 측정 방법 | 목표 | 충족 |
| --- | --- | --- | --- | --- |
| F1 | DNS 해석 | `dig shop.<도메인>` 등 4건 | 전부 응답 | [ ] |
| F2 | HTTPS | 각 서브도메인 `curl -I` | 인증서 유효, 200 또는 배포 대기 응답 | [ ] |
| F3 | 루트 리다이렉트 | 루트 도메인 접속 | `shop` 으로 301/302 | [ ] |
| F4 | 프록시 설정 | Cloudflare 대시보드 확인 | Vercel·API 레코드가 DNS only | [ ] |

### 6.2 품질 게이트

[공통 품질 게이트](../QUALITY-GATES.md) 적용. 예외:
- **Q1~Q7 해당 없음** — 코드 변경 없음
- **2~4장 해당 없음**

### 6.3 문서

| # | 기준 | 충족 |
| --- | --- | --- |
| D1 | 상태 갱신 + 인덱스 2곳 | [ ] |
| 추가 | `docs/design/pages.md` 의 `<도메인>` 자리표시자를 `demo-shopping.com` 으로 치환 | [ ] |

## 7. 리스크 / 열린 질문

| # | 내용 | 대응 |
| --- | --- | --- |
| R1 | ~~네임서버 전파 지연~~ | Cloudflare 등록이라 해당 없음 |
| R2 | Cloudflare 프록시를 켜두면 Vercel SSL·캐시가 어긋남 | 레코드 생성 시 **DNS only** 확인. F4 로 검증 |

## 8. 확정된 버전

해당 없음.

## 9. 변경 이력

| 날짜 | 내용 |
| --- | --- |
| 2026-09-02 | 최초 작성 |
