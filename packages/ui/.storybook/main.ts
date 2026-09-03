/**
 * Storybook for `@shopping/ui` (TASK-0104).
 *
 * Scoped to this package and nothing else (R3): no app config is imported, no
 * Next.js plugin is loaded, and the only stylesheet is the shared token preset.
 * A component that renders here therefore renders from the design system alone —
 * if it needs something an app supplies, the story is where that shows up.
 *
 * Stories live in `../stories`, *not* beside the components in `src`. The
 * preset's `@source "../../ui/src"` makes Tailwind scan every file under `src`
 * for class names, so a story kept there would compile its own utilities into
 * all three apps' stylesheets — the bundle regression TASK-0104 F7 forbids.
 * Keeping them outside the scanned tree makes the zero-impact guarantee
 * structural rather than something to remember.
 */

import { fileURLToPath } from 'node:url'

import type { StorybookConfig } from '@storybook/react-vite'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { mergeConfig } from 'vite'

const config: StorybookConfig = {
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },

  stories: ['../stories/**/*.stories.@(ts|tsx)'],

  addons: [
    // Renders the axe report next to the story. The same rule set is asserted
    // in CI by `test/story-a11y.spec.tsx`, which imports the configuration this
    // addon uses from `stories/support/a11y.ts` — one definition, two consumers.
    '@storybook/addon-a11y',
    '@storybook/addon-docs',
  ],

  core: {
    // A design system browsable offline and buildable on a machine with no
    // outbound network. Nothing here needs to phone home.
    disableTelemetry: true,
  },

  viteFinal: (viteConfig) =>
    mergeConfig(viteConfig, {
      plugins: [
        react(),
        // Tailwind v4 is configured in CSS, so the token layer arrives through
        // `.storybook/preview.css` and this plugin compiles it.
        tailwindcss(),
      ],
    }),

  typescript: {
    // Prop tables come from the TypeScript types the components already carry,
    // so a documented prop cannot drift from the implemented one.
    reactDocgen: 'react-docgen-typescript',
    reactDocgenTypescriptOptions: {
      tsconfigPath: fileURLToPath(new URL('../tsconfig.json', import.meta.url)),
      shouldExtractLiteralValuesFromEnum: true,
      shouldRemoveUndefinedFromOptional: true,
      // Radix and React's own DOM prop types would otherwise flood every table.
      propFilter: (prop) => !(prop.parent?.fileName ?? '').includes('node_modules'),
    },
  },
}

export default config
