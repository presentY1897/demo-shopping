/**
 * Class-name concatenation, and nothing else.
 *
 * Deliberately not `clsx`: a component library that lists a runtime dependency
 * for six lines makes every consuming app pay a resolution step for it, and
 * `packages/ui` keeps its dependency list to the things it genuinely cannot
 * write itself (the Radix behaviours). Objects and nested arrays are not
 * supported because no component here needs them.
 */

export type ClassValue = string | false | null | undefined

export function cx(...values: readonly ClassValue[]): string {
  return values.filter((value) => typeof value === 'string' && value !== '').join(' ')
}
