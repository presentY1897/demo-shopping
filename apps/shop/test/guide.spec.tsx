/**
 * 5분 둘러보기 (TASK-0099 F6 · F7).
 *
 * **안내는 문서가 아니라 약속이다.** 「② 판매자 콘솔에서 주문을 확인하세요」라고
 * 적어 두면 그 화면이 있어야 하고, 그 주소로 갈 수 있어야 하고, 5분 안에 끝나야
 * 한다. 셋 중 하나가 어긋난 안내는 없느니만 못하다 — 따라간 사람이 자기가 뭘 잘못한
 * 줄 안다.
 *
 * 그래서 여기서 세 가지를 검사한다.
 *
 * 1. **적힌 시간의 합이 5분 안이다** (F7). 걸음을 더하면서 합을 잊는 것이 이 안내가
 *    틀려지는 가장 흔한 방법이고, 사람은 그것을 따라가 보기 전에는 모른다.
 * 2. **가리키는 경로가 이 앱에 실제로 있다** (F6). 상점 쪽 경로는 `src/app` 아래의
 *    라우트를 읽어 맞춰 본다 — 화면 이름을 바꾸는 날 이 검사가 먼저 빨개진다.
 * 3. **콘솔 주소를 모르면 링크를 걸지 않는다.** 어딘지 모르는 곳으로 데려가는 것보다
 *    이름만 적는 편이 낫다.
 */

import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import GuidePage from '@/app/guide/page'
import { hrefFor } from '@/lib/guide/app-origins'
import { messagesFor } from '@/messages'

const guide = messagesFor().guide

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'app')

/** `/mypage/orders` → `src/app/mypage/orders/page.tsx` 가 있는가. */
function routeExists(path: string): boolean {
  const segments = path.split('/').filter((segment) => segment !== '')

  return existsSync(join(APP_DIR, ...segments, 'page.tsx'))
}

describe('안내가 약속하는 것', () => {
  it('걸음마다 시간이 적혀 있고, 합이 5분 안이다 (F7)', () => {
    const total = guide.steps.reduce((sum, step) => sum + step.minutes, 0)

    expect(guide.steps.length).toBeGreaterThan(0)
    for (const step of guide.steps) expect(step.minutes).toBeGreaterThan(0)
    expect(total).toBeLessThanOrEqual(5)
  })

  it('상점을 가리키는 걸음은 실제로 있는 화면을 가리킨다 (F6)', () => {
    const shopSteps = guide.steps.filter((step) => step.app === 'shop')

    // 하나도 없으면 아래 단언이 조용히 통과한다.
    expect(shopSteps.length).toBeGreaterThan(0)

    for (const step of shopSteps) {
      expect(routeExists(step.path), `${step.path} 화면이 없습니다`).toBe(true)
    }
  })

  it('콘솔의 경로는 그 앱 안에서 로그인 문을 가리킨다 (F6)', () => {
    const consoleSteps = guide.steps.filter((step) => step.app !== 'shop')

    expect(consoleSteps.length).toBeGreaterThan(0)

    // 콘솔 화면은 이 앱에 없으므로 파일로 확인할 수 없다. 대신 **로그인 뒤에 있는
    // 화면을 바로 가리키지 않는다**를 지킨다 — 세션 없이 열면 로그인 화면으로
    // 튕기고, 안내를 따라온 사람은 자기가 길을 잘못 든 줄 안다.
    for (const step of consoleSteps) {
      expect(step.path).toBe('/login')
    }
  })
})

describe('안내 화면', () => {
  it('네 걸음을 순서 있는 목록으로 그린다', () => {
    render(<GuidePage />)

    const steps = screen.getByRole('list')

    expect(screen.getByRole('heading', { level: 1, name: guide.title })).toBeVisible()
    expect(steps.tagName).toBe('OL')
    expect(screen.getAllByRole('listitem')).toHaveLength(guide.steps.length)
  })

  it('데이터가 사라진다는 것을 말한다', () => {
    render(<GuidePage />)

    // 이 안내를 따라간 사람은 계정을 만들고 주문을 넣는다. 그것이 24시간 뒤에
    // 사라진다는 사실을 안내가 말하지 않으면, 그 사람은 잃어버린 줄 안다.
    expect(screen.getByText(guide.caution)).toBeVisible()
  })
})

describe('앱 주소', () => {
  it('상점은 상대 경로다', () => {
    // 절대 주소를 쓰면 미리보기 배포에서 눌렀을 때 운영으로 건너뛰고, 그 사람이
    // 방금 만든 데모 계정은 거기 없다.
    expect(hrefFor('shop', '/login')).toBe('/login')
  })

  it('콘솔 주소를 모르면 링크를 걸지 않는다', () => {
    const kept = process.env.NEXT_PUBLIC_SELLER_URL

    try {
      delete process.env.NEXT_PUBLIC_SELLER_URL
      expect(hrefFor('seller', '/login')).toBeNull()
    } finally {
      if (kept !== undefined) process.env.NEXT_PUBLIC_SELLER_URL = kept
    }
  })

  it('끝의 빗금은 붙이지 않는다', () => {
    const kept = process.env.NEXT_PUBLIC_ADMIN_URL

    try {
      process.env.NEXT_PUBLIC_ADMIN_URL = 'https://admin.example.com/'
      expect(hrefFor('admin', '/login')).toBe('https://admin.example.com/login')
    } finally {
      if (kept === undefined) delete process.env.NEXT_PUBLIC_ADMIN_URL
      else process.env.NEXT_PUBLIC_ADMIN_URL = kept
    }
  })
})
