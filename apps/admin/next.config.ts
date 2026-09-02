import { join } from 'node:path'

import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The lockfile lives at the workspace root; without this Next infers a root
  // from the app directory and warns on every start.
  outputFileTracingRoot: join(import.meta.dirname, '..', '..'),
  // Next would otherwise drop its own AGENTS.md and CLAUDE.md into every app on
  // each start. The repository keeps one CLAUDE.md at the root (CLAUDE.md 4장)
  // and three more competing with it is not an improvement.
  agentRules: false,
}

export default nextConfig
