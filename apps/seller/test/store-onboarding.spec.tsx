/**
 * 입점 신청 · 스토어 설정 — the five faces, and what happens on the way in and
 * out of each (TASK-0109 6.1).
 *
 * The API is `@shopping/api-mocks` throughout (QUALITY-GATES 2장 대역), and the
 * mock keeps state, so these are assertions about what the screen *did* rather
 * than about what it rendered from a frozen payload: a re-application really
 * moves the store back to `PENDING`, a stale save really loses the race.
 *
 * `setupTestServer` counts sockets, so "실 API 호출 0건" is measured rather than
 * intended.
 */

import {
  brandNameTaken,
  httpFailure,
  httpFailureOn,
  mockPaths,
  resetSellerStore,
  sellerActive,
  sellerPending,
  sellerRejected,
  sellerRequests,
  sellerRowSnapshot,
  sellerSuspended,
} from '@shopping/api-mocks'
import type { Seller } from '@shopping/shared'
import { sellerApplicationRequestSchema, sellerStoreUpdateRequestSchema } from '@shopping/shared'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import ApplyPage from '@/app/apply/page'
import SettingsPage from '@/app/settings/page'
import { messagesFor, screenTitle } from '@/messages'

import { testServer } from './setup'
import { stubViewport, VIEWPORTS } from './support/viewport'

const { store: copy, errors } = messagesFor()

// Only the last describe stubs one, but a global left behind would decide the
// next spec file's window width.
afterEach(() => {
  vi.unstubAllGlobals()
})

/** What a spec sent, by verb. The availability probes are filtered out. */
function sent(method: string) {
  return sellerRequests().filter((entry) => entry.method === method)
}

function field(name: RegExp) {
  return screen.getByRole('textbox', { name })
}

const BRAND_NAME = /^브랜드명/
const SLUG = /^스토어 주소/
const INTRODUCTION = /^스토어 소개/
const LOGO_URL = /^로고 주소/

/** Renders `/apply` and waits for `GET /sellers/me` to have been answered. */
async function openApply(seed?: Seller) {
  if (seed !== undefined) resetSellerStore(seed)
  render(<ApplyPage />)

  return screen.findByRole('form', { name: copy.applyTitle })
}

async function openSettings(seed?: Seller) {
  if (seed !== undefined) resetSellerStore(seed)
  render(<SettingsPage />)

  await screen.findByRole('heading', { level: 1, name: screenTitle('/settings') })
}

/** A complete, valid application. Nothing here collides with the fixtures. */
async function fillApplication(user: ReturnType<typeof userEvent.setup>) {
  await user.type(field(BRAND_NAME), '해뜰녘')
  await user.type(field(SLUG), 'haetteulnyeok')
  await user.type(field(INTRODUCTION), '아침 햇살 색으로 물들인 리넨.')
}

describe('U1 · P5 — the four states of the read', () => {
  it('announces the wait before the API has answered', () => {
    render(<ApplyPage />)

    expect(screen.getByRole('status', { name: copy.loadingLabel })).toHaveAttribute(
      'aria-busy',
      'true',
    )
  })

  it('offers an empty application form when the account has never applied', async () => {
    await openApply()

    expect(field(BRAND_NAME)).toHaveValue('')
    expect(screen.getByRole('button', { name: copy.form.applyLabel })).toBeEnabled()
    // No banner: there is no store to say anything about.
    expect(screen.queryByText(copy.status.pendingTitle)).not.toBeInTheDocument()
  })

  it('shows the store when there is one', async () => {
    await openApply(sellerActive)

    expect(field(BRAND_NAME)).toHaveValue(sellerActive.brandName)
    expect(field(SLUG)).toHaveValue(sellerActive.slug)
  })

  it('reports a failed read and offers a way back', async () => {
    testServer.server.use(httpFailure(mockPaths.sellerMe, 500, 'INTERNAL_ERROR', '서버 오류'))
    render(<ApplyPage />)

    const notice = await screen.findByRole('alert')

    expect(within(notice).getByText(copy.failure.title)).toBeVisible()
    expect(within(notice).getByText(errors.INTERNAL_ERROR)).toBeVisible()
    expect(within(notice).getByRole('button', { name: copy.failure.retryLabel })).toBeVisible()
  })

  it('quotes the request id only for a failure nobody here can fix', async () => {
    testServer.server.use(httpFailure(mockPaths.sellerMe, 500, 'INTERNAL_ERROR', '서버 오류'))
    render(<ApplyPage />)
    await screen.findByRole('alert')

    expect(screen.getByLabelText(copy.failure.requestIdLabel)).toBeVisible()
  })

  it('does not treat "never applied" as a failure', async () => {
    // The 404 branch. A store that does not exist is the most ordinary visitor
    // this screen has, and a failure notice would be wrong about them.
    await openApply()

    expect(screen.queryByText(copy.failure.title)).not.toBeInTheDocument()
  })

  it('reads again when the reader retries', async () => {
    const user = userEvent.setup()
    testServer.server.use(httpFailure(mockPaths.sellerMe, 500, 'INTERNAL_ERROR', '서버 오류'))
    render(<ApplyPage />)
    await screen.findByRole('alert')

    testServer.server.resetHandlers()
    await user.click(screen.getByRole('button', { name: copy.failure.retryLabel }))

    expect(await screen.findByRole('form', { name: copy.applyTitle })).toBeVisible()
  })
})

