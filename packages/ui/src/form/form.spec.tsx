/**
 * The form's behaviour, driven the way a person drives it.
 *
 * QUALITY-GATES 1장 U1~U6 in one place, plus the reproduction of the implicit
 * submission bypass that TASK-0017 4.2 is about. Nothing here asserts a class
 * name: every test types, clicks or presses a key and then reads what a user —
 * or a screen reader — would get back.
 */

import { render, screen, waitFor } from '@testing-library/react'
import type { FormEvent } from 'react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { Button } from '../components/button'
import { Input } from '../components/input'
import { setupUser } from '../../test/support/ui'
import { Form } from './form'
import { FormError, FormField } from './form-field'
import { serverFieldErrors } from './server-errors'
import { useForm } from './use-form'

const schema = z.object({
  email: z.string().trim().min(1, '이메일을 입력해주세요').regex(/@/, '이메일 형식이 아닙니다'),
  nickname: z.string().trim().min(2, '닉네임은 2자 이상이어야 합니다'),
})

/**
 * Stands in for `ApiClientError` from `@shopping/shared`.
 *
 * `packages/ui` does not depend on that package (TASK-0017 4.4), so what the
 * form sees is whatever the app hands to `mapError` — here, the two things an
 * `ApiClientError` carries: the envelope's `details` and its `code`.
 */
class ApiFailure extends Error {
  constructor(
    readonly details: readonly unknown[],
    readonly code: string | null = 'VALIDATION_FAILED',
  ) {
    super('request failed')
  }
}

const FIELDS = ['email', 'nickname']

interface Deferred {
  readonly promise: Promise<void>
  readonly resolve: () => void
}

function deferred(): Deferred {
  let resolve = (): void => undefined
  const promise = new Promise<void>((settle) => {
    resolve = () => {
      settle()
    }
  })
  return { promise, resolve }
}

interface AccountFormProps {
  readonly onSubmit: (values: { email: string; nickname: string }) => void | Promise<void>
  /**
   * `false` puts the action in a `type="button"` — the shape a modal footer
   * forces, and the one the implicit submission bypass needs.
   */
  readonly actionSubmits?: boolean
}

function AccountForm({ onSubmit, actionSubmits = true }: AccountFormProps) {
  const form = useForm({
    initialValues: { email: '', nickname: '' },
    mapError: (error) =>
      error instanceof ApiFailure
        ? serverFieldErrors(error.details, {
            code: error.code,
            codeFields: { EMAIL_TAKEN: 'email' },
            messageForCode: (code) =>
              code === 'EMAIL_TAKEN' ? '이미 가입된 이메일입니다' : undefined,
            fields: FIELDS,
          })
        : undefined,
    onSubmit,
    schema,
    submitErrorMessage: '저장하지 못했습니다',
  })

  return (
    <Form aria-label="계정" form={form}>
      <FormError errors={form.formErrors} />

      <FormField form={form} label="이메일" name="email" required>
        <Input {...form.text('email')} type="email" />
      </FormField>

      <FormField form={form} hint="2자 이상" label="닉네임" name="nickname">
        <Input {...form.text('nickname')} />
      </FormField>

      {actionSubmits ? (
        <Button loading={form.submitting} type="submit">
          저장
        </Button>
      ) : (
        <Button
          loading={form.submitting}
          onClick={() => {
            form.submit()
          }}
          type="button"
        >
          저장
        </Button>
      )}
    </Form>
  )
}

