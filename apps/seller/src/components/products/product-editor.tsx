'use client'

import type { AttributeValues, Product, ProductImageInput, ProductStatus } from '@shopping/shared'
import {
  Badge,
  Button,
  EmptyState,
  ErrorNotice,
  Link,
  Skeleton,
  ToastProvider,
  useToast,
} from '@shopping/ui/components'
import { PageHeader } from '@shopping/ui/console'
import type { FieldDef, FieldValue, FormValues, ValidationErrors } from '@shopping/ui/form'
import { serverFieldErrors, validateWithSchema } from '@shopping/ui/form'
import { useCallback, useMemo, useState } from 'react'

import type { ApiFailure } from '@/lib/api-failure'
import { apiFailure, failureMessage, quotableRequestId } from '@/lib/api-failure'
import { errorMessage } from '@/lib/errors'
import { attributeFields, fieldSignature, formValuesFrom } from '@/lib/products/attribute-values'
import type { OptionAxis } from '@/lib/products/combinations'
import { expandCombinations, optionIssues, variantDiff } from '@/lib/products/combinations'
import type { ProductBaseValues } from '@/lib/products/product-form'
import {
  attributeValuesOf,
  baseValuesOf,
  EMPTY_BASE_VALUES,
  productFormSchema,
  productFormValues,
  PRODUCT_BASE_FIELDS,
} from '@/lib/products/product-form'
import { isSellerInactive, isVersionConflict, placementOf } from '@/lib/products/product-failures'
import { createRequestFrom, updateRequestFrom } from '@/lib/products/product-request'
import { useCategories, useCategoryAttributes } from '@/lib/products/use-catalog-taxonomy'
import type { ProductEditorController } from '@/lib/products/use-product-editor'
import { useProductEditor } from '@/lib/products/use-product-editor'
import type { VariantBulk, VariantRow } from '@/lib/products/variant-rows'
import {
  applyBulk,
  axesOf,
  EMPTY_BULK,
  patchRow,
  rowsFor,
  rowsFromProduct,
  storedCombinationsOf,
} from '@/lib/products/variant-rows'
import type { Messages } from '@/messages'
import { messagesFor } from '@/messages'

import { ProductImageField } from './product-image-field'
import type { EditorIntent } from './product-editor-form'
import { ProductEditorForm } from './product-editor-form'
import { ProductDiffNotice } from './product-diff-notice'
import { ProductOptionEditor } from './product-option-editor'
import { VariantTable } from './variant-table'

/**
 * 상품 등록 · 수정 — one screen with two entrances (TASK-0114).
 *
 * `/products/new` and `/products/[id]/edit` are the same editor; what differs
 * is whether there is a listing to load, whether the option **axes** may be
 * added to, and what the primary button says. Splitting them would be the first
 * step towards two forms that answer the same refusals differently.
 *
 * **Three layers, and each one owns a different lifetime.**
 *
 * | | 무엇을 갖고 있나 | 언제 다시 만들어지나 |
 * | --- | --- | --- |
 * | `ProductEditor` | 읽기 상태 · 저장 결과 · 배너 | 절대 (라우트가 살아 있는 동안) |
 * | `ProductEditorBody` | 카테고리 · 옵션 · 표 · 이미지 | 저장이 성공해 `version` 이 올라갈 때 |
 * | `ProductEditorForm` | 폼 값 | 카테고리가 바뀌어 필드 모양이 달라질 때 |
 *
 * The middle one is why the notice survives a save: a banner owned by the form
 * would be thrown away by the very thing it is announcing (the same reasoning
 * `StoreOnboarding` gives).
 *
 * **The four states are the read's own** — 로딩 · 없음 · 에러 · 정상 — and
 * 없음 is not folded into 에러: a 404 here is a stale bookmark, not a failure
 * (P5 · U1).
 */

export interface ProductEditorProps {
  /** `null` on `/products/new`. */
  readonly productId: string | null
  readonly title: string
}

export function ProductEditor({ productId, title }: ProductEditorProps) {
  const messages = messagesFor()

  return (
    <ToastProvider
      closeLabel={messages.products.toast.closeLabel}
      regionLabel={messages.products.toast.regionLabel}
    >
      <ProductEditorScreen messages={messages} productId={productId} title={title} />
    </ToastProvider>
  )
}

/**
 * What the last write did, held above the form it would otherwise be lost with.
 *
 * A successful save is **not** here: it is a toast, because there is nothing
 * left to do about it (4장 — 자리). What stays on screen are the two states a
 * seller still has to act on, and both survive the remount a save causes
 * because they are owned one level up.
 */
