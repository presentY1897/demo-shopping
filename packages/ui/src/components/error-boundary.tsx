'use client'

/**
 * Keeps one broken subtree from taking the page with it.
 *
 * React unmounts the *entire* tree when a render throws and nothing catches it,
 * so a null dereference in one order row leaves the visitor on a blank white
 * document with no navigation and no way back. TASK-0016 F6 asks that the
 * failure stay inside the component that failed.
 *
 * A class, because `getDerivedStateFromError` has no hook equivalent — this is
 * the one part of React with no function-component form. It is deliberately not
 * `react-error-boundary`: the whole of the behaviour is the thirty lines below,
 * and `packages/ui` keeps its dependency list to the things it cannot write
 * itself.
 *
 * **This is not error *reporting*.** `onError` is the seam Sentry attaches to
 * (DECISIONS 9장 관측); this component only decides what the reader sees.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react'

export interface ErrorBoundaryFallbackProps {
  readonly error: Error
  /** Clears the caught error and re-renders the children. */
  readonly reset: () => void
}

export interface ErrorBoundaryProps {
  readonly children: ReactNode
  /**
   * What to show instead. As a function it receives the error and a `reset`, so
   * an `ErrorState` with a working 다시 시도 button is one line.
   */
  readonly fallback: ReactNode | ((props: ErrorBoundaryFallbackProps) => ReactNode)
  /** Where a monitoring hook goes. Runs on every catch, before the fallback renders. */
  readonly onError?: (error: Error, info: ErrorInfo) => void
  /**
   * Values that, when they change, clear the error automatically.
   *
   * Without this a boundary that caught an error on product 12 keeps showing the
   * fallback after the user navigates to product 13, because nothing told it the
   * inputs changed. Compared item by item with `Object.is`.
   */
  readonly resetKeys?: readonly unknown[]
}

interface ErrorBoundaryState {
  readonly error: Error | null
}

function keysChanged(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length !== b.length || a.some((value, index) => !Object.is(value, b[index]))
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    // A thrown string or object is legal JavaScript and reaches here as-is;
    // the fallback is typed against `Error`, so it is normalised once, here.
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError?.(error, info)
  }

  override componentDidUpdate(previous: ErrorBoundaryProps): void {
    if (this.state.error === null) return
    const before = previous.resetKeys ?? []
    const after = this.props.resetKeys ?? []
    if (keysChanged(before, after)) this.reset()
  }

  readonly reset = (): void => {
    this.setState({ error: null })
  }

  override render(): ReactNode {
    const { error } = this.state
    if (error === null) return this.props.children

    const { fallback } = this.props
    return typeof fallback === 'function' ? fallback({ error, reset: this.reset }) : fallback
  }
}
