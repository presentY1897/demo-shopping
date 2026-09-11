const { spawn, execFileSync } = require('node:child_process')
const { createConnection } = require('node:net')
const { randomBytes } = require('node:crypto')
const { writeFileSync } = require('node:fs')
const { once } = require('node:events')
const root = process.cwd()
const port = 4181
const env = {
  ...process.env,
  NODE_ENV: 'production',
  API_HOST: '127.0.0.1',
  API_PORT: String(port),
  DATABASE_URL: 'postgresql://shopping:shopping@127.0.0.1:5612/shopping',
  MEILI_HOST: 'http://127.0.0.1:7870',
  MEILI_MASTER_KEY: 'local_dev_master_key_change_me',
  JWT_SECRET: randomBytes(32).toString('hex'),
  LOG_LEVEL: 'error',
  PAYMENT_SIMULATION: 'off',
  DATABASE_POOL_SIZE: '5',
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
const connect = () =>
  new Promise((resolve) => {
    const s = createConnection({ host: '127.0.0.1', port })
    s.setTimeout(100, () => {
      s.destroy()
      resolve(false)
    })
    s.on('connect', () => {
      s.destroy()
      resolve(true)
    })
    s.on('error', () => {
      s.destroy()
      resolve(false)
    })
  })
let child
async function stop() {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  const exited = once(child, 'exit')
  child.kill('SIGTERM')
  const t = setTimeout(() => child.kill('SIGKILL'), 5000)
  await exited
  clearTimeout(t)
  child = null
}
async function start() {
  if (await connect()) throw Error('Port already occupied')
  const t = performance.now()
  child = spawn(process.execPath, ['apps/api/dist/main.js'], { cwd: root, env, stdio: 'ignore' })
  while (!(await connect())) {
    if (child.exitCode !== null || child.signalCode !== null)
      throw Error('Child exited before listen')
    if (performance.now() - t > 30000) throw Error('Startup deadline')
    await pause(10)
  }
  return performance.now() - t
}
const base = `http://127.0.0.1:${port}/api/v1`
let token
async function cart() {
  const t = performance.now()
  const r = await fetch(base + '/cart', {
    headers: {
      'X-App-Id': 'shop',
      Authorization: 'Bearer ' + token,
      'X-Checkout-Diagnostics': '1',
    },
    signal: AbortSignal.timeout(10000),
  })
  await r.arrayBuffer()
  return {
    ms: performance.now() - t,
    status: r.status,
    serverTiming: r.headers.get('server-timing'),
  }
}
;(async () => {
  const samples = []
  try {
    await start()
    const demo = await fetch(base + '/auth/demo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-App-Id': 'shop' },
      body: JSON.stringify({ role: 'BUYER' }),
    })
    if (!demo.ok) throw Error('Fixture demo ' + demo.status)
    const cookie = demo.headers.get('set-cookie').split(';')[0]
    const refresh = await fetch(base + '/auth/refresh', {
      method: 'POST',
      headers: { 'X-App-Id': 'shop', Cookie: cookie },
    })
    if (!refresh.ok) throw Error('Fixture session ' + refresh.status)
    token = (await refresh.json()).accessToken
    await stop()
    for (let i = 0; i < 30; i++) {
      const listenMs = await start()
      const first = await cart()
      const warm = await cart()
      samples.push({ sequence: i, listenMs, first, warm })
      await stop()
    }
    const result = {
      at: new Date().toISOString(),
      commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      environment:
        'local production Node process restarted; existing PostgreSQL and Meilisearch containers and OS caches retained; pool5; real JWT; same demo buyer; empty cart; 100ms TCP timeout and 10ms retry delay; not Render/Neon scale-to-zero',
      samples,
    }
    writeFileSync('/tmp/checkout-process-cold.json', JSON.stringify(result, null, 2))
    console.log(
      JSON.stringify({
        samples: samples.length,
        errors: samples.filter((s) => s.first.status !== 200 || s.warm.status !== 200).length,
      }),
    )
  } finally {
    await stop()
  }
})().catch((e) => {
  console.error(e.message)
  process.exitCode = 1
})
