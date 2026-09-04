import 'reflect-metadata'

import { NestFactory } from '@nestjs/core'

import { AppModule } from '../app.module.js'
import { EnvValidationError } from '../config/env-validation.error.js'
import { loadAppConfig } from '../config/load-app-config.js'
import { SearchIndexerService } from './search-indexer.service.js'

/**
 * `pnpm search:reindex` — rebuilds the whole index (TASK-0038 F5).
 *
 * The same application context the API boots with, for the reason
 * `apps/api/src/seed/run.ts` gives: the rebuild reads through the same query and
 * writes through the same port as the worker, so it cannot disagree with the
 * pipeline about what a document is.
 *
 * It exists as a command because F5b's automatic trigger only fires when the
 * index is **empty**, and the case this is for is different — the index is
 * populated and wrong, because a mapping changed. That is a decision a person
 * makes, so it is a command a person runs.
 */
async function main(): Promise<void> {
  const { config } = await loadAppConfig()
  const app = await NestFactory.createApplicationContext(AppModule.forRoot(config), {
    logger: ['error', 'warn'],
  })

  try {
    const indexer = app.get(SearchIndexerService, { strict: false })
    const startedAt = performance.now()

    console.log('\n검색 인덱스를 다시 만듭니다…\n')

    const written = await indexer.reindexAll()
    const seconds = ((performance.now() - startedAt) / 1_000).toFixed(1)

    console.log(`  ${String(written)}건 색인 · ${seconds}초\n`)
  } finally {
    await app.close()
  }
}

main().catch((error: unknown) => {
  console.error('\n재색인에 실패했습니다.\n')
  console.error(error instanceof EnvValidationError ? error.message : error)
  process.exit(1)
})
