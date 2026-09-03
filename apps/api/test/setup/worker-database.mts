import { resolveDatabaseUrl } from '../../src/config/database-url.js'
import { currentPoolId, withDatabase, workerDatabaseName } from './test-databases.js'

/**
 * Points this worker at its own database.
 *
 * A setup file rather than something each spec opts into: `DATABASE_URL` is the
 * variable the API, the Prisma CLI and the harness all read, so overwriting it
 * here means nothing inside a test can reach the development database by
 * accident — including code that resolves the URL for itself.
 *
 * The database was created by `global-setup.ts`; this only computes its name.
 */
process.env.DATABASE_URL = withDatabase(
  await resolveDatabaseUrl(),
  workerDatabaseName(currentPoolId()),
)
