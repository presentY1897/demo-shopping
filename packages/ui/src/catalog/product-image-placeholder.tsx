/** Shared visual for absent or unavailable product photography. */
export function ProductImagePlaceholder({
  label,
  compact = false,
}: {
  readonly label?: string
  readonly compact?: boolean
}) {
  return (
    <div
      className="bg-surface-muted text-fg-subtle flex size-full flex-col items-center justify-center gap-3 p-3"
      role={label ? 'img' : undefined}
      aria-label={label}
    >
      <svg
        aria-hidden="true"
        className={compact ? 'size-7' : 'w-1/4 max-w-20'}
        viewBox="0 0 80 80"
        fill="none"
      >
        <rect x="17" y="25" width="46" height="43" rx="6" stroke="currentColor" strokeWidth="2" />
        <path
          d="M29 29V23a11 11 0 0 1 22 0v6"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <path
          d="M32 47h16M36 54h8"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          opacity=".5"
        />
      </svg>
      {label && !compact ? (
        <span aria-hidden="true" className="text-center text-xs tracking-wide">
          {label}
        </span>
      ) : null}
    </div>
  )
}