type Outcome =
  | { readonly kind: 'idle' }
  /** Somebody saved first. `latest` is for showing and for its `version`. */
  | { readonly kind: 'conflict'; readonly latest: Product }
  /** The store is not approved yet — a 403 nothing on this form can fix. */
  | { readonly kind: 'blocked'; readonly message: string }

function ProductEditorScreen({
  productId,
  title,
  messages,
}: {
  readonly productId: string | null
  readonly title: string
  readonly messages: Messages
}) {
  const copy = messages.products
  const controller = useProductEditor(productId)
  const { state } = controller
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'idle' })

  const reload = useCallback(() => {
    setOutcome({ kind: 'idle' })
    controller.reload()
  }, [controller])

  const product = state.status === 'ready' ? state.product : null
  const description = productId === null ? copy.newDescription : copy.editDescription

  return (
    <>
      <PageHeader
        actions={
          product === null ? null : (
            <Badge variant={product.status === 'ACTIVE' ? 'success' : 'neutral'}>
              {copy.statusLabels[product.status]}
            </Badge>
          )
        }
        description={description}
        title={title}
      />

      {state.status === 'loading' ? (
        <div aria-busy="true" aria-label={copy.loadingLabel} role="status">
          <Skeleton className="h-96 w-full" />
        </div>
      ) : null}

      {state.status === 'missing' ? (
        <EmptyState
          action={
            <Link href="/products" variant="default">
              {copy.missing.listLabel}
            </Link>
          }
          description={copy.missing.body}
          title={copy.missing.title}
        />
      ) : null}

      {state.status === 'error' ? (
        <ReadFailure failure={state.failure} messages={messages} onRetry={controller.reload} />
      ) : null}

      {outcome.kind === 'blocked' ? (
        <p
          className="border-warning bg-warning-surface text-fg rounded-lg border px-4 py-3 text-sm"
          role="alert"
        >
          {outcome.message}
        </p>
      ) : null}

      {outcome.kind === 'conflict' ? (
        <ConflictNotice
          messages={messages}
          onOverwrite={() => {
            setOutcome({ kind: 'idle' })
          }}
          onReload={reload}
        />
      ) : null}

      {state.status === 'blank' || state.status === 'ready' ? (
        <ProductEditorBody
          controller={controller}
          // Remounted when the stored row moves on, which is what a successful
          // save does: the response carries new variant ids and a new version,
          // and a table still holding the old ones would send them back.
          key={product === null ? 'new' : `${product.id}-${String(product.version)}`}
          messages={messages}
          onOutcome={setOutcome}
          outcome={outcome}
          product={product}
          title={title}
        />
      ) : null}
    </>
  )
}

/** The read never answered — not a refusal about the listing. */
function ReadFailure({
  failure,
  messages,
  onRetry,
}: {
  readonly failure: ApiFailure
  readonly messages: Messages
  readonly onRetry: () => void
}) {
  const copy = messages.products.failure
  const requestId = quotableRequestId(failure)

  return (
    <ErrorNotice
      action={
        <div>
          <Button onClick={onRetry} variant="outline">
            {copy.retryLabel}
          </Button>
        </div>
      }
      copiedLabel={copy.copiedLabel}
      copyLabel={copy.copyLabel}
      description={failureMessage(failure, {
        errors: messages.errors,
        failures: messages.apiFailures,
      })}
      requestIdHint={copy.requestIdHint}
      requestIdLabel={copy.requestIdLabel}
      title={copy.title}
      {...(requestId === null ? {} : { requestId })}
    />
  )
}

/** Somebody saved first. Reloading is an offer, never something done for them. */
function ConflictNotice({
  messages,
  onReload,
  onOverwrite,
}: {
  readonly messages: Messages
  readonly onReload: () => void
  readonly onOverwrite: () => void
}) {
  const copy = messages.products.conflict

  return (
    <div
      className="border-warning bg-warning-surface text-fg flex flex-col gap-2 rounded-lg border px-4 py-3 text-sm"
      role="alert"
    >
      <p className="font-medium">{copy.title}</p>
      <p>{copy.body}</p>
      <div className="flex flex-wrap gap-2">
        <Button onClick={onReload} size="sm" variant="primary">
          {copy.reloadLabel}
        </Button>
        <Button onClick={onOverwrite} size="sm" variant="outline">
          {copy.overwriteLabel}
        </Button>
      </div>
    </div>
  )
}