describe('client side validation', () => {
  it('blocks the submit and puts a message on each offending field (U2)', async () => {
    const user = setupUser()
    const onSubmit = vi.fn()
    render(<AccountForm onSubmit={onSubmit} />)

    await user.click(screen.getByRole('button', { name: '저장' }))

    expect(onSubmit).not.toHaveBeenCalled()
    expect(await screen.findByText('이메일을 입력해주세요')).toBeVisible()
    expect(screen.getByText('닉네임은 2자 이상이어야 합니다')).toBeVisible()
  })

  it('ties the message to its own field, so a screen reader reads it (U2, F4)', async () => {
    const user = setupUser()
    render(<AccountForm onSubmit={vi.fn()} />)

    await user.type(screen.getByLabelText(/이메일/), 'not-an-address')
    await user.click(screen.getByRole('button', { name: '저장' }))

    const email = await screen.findByLabelText(/이메일/)
    expect(email).toHaveAttribute('aria-invalid', 'true')
    expect(email).toHaveAccessibleDescription('이메일 형식이 아닙니다')

    // The hint stays part of the description, and the error is read after it.
    expect(screen.getByLabelText('닉네임')).toHaveAccessibleDescription(
      '2자 이상 닉네임은 2자 이상이어야 합니다',
    )
  })

  it('moves focus to the first invalid control', async () => {
    const user = setupUser()
    render(<AccountForm onSubmit={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: '저장' }))

    await waitFor(() => {
      expect(screen.getByLabelText(/이메일/)).toHaveFocus()
    })
  })

  it('clears a field message once the person edits that field', async () => {
    const user = setupUser()
    render(<AccountForm onSubmit={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: '저장' }))
    expect(await screen.findByText('이메일을 입력해주세요')).toBeVisible()

    await user.type(screen.getByLabelText(/이메일/), 'a')

    expect(screen.queryByText('이메일을 입력해주세요')).not.toBeInTheDocument()
    expect(screen.getByText('닉네임은 2자 이상이어야 합니다')).toBeVisible()
  })

  it('submits the parsed values once they pass', async () => {
    const user = setupUser()
    const onSubmit = vi.fn()
    render(<AccountForm onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText(/이메일/), '  buyer@example.com  ')
    await user.type(screen.getByLabelText('닉네임'), '바이어')
    await user.click(screen.getByRole('button', { name: '저장' }))

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({ email: 'buyer@example.com', nickname: '바이어' })
    })
  })
})

describe('while a submit is in flight (U1, U3)', () => {
  it('announces the wait and blocks three more clicks', async () => {
    const user = setupUser()
    const pending = deferred()
    const onSubmit = vi.fn(() => pending.promise)
    render(<AccountForm onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText(/이메일/), 'buyer@example.com')
    await user.type(screen.getByLabelText('닉네임'), '바이어')

    const save = screen.getByRole('button', { name: '저장' })
    await user.click(save)

    await waitFor(() => {
      expect(save).toHaveAttribute('aria-busy', 'true')
    })
    expect(screen.getByRole('form', { name: '계정' })).toHaveAttribute('aria-busy', 'true')

    await user.click(save)
    await user.click(save)
    await user.click(save)

    expect(onSubmit).toHaveBeenCalledTimes(1)

    pending.resolve()
    await waitFor(() => {
      expect(save).not.toHaveAttribute('aria-busy')
    })
  })

  it('accepts a second submit once the first has finished', async () => {
    const user = setupUser()
    const onSubmit = vi.fn()
    render(<AccountForm onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText(/이메일/), 'buyer@example.com')
    await user.type(screen.getByLabelText('닉네임'), '바이어')

    await user.click(screen.getByRole('button', { name: '저장' }))
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1)
    })

    await user.click(screen.getByRole('button', { name: '저장' }))
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(2)
    })
  })
})

/**
 * The reason the guard is on the form and not only on the button.
 *
 * The first test is the defect, reproduced: `Button.loading` blocks the click
 * path and the click path only. When a form's action is not a `type="submit"`
 * button — a modal footer, or a `type="button"` with an `onClick`, both
 * ordinary in this project's console screens — Enter in a text field submits
 * the form directly, and the button's guard is never consulted.
 */
