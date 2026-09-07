/**
 * 「본문」은 한 쪽에 하나다 (TASK-0098 F3 · TASK-0099 가 찾은 것).
 *
 * `SkipLink` 는 `#main` 으로 데려다준다. 그 약속은 **본문이 하나일 때만** 성립한다 —
 * 두 개면 스크린리더의 랜드마크 목록에 「본문」이 둘 뜨고, 「본문 바로가기」가 데려간
 * 곳이 그중 어느 쪽인지 아무도 모른다. 그래서 이 규칙은 `SkipLink` 를 가진 쪽,
 * 즉 이 패키지가 지킨다.
 *
 * **화면 단위 axe 검사로는 안 잡힌다.** 그 검사들은 레이아웃 없이 페이지 하나만
 * 그리므로, 페이지가 자기 `<main>` 을 그려도 그 트리 안에서는 하나뿐이다. 실제로
 * 그 사이로 shop 의 네 화면이 `<main>` 안에 `<main>` 을 그린 채 남아 있었고,
 * Lighthouse 접근성 점수도 1.00 이었다(그쪽 기본 항목에 이 규칙이 없다).
 *
 * 소스를 읽는 검사인 이유가 그것이다 — 이것은 한 화면의 성질이 아니라 **화면과
 * 레이아웃이 겹쳐졌을 때** 생기는 성질이다.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

/** 여는 태그만 본다. `g` 플래그는 쓰지 않는다 — `test` 가 상태를 갖는다. */
const OPENS_MAIN = /<main[\s>]/

/**
 * 주석을 걷어 낸다.
 *
 * 이 규칙을 적어 둔 주석에도 `<main>` 이라는 글자가 들어간다 — 걷어 내지 않으면
 * **규칙을 설명한 파일이 규칙을 어긴 것으로 잡힌다.**
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

/**
 * 앱마다 **딱 한 파일**이 본문을 그린다.
 *
 * shop 은 자기 레이아웃이, 콘솔 둘은 `packages/ui` 의 `ConsoleShell` 이 그린다 —
 * 그래서 저쪽 `src` 에는 하나도 없는 것이 맞다.
 */
const ALLOWED: Readonly<Record<string, string>> = {
  'apps/shop/src/app/layout.tsx': '스토어프론트의 셸',
  'packages/ui/src/console/console-shell.tsx': '콘솔 세 앱이 함께 쓰는 셸',
  'packages/ui/src/preview/component-gallery.tsx': '문서용 미리보기 — 앱 화면이 아니다',
}

function sourcesUnder(dir: string): readonly string[] {
  const found: string[] = []

  const walk = (path: string): void => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const child = join(path, entry.name)

      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules' && !entry.name.startsWith('.')) walk(child)
      } else if (entry.name.endsWith('.tsx') && !entry.name.includes('.spec.')) found.push(child)
    }
  }

  walk(dir)

  return found
}

function scanned(): readonly string[] {
  return [
    ...sourcesUnder(join(ROOT, 'apps', 'shop', 'src')),
    ...sourcesUnder(join(ROOT, 'apps', 'seller', 'src')),
    ...sourcesUnder(join(ROOT, 'apps', 'admin', 'src')),
    ...sourcesUnder(join(ROOT, 'packages', 'ui', 'src')),
  ]
}

describe('본문 랜드마크', () => {
  const files = scanned()

  it('읽을 파일을 찾는다', () => {
    // 경로가 어긋나 아무것도 못 읽으면 아래 검사는 조용히 통과한다.
    expect(files.length).toBeGreaterThan(100)
  })

  it('본문을 그리는 곳은 적어 둔 곳뿐이다', () => {
    const drawing = files
      .filter((file) => OPENS_MAIN.test(withoutComments(readFileSync(file, 'utf8'))))
      .map((file) => relative(ROOT, file).split('\\').join('/'))

    expect([...drawing].sort()).toEqual(Object.keys(ALLOWED).sort())
  })

  it('적어 둔 곳마다 이유가 있다', () => {
    for (const reason of Object.values(ALLOWED)) expect(reason).not.toBe('')
  })
})
