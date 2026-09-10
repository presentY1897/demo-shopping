// Demo disclosure and the walkthrough remain available on every storefront page.

import Link from 'next/link'

import { PageContainer } from '@shopping/ui/layout'

import type { FooterMessages } from '@/messages'

export function ShopFooter({
  brand,
  messages,
}: {
  readonly brand: string
  readonly messages: FooterMessages
}) {
  return (
    <footer aria-label={messages.label} className="border-border bg-surface-sunken mt-12 border-t">
      <PageContainer className="flex flex-col gap-6 py-8">
        <p className="text-fg text-base font-bold">{brand}</p>

        <p className="text-fg-muted text-sm">{messages.demoBody}</p>

        {/*
          안내로 가는 문은 **모든 화면에** 있다 (TASK-0099). 홈에만 두면 검색 결과로
          바로 들어온 사람은 이 서비스에 둘러보기가 있다는 것을 끝까지 모른다.
        */}
        <p className="flex flex-wrap items-center gap-3 text-xs">
          <Link
            className="text-fg-muted min-h-touch -mx-2 inline-flex items-center px-2 underline-offset-2 hover:underline"
            href="/guide"
          >
            {messages.guideLabel}
          </Link>
          <span className="text-fg-subtle">{messages.copyright}</span>
        </p>
      </PageContainer>
    </footer>
  )
}