describe('F2 — every status has a face', () => {
  it.each([
    [sellerPending, copy.status.pendingTitle, copy.status.label.PENDING, copy.form.saveLabel],
    [sellerRejected, copy.status.rejectedTitle, copy.status.label.REJECTED, copy.form.reapplyLabel],
    [sellerActive, copy.status.activeTitle, copy.status.label.ACTIVE, copy.form.saveLabel],
    [sellerSuspended, copy.status.suspendedTitle, copy.status.label.SUSPENDED, copy.form.saveLabel],
  ])('%#', async (seed: Seller, title: string, badge: string, action: string) => {
    await openApply(seed)

    expect(screen.getByRole('heading', { level: 2, name: title })).toBeVisible()
    expect(screen.getByText(badge)).toBeVisible()
    expect(screen.getByRole('button', { name: action })).toBeVisible()
  })

  it('shows the reason a rejected or suspended store was given', async () => {
    await openApply(sellerRejected)

    expect(screen.getByText(sellerRejected.statusReason ?? '')).toBeVisible()
  })

  it('leaves every field editable while a store is suspended', async () => {
    // `state-machines.md` 6장: 스토어 정보 수정은 모든 상태에서 열려 있다.
    // A disabled form would be the screen refusing what the API allows.
    await openApply(sellerSuspended)

    expect(field(BRAND_NAME)).not.toHaveAttribute('readonly')
    expect(field(INTRODUCTION)).toBeEnabled()
  })

  it('locks the address once the store exists, and shows it', async () => {
    await openApply(sellerActive)

    // Read-only rather than disabled: still reachable by Tab, still selectable.
    expect(field(SLUG)).toHaveAttribute('readonly')
    expect(field(SLUG)).toHaveValue(sellerActive.slug)
  })
})

describe('F1 — applying', () => {
  it('sends a body the contract accepts and says what happened', async () => {
    const user = userEvent.setup()
    await openApply()

    await fillApplication(user)
    await user.click(screen.getByRole('button', { name: copy.form.applyLabel }))

    expect(await screen.findByText(copy.form.appliedNotice)).toBeVisible()

    const posts = sent('POST')
    expect(posts).toHaveLength(1)
    expect(sellerApplicationRequestSchema.parse(posts[0]?.body)).toEqual({
      brandName: '해뜰녘',
      slug: 'haetteulnyeok',
      introduction: '아침 햇살 색으로 물들인 리넨.',
    })
    expect(sellerRowSnapshot()?.status).toBe('PENDING')
  })

  it('leaves an untouched optional field out of the body rather than sending ""', async () => {
    const user = userEvent.setup()
    await openApply()

    await user.type(field(BRAND_NAME), '해뜰녘')
    await user.type(field(SLUG), 'haetteulnyeok')
    await user.click(screen.getByRole('button', { name: copy.form.applyLabel }))
    await screen.findByText(copy.form.appliedNotice)

    // `sellerLogoUrlSchema` is `min(1)`: an empty string is not "no logo", it is
    // an invalid one, and the API would refuse a form nobody filled in.
    expect(sent('POST')[0]?.body).not.toHaveProperty('logoUrl')
  })

  it('draws the status the application produced without a second read', async () => {
    const user = userEvent.setup()
    await openApply()

    await fillApplication(user)
    await user.click(screen.getByRole('button', { name: copy.form.applyLabel }))

    expect(
      await screen.findByRole('heading', { level: 2, name: copy.status.pendingTitle }),
    ).toBeVisible()
    expect(sent('GET').filter((entry) => entry.path === '/sellers/me')).toHaveLength(1)
  })
})