describe('the implicit submission bypass (F7)', () => {
  function NaiveForm({ onSubmit }: { readonly onSubmit: () => void }) {
    const [pending, setPending] = useState(false)

    const submit = (event: FormEvent): void => {
      event.preventDefault()
      onSubmit()
      setPending(true)
    }

    return (
      <form onSubmit={submit}>
        <label htmlFor="naive-email">이메일</label>
        <Input id="naive-email" />
        <Button
          loading={pending}
          onClick={() => {
            onSubmit()
            setPending(true)
          }}
          type="button"
        >
          저장
        </Button>
      </form>
    )
  }

  it('is real: a button-only guard lets Enter through', async () => {
    const user = setupUser()
    const onSubmit = vi.fn()
    render(<NaiveForm onSubmit={onSubmit} />)

    await user.click(screen.getByRole('button', { name: '저장' }))
    await user.click(screen.getByRole('button', { name: '저장' }))
    expect(onSubmit).toHaveBeenCalledTimes(1)

    await user.click(screen.getByLabelText('이메일'))
    await user.keyboard('{Enter}{Enter}{Enter}')

    // Four submits from a form that already declared itself busy.
    expect(onSubmit).toHaveBeenCalledTimes(4)
  })

  it('is closed: the same shape wrapped in `Form` submits once', async () => {
    const user = setupUser()
    const pending = deferred()
    const onSubmit = vi.fn(() => pending.promise)
    render(<AccountForm actionSubmits={false} onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText(/이메일/), 'buyer@example.com')
    await user.type(screen.getByLabelText('닉네임'), '바이어')

    await user.click(screen.getByRole('button', { name: '저장' }))
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1)
    })

    await user.click(screen.getByRole('button', { name: '저장' }))
    await user.click(screen.getByRole('button', { name: '저장' }))
    await user.click(screen.getByLabelText(/이메일/))
    await user.keyboard('{Enter}{Enter}{Enter}')

    expect(onSubmit).toHaveBeenCalledTimes(1)

    pending.resolve()
  })

  it('submits once when Enter is pressed three times in a row', async () => {
    const user = setupUser()
    const pending = deferred()
    const onSubmit = vi.fn(() => pending.promise)
    render(<AccountForm onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText(/이메일/), 'buyer@example.com')
    await user.type(screen.getByLabelText('닉네임'), '바이어')

    await user.click(screen.getByLabelText(/이메일/))
    await user.keyboard('{Enter}{Enter}{Enter}')

    expect(onSubmit).toHaveBeenCalledTimes(1)
    pending.resolve()
  })
})

describe('server errors (U6, F2)', () => {
  async function fill(user: ReturnType<typeof setupUser>): Promise<void> {
    await user.type(screen.getByLabelText(/이메일/), 'buyer@example.com')
    await user.type(screen.getByLabelText('닉네임'), '바이어')
  }

  it('puts a 400 detail on the field it names', async () => {
    const user = setupUser()
    const onSubmit = vi.fn(() => {
      throw new ApiFailure(['nickname 값이 올바르지 않습니다.'])
    })
    render(<AccountForm onSubmit={onSubmit} />)

    await fill(user)
    await user.click(screen.getByRole('button', { name: '저장' }))

    const nickname = await screen.findByLabelText('닉네임')
    expect(nickname).toHaveAttribute('aria-invalid', 'true')
    expect(nickname).toHaveAccessibleDescription('2자 이상 nickname 값이 올바르지 않습니다.')
  })

  it('places an error only the server can know, by its code', async () => {
    const user = setupUser()
    const onSubmit = vi.fn(() => {
      throw new ApiFailure([], 'EMAIL_TAKEN')
    })
    render(<AccountForm onSubmit={onSubmit} />)

    await fill(user)
    await user.click(screen.getByRole('button', { name: '저장' }))

    expect(await screen.findByLabelText(/이메일/)).toHaveAccessibleDescription(
      '이미 가입된 이메일입니다',
    )
  })

  it('announces a failure it cannot place, rather than doing nothing', async () => {
    const user = setupUser()
    const onSubmit = vi.fn(() => {
      throw new Error('network is down')
    })
    render(<AccountForm onSubmit={onSubmit} />)

    await fill(user)
    await user.click(screen.getByRole('button', { name: '저장' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('저장하지 못했습니다')
  })

  it('lets the person try again after a server error', async () => {
    const user = setupUser()
    const onSubmit = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new ApiFailure([], 'EMAIL_TAKEN')
      })
      .mockImplementationOnce(() => undefined)
    render(<AccountForm onSubmit={onSubmit} />)

    await fill(user)
    await user.click(screen.getByRole('button', { name: '저장' }))
    await screen.findByText('이미 가입된 이메일입니다')

    await user.click(screen.getByRole('button', { name: '저장' }))

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(2)
    })
    expect(screen.queryByText('이미 가입된 이메일입니다')).not.toBeInTheDocument()
  })
})

describe('keyboard only (U5)', () => {
  it('reaches every control by Tab and submits from the field', async () => {
    const user = setupUser()
    const onSubmit = vi.fn()
    render(<AccountForm onSubmit={onSubmit} />)

    await user.tab()
    expect(screen.getByLabelText(/이메일/)).toHaveFocus()
    await user.keyboard('buyer@example.com')

    await user.tab()
    expect(screen.getByLabelText('닉네임')).toHaveFocus()
    await user.keyboard('바이어')

    await user.tab()
    expect(screen.getByRole('button', { name: '저장' })).toHaveFocus()
    await user.keyboard('{Enter}')

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1)
    })
  })
})
