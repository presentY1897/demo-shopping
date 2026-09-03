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
| `api` → Render | 프록시 켜도 된다 (아래 4.2) |
| `cdn` → R2 | 프록시 사용 가능 (Cloudflare 자체 서비스) |

### 4.1 실제로 넣는 레코드

Cloudflare → 해당 도메인 → **DNS** → *Add record*. 넷 다 `CNAME` 이다.

| Name | Target | Proxy | 값을 어디서 얻나 |
| --- | --- | --- | --- |
| `shop` | `<해시>.vercel-dns-017.com` | **DNS only** | Vercel → 프로젝트 → Settings → **Domains**. 도메인을 추가하면 화면이 알려 준다 |
| `seller` | `<해시>.vercel-dns-017.com` | **DNS only** | 〃 |
| `admin` | `<해시>.vercel-dns-017.com` | **DNS only** | 〃 |
| `api` | `shopping-api-96sy.onrender.com` | 프록시 | Render → `shopping-api` → 서비스 상단의 `.onrender.com` 주소 |
| `cdn` | — | 프록시 | **직접 만들지 않는다.** R2 버킷 → Settings → Public access → Connect Domain 하면 Cloudflare 가 레코드를 자동 생성한다 |

**세 앱에 같은 값을 써도 된다.** Vercel 이 안내문에서 밝히듯 레거시 레코드
`cname.vercel-dns.com` 이 계속 동작하며, Vercel 은 Host 헤더로 어느 프로젝트인지 판별한다.
프로젝트마다 화면을 열어 해시를 복사할 필요가 없다.

`<해시>.vercel-dns-017.com` 은 Vercel 이 IP 대역 확장 때문에 권장하는 새 방식이다. 쓰려면
**각 프로젝트의 Domains 화면이 보여 주는 값을 그대로** 복사한다 — 프로젝트끼리 같은지 다른지
추측하지 말고 화면의 값을 쓴다. 두 방식이 섞여 있어도 상관없다.

Cloudflare 입력창에는 끝의 점(`.`)을 빼고 넣어도 된다.

레코드를 넣은 뒤 Vercel 의 Domains 화면에서 **Refresh** 를 누르면 즉시 재검사한다. 그냥 두면
자동 재검사까지 몇 분 걸린다.

### 4.2 `api` 는 프록시를 켠다 — 문서보다 실제가 맞다

위 표의 "Vercel 은 DNS only" 는 **Vercel 고유 사정**이다. Vercel 은 자체 CDN 을 두고 도메인
검증·인증서 발급을 자기 엣지에서 하므로, 앞에 Cloudflare 프록시가 끼면 검증이 실패하거나
캐시가 이중으로 걸린다.

**Render 에는 그 사정이 없다.** 실제로 `api.demo-shopping.com` 은 프록시를 켠 상태로 동작하고
있고(`cf-ray` 헤더로 확인), 얻는 것이 있다:

- Cloudflare 가 앞단에서 받아 주므로 Render 무료 인스턴스의 콜드 스타트 노출이 줄어든다
- 오리진 주소(`*.onrender.com`)가 밖으로 드러나지 않는다

**단 SSL/TLS 모드를 봐야 한다.** Cloudflare → SSL/TLS → Overview:

| 모드 | 브라우저→CF | CF→Render | 판정 |
| --- | --- | --- | --- |
| Flexible | HTTPS | **평문 HTTP** | **금지.** 이 API 는 JWT 를 실어 나른다 |
| Full | HTTPS | HTTPS (인증서 미검증) | 허용. 현재 이 상태 |
| Full (strict) | HTTPS | HTTPS + 검증 | 권장 |

`Full (strict)` 로 올리기 전에 **Render → `shopping-api` → Settings → Custom Domains 에서
`api.demo-shopping.com` 이 인증서 발급 완료 상태인지** 확인한다. 프록시가 켜져 있으면 Render 의
ACME 검증이 막혀 발급이 안 되어 있을 수 있고, 그 상태로 strict 를 켜면 **API 가 즉시 502 로 죽는다.**

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
| F1 | DNS 해석 | `getent hosts <서브도메인>`. **이 머신에 `dig`·`nslookup`·`host` 가 없다** | 전부 응답 | [x] `shop`·`seller` → 64.29.17.65 / `admin` → 64.29.17.1 (Vercel) · `api` → 216.24.57.15 (Render) · `cdn` → Cloudflare AAAA |
| F2 | HTTPS | 각 서브도메인 익명 `curl` | 인증서 유효, 200 | [x] 세 앱 모두 **200 + 실제 화면** — `구매자 앱` · `판매자 콘솔` · `관리자 콘솔`. TLS 1.3. `api`·`cdn` 의 루트 404 는 해당 경로에 리소스가 없는 것이라 정상 |
| F3 | 루트 리다이렉트 | 루트 도메인 접속 | `shop` 으로 301/302 | [ ] **미충족.** `demo-shopping.com`·`www` 둘 다 레코드가 없어 해석되지 않는다 |
| F4 | 프록시 설정 | Cloudflare 대시보드 확인 | **Vercel 3건이 DNS only.** `api` 는 프록시 허용 (4.2) | [x] Vercel 3건은 Vercel IP 로 직접 해석되므로 DNS only 가 맞다. `api`·`cdn` 은 Cloudflare 응답 |
| F5 | 오리진 구간 암호화 | Cloudflare → SSL/TLS → Overview | **Flexible 이 아님** (4.2) | [x] `Full` — 오리진 구간이 HTTPS 다. `Full (strict)` 상향은 4.2 의 선행 확인 후 |

**F3 만 남았다.** 루트 도메인을 `shop` 으로 보내는 리다이렉트가 없다. Cloudflare 의 **Redirect
Rules**(무료) 로 `demo-shopping.com/*` → `https://shop.demo-shopping.com/$1` 301 을 만들거나,
Vercel 의 shop 프로젝트에 루트 도메인을 추가하고 Redirect 로 지정하면 된다. 후자는 루트에
CNAME 을 걸 수 없어(CNAME flattening 필요) Cloudflare 쪽이 단순하다.

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