/**
 * The axes cannot be expanded, so there is nothing to save (F9).
 *
 * Refused here rather than by disabling the button: a natively disabled submit
 * blocks the browser's *implicit* submission too, so Enter in a text field
 * would do nothing at all and say nothing about why — the dead end TASK-0018
 * 4.5 refuses and TASK-0109 made the same call. Pressing it meets this guard,
 * which puts the reason above the table the repair is in.
 */
class OptionsRejected extends Error {
  override readonly name = 'OptionsRejected'

  constructor(readonly notice: string) {
    super('the option axes cannot be expanded')
  }
}

/**
 * 판매 시작 refused before the request went out, because a required attribute
 * is still empty (F6).
 *
 * Thrown rather than checked beside the button, so that Enter pressed in a text
 * field meets the same guard a click does — there is one door (TASK-0017 4.2).
 */
class IncompleteForPublish extends Error {
  override readonly name = 'IncompleteForPublish'

  constructor(readonly errors: ValidationErrors) {
    super('a required attribute is empty')
  }
}

/** A refused write, carried to `mapError` as a value it can read. */
class ProductWriteRejection extends Error {
  override readonly name = 'ProductWriteRejection'

  constructor(readonly failure: ApiFailure) {
    super('the product write was refused')
  }
}

/** The attribute values a form instance starts from, in whichever shape is held. */
type AttributeSeed =
  /** Straight from the server, keyed by definition key. */
  | { readonly kind: 'stored'; readonly values: AttributeValues }
  /** What the previous form instance held, keyed by field name. */
  | { readonly kind: 'typed'; readonly values: Readonly<Record<string, FieldValue>> }

