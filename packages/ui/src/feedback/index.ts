/**
 * Telling somebody that something went wrong (TASK-0117).
 *
 * Its own directory rather than another file under `components/`: what is here
 * is not a control but a *convention* — which failures get a correlation id,
 * which get a sentence and a next step. It is exported through
 * `@shopping/ui/components` all the same, so that `test/story-coverage.spec.ts`
 * keeps seeing it: that check reads the package's public barrels, and a third
 * entry point would have to be registered by hand — which is one forgotten line
 * away from a component shipping outside the accessibility sweep (TASK-0117
 * 4.7 J5).
 */

export { ErrorNotice } from './error-notice'
export type { ErrorNoticeProps } from './error-notice'
