import { ImageResponse } from 'next/og'

import { fetchProductDetail } from '@/lib/products/detail-api'
import { ogCard, OG_IMAGE_SIZE } from '@/lib/seo/og-image'

/**
 * 상품 링크를 공유했을 때 보이는 그림 (TASK-0102 F2).
 *
 * **한국어를 그리려면 글꼴을 실어야 한다.** `ImageResponse` 의 기본 글꼴에는 한글이
 * 없고, 없는 글자는 두부(□)로 나온다 — 상품명이 전부 네모가 된 카드는 카드가 없는
 * 것보다 나쁘다. 그래서 Noto Sans KR 를 요청 시점에 받아 쓴다. 저장소에 몇 MB짜리
 * 폰트를 커밋하지 않기 위해서이고, Next 가 이 응답을 캐시하므로 매번 받지 않는다.
 *
 * **글꼴을 못 받으면 카드를 만들지 않는다.** 두부로 채운 그림을 내보내느니 OG 이미지가
 * 없는 편이 낫다 — 그때 링크 미리보기는 제목과 설명으로 떨어지고, 그 둘은 이미
 * 메타데이터에 있다.
 *
 * **색을 토큰으로 쓸 수 없다.** Satori 는 Tailwind 클래스도 CSS 변수도 읽지 않는다 —
 * `var(--color-fg)` 는 문자열 그대로 남고 아무것도 칠하지 않는다. 그래서 이 파일만
 * 색을 직접 적고, `component-tokens.spec.ts` 가 파일명으로 면제한다.
 */

/** Satori 가 읽는 것은 리터럴뿐이다. 화면의 토큰과 같은 값을 눈으로 맞춰 둔다. */
const CARD_COLORS = {
  background: '#ffffff',
  muted: '#6b7280',
  foreground: '#111827',
} as const

export const size = OG_IMAGE_SIZE
export const contentType = 'image/png'
export const alt = '상품 미리보기'

/** Regenerated with the page it belongs to. A literal, as Next requires. */
export const revalidate = 60

const FONT_URL =
  'https://fonts.gstatic.com/s/notosanskr/v36/PbyxFmXiEBPT4ITbgNA5Cgm20xz64px_1hVWr0wuPNGmlQNMEfD4.ttf'

async function koreanFont(): Promise<ArrayBuffer | null> {
  try {
    const response = await fetch(FONT_URL)

    return response.ok ? await response.arrayBuffer() : null
  } catch {
    return null
  }
}

export default async function ProductOgImage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>
}) {
  const { id } = await params
  const [detail, font] = await Promise.all([fetchProductDetail(id), koreanFont()])

  if (font === null) {
    // Nothing rather than tofu. The preview falls back to the title and the
    // description, which the page's metadata already carries.
    return new Response(null, { status: 404 })
  }

  const card = ogCard(detail)

  return new ImageResponse(
    <div
      style={{
        display: 'flex',
        width: '100%',
        height: '100%',
        background: '#ffffff',
        fontFamily: 'Noto Sans KR',
      }}
    >
      {card.imageUrl === null ? null : (
        // `ImageResponse` renders through Satori, not the DOM — `next/image`
        // has no meaning here and its lint rule does not reach this file.
        <img alt="" src={card.imageUrl} style={{ width: 630, height: 630, objectFit: 'cover' }} />
      )}

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          gap: 16,
          padding: 64,
          flex: 1,
        }}
      >
        <div style={{ fontSize: 28, color: CARD_COLORS.muted }}>{card.brandName}</div>
        <div
          style={{ fontSize: 56, fontWeight: 700, color: CARD_COLORS.foreground, lineHeight: 1.2 }}
        >
          {card.name}
        </div>
        <div style={{ fontSize: 44, fontWeight: 700, color: CARD_COLORS.foreground }}>
          {card.price}
        </div>
      </div>
    </div>,
    {
      ...size,
      fonts: [{ name: 'Noto Sans KR', data: font, style: 'normal', weight: 700 }],
    },
  )
}
