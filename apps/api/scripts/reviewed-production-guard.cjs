const { createHash } = require('node:crypto')
const { readFileSync } = require('node:fs')

const sha256 = (value) => createHash('sha256').update(value).digest('hex')

// Without a production plan the import may only touch the confirmed local database.
function assertLocalTarget(target) {
  const db = new URL(target)
  if (
    !['localhost', '127.0.0.1'].includes(db.hostname) ||
    db.port !== '5582' ||
    db.pathname !== '/shopping'
  )
    throw Error('Only the confirmed localhost:5582/shopping target is allowed')
}

// A production run pins its target and reviewed inputs; the local guard stays intact.
function validateProductionPlan({ target, plan, exportBytes, mapped, apply, planOnly }) {
  // `--plan-only` skips the public byte check, which production may never skip.
  if (planOnly) throw Error('Production requires public asset verification')
  const db = new URL(target)
  const base = new URL(plan.publicBaseUrl)
  if (
    plan.version !== 1 ||
    !['postgres:', 'postgresql:'].includes(db.protocol) ||
    db.hostname !== plan.databaseHost ||
    db.pathname !== plan.databasePath ||
    !db.hostname.endsWith('.neon.tech') ||
    !['require', 'verify-full'].includes(db.searchParams.get('sslmode')) ||
    plan.bucket !== 'shopping-prod' ||
    base.href !== 'https://cdn.demo-shopping.com/' ||
    sha256(exportBytes) !== plan.exportSha256 ||
    !Array.isArray(mapped.assets) ||
    mapped.assets.length !== plan.assetCount ||
    mapped.assets.some((a) => {
      const url = new URL(a.publicUrl)
      return (
        !a.verified ||
        url.origin !== base.origin ||
        url.search ||
        url.hash ||
        url.username ||
        url.password
      )
    })
  )
    throw Error('Production target or reviewed input does not match pinned plan')
  if (apply && (!plan.backupVerified || !plan.dryRunVerified))
    throw Error('Production apply requires verified backup and dry run')
  if (apply) {
    const backup = readFileSync(plan.backupFile)
    const dryRunBytes = readFileSync(plan.dryRunFile)
    const dryRun = JSON.parse(dryRunBytes)
    if (
      backup.subarray(0, 5).toString() !== 'PGDMP' ||
      sha256(backup) !== plan.backupSha256 ||
      sha256(dryRunBytes) !== plan.dryRunSha256 ||
      dryRun.mode !== 'dry-run' ||
      dryRun.target !== 'confirmed-production' ||
      dryRun.verifiedAssets !== plan.assetCount ||
      dryRun.products.length !== JSON.parse(exportBytes).productCount
    )
      throw Error('Production backup or dry-run evidence does not match pinned plan')
  }
}

module.exports = { assertLocalTarget, validateProductionPlan }
