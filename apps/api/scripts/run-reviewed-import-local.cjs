// Derive the confirmed original DB from local preview config without logging credentials.
require('reflect-metadata')
const { loadAppConfig } = require('../dist/config/load-app-config.js')
;(async () => {
  const { config } = await loadAppConfig()
  const url = new URL(config.database.url)
  if (
    !['localhost', '127.0.0.1'].includes(url.hostname) ||
    url.port !== '5582' ||
    url.pathname !== '/shopping_image_preview'
  )
    throw new Error('Expected local preview source configuration')
  url.pathname = '/shopping'
  process.env.IMPORT_TARGET_DATABASE_URL = url.href
  require('./import-reviewed-products.cjs')
})().catch(() => {
  console.error('Local target configuration failed; details suppressed')
  process.exitCode = 1
})
