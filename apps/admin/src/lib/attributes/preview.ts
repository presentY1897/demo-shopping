import type { AttributeType, EffectiveAttribute } from '@shopping/shared'
import type { FieldDef, FieldType } from '@shopping/ui/form'

/**
 * The definition that is open in the form but has not been saved.
 *
 * Carried into the preview so an operator sees the result of what they are
 * typing before they commit to it (TASK-0031 4.10). `id` is `null` while the
 * definition is being created and the row's id while it is being edited, which
 * is how the draft knows whether it replaces a row or joins the list.
 */
export interface AttributeDraft {
  readonly id: number | null
  readonly key: string
  readonly label: string
  readonly type: AttributeType
  readonly options: readonly string[]
  readonly isRequired: boolean
  readonly sortOrder: number
}

/** One row of the preview, saved or not. */
export interface PreviewAttribute {
  readonly id: number | null
  readonly key: string
  readonly label: string
  readonly type: AttributeType
  readonly options: readonly string[]
  readonly isRequired: boolean
  readonly inherited: boolean
  readonly sortOrder: number
  /** True for the definition still open in the form. */
  readonly draft: boolean
}

function toRow(attribute: EffectiveAttribute): PreviewAttribute {
  return {
    id: attribute.id,
    key: attribute.key,
    label: attribute.label,
    type: attribute.type,
    options: attribute.options,
    isRequired: attribute.isRequired,
    inherited: attribute.inherited,
    sortOrder: attribute.sortOrder,
    draft: false,
  }
}

function fromDraft(draft: AttributeDraft): PreviewAttribute {
  return {
    id: draft.id,
    key: draft.key,
    label: draft.label,
    type: draft.type,
    options: draft.options,
    isRequired: draft.isRequired,
    inherited: false,
    sortOrder: draft.sortOrder,
    draft: true,
  }
}

/**
 * The definitions a product form would ask about, with the draft folded in.
 *
 * **The API's order is left alone when there is no draft.** The answer already
 * arrives general → specific, resolved for shadowing, and re-sorting it here
 * would be a second opinion on a question the server settled (TASK-0030 4.1).
 *
 * With a draft, only the rows this category owns are re-sorted — inherited ones
 * come from shallower categories and always precede them, whatever their
 * `sortOrder`. Ties break on `key`, so a draft that has not been given an order
 * yet lands somewhere deterministic instead of somewhere that depends on the
 * order the list was built in.
 */
export function previewAttributes(
  attributes: readonly EffectiveAttribute[],
  draft: AttributeDraft | null,
): readonly PreviewAttribute[] {
  const rows = attributes.map(toRow)

  if (draft === null) return rows

  const replacing = draft.id !== null && rows.some((row) => row.id === draft.id && !row.inherited)
  const kept = replacing
    ? rows.map((row) => (row.id === draft.id ? fromDraft(draft) : row))
    : [...rows, fromDraft(draft)]

  const inherited = kept.filter((row) => row.inherited)
  const own = kept
    .filter((row) => !row.inherited)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key))

  return [...inherited, ...own]
}

/**
 * The five attribute types, as the five controls the form generator knows.
 *
 * A `Record` with no default branch: `AttributeType` is a closed enum in the
 * database and in the contract (TASK-0030 7.4), so a sixth type would fail to
 * compile here rather than fall through to a text box.
 */
const FIELD_TYPE_BY_ATTRIBUTE: Readonly<Record<AttributeType, FieldType>> = {
  TEXT: 'text',
  NUMBER: 'number',
  SELECT: 'select',
  MULTI_SELECT: 'multiselect',
  BOOLEAN: 'boolean',
}

/**
 * Definitions as `DynamicForm` wants them.
 *
 * `order` is the row's **position in the list**, not its `sortOrder`. The list
 * is already in the order a form should ask its questions in — inherited first,
 * then the category's own — and `sortOrder` alone cannot express that: a root's
 * 브랜드 and a leaf's 넥라인 are both `0`. Handing over the index makes
 * `resolveFields`' own sort a no-op, which is the point: the ordering decision
 * has one home (TASK-0031 4.10).
 *
 * An option's stored string is both its value and its label. Attribute choices
 * are operator-entered Korean, not codes — there is no second form of them to
 * show.
 */
export function attributeFields(rows: readonly PreviewAttribute[]): readonly FieldDef[] {
  return rows.map((row, index) => ({
    key: row.key,
    label: row.label,
    type: FIELD_TYPE_BY_ATTRIBUTE[row.type],
    options: row.options.map((option) => ({ value: option, label: option })),
    required: row.isRequired,
    order: index,
  }))
}

/**
 * A string that changes whenever the generated form's **shape** changes.
 *
 * `useForm` reads `initialValues` once, so a preview whose field list grew a key
 * would keep a values object that has never heard of it — and a field removed
 * would leave its value behind to be validated forever. Remounting on this
 * signature is what keeps the two in step.
 *
 * Labels and `required` are deliberately not in it: they change what the form
 * *says*, not what it *holds*, and remounting on every keystroke in the label
 * box would throw away whatever the operator had typed into the preview.
 */
export function fieldSignature(fields: readonly FieldDef[]): string {
  return fields.map((field) => `${field.key}:${field.type}`).join('|')
}