describe('F3 — the brand name check', () => {
  it('says a name is taken before anything is submitted', async () => {
    const user = userEvent.setup()
    await openApply()

    await user.type(field(BRAND_NAME), brandNameTaken.value)

    expect(await screen.findByText(copy.availability.taken)).toBeVisible()
  })

  it('refuses the submit and says why, under the field', async () => {
    const user = userEvent.setup()
    await openApply()

    await user.type(field(SLUG), 'haetteulnyeok')
    await user.type(field(BRAND_NAME), brandNameTaken.value)
    await screen.findByText(copy.availability.taken)
    await user.click(screen.getByRole('button', { name: copy.form.applyLabel }))

    const message = await screen.findByText(copy.form.errors.brandNameTaken)
    expect(field(BRAND_NAME).getAttribute('aria-describedby')).toContain(message.id)
    expect(sent('POST')).toHaveLength(0)
  })

  it('says a name is free without promising it', async () => {
    const user = userEvent.setup()
    await openApply()

    await user.type(field(BRAND_NAME), '해뜰녘')

    expect(await screen.findByText(copy.availability.available)).toBeVisible()
    expect(screen.getByRole('button', { name: copy.form.applyLabel })).toBeEnabled()
  })

  it('refuses the keyboard the same way it refuses the button', async () => {
    const user = userEvent.setup()
    await openApply()

    await user.type(field(SLUG), 'haetteulnyeok')
    await user.type(field(BRAND_NAME), brandNameTaken.value)
    await screen.findByText(copy.availability.taken)

    // Enter in a text field is the submit `Button.loading` cannot guard, and it
    // has to meet the same refusal a click does — one door (TASK-0017 4.2).
    await user.keyboard('{Enter}')

    expect(await screen.findByText(copy.form.errors.brandNameTaken)).toBeVisible()
    expect(sent('POST')).toHaveLength(0)
  })

  it('never asks about the name the store already has', async () => {
    await openApply(sellerActive)

    expect(sent('GET').some((entry) => entry.path.includes('brand-name-availability'))).toBe(false)
    expect(screen.queryByText(copy.availability.taken)).not.toBeInTheDocument()
  })

  it('does not block a submit when the check itself failed', async () => {
    const user = userEvent.setup()
    await openApply()
    testServer.server.use(httpFailure(mockPaths.sellerBrandNameAvailability, 503, 'X', 'asleep'))

    await fillApplication(user)
    await user.click(screen.getByRole('button', { name: copy.form.applyLabel }))

    // A check that could not be made is not a refusal. The endpoint that can
    // actually decide is the one being asked.
    expect(await screen.findByText(copy.form.appliedNotice)).toBeVisible()
  })
})

describe('F4 — re-applying after a rejection', () => {
  it('sends one application and clears the reason', async () => {
    const user = userEvent.setup()
    await openApply(sellerRejected)

    await user.clear(field(LOGO_URL))
    await user.type(field(LOGO_URL), 'https://cdn.test.invalid/sellers/lumiere/logo-v2.png')
    await user.click(screen.getByRole('button', { name: copy.form.reapplyLabel }))

    expect(await screen.findByText(copy.form.appliedNotice)).toBeVisible()
    expect(sent('POST')).toHaveLength(1)
    expect(sellerRowSnapshot()).toMatchObject({ status: 'PENDING', statusReason: null })
    expect(screen.queryByText(sellerRejected.statusReason ?? '')).not.toBeInTheDocument()
  })

  it('carries the whole form, not a patch on the rejected row', async () => {
    const user = userEvent.setup()
    await openApply(sellerRejected)

    await user.click(screen.getByRole('button', { name: copy.form.reapplyLabel }))
    await screen.findByText(copy.form.appliedNotice)

    // The brand name may have *been* the reason for the rejection, so it has to
    // travel even when it did not change (TASK-0108 `SellerService.apply`).
    expect(sent('POST')[0]?.body).toMatchObject({
      brandName: sellerRejected.brandName,
      slug: sellerRejected.slug,
    })
  })
})

