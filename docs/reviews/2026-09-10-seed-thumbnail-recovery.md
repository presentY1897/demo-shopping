# 기존 시드 썸네일 복구

운영 검색 첫12개 상품의 대표 이미지가 모두 `https://cdn.demo-shopping.com/seed/catalog/<hash>.svg`를 사용하며 HEAD 404를 반환했다. 첫 상품의 상세 갤러리도 같은 경로를 사용하고 실제 GET도 404였다. 사용자는 특정 상품 대신 임의 상품으로 확인하도록 요청했다. 새 사진 상품의 PNG와 구분되는, 기존 시드 객체 누락 문제다.

기존 시드 생성 코드로 SVG 바이트를 재생성하고 SHA-256 앞32자리로 URL과 대조했다. 12개 모두 일치한다. 총102개 고유 SVG를 구매자 앱의 정적 자산으로 제공한다. DB/장바구니/주문 스냅샷 URL은 수정하지 않고 화면에서 해당 운영 CDN 주소와 알려진 해시만 같은 바이트의 로컬 경로로 해석한다. 다른 호스트·미지의 해시·사진 URL·쿼리가 붙은 URL은 바꾸지 않는다. 원본 CDN 객체 자체를 복원한 것은 아니며 별도 R2 복원 없이 구매자 화면의 원래 샘플 이미지를 제공하는 방식이다.

재현: `pnpm --filter @shopping/api build && node apps/api/scripts/export-seed-placeholders.mjs --check`. `--check`를 빼면 자산/manifest를 다시 생성한다. API 검사에서 생성 바이트와 모든 정적 파일을 대조하며 상품 썸네일·갤러리·URL 해석 회귀 검사도 수행한다.

로컬 production build가 운영의 공개 상품 상세 데이터를 읽는 Chromium 360/768/1440px에서 갤러리와 작은 썸네일10개씩 모두 naturalWidth800으로 디코딩되고 가로 넘침이 없었다. 구매자 카드와 장바구니/주문서/주문 상세 썸네일도 같은 해석기를 사용한다. 운영 배포 후 임의 상품으로 구매 경로를 추가 확인한다.

[원본 응답 점검](artifacts/checkout-review/seed-url-audit.json) · [브라우저 표시](artifacts/checkout-review/seed-image-viewports.json).

390px Chromium에서 기존 시드 SVG와 정상 사진 PNG를 함께 담고 장바구니·주문서·주문 상세의 naturalWidth800/1254와 가로 넘침 없음으로 확인했다. 주문서·주문 상세는 운영 API 응답을 미리 받아 브라우저에 제공해 이미지 렌더링을 지연 문제에서 분리했다. [실제 원본 URL과 디코딩 결과](artifacts/checkout-review/seed-checkout-image-rendering.json)에 `prefetched: true`로 명시한다. 실제 서버 주문·장바구니 데이터를 사용하지만 이 검사는 운영 전체 결제 성공을 의미하지 않는다. 복수 상품 capture500과 별도 구매 지연은 [지연 실측 보고서](2026-09-10-checkout-latency-measurements.md)에 기록했다.

최신 main 통합 기준 로컬 typecheck·lint·build·전체 테스트 통과. API4347개(진단1개 skip), 구매자1256개(1개 skip)를 포함한다. 이후 추가한 지연 주입 진단은 opt-in이며 기본 검사에서 별도 skip한다. 테스트의 옵션 렌더링 전 count 경합을 보완해 실제 스택 구매·부분 환불·밀도 E2E5개가 모두 통과했다(1.6분). 최종 CI와 배포 확인은 PR #138에 기록한다.
