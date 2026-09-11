'use client'
import { useState } from 'react'

/** A gallery can share failures between its full image and thumbnail controls. */
export function useImageFailure() {
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set())
  return {
    unavailable: (src: string | null | undefined) => !src?.trim() || failed.has(src.trim()),
    markFailed: (src: string | null | undefined) => {
      if (src?.trim()) setFailed((held) => new Set([...held, src.trim()]))
    },
  }
}
