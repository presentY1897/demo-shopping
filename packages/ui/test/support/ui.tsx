/**
 * Helpers shared by the component specs.
 *
 * Interaction tests only — QUALITY-GATES is explicit that a UI test renders and
 * then *does* something ("마크업이나 클래스명을 검증하지 않는다"), so nothing
 * here helps assert on markup.
 */

import { render, type RenderResult } from '@testing-library/react'
import userEvent, { PointerEventsCheckLevel, type UserEvent } from '@testing-library/user-event'
import type { ReactElement } from 'react'

import { DENSITY_ATTRIBUTE, type DensityLevel } from '../../src/density/density'

/**
 * A user-event session with the pointer-events guard switched off.
 *
 * Radix sets `pointer-events: none` on `<body>` while a dialog is open so that
 * the page behind it is inert. In a real browser the dialog itself sits in a
 * portal that re-enables them; jsdom does no layout and user-event's guard reads
 * only the inherited style, so it would refuse to click the dialog's own close
 * button. The guard protects against clicking something a real user could not
 * reach — which is not what is happening here.
 */
export function setupUser(): UserEvent {
  return userEvent.setup({ pointerEventsCheck: PointerEventsCheckLevel.Never })
}

/**
 * Renders with a density step applied to `<html>`, where `density.css` reads it.
 *
 * The attribute goes on the document element rather than a wrapper because
 * overlays portal into `<body>`: a wrapper would leave every dialog on the
 * default step and the three-step check would skip the components most likely
 * to break.
 */
export function renderAtDensity(density: DensityLevel, ui: ReactElement): RenderResult {
  document.documentElement.setAttribute(DENSITY_ATTRIBUTE, String(density))
  return render(ui)
}

/** Puts `<html>` back the way it was found. Call from an `afterEach`. */
export function resetDensity(): void {
  document.documentElement.removeAttribute(DENSITY_ATTRIBUTE)
}