function ProductEditorBody({
  product,
  controller,
  messages,
  outcome,
  onOutcome,
  title,
}: {
  readonly product: Product | null
  readonly controller: ProductEditorController
  readonly messages: Messages
  readonly outcome: Outcome
  readonly onOutcome: (outcome: Outcome) => void
  readonly title: string
}) {
  const copy = messages.products
  const { toast } = useToast()

  const [categoryId, setCategoryId] = useState<number | null>(product?.categoryId ?? null)
  const [axes, setAxes] = useState<readonly OptionAxis[]>(product === null ? [] : axesOf(product))
  const [rows, setRows] = useState<readonly VariantRow[]>(
    product === null ? rowsFor([], []) : rowsFromProduct(product),
  )
  const [bulk, setBulk] = useState<VariantBulk>(EMPTY_BULK)
  const [images, setImages] = useState<readonly ProductImageInput[]>(
    product?.images.map((image) => ({
      url: image.url,
      ...(image.alt === null ? {} : { alt: image.alt }),
    })) ?? [],
  )
  const [base, setBase] = useState<ProductBaseValues>(
    product === null
      ? EMPTY_BASE_VALUES
      : {
          name: product.name,
          description: product.description ?? '',
          maxPurchaseQuantity:
            product.maxPurchaseQuantity === null ? '' : String(product.maxPurchaseQuantity),
        },
  )
  const [seed, setSeed] = useState<AttributeSeed>({
    kind: 'stored',
    values: product?.attributes ?? {},
  })
  /** A refusal whose repair is inside the option or variant table (4장). */
  const [tableNotice, setTableNotice] = useState<string | null>(null)

  const categories = useCategories()
  const attributes = useCategoryAttributes(categoryId)

  const fields = useMemo<readonly FieldDef[]>(
    () => (attributes.state.status === 'ready' ? attributeFields(attributes.state.data) : []),
    [attributes.state],
  )

  const initialValues = useMemo<FormValues>(
    () =>
      productFormValues(
        base,
        seed.kind === 'stored' ? formValuesFrom(seed.values, fields) : seed.values,
        fields,
      ),
    [base, seed, fields],
  )

  /**
   * The paths a message may be placed on.
   *
   * The image entries are generated from the gallery's own length because the
   * server names them by position (`images.1.url`) and there is no control to
   * hang them off — the widget owns its rows. Naming them here is what lets
   * `serverFieldErrors` place them rather than push them to the form level.
   */
  const formFields = useMemo(
    () => [
      ...PRODUCT_BASE_FIELDS,
      ...fields.map((field) => field.key),
      ...images.map((_unused, index) => `images.${String(index)}.url`),
    ],
    [fields, images],
  )

  const issues = useMemo(() => optionIssues(axes), [axes])
  const combinations = useMemo(() => expandCombinations(axes), [axes])
  const diff = useMemo(
    () => (product === null ? null : variantDiff(storedCombinationsOf(product), combinations)),
    [product, combinations],
  )

  /** A row changes; every other row keeps its object, so `memo` skips it (F10). */
  const changeRow = useCallback((key: string, patch: Partial<VariantRow>) => {
    setRows((current) => patchRow(current, key, patch))
  }, [])

  const applyBulkValue = useCallback((field: keyof VariantBulk, value: string) => {
    setRows((current) => applyBulk(current, field, value))
  }, [])

  const changeAxes = useCallback((next: readonly OptionAxis[]) => {
    setAxes(next)
    setRows((current) => rowsFor(next, current))
  }, [])

  const changeCategory = useCallback((next: number, values: FormValues) => {
    // Captured **before** the new definitions arrive, because this is the only
    // moment the outgoing instance's values are reachable. What survives the
    // change is decided later, against the fields that turn up (F2).
    setBase(baseValuesOf(values))
    setSeed({ kind: 'typed', values: attributeValuesOf(values) })
    setCategoryId(next)
  }, [])

  /**
   * Turns a refused save into messages, in the place that refusal belongs
   * (TASK-0114 4장).
   *
   * The placement is decided first and by a pure function, so the four
   * destinations are a table rather than a chain of conditions in a component.
   * What is left here is doing what each one means.
   */
  const mapError = useCallback(
    (error: unknown): ValidationErrors | undefined => {
      // Refused here rather than by the API, so there is no envelope to read
      // and the messages are already placed.
      if (error instanceof IncompleteForPublish) return error.errors

      if (error instanceof OptionsRejected) {
        setTableNotice(error.notice)
        return { fieldErrors: {}, formErrors: [] }
      }

      const failure = error instanceof ProductWriteRejection ? error.failure : apiFailure(error)
      const message = failureMessage(failure, {
        errors: messages.errors,
        failures: messages.apiFailures,
      })

      setTableNotice(null)

      switch (placementOf(failure, formFields)) {
        case 'banner':
          if (isSellerInactive(failure)) onOutcome({ kind: 'blocked', message })
          // A conflict has already been turned into an outcome by the submit
          // handler, which has the reloaded listing the banner offers.
          return { fieldErrors: {}, formErrors: [] }

        case 'table':
          setTableNotice(message)
          return { fieldErrors: {}, formErrors: [] }

        case 'fields':
          return serverFieldErrors(failure.kind === 'http' ? failure.details : [], {
            fields: formFields,
            fallbackMessage: message,
            // The catalog first, keyed by code; the server's own sentence only
            // for a code this console has never heard of.
            messageForCode: (code) => errorMessage(messages.errors, code),
          })

        default:
          toast({ title: copy.toast.failureTitle, description: message, variant: 'danger' })
          return { fieldErrors: {}, formErrors: [] }
      }
    },
    [copy.toast.failureTitle, formFields, messages.apiFailures, messages.errors, onOutcome, toast],
  )

  /**
   * What the version a save is written against.
   *
   * The conflict's `latest` wins once there has been one: 그대로 저장 means
   * "write mine on top of what is there now", and re-sending the version that
   * was already refused would only be refused again.
   */
  const version = outcome.kind === 'conflict' ? outcome.latest.version : (product?.version ?? 0)

  const strictSchema = useMemo(
    () =>
      productFormSchema(
        fields,
        { base: copy.basics.errors, attributes: copy.attributes.errors },
        { requireAttributes: true },
      ),
    [copy.attributes.errors, copy.basics.errors, fields],
  )

  const submit = useCallback(
    async (values: FormValues, intent: EditorIntent): Promise<void> => {
      if (categoryId === null) {
        throw new ProductWriteRejection({ kind: 'transport', reason: 'unknown' })
      }

      const [firstIssue] = optionIssues(axes)

      if (firstIssue !== undefined) throw new OptionsRejected(copy.options.issues[firstIssue.code])

      // 임시저장 and 판매 시작 are validated differently, because the server
      // validates them differently (TASK-0113 4장): a draft may be unfinished
      // and a listing a buyer can see may not. The form itself holds the draft
      // rules, so nothing is ever blocked from being saved; this is the extra
      // pass 판매 시작 gets, and it names the very fields the server would.
      if (intent === 'publish') {
        const strict = validateWithSchema(strictSchema, values)

        if (!strict.success) {
          throw new IncompleteForPublish({
            fieldErrors: strict.fieldErrors,
            formErrors: strict.formErrors,
          })
        }
      }

      const submission = { values, fields, categoryId, axes, rows, bulk, images }
      const status = statusFor(intent, product?.status ?? null)

      const result =
        product === null
          ? await controller.create(createRequestFrom(submission, status))
          : await controller.save(product.id, updateRequestFrom(submission, version, status))

      if (result.ok) {
        setTableNotice(null)
        onOutcome({ kind: 'idle' })
        toast({ title: noticeFor(intent, messages), variant: 'success' })
        return
      }
      // A lost optimistic lock is not a field error: `version` is not an input,
      // and the answer is a choice rather than a correction.
      if (isVersionConflict(result.failure) && result.conflict !== undefined) {
        onOutcome({ kind: 'conflict', latest: result.conflict })
        return
      }

      throw new ProductWriteRejection(result.failure)
    },
    [
      axes,
      bulk,
      categoryId,
      controller,
      copy.options.issues,
      fields,
      images,
      messages,
      onOutcome,
      product,
      rows,
      strictSchema,
      toast,
      version,
    ],
  )

  /**
   * The form waits for the definitions before it is mounted at all.
   *
   * `useForm` reads `initialValues` once, so the instance has to be replaced
   * when the generated shape moves — and the shape moves as soon as
   * `GET /attributes` answers. Rendering the form before then would mount an
   * instance with no attribute fields and replace it a tick later, which throws
   * away anything typed into 상품명 in between and leaves a half-built form on
   * screen while the answer is in flight.
   *
   * So the wait is drawn instead, which is also the more honest thing to say:
   * what a category asks for is not known yet (P5).
   */
  if (categoryId !== null && attributes.state.status === 'loading') {
    return (
      <div aria-busy="true" aria-label={copy.attributes.loadingLabel} role="status">
        <Skeleton className="h-96 w-full" />
      </div>
    )
  }

  return (
    <ProductEditorForm
      attributes={
        attributes.state.status === 'ready' ? { status: 'ready', data: fields } : attributes.state
      }
      axes={axes}
      categories={categories.state}
      categoryId={categoryId}
      fields={fields}
      images={images}
      initialValues={initialValues}
      // `useForm` reads `initialValues` once, so the instance is replaced when
      // the generated shape moves — and only then (F2).
      key={fieldSignature(fields)}
      mapError={mapError}
      messages={messages}
      onAttributesRetry={attributes.reload}
      onCategoriesRetry={categories.reload}
      onCategoryChange={changeCategory}
      onSubmit={submit}
      rows={rows}
      status={product?.status ?? null}
      title={title}
    >
      <ProductImageField
        messages={messages}
        onChange={setImages}
        sellerId={product?.sellerId ?? null}
        stored={product?.images ?? []}
      />

      <ProductOptionEditor
        axes={axes}
        axesLocked={product !== null}
        issues={issues}
        messages={copy.options}
        onChange={changeAxes}
      />

      {diff === null ? null : <ProductDiffNotice diff={diff} messages={copy.diff} />}

      <VariantTable
        bulk={bulk}
        messages={copy.variants}
        notice={tableNotice}
        onBulkApply={applyBulkValue}
        onBulkChange={setBulk}
        onRowChange={changeRow}
        rows={rows}
      />
    </ProductEditorForm>
  )
}

/**
 * The status a save is written at.
 *
 * The editor always has a complete body, so the status rides on the save rather
 * than being flipped by a second request. `POST /products/:id/publish` does the
 * very same thing server-side — it delegates to `update` — and using it here
 * would mean either discarding the edits on screen or splitting one intention
 * into two requests that can half succeed. The dedicated endpoints belong to a
 * screen that flips the switch with nothing to save (TASK-0116).
 */
function statusFor(intent: EditorIntent, stored: ProductStatus | null): ProductStatus {
  switch (intent) {
    case 'publish':
      return 'ACTIVE'
    case 'unpublish':
      // `DRAFT` and not `INACTIVE`: 판매 중지 from the editor is the seller
      // reopening what they are working on (TASK-0113 4장).
      return 'DRAFT'
    case 'draft':
      return 'DRAFT'
    default:
      return stored ?? 'DRAFT'
  }
}

function noticeFor(intent: EditorIntent, messages: Messages): string {
  const copy = messages.products.actions

  switch (intent) {
    case 'publish':
      return copy.publishedNotice
    case 'unpublish':
      return copy.unpublishedNotice
    case 'draft':
      return copy.createdNotice
    default:
      return copy.savedNotice
  }
}
