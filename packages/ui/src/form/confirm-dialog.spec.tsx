/**
 * The confirmation gate around a destructive action (F6).
 *
 * The assertion that matters is negative and is repeated in several shapes: the
 * destructive function is *not* called. A test that only checked the happy path
 * would pass on a dialog that ran the action as soon as it opened.
 */

import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { Button } from '../components/button'
import { setupUser } from '../../test/support/ui'
import { ConfirmDialog, useConfirm } from './confirm-dialog'

const LABELS = {
  cancelLabel: '취소',
  closeLabel: '닫기',
  confirmLabel: '삭제',
} as const

/** The shape an app writes: the destructive call sits behind one `await`. */
function DeleteCategory({ onDelete }: { readonly onDelete: () => void | Promise<void> }) {
  const gate = useConfirm()

  return (
    <>
      <Button
        onClick={() => {
          void (async () => {
            if (!(await gate.request())) return
            await onDelete()
          })()
        }}
      >
        카테고리 삭제
      </Button>

      <ConfirmDialog
        {...LABELS}
        description="되돌릴 수 없습니다."
        destructive
        onConfirm={gate.confirm}
        onOpenChange={gate.onOpenChange}
        open={gate.open}
        title="카테고리를 삭제할까요?"
      />
    </>
  )
}

describe('ConfirmDialog', () => {
  it('does not run the action until the person confirms (F6)', async () => {
    const user = setupUser()
    const onDelete = vi.fn()
    render(<DeleteCategory onDelete={onDelete} />)

    await user.click(screen.getByRole('button', { name: '카테고리 삭제' }))

    expect(await screen.findByRole('dialog', { name: '카테고리를 삭제할까요?' })).toBeVisible()
    expect(onDelete).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: '삭제' }))

    await waitFor(() => {
      expect(onDelete).toHaveBeenCalledTimes(1)
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('never runs the action when the person cancels', async () => {
    const user = setupUser()
    const onDelete = vi.fn()
    render(<DeleteCategory onDelete={onDelete} />)

    await user.click(screen.getByRole('button', { name: '카테고리 삭제' }))
    await screen.findByRole('dialog')
    await user.click(screen.getByRole('button', { name: '취소' }))

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
    expect(onDelete).not.toHaveBeenCalled()
  })

  it('treats Escape as a cancel, so the dialog is not a keyboard trap', async () => {
    const user = setupUser()
    const onDelete = vi.fn()
    render(<DeleteCategory onDelete={onDelete} />)

    await user.click(screen.getByRole('button', { name: '카테고리 삭제' }))
    await screen.findByRole('dialog')
    await user.keyboard('{Escape}')

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
    expect(onDelete).not.toHaveBeenCalled()
  })

  it('does not put initial focus on the destructive button', async () => {
    const user = setupUser()
    render(<DeleteCategory onDelete={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: '카테고리 삭제' }))
    await screen.findByRole('dialog')

    expect(screen.getByRole('button', { name: '삭제' })).not.toHaveFocus()
  })

  it('is operable from the keyboard alone (U5)', async () => {
    const user = setupUser()
    const onDelete = vi.fn()
    render(<DeleteCategory onDelete={onDelete} />)

    await user.tab()
    expect(screen.getByRole('button', { name: '카테고리 삭제' })).toHaveFocus()
    await user.keyboard('{Enter}')

    const dialog = await screen.findByRole('dialog')

    // Tab until the confirm button has focus, then press it. The trap is
    // `Modal`'s and is tested there; what matters here is that the confirm is
    // reachable without a pointer.
    const confirm = screen.getByRole('button', { name: '삭제' })
    for (let press = 0; press < 6 && document.activeElement !== confirm; press += 1) {
      await user.tab()
      expect(dialog).toContainElement(document.activeElement as HTMLElement)
    }

    expect(confirm).toHaveFocus()
    await user.keyboard('{Enter}')

    await waitFor(() => {
      expect(onDelete).toHaveBeenCalledTimes(1)
    })
  })

  it('blocks a second confirmation while the action is running (U3)', async () => {
    const user = setupUser()
    let release = (): void => undefined
    const onDelete = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = () => {
            resolve()
          }
        }),
    )
    render(<DeleteCategory onDelete={onDelete} />)

    await user.click(screen.getByRole('button', { name: '카테고리 삭제' }))
    await screen.findByRole('dialog')

    const confirm = screen.getByRole('button', { name: '삭제' })
    await user.click(confirm)
    await user.click(confirm)
    await user.click(confirm)

    expect(onDelete).toHaveBeenCalledTimes(1)
    release()
  })

  it('opens from its own trigger and closes itself when there is no outer state', async () => {
    const user = setupUser()
    const onConfirm = vi.fn()
    render(
      <ConfirmDialog
        {...LABELS}
        onConfirm={onConfirm}
        title="발행을 취소할까요?"
        trigger={<Button>발행 취소</Button>}
      />,
    )

    await user.click(screen.getByRole('button', { name: '발행 취소' }))
    expect(await screen.findByRole('dialog', { name: '발행을 취소할까요?' })).toBeVisible()

    await user.click(screen.getByRole('button', { name: '삭제' }))

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('stays open when the action fails, so the person can try again', async () => {
    const user = setupUser()
    const onConfirm = vi.fn(() => {
      throw new Error('server said no')
    })
    render(
      <ConfirmDialog
        {...LABELS}
        onConfirm={onConfirm}
        title="삭제할까요?"
        trigger={<Button>열기</Button>}
      />,
    )

    await user.click(screen.getByRole('button', { name: '열기' }))
    await screen.findByRole('dialog')
    await user.click(screen.getByRole('button', { name: '삭제' }))

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledTimes(1)
    })
    expect(screen.getByRole('dialog')).toBeVisible()
  })
})

describe('useConfirm', () => {
  it('answers "no" to a question that is replaced by a newer one', async () => {
    const user = setupUser()
    const answers: boolean[] = []

    function Twice() {
      const gate = useConfirm()
      return (
        <>
          <Button
            onClick={() => {
              // Two questions, the second replacing the first — what a double
              // click on a row's delete button produces.
              void gate.request().then((answer) => answers.push(answer))
              void gate.request().then((answer) => answers.push(answer))
            }}
          >
            묻기
          </Button>
          <ConfirmDialog
            {...LABELS}
            onConfirm={gate.confirm}
            onOpenChange={gate.onOpenChange}
            open={gate.open}
            title="계속할까요?"
          />
        </>
      )
    }

    render(<Twice />)

    await user.click(screen.getByRole('button', { name: '묻기' }))
    await screen.findByRole('dialog')

    // The abandoned question is answered rather than left pending for ever.
    await waitFor(() => {
      expect(answers).toEqual([false])
    })

    await user.click(screen.getByRole('button', { name: '삭제' }))

    await waitFor(() => {
      expect(answers).toEqual([false, true])
    })
  })
})
