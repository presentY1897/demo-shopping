// Configuration for the Prisma CLI (`db:migrate`, `db:reset`, `db:studio`, …).
//
// Prisma 7 no longer reads `.env` on its own and no longer takes the URL from
// `schema.prisma`, which turns out to be exactly what this repository needs:
// `DATABASE_URL` is normally *derived* from the worktree's `PORT_OFFSET` and is
// absent from `.env` (writing it there would pin it and disable the derivation —
// see `scripts/infra.mjs`). Resolving it here with the very code the API runs at
// boot is what keeps a migration and the running process pointed at the same
// database.
//
// `.mts` rather than `.ts`: the resolution is async, and this package is
// `type: commonjs`, where a top level await is not allowed.

import { defineConfig } from 'prisma/config'

import { resolveDatabaseUrl } from './src/config/database-url.js'

const databaseUrl = await resolveDatabaseUrl()

// `prisma db seed` spawns the command below as a child process, which inherits
// this environment but not this module. Publishing the resolved URL here is what
// keeps the seed pointed at the database the migrations just ran against.
process.env.DATABASE_URL = databaseUrl

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'node prisma/seed.mts',
  },
  datasource: {
    url: databaseUrl,
  },
})
