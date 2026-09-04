'use client'

/**
 * The postal-code search widget, and the one seam that makes it optional
 * (TASK-0112 4장 「우편번호 검색」).
 *
 * **What is attached.** 다음(카카오) 우편번호 서비스 v2. It is keyless, it is
 * what a Korean shopper expects to see, and typing a road address by hand is the
 * thing this screen exists to avoid. Its cost is written into TASK-0112 8장:
 * the delivery channel is `prod` and the file name carries no version, so
 * **there is no version to pin** — the provider can change the script under us
 * at any time.
 *
 * **That cost is why the fallback is not an error path.** If the script is
 * blocked, dead, or simply slow, the form turns its three address fields into
 * ordinary inputs and the address is still savable (F6b). A storefront where
 * nobody can add an address is a storefront where nobody can order.
 *
 * **Nothing here is loaded until somebody asks.** The script is fetched when the
 * search is opened, not when the page is rendered, so it appears in no route's
 * First Load JS and cannot slow the address list down.
 *
 * **The whole module is one injectable function.** `AddressForm` takes
 * {@link PostcodeSearch} as a prop; specs hand over a stub that resolves with a
 * chosen address, or one that rejects to exercise the fallback. No test ever
 * reaches `t1.daumcdn.net` — the mock server refuses unhandled requests and the
 * process counts outbound sockets.
 */

export const POSTCODE_SCRIPT_URL =
  'https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js'

/**
 * How long the script gets before the form gives up and offers manual entry.
 *
 * A ceiling rather than a guess at a network: `<script>` reports `error` for a
 * refused connection but *nothing at all* for a request that hangs, which is
 * exactly what a corporate proxy or a blocked-domain policy produces. Without
 * this the button would spin for ever and F6b would be unreachable in the field
 * even though it is implemented.
 */
export const POSTCODE_LOAD_TIMEOUT_MS = 5_000

/** What the widget hands back, in the shape the address form stores. */
export interface PostcodeSelection {
  readonly postalCode: string
  /**
   * The road or lot address, exactly as the widget wrote it.
   *
   * **Not normalised.** The server does not normalise either (TASK-0111 2장),
   * and a value a person reads back should be the one they were shown.
   */
  readonly addressLine1: string
}

export interface PostcodeSearchOptions {
  /** Where the widget draws itself. Owned by the form, so we control the frame. */
  readonly container: HTMLElement
  readonly onSelect: (selection: PostcodeSelection) => void
  /** The person closed the widget without choosing. */
  readonly onClose: () => void
}

/**
 * Opens the search, or rejects when it cannot be opened at all.
 *
 * A rejection is the fallback's trigger and the only thing the caller has to
 * branch on: whether the script 404'd, timed out or threw is not a difference a
 * shopper can act on.
 */
export type PostcodeSearch = (options: PostcodeSearchOptions) => Promise<void>

/** The slice of the vendor's global this module uses. */
interface DaumPostcodeData {
  readonly zonecode: string
  readonly roadAddress: string
  readonly jibunAddress: string
  /** `'R'` road, `'J'` lot. Which of the two the person picked. */
  readonly userSelectedType?: 'R' | 'J'
}

type DaumPostcodeConstructor = new (options: {
  oncomplete: (data: DaumPostcodeData) => void
  onclose: (state: string) => void
  width: string
  height: string
}) => { embed: (element: HTMLElement, options?: { autoClose?: boolean }) => void }

interface DaumGlobal {
  readonly Postcode?: DaumPostcodeConstructor
}

function daumGlobal(): DaumGlobal | undefined {
  return (globalThis as { daum?: DaumGlobal }).daum
}

/**
 * The in-flight or finished load, so a second click does not fetch it twice.
 *
 * Reset on failure: a person who was offline when they first pressed the button
 * should not be locked into manual entry for the rest of the session.
 */
let loading: Promise<DaumPostcodeConstructor> | null = null

function loadScript(): Promise<DaumPostcodeConstructor> {
  const ready = daumGlobal()?.Postcode
  if (ready !== undefined) return Promise.resolve(ready)

  loading ??= new Promise<DaumPostcodeConstructor>((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(new Error('postcode widget needs a document'))
      return
    }

    const script = document.createElement('script')
    const timer = setTimeout(() => {
      reject(new Error('postcode widget timed out'))
    }, POSTCODE_LOAD_TIMEOUT_MS)

    script.addEventListener('load', () => {
      clearTimeout(timer)
      const constructor = daumGlobal()?.Postcode

      // Loaded but with no global is the same outcome as not loading: a proxy
      // that answers 200 with an error page reaches this branch.
      if (constructor === undefined) reject(new Error('postcode widget did not register'))
      else resolve(constructor)
    })
    script.addEventListener('error', () => {
      clearTimeout(timer)
      reject(new Error('postcode widget failed to load'))
    })

    script.async = true
    script.src = POSTCODE_SCRIPT_URL
    document.head.append(script)
  }).catch((error: unknown) => {
    loading = null
    throw error
  })

  return loading
}

/**
 * The real search, embedded into the form's own container.
 *
 * **Embedded rather than a popup.** A popup would be blocked whenever the click
 * that asked for it is separated from `window.open` by an `await` — which it
 * always is here, because the script is fetched on demand — and a shopper
 * cannot tell a blocked popup from a broken button. Embedding also keeps the
 * widget inside a region this page labels and can close.
 */
export const openPostcodeSearch: PostcodeSearch = async ({ container, onSelect, onClose }) => {
  const Postcode = await loadScript()

  new Postcode({
    oncomplete: (data) => {
      onSelect({
        postalCode: data.zonecode,
        // Whichever of the two the person picked. `roadAddress` is empty for a
        // few rural lots, so the lot address is the fallback rather than a
        // second-class answer.
        addressLine1:
          data.userSelectedType === 'J' ? data.jibunAddress : data.roadAddress || data.jibunAddress,
      })
    },
    onclose: () => {
      onClose()
    },
    width: '100%',
    height: '100%',
  }).embed(container, { autoClose: true })
}
