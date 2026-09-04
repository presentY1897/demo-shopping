import type { AttributeType } from '@shopping/shared'
import {
  attributeKeySchema,
  attributeLabelSchema,
  attributeOptionSchema,
  attributeTypes,
} from '@shopping/shared'
import { z } from 'zod'

import type { AttributeFormMessages } from '@/messages'

import type { OptionProblem } from './options'
import { optionProblems } from './options'

/** What the add/edit form holds while it is being filled in. */
export interface AttributeFormValues {
  readonly key: string
  readonly label: string
  readonly type: AttributeType
  readonly options: readonly string[]
  readonly isRequired: boolean
  readonly isFilterable: boolean
}

/**
 * The form's schema: the contract's rules, wearing the console's words.
 *
 * `useForm` validates with one zod schema, and the schema `apps/api` parses the
 * request with cannot be that schema directly — its messages are the server's,
 * and the server's vocabulary is the implementation's (`SELECT`, `key`). So the
 * **predicates** are taken from `packages/shared` and only the sentences are
 * this app's (TASK-0031 4.5). A rule that changes there changes here, which is
 * what gate C1 asks for; a rule stated twice would not be.
 *
 * The option rules are the exception and they are the reason
 * `attribute-options.spec.ts` exists: they need one message per broken rule and
 * `optionIssues` only offers its own sentences, so the predicates are restated
 * in `optionProblems` and a test holds the two to the same verdict.
 */
export function attributeFormSchema(copy: AttributeFormMessages['errors']) {
  const optionMessages: Readonly<Record<OptionProblem, string>> = {
    required: copy.optionsRequired,
    forbidden: copy.optionsForbidden,
    duplicate: copy.optionsDuplicate,
  }

  return z
    .object({
      key: z
        .string()
        .trim()
        .min(1, copy.keyRequired)
        .refine((value) => attributeKeySchema.safeParse(value).success, copy.keyFormat),
      label: z
        .string()
        .trim()
        .min(1, copy.labelRequired)
        .refine((value) => attributeLabelSchema.safeParse(value).success, copy.labelTooLong),
      // The five values come from the contract; only the message is ours. An
      // unchosen type arrives as `''`, which is not one of them.
      type: z.enum(attributeTypes, { error: () => copy.typeRequired }),
      options: z.array(z.string().trim()),
      isRequired: z.boolean(),
      isFilterable: z.boolean(),
    })
    .check((ctx) => {
      const { type, options } = ctx.value
      const push = (message: string): void => {
        ctx.issues.push({ code: 'custom', input: ctx.value, message, path: ['options'] })
      }

      for (const problem of optionProblems(type, options)) push(optionMessages[problem])

      // Per-choice length, reported against the group rather than the one input.
      // The editor shows one message under the list, because a person fixing a
      // 41-character choice is looking at the list, not hunting for which row
      // the schema meant.
      if (options.some((option) => !attributeOptionSchema.safeParse(option).success)) {
        push(copy.optionInvalid)
      }
    })
}

/** The blank form for a new definition on `type`-less ground. */
export const EMPTY_FORM_VALUES: Readonly<Record<string, unknown>> = {
  key: '',
  label: '',
  type: '',
  options: [],
  isRequired: false,
  isFilterable: false,
}
