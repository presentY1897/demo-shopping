import { PageContainer } from '@shopping/ui/layout'
import type { Metadata } from 'next'
import Link from 'next/link'

import { hrefFor } from '@/lib/guide/app-origins'
import { messagesFor } from '@/messages'

/**
 * 5분 둘러보기 (TASK-0099 F6 · F7).
 *
 * **이 화면이 이 과제의 진짜 산출물이다.** 기능이 아무리 많아도 방문자가 어디서 뭘
 * 봐야 할지 모르면 전달되지 않는다.
 *
 * 서버 컴포넌트다. 여기 있는 것은 전부 빌드 시점에 정해지는 글과 링크이고,
 * 브라우저에서 물어볼 것이 하나도 없다 — 콜드 스타트 중에도 이 화면은 그려진다.
 * 그것이 이 화면에 특히 중요하다: **API 가 깨어나기를 기다리는 사람이 읽을 것**이
 * 마침 이 안내다.
 */
export const metadata: Metadata = {
  title: messagesFor().guide.title,
  description: messagesFor().guide.description,
}

export default function GuidePage() {
  const guide = messagesFor().guide

  return (
    <PageContainer className="flex flex-col gap-6 py-6" width="narrow">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">{guide.title}</h1>
        <p className="text-fg-muted">{guide.description}</p>
      </div>

      <p className="border-border bg-surface-muted text-fg rounded-md border p-4 text-sm">
        {guide.intro}
      </p>

      {/*
        `<ol>` 이다 — 순서가 뜻이다. 앞의 걸음이 만든 것을 뒤의 걸음이 본다.
        스크린리더가 「목록, 4개 항목」이라고 읽어 주는 것도 그 뜻의 일부다.
      */}
      <ol className="flex flex-col gap-4">
        {guide.steps.map((step) => {
          const href = hrefFor(step.app, step.path)

          return (
            <li
              className="border-border bg-surface flex flex-col gap-2 rounded-md border p-4"
              key={step.title}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-fg text-base font-semibold">{step.title}</h2>
                <span className="text-fg-subtle text-xs">
                  {guide.minutesLabel.replace('{minutes}', String(step.minutes))}
                </span>
              </div>

              <p className="text-fg-muted text-sm">{step.body}</p>

              {/*
                콘솔 주소를 모르는 배포에서는 링크가 없다. 어딘지 모르는 곳으로
                데려가느니 이름만 적는 편이 낫다 (`app-origins.ts`).
              */}
              {href === null ? (
                <span className="text-fg-subtle text-sm">{guide.apps[step.app]}</span>
              ) : (
                <Link
                  className="text-primary min-h-touch -mx-2 inline-flex w-fit items-center px-2 text-sm underline-offset-2 hover:underline"
                  href={href}
                >
                  {guide.openLabel.replace('{app}', guide.apps[step.app])}
                </Link>
              )}
            </li>
          )
        })}
      </ol>

      <p className="text-fg-subtle text-sm">{guide.caution}</p>
    </PageContainer>
  )
}
