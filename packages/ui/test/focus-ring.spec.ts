/**
 * 키보드로 옮겨 다니는 사람이 **지금 어디에 있는지** 보이는가 (TASK-0098 F3).
 *
 * `touch-target.spec.ts` 와 같은 모양의 검사다. 저쪽이 「손가락이 닿는 상자는 자기
 * 하한을 말한다」를 강제한다면, 여기는 「키보드가 닿는 상자는 자기 표시를 말한다」를
 * 강제한다. 둘 다 렌더된 픽셀이 아니라 **정책**을 검사한다 — jsdom 에는 레이아웃도
 * 스타일시트도 없어 `:focus-visible` 의 그려진 결과를 볼 수 없고, axe 도 이것을
 * 보지 못한다(초점 표시가 있는지는 색을 계산해야 알 수 있고, axe 는 그 규칙을 끄고
 * 있다). 그래서 브라우저에서 한 번 눈으로 확인한 것을 **이 파일이 붙잡아 둔다.**
 *
 * ## 두 가지를 본다
 *
 * 1. 상호작용하는 파일은 `FOCUS_RING` 에 닿는다 — 직접 쓰거나, 그것을 쓰는 파일을
 *    가져다 쓰거나. 손으로 적은 목록이 아니라 **상대 경로 import 를 따라가서** 판단한다.
 *    목록이었다면 새 컴포넌트가 조용히 빠질 수 있다.
 * 2. `outline-none` 을 쓴 자리는 대신할 표시를 함께 쓴다. 초점 표시가 사라지는 가장
 *    흔한 방법이 「기본 테두리가 보기 싫어서 끄고 잊는 것」이고, 끈 자리는 **켠
 *    자리보다 적어서** 하나씩 이유를 적을 수 있다.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src')

/** 초점 표시를 만드는 두 가지 — 공용 조각, 그리고 손으로 적은 같은 내용. */
const NAMES_RING = /FOCUS_RING|focus-visible:outline/

/** 키보드가 멈춰 설 수 있는 것을 그리는 파일인가. */
const RENDERS_INTERACTIVE = /<button|<a\s|<input|<select|<textarea|Primitive\.(?:Trigger|Item)/

/**
 * 링을 이름하지 않아도 되는 파일과 그 이유.
 *
 * `tooltip.tsx` — 방아쇠가 `asChild` 라 **자기 요소를 그리지 않는다.** 초점을 받는
 * 것은 호출한 쪽이 넘긴 버튼이고, 링은 그 버튼이 이미 가지고 있다. 여기에 링을
 * 더하면 같은 상자에 두 겹이 그려진다.
 */
const RING_EXEMPT: Readonly<Record<string, string>> = {
  'components/tooltip.tsx': '방아쇠가 asChild 라 자기 요소를 그리지 않는다',
}

/**
 * 기본 테두리를 꺼도 되는 자리와 그 이유.
 *
 * 앞의 넷은 **탭으로 도달하지 않는다.** 열릴 때 초점을 프로그램으로 받아 안쪽으로
 * 넘겨주는 그릇이고, 사람이 Tab 으로 그 그릇 자체에 멈추는 일은 없다. 그릇에 링이
 * 그려지면 열자마자 화면 전체에 테두리가 생긴다.
 */
const OUTLINE_EXEMPT: Readonly<Record<string, string>> = {
  'components/drawer.tsx': '열릴 때 초점을 받아 안으로 넘기는 그릇 — 탭으로 도달하지 않는다',
  'components/modal.tsx': '열릴 때 초점을 받아 안으로 넘기는 그릇 — 탭으로 도달하지 않는다',
  'components/popover.tsx': '열릴 때 초점을 받아 안으로 넘기는 그릇 — 탭으로 도달하지 않는다',
  'components/toast.tsx': '알림 목록 자체 — 초점은 안의 닫기 버튼이 받는다',
}

function sources(): ReadonlyMap<string, string> {
  const found = new Map<string, string>()

  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      const key = prefix === '' ? entry.name : `${prefix}/${entry.name}`

      if (entry.isDirectory()) walk(path, key)
      else if (/\.tsx?$/.test(entry.name) && !entry.name.includes('.spec.'))
        found.set(key, readFileSync(path, 'utf8'))
    }
  }

  walk(SRC, '')

  return found
}

const FILES = sources()

/** `'../lib/styles'` 같은 상대 경로를 이 표의 열쇠로 바꾼다. */
function resolveImport(from: string, specifier: string): string | null {
  const parts = from.split('/').slice(0, -1)

  for (const segment of specifier.split('/')) {
    if (segment === '.') continue
    else if (segment === '..') parts.pop()
    else parts.push(segment)
  }

  const base = parts.join('/')

  return (
    ['.tsx', '.ts', '/index.tsx', '/index.ts']
      .map((suffix) => `${base}${suffix}`)
      .find((candidate) => FILES.has(candidate)) ?? null
  )
}

/** 직접 쓰는 파일에서 시작해 **가져다 쓰는 쪽으로** 번져 나간다. */
function filesReachingTheRing(): ReadonlySet<string> {
  const reaches = new Set(
    [...FILES].filter(([, source]) => NAMES_RING.test(source)).map(([name]) => name),
  )

  for (;;) {
    const before = reaches.size

    for (const [name, source] of FILES) {
      if (reaches.has(name)) continue

      for (const match of source.matchAll(/from '(\.[^']+)'/g)) {
        const target = resolveImport(name, match[1] ?? '')

        if (target !== null && reaches.has(target)) {
          reaches.add(name)
          break
        }
      }
    }

    if (reaches.size === before) return reaches
  }
}

describe('키보드가 닿는 것은 초점 표시에 닿는다', () => {
  const reaches = filesReachingTheRing()
  const interactive = [...FILES]
    .filter(([, source]) => RENDERS_INTERACTIVE.test(source))
    .map(([name]) => name)

  it('상호작용하는 파일을 찾는다', () => {
    // 정규식이 바뀌어 아무것도 못 찾으면 아래 검사가 전부 조용히 통과한다.
    expect(interactive.length).toBeGreaterThan(10)
  })

  it.each(interactive)('%s', (name) => {
    if (name in RING_EXEMPT) {
      expect(RING_EXEMPT[name]).toBeTruthy()

      return
    }

    expect(reaches.has(name)).toBe(true)
  })
})

describe('기본 테두리를 끈 자리는 대신할 표시를 쓴다', () => {
  const turnedOff = [...FILES]
    .filter(([, source]) => /outline-none|outline-hidden/.test(source))
    .map(([name]) => name)

  it('끈 자리를 찾는다', () => {
    expect(turnedOff.length).toBeGreaterThan(0)
  })

  it.each(turnedOff)('%s', (name) => {
    if (name in OUTLINE_EXEMPT) {
      expect(OUTLINE_EXEMPT[name]).toBeTruthy()

      return
    }

    const source = FILES.get(name) ?? ''

    // 링이든 강조든, 초점이 어디 있는지 눈에 보이면 된다 — Radix 의 목록은
    // `data-highlighted` 로 칠하고 그것이 곧 초점의 자리다.
    expect(NAMES_RING.test(source) || source.includes('data-highlighted:')).toBe(true)
  })
})
