'use client'

import type { ProductStatus } from '@shopping/shared'
import {
  Button,
  EmptyState,
  ErrorState,
  Input,
  Select,
  Skeleton,
  Textarea,
} from '@shopping/ui/components'
import type { FieldDef, FormValues, ValidationErrors } from '@shopping/ui/form'
import { DynamicForm, Form, FormError, FormField, useForm } from '@shopping/ui/form'
import type { ReactNode } from 'react'
import { useId, useMemo, useRef, useState } from 'react'

import type { OptionAxis } from '@/lib/products/combinations'
import { productFormSchema } from '@/lib/products/product-form'
import type { CategoryChoice, TaxonomyState } from '@/lib/products/use-catalog-taxonomy'
import type { VariantRow } from '@/lib/products/variant-rows'
import type { Messages } from '@/messages'

import { ProductPreview } from './product-preview'

/**
 * The form itself: 기본 정보, the generated attribute fields, whatever the
 * editor puts between them, and the actions (TASK-0114 4장).
 *
 * **One `useForm` and one `<Form>`.** The base fields and the generated ones
 * are one object validated by one schema, because there is one submit and a
 * screen with two of either cannot say which refused (TASK-0017 4.2). Enter
 * pressed in the 상품명 box therefore meets the same guard a click on 저장 does.
 *
 * **Remounted when the generated shape changes, never otherwise.** `useForm`
 * reads `initialValues` once, so a form whose field list grew a key would hold
 * values that have never heard of it. The caller supplies the `key` and the
 * carried-over values; what this component owes back is
 * {@link ProductEditorFormProps.onCategoryChange} — the values as they stand at
 * the moment the category moves, which is the only moment they can be captured
 * without watching every keystroke from outside.
 *
 * **The sections the editor owns are `children`.** They are created by the
 * parent's render, so typing in a price cell does not re-render the attribute
 * fields and typing in 상품명 does not re-render two hundred table rows (F10).
 */

