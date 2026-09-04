/**
 * Picking images and showing what is happening to them (TASK-0033).
 *
 * Its own directory rather than more files under `components/`, and for the same
 * reason `feedback/` is one: what is here is a *pair* — a drop zone and the
 * gallery it fills — and neither is useful without the convention the other
 * carries (order is the model, dropping is an addition to a real control).
 *
 * Exported through `@shopping/ui/components` all the same, so that
 * `test/story-coverage.spec.ts` keeps seeing it: that check reads the package's
 * public barrels, and a fourth entry point would have to be registered by hand —
 * one forgotten line away from a component shipping outside the accessibility
 * sweep.
 */

export { ImageDropZone } from './image-drop-zone'
export type { ImageDropZoneProps } from './image-drop-zone'

export { ImageUploadList, IMAGE_UPLOAD_STATUSES } from './image-upload-list'
export type {
  ImageUploadItem,
  ImageUploadListLabels,
  ImageUploadListProps,
  ImageUploadStatus,
} from './image-upload-list'
