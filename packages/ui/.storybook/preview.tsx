/**
 * Global story configuration.
 *
 * The density toolbar is the reason this project has a Storybook at all
 * (TASK-0104 1장): the same component is three different shapes depending on the
 * step the shopper picked, and a static screenshot of one of them is not the
 * design system.
 */

import type { Decorator, Preview } from '@storybook/react-vite'
import type { ReactNode } from 'react'
import { useEffect } from 'react'

import {
  DEFAULT_DENSITY,
  DENSITY_ATTRIBUTE,
  DENSITY_LEVELS,
  parseDensityLevel,
  type DensityLevel,
} from '../src/density/density'
import { axeRunOptions, axeSpec } from '../stories/support/a11y'

import './preview.css'

/** Labels for the toolbar. English, because Storybook's own chrome is. */
const DENSITY_TITLES: Readonly<Record<DensityLevel, string>> = {
  1: '1 · minimal',
  2: '2 · standard',
  3: '3 · maximal',
}

/**
 * Applies the selected step to the story document.
 *
 * Written to `<html>` rather than to a wrapper element, for the reason the
 * component gallery discovered first: modals, drawers, tooltips and toasts
 * render through a portal into `<body>`, so a wrapper would leave exactly the
 * components most likely to break on the page's own density. Every token that
 * scales is declared `inline` (see `tokens.css`), so a nested `data-density`
 * scope inside a story — the three-up comparison on the density page — still
 * resolves against its own step.
 */
function DensityScope({
  density,
  children,
}: {
  readonly density: DensityLevel
  readonly children: ReactNode
}) {
  useEffect(() => {
    document.documentElement.setAttribute(DENSITY_ATTRIBUTE, String(density))
  }, [density])

  return <>{children}</>
}

const withDensity: Decorator = (Story, context) => (
  <DensityScope density={parseDensityLevel(context.globals.density) ?? DEFAULT_DENSITY}>
    <Story />
  </DensityScope>
)

const preview: Preview = {
  decorators: [withDensity],

  initialGlobals: {
    density: String(DEFAULT_DENSITY),
  },

  globalTypes: {
    density: {
      description: 'Display density — sets data-density on the story document',
      toolbar: {
        title: 'Density',
        icon: 'grid',
        dynamicTitle: true,
        items: DENSITY_LEVELS.map((level) => ({
          value: String(level),
          title: DENSITY_TITLES[level],
        })),
      },
    },
  },

  parameters: {
    a11y: {
      config: axeSpec,
      options: axeRunOptions,
    },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    options: {
      // Design tokens first: the documentation is the thing this Storybook is
      // for (D-206), and the component list is what it is evidence about.
      storySort: {
        order: ['Design tokens', 'Components'],
      },
    },
  },
}

export default preview