/** A form value as text. `values` is `unknown`-valued, so this is the narrowing. */
function textOf(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** Which button was pressed. Each one means a different status to save at. */
export type EditorIntent = 'draft' | 'save' | 'publish' | 'unpublish'

export interface ProductEditorFormProps {
  readonly fields: readonly FieldDef[]
  readonly initialValues: FormValues
  readonly messages: Messages
  /** Names the form for a screen reader, so it is not an unlabelled region. */
  readonly title: string
  readonly categoryId: number | null
  readonly categories: TaxonomyState<readonly CategoryChoice[]>
  readonly onCategoriesRetry: () => void
  /** Carries the values out so the remounted instance can start from them. */
  readonly onCategoryChange: (categoryId: number, values: FormValues) => void
  readonly attributes: TaxonomyState<readonly FieldDef[]>
  readonly onAttributesRetry: () => void
  /** `null` while creating; the stored status while editing. */
  readonly status: ProductStatus | null
  readonly onSubmit: (values: FormValues, intent: EditorIntent) => Promise<void>
  readonly mapError: (error: unknown) => ValidationErrors | undefined
  /** For the preview, which needs the form's own values as well as these. */
  readonly axes: readonly OptionAxis[]
  readonly rows: readonly VariantRow[]
  readonly images: readonly { readonly url: string; readonly alt?: string }[]
  readonly children: ReactNode
}

export function ProductEditorForm({
  fields,
  initialValues,
  messages,
  title,
  categoryId,
  categories,
  onCategoriesRetry,
  onCategoryChange,
  attributes,
  onAttributesRetry,
  status,
  onSubmit,
  mapError,
  axes,
  rows,
  images,
  children,
}: ProductEditorFormProps) {
  const copy = messages.products
  const [previewOpen, setPreviewOpen] = useState(false)

  /**
   * Which button was pressed, as a ref.
   *
   * State would be read stale: a click handler that calls `setIntent` and then
   * submits sees the previous value inside `onSubmit`, because React has not
   * re-rendered yet. This is written and read on events only, never during a
   * render.
   */
  const intent = useRef<EditorIntent>('save')

  const schema = useMemo(
    () =>
      productFormSchema(fields, { base: copy.basics.errors, attributes: copy.attributes.errors }),
    [fields, copy.basics.errors, copy.attributes.errors],
  )

  const form = useForm({
    schema,
    initialValues,
    mapError,
    submitErrorMessage: copy.actions.submitFailed,
    onSubmit: (values) => onSubmit(values as FormValues, intent.current),
  })

  const imageErrors = Object.entries(form.fieldErrors)
    .filter(([field]) => field.startsWith('images.'))
    .map(([, message]) => message)

  return (
    <>
      <Form aria-label={title} className="max-w-5xl" form={form}>
        <FormError errors={form.formErrors} title={copy.actions.errorTitle} />

        <BasicFields
          categories={categories}
          categoryId={categoryId}
          form={form}
          messages={messages}
          onCategoriesRetry={onCategoriesRetry}
          onCategoryChange={(next) => {
            onCategoryChange(next, form.values)
          }}
        />

        <AttributeSection
          attributes={attributes}
          form={form}
          messages={messages}
          onRetry={onAttributesRetry}
        />

        {imageErrors.length === 0 ? null : (
          <ul className="flex flex-col gap-1" role="alert">
            {imageErrors.map((message, index) => (
              <li className="text-danger text-sm" key={index}>
                {message}
              </li>
            ))}
          </ul>
        )}

        {children}

        <div className="flex flex-wrap gap-2">
          <Button
            loading={form.submitting}
            onClick={() => {
              intent.current = status === null ? 'draft' : 'save'
            }}
            type="submit"
            variant="outline"
          >
            {status === null ? copy.actions.saveDraftLabel : copy.actions.saveLabel}
          </Button>

          {status === 'ACTIVE' ? (
            <Button
              loading={form.submitting}
              onClick={() => {
                intent.current = 'unpublish'
              }}
              type="submit"
              variant="outline"
            >
              {copy.actions.unpublishLabel}
            </Button>
          ) : (
            <Button
              loading={form.submitting}
              onClick={() => {
                intent.current = 'publish'
              }}
              type="submit"
              variant="primary"
            >
              {copy.actions.publishLabel}
            </Button>
          )}

          <Button
            onClick={() => {
              setPreviewOpen(true)
            }}
            type="button"
            variant="ghost"
          >
            {copy.preview.openLabel}
          </Button>
        </div>

        <p className="text-fg-muted text-sm">{copy.actions.draftNotice}</p>
      </Form>

      <ProductPreview
        axes={axes}
        description={textOf(form.values.description)}
        fields={fields}
        images={images}
        messages={copy.preview}
        name={textOf(form.values.name)}
        onOpenChange={setPreviewOpen}
        open={previewOpen}
        rows={rows}
        values={form.values}
      />
    </>
  )
}

/** 이름 · 설명 · 카테고리 · 1회 최대 구매 수량. */
function BasicFields({
  form,
  messages,
  categoryId,
  categories,
  onCategoryChange,
  onCategoriesRetry,
}: {
  readonly form: ReturnType<typeof useForm>
  readonly messages: Messages
  readonly categoryId: number | null
  readonly categories: TaxonomyState<readonly CategoryChoice[]>
  readonly onCategoryChange: (categoryId: number) => void
  readonly onCategoriesRetry: () => void
}) {
  const copy = messages.products.basics
  const headingId = useId()
  const labelId = useId()

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4">
      <h2 className="text-fg text-base font-medium" id={headingId}>
        {copy.title}
      </h2>

      <FormField form={form} hint={copy.nameHint} label={copy.nameLabel} name="name" required>
        <Input {...form.text('name')} autoComplete="off" />
      </FormField>

      <FormField
        form={form}
        hint={copy.descriptionHint}
        label={copy.descriptionLabel}
        name="description"
      >
        <Textarea {...form.text('description')} rows={5} />
      </FormField>

      <div className="flex flex-col gap-1">
        <span className="text-fg-muted text-sm" id={labelId}>
          {copy.categoryLabel}
        </span>

        {categories.status === 'loading' ? (
          <div aria-busy="true" aria-label={copy.categoryLoadingLabel} role="status">
            <Skeleton className="h-10 w-full max-w-md" />
          </div>
        ) : null}

        {categories.status === 'error' ? (
          <ErrorState
            action={
              <Button onClick={onCategoriesRetry} variant="outline">
                {copy.categoryRetryLabel}
              </Button>
            }
            description={copy.categoryFailure}
            title={copy.categoryFailure}
          />
        ) : null}

        {categories.status === 'ready' ? (
          <Select
            aria-describedby={`${labelId}-hint`}
            aria-labelledby={labelId}
            onValueChange={(next) => {
              onCategoryChange(Number(next))
            }}
            options={categories.data.map((choice) => ({
              value: String(choice.id),
              label: choice.path.join(copy.categorySeparator),
            }))}
            placeholder={copy.categoryPlaceholder}
            value={categoryId === null ? undefined : String(categoryId)}
          />
        ) : null}

        <p className="text-fg-subtle text-xs" id={`${labelId}-hint`}>
          {copy.categoryHint}
        </p>
      </div>

      <FormField
        form={form}
        hint={copy.purchaseLimitHint}
        label={copy.purchaseLimitLabel}
        name="maxPurchaseQuantity"
      >
        <Input {...form.text('maxPurchaseQuantity')} inputMode="numeric" type="number" />
      </FormField>
    </section>
  )
}

/**
 * The generated half — the questions this category asks (F1).
 *
 * `DynamicForm` is TASK-0017's renderer and `schemaForFields` its validator, so
 * the seller is asked exactly what the attribute console's preview shows and
 * exactly what the server will check (TASK-0031 R1).
 */
function AttributeSection({
  attributes,
  form,
  messages,
  onRetry,
}: {
  readonly attributes: TaxonomyState<readonly FieldDef[]>
  readonly form: ReturnType<typeof useForm>
  readonly messages: Messages
  readonly onRetry: () => void
}) {
  const copy = messages.products.attributes
  const headingId = useId()

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <div>
        <h2 className="text-fg text-base font-medium" id={headingId}>
          {copy.title}
        </h2>
        <p className="text-fg-muted mt-1 text-sm">{copy.description}</p>
      </div>

      {attributes.status === 'loading' ? (
        <div aria-busy="true" aria-label={copy.loadingLabel} role="status">
          <Skeleton className="h-32 w-full max-w-md" />
        </div>
      ) : null}

      {attributes.status === 'error' ? (
        <ErrorState
          action={
            <Button onClick={onRetry} variant="outline">
              {copy.retryLabel}
            </Button>
          }
          description={copy.failureTitle}
          title={copy.failureTitle}
        />
      ) : null}

      {attributes.status === 'ready' && attributes.data.length === 0 ? (
        <EmptyState description={copy.emptyBody} title={copy.emptyTitle} />
      ) : null}

      {attributes.status === 'ready' && attributes.data.length > 0 ? (
        <DynamicForm fields={attributes.data} form={form} />
      ) : null}
    </section>
  )
}