describe('F5 — saving the store', () => {
  it('sends a PATCH carrying the version it was written against', async () => {
    const user = userEvent.setup()
    await openSettings(sellerActive)

    await user.clear(field(BRAND_NAME))
    await user.type(field(BRAND_NAME), '해뜰녘')
    await user.click(screen.getByRole('button', { name: copy.form.saveLabel }))

    expect(await screen.findByText(copy.form.savedNotice)).toBeVisible()

    const patches = sent('PATCH')
    expect(patches).toHaveLength(1)
    expect(sellerStoreUpdateRequestSchema.parse(patches[0]?.body)).toMatchObject({
      brandName: '해뜰녘',
      version: sellerActive.version,
    })
    expect(sellerRowSnapshot()?.version).toBe(sellerActive.version + 1)
  })

  it('clears an emptied introduction with null rather than leaving it alone', async () => {
    const user = userEvent.setup()
    await openSettings(sellerActive)

    await user.clear(field(INTRODUCTION))
    await user.click(screen.getByRole('button', { name: copy.form.saveLabel }))
    await screen.findByText(copy.form.savedNotice)

    expect(sent('PATCH')[0]?.body).toMatchObject({ introduction: null })
    expect(sellerRowSnapshot()?.introduction).toBeNull()
  })

  it('never sends the address', async () => {
    const user = userEvent.setup()
    await openSettings(sellerActive)

    await user.click(screen.getByRole('button', { name: copy.form.saveLabel }))
    await screen.findByText(copy.form.savedNotice)

    expect(sent('PATCH')[0]?.body).not.toHaveProperty('slug')
  })

  it('points a seller with no store at the application form', async () => {
    await openSettings()

    expect(screen.getByText(copy.absent.title)).toBeVisible()
    expect(screen.getByRole('link', { name: copy.absent.applyLabel })).toHaveAttribute(
      'href',
      '/apply',
    )
  })
})

describe('F6 — somebody saved first', () => {
  /** Renders the settings form, then moves the row on behind its back. */
  async function withAnotherTabAhead(user: ReturnType<typeof userEvent.setup>) {
    await openSettings(sellerActive)
    resetSellerStore({
      ...sellerActive,
      introduction: '다른 탭이 저장한 소개.',
      version: sellerActive.version + 1,
    })

    await user.clear(field(INTRODUCTION))
    await user.type(field(INTRODUCTION), '이 탭이 쓰던 소개.')
    await user.click(screen.getByRole('button', { name: copy.form.saveLabel }))

    return screen.findByText(copy.conflict.title)
  }

  it('asks rather than overwriting, and keeps what was typed', async () => {
    const user = userEvent.setup()
    await withAnotherTabAhead(user)

    expect(field(INTRODUCTION)).toHaveValue('이 탭이 쓰던 소개.')
    expect(sellerRowSnapshot()?.introduction).toBe('다른 탭이 저장한 소개.')
  })

  it('offers both answers', async () => {
    const user = userEvent.setup()
    await withAnotherTabAhead(user)

    expect(screen.getByRole('button', { name: copy.conflict.reloadLabel })).toBeVisible()
    expect(screen.getByRole('button', { name: copy.conflict.overwriteLabel })).toBeVisible()
  })

  it('takes the stored version when the reader asks for it', async () => {
    const user = userEvent.setup()
    await withAnotherTabAhead(user)

    await user.click(screen.getByRole('button', { name: copy.conflict.reloadLabel }))

    await waitFor(() => {
      expect(field(INTRODUCTION)).toHaveValue('다른 탭이 저장한 소개.')
    })
    expect(screen.queryByText(copy.conflict.title)).not.toBeInTheDocument()
  })

  it('writes on top of the current version when the reader chooses to', async () => {
    const user = userEvent.setup()
    await withAnotherTabAhead(user)

    await user.click(screen.getByRole('button', { name: copy.conflict.overwriteLabel }))

    expect(await screen.findByText(copy.form.savedNotice)).toBeVisible()
    expect(sellerRowSnapshot()?.introduction).toBe('이 탭이 쓰던 소개.')
    // The second attempt carries the version that is now current — re-sending
    // the one that was already refused would only be refused again.
    expect(sent('PATCH').map((entry) => (entry.body as { version: number }).version)).toEqual([
      sellerActive.version,
      sellerActive.version + 1,
    ])
  })
})

