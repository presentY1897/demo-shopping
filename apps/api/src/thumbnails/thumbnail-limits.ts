/** Keep native image memory out of the HTTP server and bound each job. */
export const THUMBNAIL_LIMITS = {
  inputBytes: 10 * 1024 * 1024,
  pixels: 16_000_000,
  rssBytes: 192 * 1024 * 1024,
  timeoutMs: 30_000,
  edges: [256, 768],
} as const

export interface ThumbnailOutput {
  readonly edge: number
  readonly width: number
  readonly height: number
  readonly bytes: number
}

export interface ThumbnailCommand {
  readonly directory?: string
  readonly sourceUrl: string
  readonly targets: readonly { readonly edge: number; readonly url: string }[]
}