describe('F7 · U2 · U6 — messages land where they belong', () => {
  it('puts a schema failure under the field it is about', async () => {
    const user = userEvent.setup()
    await openApply()

    await user.type(field(BRAND_NAME), '가')
    await user.type(field(SLUG), 'haetteulnyeok')
    await user.click(screen.getByRole('button', { name: copy.form.applyLabel }))

    const message = await screen.findByText(copy.form.errors.brandNameLength)
    expect(field(BRAND_NAME)).toHaveAttribute('aria-invalid', 'true')
    expect(field(BRAND_NAME).getAttribute('aria-describedby')).toContain(message.id)
    expect(sent('POST')).toHaveLength(0)
  })

  it('puts a server field error under the same field', async () => {
    const user = userEvent.setup()
    await openApply()
    testServer.server.use(
      httpFailureOn(
        'post',
        mockPaths.sellerApplications,
        400,
        'BAD_REQUEST',
        '요청 형식이 올바르지 않습니다.',
        [{ field: 'brandName', message: '브랜드명을 다시 확인해주세요.', code: 'INVALID' }],
      ),
    )

    await fillApplication(user)
    await user.click(screen.getByRole('button', { name: copy.form.applyLabel }))

    const message = await screen.findByText('브랜드명을 다시 확인해주세요.')
    expect(field(BRAND_NAME).getAttribute('aria-describedby')).toContain(message.id)
  })

  it('keeps the server sentence for a duplicate rather than the catalog line', async () => {
    const user = userEvent.setup()
    await openApply()
    // The availability check is out of the way here: only the endpoint decides.
    testServer.server.use(
      httpFailureOn('post', mockPaths.sellerApplications, 409, 'CONFLICT', '충돌', [
        { field: 'brandName', message: '이미 쓰고 있는 브랜드명이에요.', code: 'INVALID' },
      ]),
    )

    await fillApplication(user)
    await user.click(screen.getByRole('button', { name: copy.form.applyLabel }))

    // `INVALID` is the only code these endpoints send, so answering it from the
    // catalog would replace a sentence that names the problem with one that
    // does not.
    expect(await screen.findByText('이미 쓰고 있는 브랜드명이에요.')).toBeVisible()
    expect(screen.queryByText(errors.INVALID)).not.toBeInTheDocument()
  })

  it('shows a 500 at the form level, where nothing else could carry it', async () => {
    const user = userEvent.setup()
    await openApply()
    testServer.server.use(
      httpFailureOn('post', mockPaths.sellerApplications, 500, 'INTERNAL_ERROR', '서버 오류'),
    )

    await fillApplication(user)
    await user.click(screen.getByRole('button', { name: copy.form.applyLabel }))

    const box = await screen.findByRole('alert')
    expect(within(box).getByText(errors.INTERNAL_ERROR)).toBeVisible()
  })
})

describe('F8 · U3 — one submit per press', () => {
  it('sends one request for two clicks in the same tick', async () => {
    const user = userEvent.setup()
    await openApply()
    await fillApplication(user)

    // Both events before React has re-rendered with `submitting: true`, which is
    // the case a disabled button cannot cover on its own.
    const button = screen.getByRole('button', { name: copy.form.applyLabel })
    fireEvent.click(button)
    fireEvent.click(button)

    expect(await screen.findByText(copy.form.appliedNotice)).toBeVisible()
    expect(sent('POST')).toHaveLength(1)
  })
})

describe('U5 — the keyboard alone', () => {
  it('reaches every control and submits', async () => {
    const user = userEvent.setup()
    await openApply()

    await user.tab()
    expect(field(BRAND_NAME)).toHaveFocus()
    await user.keyboard('해뜰녘')

    await user.tab()
    expect(field(SLUG)).toHaveFocus()
    await user.keyboard('haetteulnyeok')

    await user.tab()
    expect(field(INTRODUCTION)).toHaveFocus()

    await user.tab()
    expect(field(LOGO_URL)).toHaveFocus()

    await user.tab()
    expect(screen.getByRole('button', { name: copy.form.applyLabel })).toHaveFocus()
    await user.keyboard('{Enter}')

    expect(await screen.findByText(copy.form.appliedNotice)).toBeVisible()
  })
})

describe('P3 — one column at every width', () => {
  /**
   * There is no viewport branch on this screen, and that is the claim.
   *
   * The console shell mounts a sidebar or a sheet depending on the width
   * (D-055) and its own spec checks that; everything inside it here is a single
   * fluid column — `max-w-2xl`, full-width controls, no table and no fixed
   * width — so the three verification widths produce the same tree rather than
   * three layouts to keep working. jsdom has no layout engine, so what is
   * asserted is the absence of the branch, not the absence of an overflow;
   * 6.2 says which of the two was measured where.
   */
  it.each([VIEWPORTS.mobile, VIEWPORTS.tablet, VIEWPORTS.desktop])('%dpx', async (width) => {
    stubViewport(width)
    await openApply(sellerActive)

    for (const name of [BRAND_NAME, SLUG, INTRODUCTION, LOGO_URL]) {
      expect(field(name)).toBeVisible()
    }
    expect(screen.getByRole('button', { name: copy.form.saveLabel })).toBeVisible()
  })
})
